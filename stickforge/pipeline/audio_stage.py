"""Stage 7: scene audio -> voice track -> music ducking -> two-pass loudnorm.

Each scene's audio is exactly ``frames * sample_rate / fps`` samples (voice + padding,
optional SFX at the scene start), so the soundtrack cannot drift from the video. Mixing
runs in 32-bit float so nothing clips before loudness normalization.
"""

from __future__ import annotations

import asyncio
import math
from collections.abc import Callable
from pathlib import Path

from stickforge.core.cache import CacheEntry, atomic_write_text, canonical_key, file_sha256
from stickforge.core.ffmpeg import (
    DuckParams,
    LoudnessTarget,
    build_concat_copy,
    build_loudnorm_apply,
    build_loudnorm_measure,
    build_music_mix,
    build_scene_audio_mix,
    concat_list_text,
    parse_loudnorm,
)
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.util import run_all

AUDIO_VERSION = 2
SILENCE_LUFS = -70.0  # below this, loudnorm has nothing to normalize


def scene_samples(frames: int, fps: int, sample_rate: int) -> int:
    num = frames * sample_rate
    if num % fps:
        raise ValueError(f"sample rate {sample_rate} not frame-aligned at {fps} fps")
    return num // fps


async def _cached(
    ctx: RunContext,
    key: str,
    suffix: str,
    args_for: Callable[[Path], list[str]],
    timeout_s: float,
    *,
    force: bool,
) -> CacheEntry:
    """Run an ffmpeg job whose output is cached under ``key``."""
    hit = None if force else ctx.cache.get(key)
    if hit is not None:
        return hit
    tmp = ctx.cache.tmp_path(key, suffix)
    try:
        await ctx.ffmpeg.run(args_for(tmp), timeout_s=timeout_s)
        return ctx.cache.commit(key, tmp, suffix, {})
    except BaseException:
        ctx.cache.discard(tmp)
        raise


async def run(ctx: RunContext) -> None:
    acfg = ctx.config.audio
    sr = acfg.sample_rate
    limit = asyncio.Semaphore(ctx.config.render.parallelism() * 2)
    ctx.reporter.stage("audio", len(ctx.scenes) + 3)

    async def one(st: SceneState) -> None:
        assert st.audio is not None and st.audio_id is not None
        samples = scene_samples(st.frames, ctx.fps, sr)
        sfx_path, sfx_s, sfx_hash = None, 0.0, None
        if st.scene.sfx:
            sfx_path = ctx.project.resolve(st.scene.sfx)
            sfx_s = await ctx.ffmpeg.validate_audio(sfx_path, max_s=600)
            sfx_hash = file_sha256(sfx_path)
        key = canonical_key(
            {
                "stage": "scene_audio",
                "v": AUDIO_VERSION,
                "voice": st.audio_id,
                "samples": samples,
                "sr": sr,
                "fade_ms": acfg.fade_ms,
                "sfx": sfx_hash,
                "sfx_db": acfg.sfx_volume_db,
            }
        )
        force = ctx.forced(st)
        cached = not force and ctx.cache.get(key) is not None
        assert st.audio is not None
        voice = st.audio

        def args(tmp: Path) -> list[str]:
            return build_scene_audio_mix(
                ctx.ffmpeg.ffmpeg,
                voice.path,
                tmp,
                voice_s=voice.duration_s,
                samples=samples,
                sample_rate=sr,
                fade_ms=acfg.fade_ms,
                sfx=sfx_path,
                sfx_s=sfx_s,
                sfx_volume_db=acfg.sfx_volume_db,
            )

        async with limit:
            entry = await _cached(
                ctx,
                key,
                ".wav",
                args,
                ctx.ffmpeg.timeout_for(st.duration_s(ctx.fps)),
                force=force,
            )
        st.scene_audio, st.scene_audio_id = entry.path, entry.sha256
        st.cache_hits["scene_audio"] = cached
        ctx.reporter.advance("audio", cached=cached)

    await run_all(one, ctx.scenes)
    total_s = ctx.total_frames() / ctx.fps
    total_samples = scene_samples(ctx.total_frames(), ctx.fps, sr)
    long_timeout = ctx.ffmpeg.timeout_for(total_s / 4)

    # 1) voice track: PCM concat (stream copy)
    vkey = canonical_key(
        {
            "stage": "voice_track",
            "v": AUDIO_VERSION,
            "parts": [s.scene_audio_id for s in ctx.scenes],
        }
    )

    def concat_args(tmp: Path) -> list[str]:
        rel = [ctx.cache.relpath(s.scene_audio) for s in ctx.scenes if s.scene_audio]
        list_file = ctx.cache.root / f"concat-{vkey}.txt"
        atomic_write_text(list_file, concat_list_text(rel))
        return build_concat_copy(ctx.ffmpeg.ffmpeg, list_file, tmp)

    try:
        vtrack = await _cached(ctx, vkey, ".wav", concat_args, long_timeout, force=ctx.force)
        voice_track = vtrack.path
    finally:
        (ctx.cache.root / f"concat-{vkey}.txt").unlink(missing_ok=True)
    ctx.reporter.advance("audio")

    # 2) music bed, ducked under the voice
    music = ctx.project.project.music
    mix, mix_id = voice_track, vtrack.sha256
    if music is not None:
        mpath = ctx.project.resolve(music.file)
        await ctx.ffmpeg.validate_audio(mpath, max_s=4 * 3600)
        duck = DuckParams(
            acfg.duck_threshold, acfg.duck_ratio, acfg.duck_attack_ms, acfg.duck_release_ms
        )
        mkey = canonical_key(
            {
                "stage": "music_mix",
                "v": AUDIO_VERSION,
                "voice": vtrack.sha256,
                "music": file_sha256(mpath),
                "db": music.volume_db,
                "duck": repr(duck),
                "fades": [acfg.music_fade_in_s, acfg.music_fade_out_s],
            }
        )

        def mix_args(tmp: Path) -> list[str]:
            return build_music_mix(
                ctx.ffmpeg.ffmpeg,
                voice_track,
                mpath,
                tmp,
                total_samples=total_samples,
                sample_rate=sr,
                music_db=music.volume_db,
                duck=duck,
                fade_in_s=acfg.music_fade_in_s,
                fade_out_s=acfg.music_fade_out_s,
            )

        mixed = await _cached(ctx, mkey, ".wav", mix_args, long_timeout, force=ctx.force)
        mix, mix_id = mixed.path, mixed.sha256
    ctx.reporter.advance("audio")

    # 3) two-pass loudness normalization (I / TP / LRA from config)
    target = LoudnessTarget(acfg.loudness_i, acfg.true_peak - acfg.codec_headroom_db, acfg.lra)
    lkey = canonical_key(
        {"stage": "loudnorm", "v": AUDIO_VERSION, "mix": mix_id, "target": repr(target), "sr": sr}
    )
    hit = None if ctx.force else ctx.cache.get(lkey)
    if hit is None:
        _, err = await ctx.ffmpeg.run_capture(
            build_loudnorm_measure(ctx.ffmpeg.ffmpeg, mix, target), timeout_s=long_timeout
        )
        m = parse_loudnorm(err.decode("utf-8", "replace"))
        ctx.log.info("loudnorm.measured", **{k: round(v, 2) for k, v in m.items()})
        tmp = ctx.cache.tmp_path(lkey, ".wav")
        try:
            if not math.isfinite(m["input_i"]) or m["input_i"] < SILENCE_LUFS:
                ctx.log.warning("loudnorm.skipped_silence", input_i=m["input_i"])
                tmp.write_bytes(mix.read_bytes())
            else:
                await ctx.ffmpeg.run(
                    build_loudnorm_apply(ctx.ffmpeg.ffmpeg, mix, tmp, target, m, sr),
                    timeout_s=long_timeout,
                )
            hit = ctx.cache.commit(
                lkey, tmp, ".wav", {k: v if math.isfinite(v) else None for k, v in m.items()}
            )
        except BaseException:
            ctx.cache.discard(tmp)
            raise
    ctx.artifacts["audio"], ctx.keys["audio"] = hit.path, hit.sha256
    ctx.reporter.advance("audio")
