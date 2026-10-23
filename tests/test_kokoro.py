"""Real Kokoro synthesis — runs only where kokoro-onnx and the model files are installed."""

from __future__ import annotations

import wave
from pathlib import Path

import pytest

from stickforge.config import load_config
from stickforge.providers.base import Kind, PermanentProviderError
from stickforge.providers.registry import Registry

pytest.importorskip("kokoro_onnx")


@pytest.fixture
def kokoro(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    reg = Registry(load_config())
    if not reg.status("kokoro").ready:
        pytest.skip(reg.status("kokoro").reason)
    return reg.get("kokoro", Kind.TTS)


async def test_kokoro_synthesizes_speech(kokoro, tmp_path: Path):
    res = await kokoro.synthesize(
        "Hello from stickforge.", "af_heart", {"speed": 1.0}, out_path=tmp_path / "o.wav"
    )
    with wave.open(str(tmp_path / "o.wav")) as w:
        assert w.getframerate() == 24000 and w.getnframes() > 24000 * 0.5
    assert 0.5 < res.duration_s < 5
    assert kokoro.cache_identity()["files"][0] == kokoro.engine.models["kokoro-v1.0-fp32"].sha256


async def test_kokoro_unknown_voice(kokoro, tmp_path: Path):
    with pytest.raises(PermanentProviderError, match="unknown voice"):
        await kokoro.synthesize("x", "zz_nobody", {}, out_path=tmp_path / "o.wav")
