from __future__ import annotations

import base64
import json
import wave
from pathlib import Path

import httpx
import pytest
import respx
from adapter_helpers import pc

from stickforge.providers.base import PermanentProviderError
from stickforge.providers.tts.elevenlabs import ElevenLabsTTS, words_from_alignment

KEY = "sk_" + "a" * 40
URL = "https://api.elevenlabs.io/v1/text-to-speech/Voice123/with-timestamps"


def alignment(text: str, step: float = 0.1) -> dict:
    return {
        "characters": list(text),
        "character_start_times_seconds": [i * step for i in range(len(text))],
        "character_end_times_seconds": [(i + 1) * step for i in range(len(text))],
    }


def test_words_from_alignment():
    words = words_from_alignment(alignment("Hi there  you"))
    assert [(w.word, round(w.start_s, 2), round(w.end_s, 2)) for w in words] == [
        ("Hi", 0.0, 0.2),
        ("there", 0.3, 0.8),
        ("you", 1.0, 1.3),
    ]
    assert words_from_alignment(None) is None
    assert words_from_alignment({"characters": ["a"], "character_start_times_seconds": []}) is None


@respx.mock
async def test_request_and_wav_output(tmp_path: Path):
    pcm = b"\x00\x01" * 48000  # 1 s of 48 kHz mono s16
    route = respx.post(URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "audio_base64": base64.b64encode(pcm).decode(),
                "alignment": alignment("Hello world"),
            },
        )
    )
    a = ElevenLabsTTS(
        "elevenlabs",
        pc(adapter="elevenlabs", model="eleven_multilingual_v2", cost={"per_1k_chars_usd": 0.3}),
        KEY,
    )
    res = await a.synthesize("Hello world", "Voice123", {"speed": 1.1}, out_path=tmp_path / "o.wav")
    req = route.calls.last.request
    assert req.headers["xi-api-key"] == KEY and req.url.params["output_format"] == "pcm_48000"
    assert json.loads(req.content) == {
        "text": "Hello world",
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {"speed": 1.1},
    }
    with wave.open(str(tmp_path / "o.wav")) as w:
        assert (w.getframerate(), w.getnchannels(), w.getnframes()) == (48000, 1, 48000)
    assert res.duration_s == 1.0 and [t.word for t in res.word_timings] == ["Hello", "world"]
    assert res.cost_usd == pytest.approx(11 / 1000 * 0.3)


async def test_rejects_suspicious_voice_id(tmp_path: Path):
    a = ElevenLabsTTS("e", pc(adapter="elevenlabs", model="m"), KEY)
    with pytest.raises(PermanentProviderError):
        await a.synthesize("x", "../../v1/user", {}, out_path=tmp_path / "o.wav")
