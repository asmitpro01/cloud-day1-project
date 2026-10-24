"""Kokoro-82M local TTS via kokoro-onnx (CPU, offline once model files are pulled).

settings:
  model:  key into `models:` for the .onnx file (e.g. kokoro-v1.0-int8)
  voices: key into `models:` for the voices .bin
  lang:   optional; default en-gb for b* voices, else en-us
"""

from __future__ import annotations

import asyncio
import threading
import wave
from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar

from stickforge.providers.base import Adapter, AudioResult, Kind, PermanentProviderError

if TYPE_CHECKING:
    from stickforge.config import EngineConfig, ProviderConfig

_ENGINES: dict[tuple[str, str], Any] = {}
_ENGINES_LOCK = threading.Lock()


def _load(model: Path, voices: Path) -> Any:
    key = (str(model), str(voices))
    with _ENGINES_LOCK:
        if key not in _ENGINES:
            from kokoro_onnx import Kokoro

            _ENGINES[key] = Kokoro(str(model), str(voices))
        return _ENGINES[key]


def _write_wav(path: Path, samples: Any, sample_rate: int) -> None:
    import numpy as np

    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes(pcm.tobytes())


class KokoroTTS(Adapter):
    adapter_name: ClassVar[str] = "kokoro"
    kind: ClassVar[Kind] = Kind.TTS
    capabilities: ClassVar[frozenset[str]] = frozenset({"local"})
    optional_dependency: ClassVar[str | None] = "kokoro_onnx"
    default_max_concurrency: ClassVar[int] = 1  # onnxruntime already uses every core
    cost_model: ClassVar[str] = "free (local CPU)"
    license_note: ClassVar[str] = "Kokoro-82M weights Apache-2.0; kokoro-onnx MIT"

    @classmethod
    def readiness_problem(cls, config: ProviderConfig, engine: EngineConfig) -> str | None:
        from stickforge.models import is_installed

        for role in ("model", "voices"):
            key = config.settings.get(role)
            if not key:
                return f"settings.{role} not configured"
            if key not in engine.models:
                return f"settings.{role}: unknown model {key!r}"
            if not is_installed(engine, key):
                return f"model file missing — run: stickforge models pull {key}"
        return None

    def _paths(self) -> tuple[Path, Path]:
        from stickforge.models import model_path

        assert self.engine is not None
        s = self.config.settings
        return model_path(self.engine, s["model"]), model_path(self.engine, s["voices"])

    def cache_identity(self) -> dict[str, Any]:
        ident = super().cache_identity()
        if self.engine is not None:
            s = self.config.settings
            ident["files"] = [self.engine.models[s[k]].sha256 for k in ("model", "voices")]
        return ident

    def _synth(self, text: str, voice: str, speed: float, out_path: Path) -> float:
        kokoro = _load(*self._paths())
        if voice not in kokoro.get_voices():
            raise PermanentProviderError(f"kokoro: unknown voice {voice!r}")
        lang = self.config.settings.get("lang") or ("en-gb" if voice.startswith("b") else "en-us")
        samples, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
        _write_wav(out_path, samples, sr)
        return len(samples) / float(sr)

    async def synthesize(
        self, text: str, voice: str, settings: dict[str, Any], *, out_path: Path
    ) -> AudioResult:
        speed = float(settings.get("speed", 1.0))
        duration = await asyncio.to_thread(self._synth, text, voice, speed, out_path)
        return AudioResult(
            path=out_path,
            provider=self.name,
            model=self.config.settings.get("model"),
            duration_s=duration,
        )
