"""Shared run state passed through every stage."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from stickforge.config import EngineConfig, ModeConfig
from stickforge.core.cache import Cache
from stickforge.core.cost import CostLedger
from stickforge.core.ffmpeg import EncoderParams, FFmpeg
from stickforge.core.retry import RetryPolicy
from stickforge.providers.base import AudioResult, ImageResult
from stickforge.providers.registry import Registry
from stickforge.schema import LoadedProject, Scene


class Reporter(Protocol):
    def stage(self, name: str, total: int) -> None: ...
    def advance(self, name: str, *, cached: bool = False) -> None: ...
    def note(self, message: str) -> None: ...


class NullReporter:
    def stage(self, name: str, total: int) -> None:
        pass

    def advance(self, name: str, *, cached: bool = False) -> None:
        pass

    def note(self, message: str) -> None:
        pass


@dataclass
class SceneState:
    scene: Scene
    audio: AudioResult | None = None
    audio_id: str | None = None
    image: ImageResult | None = None
    image_id: str | None = None
    frames: int = 0
    segment: Path | None = None
    segment_id: str | None = None
    scene_audio: Path | None = None
    scene_audio_id: str | None = None
    cache_hits: dict[str, bool] = field(default_factory=dict)
    providers: dict[str, str] = field(default_factory=dict)  # stage -> provider used
    attempts: dict[str, int] = field(default_factory=dict)  # stage -> calls made this run
    cost_usd: float = 0.0  # spent this run (cache hits cost nothing)
    errors: list[str] = field(default_factory=list)  # provider failures that were survived
    cues: list[Any] = field(default_factory=list)  # captions_stage.Cue, scene-local times
    caption_pngs: list[tuple[Path, float, float, str]] = field(default_factory=list)
    title_png: Path | None = None
    title_id: str | None = None
    end_frame: Path | None = None  # camera view at the end of this scene (crossfade source)
    end_frame_id: str | None = None
    timings: dict[str, float] = field(default_factory=dict)  # stage -> seconds spent here
    seed_attempt: int = 0  # image re-roll index (QA retries)
    qa_status: str = "skipped"  # skipped | passed | flagged
    qa_issues: list[dict[str, str]] = field(default_factory=list)
    qa_attempts: int = 0

    def duration_s(self, fps: int) -> float:
        return self.frames / fps


def frame_quantum(fps: int) -> int:
    """Smallest frame count whose duration is a whole number of microseconds.

    The concat demuxer accumulates segment offsets in microseconds; segments that are a
    multiple of this length concatenate with exact constant-frame-rate timestamps.
    """
    return fps // math.gcd(fps, 1_000_000)


def frames_for(voice_s: float, padding_s: float, fps: int) -> int:
    """Scene length in whole frames, rounded up to the frame quantum (30 fps -> 3 frames)."""
    q = frame_quantum(fps)
    frames = math.ceil(round((voice_s + padding_s) * fps, 6))
    return max(q, math.ceil(frames / q) * q)


@dataclass
class RunContext:
    project: LoadedProject
    config: EngineConfig
    mode_name: str
    mode: ModeConfig
    registry: Registry
    cache: Cache
    ffmpeg: FFmpeg
    encoder: EncoderParams
    out_dir: Path
    reporter: Reporter
    log: Any
    force: bool = False
    only_scenes: frozenset[int] | None = None  # regenerate just these scenes (cache bypass)
    qa: bool = False
    ledger: CostLedger = field(default_factory=CostLedger)
    warnings: list[str] = field(default_factory=list)
    retry: RetryPolicy = field(default_factory=RetryPolicy)
    scenes: list[SceneState] = field(default_factory=list)
    artifacts: dict[str, Path] = field(default_factory=dict)
    artifacts_meta: dict[str, Any] = field(default_factory=dict)
    keys: dict[str, str] = field(default_factory=dict)

    def forced(self, st: SceneState) -> bool:
        """Bypass the cache for this scene's own assets?"""
        return self.force or (self.only_scenes is not None and st.scene.id in self.only_scenes)

    @property
    def fps(self) -> int:
        return self.mode.fps

    def total_frames(self) -> int:
        return sum(s.frames for s in self.scenes)
