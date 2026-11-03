"""WhisperX forced alignment of the *known* narration (no ASR step needed).

Optional: requires the `whisperx` package (pulls PyTorch, >1 GB) and downloads a
wav2vec2 alignment model on first use. settings: language (default "en"), device ("cpu").
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, ClassVar

from stickforge.providers.base import (
    Adapter,
    AudioResult,
    Kind,
    PermanentProviderError,
    WordTiming,
)

_MODELS: dict[tuple[str, str], tuple[Any, Any]] = {}
_LOCK = threading.Lock()


class WhisperXAligner(Adapter):
    adapter_name: ClassVar[str] = "whisperx"
    kind: ClassVar[Kind] = Kind.ALIGN
    optional_dependency: ClassVar[str | None] = "whisperx"
    default_max_concurrency: ClassVar[int] = 1
    cost_model: ClassVar[str] = "free (local CPU/GPU)"
    license_note: ClassVar[str] = "WhisperX BSD-2-Clause; wav2vec2 alignment model license varies"

    def _align_sync(self, audio: AudioResult, text: str) -> list[WordTiming]:
        import whisperx

        lang = str(self.config.settings.get("language", "en"))
        device = str(self.config.settings.get("device", "cpu"))
        with _LOCK:
            if (lang, device) not in _MODELS:
                _MODELS[(lang, device)] = whisperx.load_align_model(
                    language_code=lang, device=device
                )
        model, metadata = _MODELS[(lang, device)]
        samples = whisperx.load_audio(str(audio.path))
        segments = [{"text": text, "start": 0.0, "end": float(audio.duration_s)}]
        result = whisperx.align(
            segments, model, metadata, samples, device, return_char_alignments=False
        )
        words = [
            WordTiming(word=str(w["word"]), start_s=float(w["start"]), end_s=float(w["end"]))
            for seg in result.get("segments", [])
            for w in seg.get("words", [])
            if "start" in w and "end" in w
        ]
        if not words:
            raise PermanentProviderError("whisperx: no aligned words")
        return words

    async def align(self, audio: AudioResult, text: str) -> list[WordTiming]:
        return await asyncio.to_thread(self._align_sync, audio, text)
