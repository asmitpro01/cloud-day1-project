"""FFmpeg/ffprobe: pure argument-list builders + an async runner with hard timeouts.

Rules: argument lists only (never a shell), and every filter-graph string is assembled
here exclusively from numbers and enums we control — never from user or LLM text.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import math
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
    if not math.isfinite(x):
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


def concat_list_text(relpaths: list[str]) -> str:
    """ffconcat list. Entries are cache-generated relative paths (hex names) only."""
    for p in relpaths:
        if not all(c.isalnum() or c in "._-/" for c in p) or ".." in p or p.startswith("/"):
            raise ValueError(f"unsafe concat entry {p!r}")
    return "ffconcat version 1.0\n" + "".join(f"file '{p}'\n" for p in relpaths)


def build_concat_copy(ffmpeg: str, list_file: Path, out: Path) -> list[str]:
    return [ffmpeg, *BASE_ARGS, "-f", "concat", "-i", str(list_file), "-c", "copy", str(out)]


def build_mux(
    ffmpeg: str,
    video: Path,
    audio: Path,
    out: Path,
    *,
    aac_bitrate: str,
    sample_rate: int,
    gain_db: float = 0.0,
) -> list[str]:
    trim = ["-af", f"volume={_num(gain_db)}dB"] if gain_db else []
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
        *trim,
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


@dataclass(frozen=True)
class Overlay:
    """A full-frame RGBA PNG composited over the video between start_s and end_s."""

    png: Path
    start_s: float = 0.0
    end_s: float | None = None  # None = until the end
    fade_in_s: float = 0.0


def build_segment(
    ffmpeg: str,
    image: Path,
    out: Path,
    *,
    frames: int,
    width: int,
    height: int,
    enc: EncoderParams,
    motion_filter: str,
    overlays: list[Overlay] | None = None,
    prev_frame: Path | None = None,
    crossfade_s: float = 0.0,
) -> list[str]:
    """One scene: camera motion -> overlays -> optional crossfade from the previous scene.

    ``motion_filter`` comes from ``camera.zoompan_filter`` (numbers only). Overlay and
    crossfade sources are files we rendered; the graph references them by input index.
    """
    fps = enc.fps
    args = [ffmpeg, *BASE_ARGS, "-i", str(image)]
    graph = [f"[0:v]{motion_filter}[v0]"]
    cur, idx = "v0", 1
    for k, ov in enumerate(overlays or []):
        args += ["-loop", "1", "-framerate", str(fps), "-i", str(ov.png)]
        src = f"[{idx}:v]format=rgba"
        if ov.fade_in_s > 0:
            src += f",fade=t=in:st={_num(ov.start_s)}:d={_num(ov.fade_in_s)}:alpha=1"
        graph.append(f"{src}[o{k}]")
        end = "" if ov.end_s is None else f",{_num(ov.end_s)}"
        enable = (
            f":enable='between(t,{_num(ov.start_s)}{end})'"
            if ov.end_s is not None
            else f":enable='gte(t,{_num(ov.start_s)})'"
            if ov.start_s > 0
            else ""
        )
        graph.append(f"[{cur}][o{k}]overlay=0:0:format=auto{enable}[v{k + 1}]")
        cur, idx = f"v{k + 1}", idx + 1
    if prev_frame is not None and crossfade_s > 0:
        args += [
            "-loop",
            "1",
            "-framerate",
            str(fps),
            "-t",
            _num(crossfade_s),
            "-i",
            str(prev_frame),
        ]
        graph.append(f"[{idx}:v]scale={width}:{height},setsar=1,format=yuv420p,fps={fps}[pf]")
        graph.append(
            f"[pf][{cur}]xfade=transition=fade:duration={_num(crossfade_s)}:offset=0,"
            f"format=yuv420p[vx]"
        )
        cur = "vx"
    return [
        *args,
        "-filter_complex",
        ";".join(graph),
        "-map",
        f"[{cur}]",
        "-frames:v",
        str(frames),
        "-r",
        str(fps),
        *enc.to_args(),
        "-video_track_timescale",
        str(fps * 512),
        "-an",
        str(out),
    ]


def build_scene_audio_mix(
    ffmpeg: str,
    voice: Path,
    out: Path,
    *,
    voice_s: float,
    samples: int,
    sample_rate: int,
    fade_ms: int,
    sfx: Path | None = None,
    sfx_s: float = 0.0,
    sfx_volume_db: float = -6.0,
) -> list[str]:
    """Scene audio = voice (edge-faded) [+ SFX at scene start], exactly ``samples`` long."""
    for v in (voice_s, sfx_s, sfx_volume_db):
        _num(v)  # reject NaN/inf before any arithmetic can hide it
    fd = fade_ms / 1000.0
    voice_chain = [f"aresample={sample_rate}", "aformat=sample_fmts=fltp:channel_layouts=stereo"]
    if fade_ms > 0:
        voice_chain += [
            f"afade=t=in:st=0:d={_num(fd)}",
            f"afade=t=out:st={_num(max(0.0, voice_s - fd))}:d={_num(fd)}",
        ]
    voice_chain += [f"apad=whole_len={samples}", f"atrim=end_sample={samples}"]
    args = [ffmpeg, *BASE_ARGS, "-i", str(voice)]
    if sfx is None:
        graph = f"[0:a]{','.join(voice_chain)}[a]"
    else:
        scene_s = samples / sample_rate
        keep = max(0.05, min(sfx_s, scene_s))
        args += ["-i", str(sfx)]
        graph = (
            f"[0:a]{','.join(voice_chain)}[v];"
            f"[1:a]aresample={sample_rate},aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"atrim=0:{_num(keep)},afade=t=out:st={_num(max(0.0, keep - 0.03))}:d=0.03,"
            f"volume={_num(sfx_volume_db)}dB[s];"
            f"[v][s]amix=inputs=2:normalize=0:duration=first,atrim=end_sample={samples}[a]"
        )
    return [
        *args,
        "-filter_complex",
        graph,
        "-map",
        "[a]",
        "-c:a",
        "pcm_f32le",
        "-ar",
        str(sample_rate),
        "-ac",
        "2",
        str(out),
    ]


@dataclass(frozen=True)
class DuckParams:
    threshold: float = 0.02
    ratio: float = 8.0
    attack_ms: float = 20.0
    release_ms: float = 400.0


def build_music_mix(
    ffmpeg: str,
    voice: Path,
    music: Path,
    out: Path,
    *,
    total_samples: int,
    sample_rate: int,
    music_db: float,
    duck: DuckParams,
    fade_in_s: float = 1.0,
    fade_out_s: float = 2.5,
) -> list[str]:
    """Loop the music bed under the voice track, ducked by the voice (sidechain)."""
    total_s = total_samples / sample_rate
    graph = (
        f"[1:a]aresample={sample_rate},aformat=sample_fmts=fltp:channel_layouts=stereo,"
        f"atrim=end_sample={total_samples},volume={_num(music_db)}dB,"
        f"afade=t=in:st=0:d={_num(fade_in_s)},"
        f"afade=t=out:st={_num(max(0.0, total_s - fade_out_s))}:d={_num(fade_out_s)}[m];"
        f"[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo][sc];"
        f"[m][sc]sidechaincompress=threshold={_num(duck.threshold)}:ratio={_num(duck.ratio)}:"
        f"attack={_num(duck.attack_ms)}:release={_num(duck.release_ms)}[md];"
        f"[vo][md]amix=inputs=2:normalize=0:duration=first,atrim=end_sample={total_samples}[a]"
    )
    return [
        ffmpeg,
        *BASE_ARGS,
        "-i",
        str(voice),
        "-stream_loop",
        "-1",
        "-i",
        str(music),
        "-filter_complex",
        graph,
        "-map",
        "[a]",
        "-c:a",
        "pcm_f32le",
        "-ar",
        str(sample_rate),
        "-ac",
        "2",
        str(out),
    ]


@dataclass(frozen=True)
class LoudnessTarget:
    i: float = -14.0
    tp: float = -1.0
    lra: float = 11.0


def build_loudnorm_measure(ffmpeg: str, audio: Path, target: LoudnessTarget) -> list[str]:
    af = (
        f"loudnorm=I={_num(target.i)}:TP={_num(target.tp)}:LRA={_num(target.lra)}:print_format=json"
    )
    # -loglevel info is required: loudnorm prints its JSON at info level.
    return [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-loglevel",
        "info",
        "-i",
        str(audio),
        "-af",
        af,
        "-f",
        "null",
        "-",
    ]


_MEASURE_KEYS = ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")


def parse_loudnorm(stderr: str) -> dict[str, float]:
    """Extract loudnorm's JSON block; values may be '-inf' for silence."""
    start = stderr.rfind("{")
    end = stderr.rfind("}")
    if start < 0 or end < start:
        raise FFmpegError("loudnorm produced no measurement")
    doc = json.loads(stderr[start : end + 1])
    return {k: float(doc[k]) for k in _MEASURE_KEYS}


def build_loudnorm_apply(
    ffmpeg: str,
    audio: Path,
    out: Path,
    target: LoudnessTarget,
    m: dict[str, float],
    sample_rate: int,
) -> list[str]:
    af = (
        f"loudnorm=I={_num(target.i)}:TP={_num(target.tp)}:LRA={_num(target.lra)}"
        f":measured_I={_num(m['input_i'])}:measured_TP={_num(m['input_tp'])}"
        f":measured_LRA={_num(m['input_lra'])}:measured_thresh={_num(m['input_thresh'])}"
        f":offset={_num(m['target_offset'])}:linear=true:print_format=summary,"
        f"aresample={sample_rate}"
    )
    return [
        ffmpeg,
        *BASE_ARGS,
        "-i",
        str(audio),
        "-af",
        af,
        "-c:a",
        "pcm_f32le",
        "-ar",
        str(sample_rate),
        "-ac",
        "2",
        str(out),
    ]


def build_ebur128(ffmpeg: str, media: Path) -> list[str]:
    """Measure integrated loudness + true peak of a file's audio (EBU R128)."""
    return [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-nostats",
        "-loglevel",
        "info",
        "-i",
        str(media),
        "-map",
        "0:a:0",
        "-af",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
    ]


def parse_ebur128(stderr: str) -> dict[str, float]:
    """Summary values: i (LUFS), lra (LU), tp (dBFS true peak). Missing keys are omitted."""
    import re

    idx = stderr.rfind("Summary:")
    if idx < 0:
        return {}
    summary = stderr[idx:]
    out: dict[str, float] = {}
    for key, pat in (
        ("i", r"I:\s+(-?[\d.]+|-inf) LUFS"),
        ("lra", r"LRA:\s+(-?[\d.]+) LU\b"),
        ("tp", r"Peak:\s+(-?[\d.]+|-inf) dBFS"),
    ):
        m = re.search(pat, summary)
        if m:
            out[key] = float(m.group(1))
    return out


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
        out, _ = await self.run_capture(args, timeout_s=timeout_s)
        return out

    async def run_capture(self, args: list[str], *, timeout_s: float) -> tuple[bytes, bytes]:
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
        return stdout, stderr

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
