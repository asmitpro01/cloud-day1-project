from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from stickforge.config import load_config
from stickforge.providers.base import Adapter, Kind
from stickforge.providers.registry import Registry, RegistryError, discover


def test_defaults_load(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    cfg = load_config()
    assert cfg.modes["final"].width == 1920 and cfg.modes["draft"].height == 720


def test_override_merges_and_validates(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    p = tmp_path / "c.yaml"
    p.write_text("modes: {draft: {crf: 30}}\n")
    assert load_config(p).modes["draft"].crf == 30
    assert load_config(p).modes["draft"].width == 1280  # deep-merged
    p.write_text("modes: {draft: {chains: {image: [nope]}}}\n")
    with pytest.raises(ValidationError, match="unknown provider 'nope'"):
        load_config(p)
    p.write_text("modes: {draft: {width: 1000, height: 1000}}\n")
    with pytest.raises(ValidationError, match="16:9"):
        load_config(p)


def test_secret_from_env_only(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    p = tmp_path / "c.yaml"
    p.write_text("providers: {fake: {adapter: placeholder, api_key_env: SF_TEST_KEY}}\n")
    monkeypatch.delenv("SF_TEST_KEY", raising=False)
    assert load_config(p).secret_for("fake") is None
    monkeypatch.setenv("SF_TEST_KEY", "k-123456789")
    cfg = load_config(p)
    assert cfg.secret_for("fake") == "k-123456789"
    assert "k-123456789" not in repr(cfg)


def test_discover_and_kinds(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    adapters = discover()
    assert {"silent", "placeholder"} <= set(adapters)
    reg = Registry(load_config())
    assert reg.get("silent", Kind.TTS).name == "silent"
    with pytest.raises(RegistryError, match="not image"):
        reg.get("silent", Kind.IMAGE)


def test_new_adapter_is_one_class_plus_config(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    class KeyedTTS(Adapter):
        adapter_name = "test_keyed_tts"
        kind = Kind.TTS
        requires_key = True

    try:
        p = tmp_path / "c.yaml"
        p.write_text("providers: {k: {adapter: test_keyed_tts, api_key_env: SF_NOPE}}\n")
        monkeypatch.delenv("SF_NOPE", raising=False)
        discover.cache_clear()
        reg = Registry(load_config(p))
        st = reg.status("k")
        assert not st.ready and "SF_NOPE" in st.reason
        with pytest.raises(RegistryError, match="no ready"):
            reg.chain(["k"], Kind.TTS)
        assert [a.name for a in reg.chain(["k", "silent"], Kind.TTS)] == ["silent"]
    finally:
        Adapter._registry.pop("test_keyed_tts", None)
        discover.cache_clear()


def test_unknown_adapter(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    p = tmp_path / "c.yaml"
    p.write_text("providers: {x: {adapter: does_not_exist}}\n")
    with pytest.raises(RegistryError, match="unknown adapter"):
        Registry(load_config(p))
