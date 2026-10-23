"""Uses word timings the TTS provider already returned (e.g. ElevenLabs with-timestamps)."""

from __future__ import annotations

from typing import ClassVar

from stickforge.providers.base import (
    Adapter,
    AudioResult,
    Kind,
    PermanentProviderError,
    WordTiming,
)


class TTSTimestampsAligner(Adapter):
    adapter_name: ClassVar[str] = "tts_timestamps"
    kind: ClassVar[Kind] = Kind.ALIGN
    default_max_concurrency: ClassVar[int] = 64
    license_note: ClassVar[str] = "timings from the TTS provider"

    async def align(self, audio: AudioResult, text: str) -> list[WordTiming]:
        if not audio.word_timings:
            raise PermanentProviderError(f"{audio.provider} returned no word timestamps")
        return list(audio.word_timings)
