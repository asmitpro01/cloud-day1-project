"""Silent TTS stub: writes silence whose length is estimated from word count.

Offline, deterministic, free — used by tests and the zero-key path.
"""

from __future__ import annotations

import asyncio
import wave
from pathlib import Path
from typing import Any, ClassVar

from stickforge.providers.base import Adapter, AudioResult, Kind

SAMPLE_RATE = 48000


def _write_silence(path: Path, seconds: float) -> None:
    frames = round(seconds * SAMPLE_RATE)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(b"\x00\x00" * frames)


class SilentTTS(Adapter):
    adapter_name: ClassVar[str] = "silent"
    kind: ClassVar[Kind] = Kind.TTS
    default_max_concurrency: ClassVar[int] = 16
    license_note: ClassVar[str] = "silent test stub (no voice)"

    async def synthesize(
        self, text: str, voice: str, settings: dict[str, Any], *, out_path: Path
    ) -> AudioResult:
        wpm = float(self.config.settings.get("words_per_minute", 150))
        speed = float(settings.get("speed", 1.0))
        seconds = max(1.0, len(text.split()) / (wpm * speed) * 60.0)
        await asyncio.to_thread(_write_silence, out_path, seconds)
        return AudioResult(path=out_path, provider=self.name, model="silent", duration_s=seconds)
