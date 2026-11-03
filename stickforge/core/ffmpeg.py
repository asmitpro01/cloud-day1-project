"""FFmpeg/ffprobe: pure argument-list builders + an async runner with hard timeouts.

Rules: argument lists only (never a shell), and every filter-graph string is assembled
here exclusively from numbers and enums we control — never from user or LLM text.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from stickforge.core.security import REDACTOR

BASE_ARGS = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error"]


class FFmpegError(RuntimeError):
    pass


def _num(x: float) -> str:
    """Format a number for a filter graph; rejects anything non-finite."""
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError("non-finite number in filter graph")
    return f"{x:.6f}".rstrip("0").rstrip(".") if isinstance(x, float) else str(int(x))


# ---------------------------------------------------------------------------
# Encoder parameters
# ---------------------------------------------------------------------------

HW_ENCODERS = ("h264_nvenc", "h264_videotoolbox", "h264_qsv")


@dataclass(frozen=True)
class EncoderParams:
    codec: str
    preset: str
    crf: int
    fps: int
    gop_s: int = 2

    def to_args(self) -> list[str]:
        common = ["-pix_fmt", "yuv420p", "-g", str(self.fps * self.gop_s)]
        if self.codec == "libx264":
            q = ["-preset", self.preset, "-crf", str(self.crf), "-profile:v", "high"]
        elif self.codec == "h264_nvenc":
            q = [
                "-preset",
                "p5",
                "-rc",
                "vbr",
                "-cq",
                str(self.crf),
                "-b:v",
                "0",
                "-profile:v",
                "high",
            ]
        elif self.codec == "h264_videotoolbox":
            q = ["-q:v", str(max(1, min(100, 100 - self.crf * 2))), "-profile:v", "high"]
        elif self.codec == "h264_qsv":
            q = ["-global_quality", str(self.crf), "-profile:v", "high"]
        else:
            raise ValueError(f"unsupported encoder {self.codec!r}")
        return ["-c:v", self.codec, *q, *common]


# ---------------------------------------------------------------------------
# Builders (pure; unit-tested for exact arg lists)
# ---------------------------------------------------------------------------


def build_static_segment(
    ffmpeg: str,
    image: Path,
    out: Path,
    *,
    frames: int,
    width: int,
    height: int,
    enc: EncoderParams,
) -> list[str]:
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={width}:{height},setsar=1,format=yuv420p"
    )
    return [
        ffmpeg,
        *BASE_ARGS,
        "-loop",
        "1",
        "-framerate",
        str(enc.fps),
        "-i",
        str(image),
        "-vf",
        vf,
        "-frames:v",
        str(frames),
        "-r",
        str(enc.fps),
        *enc.to_args(),
        "-video_track_timescale",
        str(enc.fps * 512),
        "-an",
        str(out),
    ]


def build_scene_audio(
    ffmpeg: str,
    voice: Path,
    out: Path,
    *,
    voice_s: float,
    samples: int,
    sample_rate: int,
    fade_ms: int,
) -> list[str]:
    """Resample to stereo PCM, fade the edges, pad/trim to exactly ``samples``."""
    filters = [f"aresample={sample_rate}", "aformat=sample_fmts=s16:channel_layouts=stereo"]
    if fade_ms > 0:
        fd = fade_ms / 1000.0
        filters.append(f"afade=t=in:st=0:d={_num(fd)}")
        filters.append(f"afade=t=out:st={_num(max(0.0, voice_s - fd))}:d={_num(fd)}")
    filters += [f"apad=whole_len={samples}", f"atrim=end_sample={samples}"]
    return [
        ffmpeg,
        *BASE_ARGS,
        "-i",
        str(voice),
        "-af",
        ",".join(filters),
        "-c:a",
        "pcm_s16le",
        "-ar",
        str(sample_rate),
        "-ac",
        "2",
        str(out),
    ]


def concat_list_text(relpaths: list[str]) -> str:
    """ffconcat list. Entries are cache-generated relative paths (hex names) only."""
    for p in relpaths:
        if not all(c.isalnum() or c in "._-/" for c in p) or ".." in p or p.startswith("/"):
            raise ValueError(f"unsafe concat entry {p!r}")
    return "ffconcat version 1.0\n" + "".join(f"file '{p}'\n" for p in relpaths)


def build_concat_copy(ffmpeg: str, list_file: Path, out: Path) -> list[str]:
    return [ffmpeg, *BASE_ARGS, "-f", "concat", "-i", str(list_file), "-c", "copy", str(out)]


def build_mux(
    ffmpeg: str, video: Path, audio: Path, out: Path, *, aac_bitrate: str, sample_rate: int
) -> list[str]:
    return [
        ffmpeg,
        *BASE_ARGS,
        "-i",
        str(video),
        "-i",
        str(audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        aac_bitrate,
        "-ar",
        str(sample_rate),
        "-ac",
        "2",
        "-movflags",
        "+faststart",
        str(out),
    ]


def build_probe(ffprobe: str, path: Path) -> list[str]:
    return [
        ffprobe,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


@dataclass
class FFmpeg:
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    timeout_base_s: float = 60.0
    timeout_per_media_s: float = 10.0
    _encoders: list[str] | None = field(default=None, repr=False)

    @classmethod
    def from_paths(cls, ffmpeg: str, ffprobe: str, **kw: Any) -> FFmpeg:
        return cls(
            ffmpeg=shutil.which(ffmpeg) or ffmpeg, ffprobe=shutil.which(ffprobe) or ffprobe, **kw
        )

    def available(self) -> bool:
        return shutil.which(self.ffmpeg) is not None and shutil.which(self.ffprobe) is not None

    def timeout_for(self, media_s: float) -> float:
        return self.timeout_base_s + self.timeout_per_media_s * max(0.0, media_s)

    async def run(self, args: list[str], *, timeout_s: float) -> bytes:
        if not args or not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            raise TypeError("args must be a list[str]")
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            await proc.wait()
            raise FFmpegError(f"{Path(args[0]).name} timed out after {timeout_s:.0f}s") from None
        if proc.returncode != 0:
            tail = stderr.decode("utf-8", "replace")[-2000:]
            raise FFmpegError(
                f"{Path(args[0]).name} exited {proc.returncode}: {REDACTOR.text(tail)}"
            )
        return stdout

    async def probe(self, path: Path) -> dict[str, Any]:
        out = await self.run(build_probe(self.ffprobe, path), timeout_s=60)
        data: dict[str, Any] = json.loads(out)
        return data

    async def duration(self, path: Path) -> float:
        data = await self.probe(path)
        try:
            return float(data["format"]["duration"])
        except (KeyError, ValueError):
            raise FFmpegError(f"could not read duration of {path.name}") from None

    async def validate_audio(self, path: Path, *, max_s: float = 600.0) -> float:
        """ffprobe validation for audio before use: one audio stream, sane duration."""
        data = await self.probe(path)
        streams = data.get("streams", [])
        if not any(s.get("codec_type") == "audio" for s in streams):
            raise FFmpegError(f"{path.name}: no audio stream")
        if any(
            s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")
            for s in streams
        ):
            raise FFmpegError(f"{path.name}: unexpected video stream in audio file")
        dur = float(data.get("format", {}).get("duration", 0.0))
        if not 0.0 < dur <= max_s:
            raise FFmpegError(f"{path.name}: audio duration {dur:.2f}s out of bounds")
        return dur

    async def encoders(self) -> list[str]:
        """H.264 encoders that actually work here (test-encode, not just compiled in)."""
        if self._encoders is None:
            ok = []
            for enc in (*HW_ENCODERS, "libx264"):
                args = [
                    self.ffmpeg,
                    *BASE_ARGS,
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=256x144:r=30:d=0.2",
                    "-c:v",
                    enc,
                    "-f",
                    "null",
                    "-",
                ]
                try:
                    await self.run(args, timeout_s=20)
                    ok.append(enc)
                except (FFmpegError, OSError):
                    pass
            self._encoders = ok
        return self._encoders

    async def pick_encoder(self, requested: str) -> str:
        working = await self.encoders()
        if requested != "auto":
            if requested not in working:
                raise FFmpegError(f"encoder {requested!r} not usable here (working: {working})")
            return requested
        for enc in (*HW_ENCODERS, "libx264"):
            if enc in working:
                return enc
        raise FFmpegError("no working H.264 encoder (is ffmpeg built with libx264?)")
