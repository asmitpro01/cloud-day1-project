from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest
from adapter_helpers import pc, png_bytes

from stickforge.providers.base import PermanentProviderError, TransientProviderError
from stickforge.providers.llm.litellm_provider import LiteLLM, LiteLLMVisionQA, parse_qa
from stickforge.schema import Scene, Style


def fake_litellm(monkeypatch, reply: str | Exception, seen: list):
    mod = types.ModuleType("litellm")

    async def acompletion(**kw):
        seen.append(kw)
        if isinstance(reply, Exception):
            raise reply
        msg = types.SimpleNamespace(content=reply)
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

    mod.acompletion = acompletion
    mod.completion_cost = lambda completion_response: 0.0012
    monkeypatch.setitem(sys.modules, "litellm", mod)


def test_parse_qa():
    assert parse_qa('```json\n{"pass": true, "issues": []}\n```') == (True, [])
    ok, issues = parse_qa(
        '{"pass": false, "issues": [{"code": "text_in_image", "detail": "sign"}]}'
    )
    assert not ok and issues[0].code == "text_in_image"
    with pytest.raises(TransientProviderError):
        parse_qa("looks fine to me")


async def test_vision_qa_call(monkeypatch, tmp_path: Path):
    seen: list = []
    fake_litellm(
        monkeypatch, '{"pass": false, "issues": [{"code": "anatomy", "detail": "3 arms"}]}', seen
    )
    img = tmp_path / "i.png"
    img.write_bytes(png_bytes())
    qa = LiteLLMVisionQA("gemini_qa", pc(adapter="litellm_vision_qa", model="gemini/x"), "k-123456")
    scene = Scene(id=1, narration="n", visual="Max waves", characters=[])
    res = await qa.check(img, scene, Style(palette=["#FFFFFF"]))
    assert not res.passed and res.issues[0].code == "anatomy" and res.cost_usd == 0.0012
    kw = seen[0]
    assert kw["model"] == "gemini/x" and kw["api_key"] == "k-123456" and kw["num_retries"] == 0
    assert kw["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


@pytest.mark.parametrize(
    ("exc_name", "expected"),
    [
        ("RateLimitError", TransientProviderError),
        ("Timeout", TransientProviderError),
        ("AuthenticationError", PermanentProviderError),
        ("BadRequestError", PermanentProviderError),
    ],
)
async def test_error_mapping(monkeypatch, exc_name, expected):
    err = type(exc_name, (Exception,), {})("boom key=sk-secretsecretsecret")
    fake_litellm(monkeypatch, err, [])
    llm = LiteLLM("gemini_llm", pc(adapter="litellm", model="gemini/x"), "k-123456")
    with pytest.raises(expected) as ei:
        await llm.complete([{"role": "user", "content": "hi"}], {})
    assert "secret" not in str(ei.value)
