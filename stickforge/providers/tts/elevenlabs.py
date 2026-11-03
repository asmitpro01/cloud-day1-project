"""ElevenLabs TTS with character timestamps (raw REST via httpx).

POST {endpoint}/v1/text-to-speech/{voice_id}/with-timestamps?output_format=pcm_48000
header xi-api-key. Returns base64 PCM + character alignment, which we turn into word
timings so captions need no ASR.
settings: voice_settings (dict, passed through), seed (optional)
cost: per_1k_chars_usd
"""

from __future__ import annotations

import base64
import re
import wave
from pathlib import Path
from typing import Any, ClassVar

import httpx

from stickforge.core import http
from stickforge.providers.base import (
    Adapter,
    AudioResult,
    Kind,
    PermanentProviderError,
    TransientProviderError,
    WordTiming,
)

DEFAULT_ENDPOINT = "https://api.elevenlabs.io"
SAMPLE_RATE = 48000
_VOICE_RE = re.compile(r"^[A-Za-z0-9]{1,64}$")
MAX_AUDIO_BYTES = 200 * 1024 * 1024


def words_from_alignment(alignment: dict[str, Any] | None) -> list[WordTiming] | None:
    if not alignment:
        return None
    chars = alignment.get("characters") or []
    starts = alignment.get("character_start_times_seconds") or []
    ends = alignment.get("character_end_times_seconds") or []
    if not (len(chars) == len(starts) == len(ends)):
        return None
    words: list[WordTiming] = []
    buf, w_start, w_end = "", 0.0, 0.0
    for ch, s, e in zip(chars, starts, ends, strict=True):
        if ch.isspace():
            if buf:
                words.append(WordTiming(word=buf, start_s=w_start, end_s=w_end))
            buf = ""
            continue
        if not buf:
            w_start = float(s)
        buf += ch
        w_end = float(e)
    if buf:
        words.append(WordTiming(word=buf, start_s=w_start, end_s=w_end))
    return words


class ElevenLabsTTS(Adapter):
    adapter_name: ClassVar[str] = "elevenlabs"
    kind: ClassVar[Kind] = Kind.TTS
    capabilities: ClassVar[frozenset[str]] = frozenset({"word_timestamps"})
    requires_key: ClassVar[bool] = True
    default_max_concurrency: ClassVar[int] = 2  # plan-dependent; raise in config
    cost_model: ClassVar[str] = "per character (cost.per_1k_chars_usd)"
    license_note: ClassVar[str] = "ElevenLabs output; commercial use per your ElevenLabs plan"

    async def synthesize(
        self, text: str, voice: str, settings: dict[str, Any], *, out_path: Path
    ) -> AudioResult:
        if not _VOICE_RE.match(voice):
            raise PermanentProviderError(f"elevenlabs: invalid voice id {voice!r}")
        s = self.config.settings
        voice_settings = dict(s.get("voice_settings", {}))
        speed = float(settings.get("speed", 1.0))
        if speed != 1.0:
            voice_settings["speed"] = speed
        body: dict[str, Any] = {"text": text, "model_id": self.config.model}
        if voice_settings:
            body["voice_settings"] = voice_settings
        if "seed" in s:
            body["seed"] = int(s["seed"])
        base = (self.config.endpoint or DEFAULT_ENDPOINT).rstrip("/")
        url = f"{base}/v1/text-to-speech/{voice}/with-timestamps"
        try:
            async with http.client(self.config.timeout_s) as c:
                resp = await c.post(
                    url,
                    params={"output_format": f"pcm_{SAMPLE_RATE}"},
                    json=body,
                    headers={"xi-api-key": self._api_key or ""},
                )
        except httpx.HTTPError as e:
            raise http.map_transport_error(e, self.name) from None
        http.raise_for_status(resp, self.name)
        try:
            payload = resp.json()
            pcm = base64.b64decode(payload["audio_base64"], validate=True)
        except (ValueError, KeyError, TypeError):
            raise TransientProviderError("elevenlabs: malformed response") from None
        if not pcm or len(pcm) > MAX_AUDIO_BYTES or len(pcm) % 2:
            raise TransientProviderError("elevenlabs: invalid audio payload")
        with wave.open(str(out_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(pcm)
        return AudioResult(
            path=out_path,
            provider=self.name,
            model=self.config.model,
            duration_s=len(pcm) / 2 / SAMPLE_RATE,
            cost_usd=len(text) / 1000 * self.cost_rate("per_1k_chars_usd"),
            word_timings=words_from_alignment(payload.get("alignment")),
        )
