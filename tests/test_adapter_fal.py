from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import respx
from adapter_helpers import pc, png_bytes

from stickforge.providers.base import Aspect, PermanentProviderError
from stickforge.providers.image.fal import FalImage

KEY = "fal-test-key-1234567890"
Q = "https://queue.fal.run/fal-ai/flux/schnell"
REQ = "https://queue.fal.run/fal-ai/flux/requests/abc"


def adapter(**settings) -> FalImage:
    return FalImage(
        "fal_schnell",
        pc(
            adapter="fal",
            model="fal-ai/flux/schnell",
            cost={"per_image_usd": 0.003},
            settings={"poll_interval_s": 0, **settings},
        ),
        KEY,
    )


def submit_json(status_url: str = f"{REQ}/status") -> dict:
    return {"request_id": "abc", "status_url": status_url, "response_url": REQ}


@respx.mock
async def test_queue_flow_and_download(tmp_path: Path):
    sub = respx.post(Q).mock(return_value=httpx.Response(200, json=submit_json()))
    respx.get(f"{REQ}/status").mock(
        side_effect=[
            httpx.Response(200, json={"status": "IN_QUEUE"}),
            httpx.Response(200, json={"status": "IN_PROGRESS"}),
            httpx.Response(200, json={"status": "COMPLETED"}),
        ]
    )
    respx.get(REQ).mock(
        return_value=httpx.Response(
            200,
            json={
                "images": [{"url": "https://v3.fal.media/files/x.png", "width": 64, "height": 36}],
                "seed": 5,
            },
        )
    )
    media = respx.get("https://v3.fal.media/files/x.png").mock(
        return_value=httpx.Response(200, content=png_bytes(), headers={"content-type": "image/png"})
    )
    a = adapter(input={"image_size": "landscape_16_9"})
    res = await a.generate("p", [], Aspect.LANDSCAPE_16_9, 5, {}, out_path=tmp_path / "o.png")
    assert sub.calls.last.request.headers["authorization"] == f"Key {KEY}"
    body = json.loads(sub.calls.last.request.content)
    assert body == {"prompt": "p", "seed": 5, "num_images": 1, "image_size": "landscape_16_9"}
    assert "authorization" not in media.calls.last.request.headers  # no key to the CDN
    assert (res.width, res.height, res.cost_usd) == (64, 36, 0.003)
    assert not a.has("refs")


@respx.mock
async def test_refuses_to_send_key_to_foreign_status_url(tmp_path: Path):
    respx.post(Q).mock(
        return_value=httpx.Response(200, json=submit_json(status_url="https://evil.example/steal"))
    )
    with pytest.raises(PermanentProviderError, match="refusing"):
        await adapter().generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o")


@respx.mock
async def test_result_from_unlisted_media_host_rejected(tmp_path: Path):
    respx.post(Q).mock(return_value=httpx.Response(200, json=submit_json()))
    respx.get(f"{REQ}/status").mock(return_value=httpx.Response(200, json={"status": "COMPLETED"}))
    respx.get(REQ).mock(
        return_value=httpx.Response(200, json={"images": [{"url": "https://evil.example/x.png"}]})
    )
    with pytest.raises(PermanentProviderError, match="refusing to download"):
        await adapter().generate("p", [], Aspect.LANDSCAPE_16_9, 1, {}, out_path=tmp_path / "o")


def test_refs_as_data_uris(tmp_path: Path):
    ref = tmp_path / "r.png"
    ref.write_bytes(png_bytes())
    a = adapter(ref_field="image_urls")
    assert a.has("refs")
    body = a.build_input("p", [ref], 1)
    assert body["image_urls"][0].startswith("data:image/png;base64,")
