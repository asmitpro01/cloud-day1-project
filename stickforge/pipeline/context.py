"""Shared run state passed through every stage."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from stickforge.config import EngineConfig, ModeConfig
from stickforge.core.cache import Cache
from stickforge.core.ffmpeg import EncoderParams, FFmpeg
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
    audio_key: str | None = None
    image: ImageResult | None = None
    image_key: str | None = None
    frames: int = 0
    segment: Path | None = None
    segment_key: str | None = None
    scene_audio: Path | None = None
    scene_audio_key: str | None = None
    cache_hits: dict[str, bool] = field(default_factory=dict)

    def duration_s(self, fps: int) -> float:
        return self.frames / fps


def frames_for(voice_s: float, padding_s: float, fps: int) -> int:
    """Scene length in whole frames (rounded up), so audio can match video sample-exactly."""
    return max(1, math.ceil(round((voice_s + padding_s) * fps, 6)))


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
    scenes: list[SceneState] = field(default_factory=list)
    artifacts: dict[str, Path] = field(default_factory=dict)
    keys: dict[str, str] = field(default_factory=dict)

    @property
    def fps(self) -> int:
        return self.mode.fps

    def total_frames(self) -> int:
        return sum(s.frames for s in self.scenes)
