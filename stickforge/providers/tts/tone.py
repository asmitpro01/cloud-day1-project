"""Test TTS stub: a speech-like tone (harmonics, ~4 Hz syllable envelope, word gaps).

Unlike `silent`, it has real loudness, so offline tests can verify ducking and
loudness normalization. Never use it for real videos.
"""

from __future__ import annotations

import asyncio
import math
import struct
import wave
from pathlib import Path
from typing import Any, ClassVar

from stickforge.providers.base import Adapter, AudioResult, Kind

SAMPLE_RATE = 24000


def _write_tone(path: Path, seconds: float) -> None:
    n = round(seconds * SAMPLE_RATE)
    frames = bytearray()
    for i in range(n):
        t = i / SAMPLE_RATE
        env = max(0.0, math.sin(math.pi * 4.0 * t)) ** 2  # syllables
        if (t % 1.3) > 1.1:  # a short gap now and then, like word/phrase breaks
            env = 0.0
        s = (
            0.5 * math.sin(2 * math.pi * 140 * t)
            + 0.3 * math.sin(2 * math.pi * 280 * t)
            + 0.2 * math.sin(2 * math.pi * 420 * t)
        )
        frames += struct.pack("<h", int(12000 * env * s))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(frames))


class ToneTTS(Adapter):
    adapter_name: ClassVar[str] = "tone"
    kind: ClassVar[Kind] = Kind.TTS
    capabilities: ClassVar[frozenset[str]] = frozenset({"stub"})
    default_max_concurrency: ClassVar[int] = 8
    license_note: ClassVar[str] = "test tone stub (no voice)"

    async def synthesize(
        self, text: str, voice: str, settings: dict[str, Any], *, out_path: Path
    ) -> AudioResult:
        wpm = float(self.config.settings.get("words_per_minute", 150))
        seconds = max(1.0, len(text.split()) / (wpm * float(settings.get("speed", 1.0))) * 60)
        await asyncio.to_thread(_write_tone, out_path, seconds)
        return AudioResult(path=out_path, provider=self.name, model="tone", duration_s=seconds)
