from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import respx
from adapter_helpers import b64png, pc, png_bytes

from stickforge.providers.base import Aspect, PermanentProviderError
from stickforge.providers.image.openai_compat import OpenAICompatImage

KEY = "sk-test-0123456789abcdefghij"
URL = "https://api.example.com/v1/images/generations"


def adapter(**settings) -> OpenAICompatImage:
    return OpenAICompatImage(
        "oai",
        pc(
            adapter="openai_compat",
            model="img-model",
            endpoint="https://api.example.com/v1",
            cost={"per_image_usd": 0.05},
            settings={"size": "1536x864", **settings},
        ),
        KEY,
    )


@respx.mock
async def test_b64_response(tmp_path: Path):
    route = respx.post(URL).mock(
        return_value=httpx.Response(200, json={"data": [{"b64_json": b64png(1536, 864)}]})
    )
    res = await adapter(extra={"quality": "low"}).generate(
        "p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o.png"
    )
    req = route.calls.last.request
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert json.loads(req.content) == {
        "model": "img-model",
        "prompt": "p",
        "n": 1,
        "size": "1536x864",
        "quality": "low",
    }
    assert (res.width, res.height, res.cost_usd) == (1536, 864, 0.05)


@respx.mock
async def test_url_response_needs_allowlisted_host(tmp_path: Path):
    respx.post(URL).mock(
        return_value=httpx.Response(200, json={"data": [{"url": "https://cdn.example.com/x.png"}]})
    )
    respx.get("https://cdn.example.com/x.png").mock(
        return_value=httpx.Response(200, content=png_bytes(), headers={"content-type": "image/png"})
    )
    with pytest.raises(PermanentProviderError, match="refusing"):
        await adapter().generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o")
    res = await adapter(media_hosts=["cdn.example.com"]).generate(
        "p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o.png"
    )
    assert res.width == 64


@respx.mock
async def test_seed_sent_only_when_enabled(tmp_path: Path):
    route = respx.post(URL).mock(
        return_value=httpx.Response(200, json={"data": [{"b64_json": b64png(1344, 768)}]})
    )
    plain = adapter()
    assert not plain.has("seed")
    await plain.generate("p", [], Aspect.LANDSCAPE_16_9, 42, {}, out_path=tmp_path / "a.png")
    assert "seed" not in json.loads(route.calls.last.request.content)
    seeded = adapter(send_seed=True)
    assert seeded.has("seed")
    res = await seeded.generate("p", [], Aspect.LANDSCAPE_16_9, 42, {}, out_path=tmp_path / "b.png")
    assert json.loads(route.calls.last.request.content)["seed"] == 42 and res.seed == 42


async def test_bad_size_rejected(tmp_path: Path):
    with pytest.raises(PermanentProviderError, match="invalid"):
        await adapter(size="1536x864;rm").generate(
            "p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o"
        )


@respx.mock
async def test_default_pollinations_entry_wiring(tmp_path: Path, monkeypatch):
    from stickforge.config import load_config
    from stickforge.providers.base import Kind
    from stickforge.providers.registry import Registry

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("POLLINATIONS_API_KEY", "sk_test_pollinations_0123456789")
    route = respx.post("https://gen.pollinations.ai/v1/images/generations").mock(
        return_value=httpx.Response(200, json={"data": [{"b64_json": b64png(1344, 768)}]})
    )
    poll = Registry(load_config()).get("pollinations", Kind.IMAGE)
    res = await poll.generate(
        "a stickman", [], Aspect.LANDSCAPE_16_9, 7, {}, out_path=tmp_path / "o.png"
    )
    req = route.calls.last.request
    assert req.headers["authorization"] == "Bearer sk_test_pollinations_0123456789"
    body = json.loads(req.content)
    assert body == {
        "model": "black-forest-labs/flux.1-schnell",
        "prompt": "a stickman",
        "n": 1,
        "size": "1344x768",
        "seed": 7,
    }
    assert (res.width, res.height) == (1344, 768)
