from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import respx
from adapter_helpers import SECRET, b64png, pc, png_bytes
from PIL import Image

from stickforge.core.http import RateLimited
from stickforge.providers.base import Aspect, PermanentProviderError, TransientProviderError
from stickforge.providers.image.gemini import GeminiImage

URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-image:generateContent"


def adapter() -> GeminiImage:
    return GeminiImage(
        "gemini_lite",
        pc(
            adapter="gemini",
            model="gemini-test-image",
            settings={"image_size": "1K", "max_refs": 1},
            cost={"per_image_usd": 0.03},
        ),
        SECRET,
    )


def ok_payload() -> dict:
    return {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": "thinking...", "thought": True},
                        {
                            "inlineData": {"mimeType": "image/png", "data": b64png(40, 40, "red")},
                            "thought": True,
                        },
                        {"text": "Here is your image"},
                        {"inlineData": {"mimeType": "image/png", "data": b64png(64, 36, "blue")}},
                    ]
                },
                "finishReason": "STOP",
            }
        ]
    }


@respx.mock
async def test_request_shape_and_final_image(tmp_path: Path):
    ref1, ref2 = tmp_path / "r1.png", tmp_path / "r2.png"
    ref1.write_bytes(png_bytes())
    ref2.write_bytes(png_bytes())
    route = respx.post(URL).mock(return_value=httpx.Response(200, json=ok_payload()))
    out = tmp_path / "o.png"
    res = await adapter().generate(
        "a stickman", [ref1, ref2], Aspect.LANDSCAPE_16_9, 77, {}, out_path=out
    )
    req = route.calls.last.request
    assert req.headers["x-goog-api-key"] == SECRET
    assert SECRET not in str(req.url)
    body = json.loads(req.content)
    gc = body["generationConfig"]
    assert gc == {
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": "16:9", "imageSize": "1K"},
        "seed": 77,
    }
    parts = body["contents"][0]["parts"]
    assert parts[0] == {"text": "a stickman"} and len(parts) == 2  # max_refs=1
    assert parts[1]["inlineData"]["mimeType"] == "image/png"
    # The final non-thought image wins (blue 64x36), re-encoded as PNG.
    assert (res.width, res.height, res.cost_usd, res.seed) == (64, 36, 0.03, 77)
    with Image.open(out) as im:
        assert im.format == "PNG" and im.getpixel((0, 0)) == (0, 0, 255)


@respx.mock
@pytest.mark.parametrize(
    ("payload", "exc", "match"),
    [
        ({"promptFeedback": {"blockReason": "SAFETY"}}, PermanentProviderError, "blocked"),
        (
            {"candidates": [{"content": {"parts": []}, "finishReason": "IMAGE_SAFETY"}]},
            PermanentProviderError,
            "refused",
        ),
        (
            {"candidates": [{"content": {"parts": [{"text": "sorry"}]}, "finishReason": "STOP"}]},
            TransientProviderError,
            "no image",
        ),
        ({"candidates": []}, TransientProviderError, "no candidates"),
    ],
)
async def test_no_image_cases(tmp_path: Path, payload, exc, match):
    respx.post(URL).mock(return_value=httpx.Response(200, json=payload))
    with pytest.raises(exc, match=match):
        await adapter().generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o.png")


@respx.mock
async def test_http_errors_mapped_and_key_not_leaked(tmp_path: Path):
    respx.post(URL).mock(
        side_effect=[
            httpx.Response(429, headers={"retry-after": "3"}, json={"error": "quota"}),
            httpx.Response(401, text=f"API key {SECRET} invalid"),
        ]
    )
    with pytest.raises(RateLimited):
        await adapter().generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o")
    with pytest.raises(PermanentProviderError) as ei:
        await adapter().generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o")
    assert SECRET not in str(ei.value)


@respx.mock
async def test_garbage_image_rejected(tmp_path: Path):
    payload = {
        "candidates": [
            {
                "content": {
                    "parts": [{"inlineData": {"mimeType": "image/png", "data": "bm90IGFuIGltYWdl"}}]
                }
            }
        ]
    }
    respx.post(URL).mock(return_value=httpx.Response(200, json=payload))
    with pytest.raises(Exception, match="invalid image"):
        await adapter().generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o")


async def test_invalid_model_id_rejected(tmp_path: Path):
    a = GeminiImage("g", pc(adapter="gemini", model="../../x"), SECRET)
    with pytest.raises(PermanentProviderError, match="invalid model"):
        await a.generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o")
