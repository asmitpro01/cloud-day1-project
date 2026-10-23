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


async def test_bad_size_rejected(tmp_path: Path):
    with pytest.raises(PermanentProviderError, match="invalid"):
        await adapter(size="1536x864;rm").generate(
            "p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o"
        )
