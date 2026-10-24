"""Stages 6 + 9: concat segments (stream copy), mux with audio, verify with ffprobe."""

from __future__ import annotations

import shutil
from fractions import Fraction
from pathlib import Path
from typing import Any

from stickforge.core.cache import CacheEntry, atomic_write_text, canonical_key
from stickforge.core.ffmpeg import (
    FFmpegError,
    build_concat_copy,
    build_ebur128,
    build_mux,
    concat_list_text,
    parse_ebur128,
)
from stickforge.pipeline.context import RunContext

ASSEMBLE_VERSION = 1
DURATION_TOLERANCE_S = 0.2


async def _concat_video(ctx: RunContext) -> tuple[Path, str]:
    keys = [s.segment_id for s in ctx.scenes]
    key = canonical_key({"stage": "video_concat", "v": ASSEMBLE_VERSION, "parts": keys})
    hit = None if ctx.force else ctx.cache.get(key)
    if hit is None:
        rel = [ctx.cache.relpath(s.segment) for s in ctx.scenes if s.segment]
        list_file = ctx.cache.root / f"concat-{key}.txt"
        atomic_write_text(list_file, concat_list_text(rel))
        tmp = ctx.cache.tmp_path(key, ".mp4")
        try:
            await ctx.ffmpeg.run(
                build_concat_copy(ctx.ffmpeg.ffmpeg, list_file, tmp),
                timeout_s=ctx.ffmpeg.timeout_for(ctx.total_frames() / ctx.fps / 10),
            )
            hit = ctx.cache.commit(key, tmp, ".mp4", {})
        except BaseException:
            ctx.cache.discard(tmp)
            raise
        finally:
            list_file.unlink(missing_ok=True)
    return hit.path, hit.sha256


async def measure_loudness(ctx: RunContext, media: Path) -> dict[str, float]:
    """EBU R128 integrated loudness / LRA / true peak of a file's audio."""
    _, err = await ctx.ffmpeg.run_capture(
        build_ebur128(ctx.ffmpeg.ffmpeg, media),
        timeout_s=ctx.ffmpeg.timeout_for(ctx.total_frames() / ctx.fps / 10),
    )
    return parse_ebur128(err.decode("utf-8", "replace"))


def verify(
    probe: dict[str, Any], *, width: int, height: int, fps: int, expected_s: float, sample_rate: int
) -> list[str]:
    """Return a list of problems with the final file (empty = OK)."""
    problems: list[str] = []
    streams = probe.get("streams", [])
    v = [s for s in streams if s.get("codec_type") == "video"]
    a = [s for s in streams if s.get("codec_type") == "audio"]
    if len(v) != 1 or len(a) != 1:
        return [f"expected 1 video + 1 audio stream, got {len(v)} + {len(a)}"]
    vs, as_ = v[0], a[0]
    if vs.get("codec_name") != "h264":
        problems.append(f"video codec {vs.get('codec_name')} != h264")
    if (vs.get("width"), vs.get("height")) != (width, height):
        problems.append(f"resolution {vs.get('width')}x{vs.get('height')} != {width}x{height}")
    if vs.get("pix_fmt") != "yuv420p":
        problems.append(f"pix_fmt {vs.get('pix_fmt')} != yuv420p")
    if Fraction(vs.get("avg_frame_rate", "0/1")) != fps:
        problems.append(f"frame rate {vs.get('avg_frame_rate')} != {fps}")
    if as_.get("codec_name") != "aac" or int(as_.get("sample_rate", 0)) != sample_rate:
        problems.append(
            f"audio {as_.get('codec_name')}@{as_.get('sample_rate')} != aac@{sample_rate}"
        )
    dur = float(probe.get("format", {}).get("duration", 0.0))
    if abs(dur - expected_s) > DURATION_TOLERANCE_S:
        problems.append(f"duration {dur:.3f}s differs from expected {expected_s:.3f}s")
    return problems


async def run(ctx: RunContext) -> Path:
    ctx.reporter.stage("assemble", 3)
    video, vkey = await _concat_video(ctx)
    ctx.reporter.advance("assemble")

    acfg = ctx.config.audio

    async def mux(gain_db: float) -> CacheEntry:
        key = canonical_key(
            {
                "stage": "mux",
                "v": ASSEMBLE_VERSION,
                "video": vkey,
                "audio": ctx.keys["audio"],
                "aac": acfg.aac_bitrate,
                "sr": acfg.sample_rate,
                "gain_db": gain_db,
            }
        )
        hit = None if ctx.force else ctx.cache.get(key)
        if hit is not None:
            return hit
        tmp = ctx.cache.tmp_path(key, ".mp4")
        try:
            await ctx.ffmpeg.run(
                build_mux(
                    ctx.ffmpeg.ffmpeg,
                    video,
                    ctx.artifacts["audio"],
                    tmp,
                    aac_bitrate=acfg.aac_bitrate,
                    sample_rate=acfg.sample_rate,
                    gain_db=gain_db,
                ),
                timeout_s=ctx.ffmpeg.timeout_for(ctx.total_frames() / ctx.fps / 4),
            )
            loud = await measure_loudness(ctx, tmp)
            return ctx.cache.commit(key, tmp, ".mp4", {"loudness": loud})
        except BaseException:
            ctx.cache.discard(tmp)
            raise

    hit = await mux(0.0)
    loud = hit.meta.get("loudness", {})
    peak = loud.get("tp")
    if peak is not None and peak > acfg.true_peak + 0.05:
        # Safety net: the encoder overshot the ceiling despite the headroom. Trim once.
        gain = round(acfg.true_peak - peak - 0.1, 2)
        ctx.log.warning("assemble.true_peak_trim", measured_tp=peak, gain_db=gain)
        ctx.warnings.append(f"true peak {peak} dBTP after AAC; trimmed audio by {gain} dB")
        hit = await mux(gain)
        loud = hit.meta.get("loudness", {})
    ctx.artifacts_meta["loudness"] = loud
    ctx.reporter.advance("assemble")

    expected = ctx.total_frames() / ctx.fps
    problems = verify(
        await ctx.ffmpeg.probe(hit.path),
        width=ctx.mode.width,
        height=ctx.mode.height,
        fps=ctx.fps,
        expected_s=expected,
        sample_rate=acfg.sample_rate,
    )
    if problems:
        raise FFmpegError("final video failed verification: " + "; ".join(problems))

    out = ctx.out_dir / ctx.project.project.output.filename
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = out.with_name(f".{out.name}.tmp")
    shutil.copyfile(hit.path, tmp_out)
    tmp_out.replace(out)
    ctx.artifacts["final"] = out
    ctx.reporter.advance("assemble")
    return out
