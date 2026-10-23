"""Stage 7: per-scene voice padded to the exact scene length, then concatenated.

Each scene's audio is exactly ``frames * sample_rate / fps`` samples, so the voice track
cannot drift from the video regardless of length.
"""

from __future__ import annotations

import asyncio

from stickforge.core.cache import atomic_write_text, canonical_key
from stickforge.core.ffmpeg import build_concat_copy, build_scene_audio, concat_list_text
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.util import run_all

AUDIO_VERSION = 1


def scene_samples(frames: int, fps: int, sample_rate: int) -> int:
    num = frames * sample_rate
    if num % fps:
        raise ValueError(f"sample rate {sample_rate} not frame-aligned at {fps} fps")
    return num // fps


async def run(ctx: RunContext) -> None:
    acfg = ctx.config.audio
    limit = asyncio.Semaphore(ctx.config.render.parallelism() * 2)
    ctx.reporter.stage("audio", len(ctx.scenes) + 1)

    async def one(st: SceneState) -> None:
        assert st.audio is not None and st.audio_key is not None
        samples = scene_samples(st.frames, ctx.fps, acfg.sample_rate)
        key = canonical_key(
            {
                "stage": "scene_audio",
                "v": AUDIO_VERSION,
                "voice": st.audio_key,
                "samples": samples,
                "sr": acfg.sample_rate,
                "fade_ms": acfg.fade_ms,
            }
        )
        hit = None if ctx.force else ctx.cache.get(key)
        if hit is None:
            tmp = ctx.cache.tmp_path(key, ".wav")
            args = build_scene_audio(
                ctx.ffmpeg.ffmpeg,
                st.audio.path,
                tmp,
                voice_s=st.audio.duration_s,
                samples=samples,
                sample_rate=acfg.sample_rate,
                fade_ms=acfg.fade_ms,
            )
            try:
                async with limit:
                    await ctx.ffmpeg.run(
                        args, timeout_s=ctx.ffmpeg.timeout_for(st.duration_s(ctx.fps))
                    )
                hit = ctx.cache.commit(key, tmp, ".wav", {"samples": samples})
            except BaseException:
                ctx.cache.discard(tmp)
                raise
        st.scene_audio, st.scene_audio_key = hit.path, key
        ctx.reporter.advance("audio")

    await run_all(one, ctx.scenes)

    keys = [s.scene_audio_key for s in ctx.scenes]
    key = canonical_key({"stage": "voice_track", "v": AUDIO_VERSION, "parts": keys})
    hit = None if ctx.force else ctx.cache.get(key)
    if hit is None:
        rel = [ctx.cache.relpath(s.scene_audio) for s in ctx.scenes if s.scene_audio]
        list_file = ctx.cache.root / f"concat-{key}.txt"
        atomic_write_text(list_file, concat_list_text(rel))
        tmp = ctx.cache.tmp_path(key, ".wav")
        try:
            total_s = ctx.total_frames() / ctx.fps
            await ctx.ffmpeg.run(
                build_concat_copy(ctx.ffmpeg.ffmpeg, list_file, tmp),
                timeout_s=ctx.ffmpeg.timeout_for(total_s / 10),
            )
            hit = ctx.cache.commit(key, tmp, ".wav", {"scenes": len(keys)})
        except BaseException:
            ctx.cache.discard(tmp)
            raise
        finally:
            list_file.unlink(missing_ok=True)
    ctx.artifacts["audio"], ctx.keys["audio"] = hit.path, key
    ctx.reporter.advance("audio")
