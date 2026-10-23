"""OpenAI-compatible image generation (`POST {endpoint}/images/generations`).

Works with OpenAI and any server exposing the same API. Bearer auth.
settings:
  size:        e.g. "1536x864" (16:9; GPT image models accept WxH divisible by 16)
  extra:       additional request fields (e.g. {"quality": "medium"})
  media_hosts: hosts allowed for `url` responses (b64_json responses need none)
cost: per_image_usd
"""

from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any, ClassVar

import httpx

from stickforge.core import http
from stickforge.core.security import save_image_as_png
from stickforge.providers.base import (
    Adapter,
    Aspect,
    ImageResult,
    Kind,
    PermanentProviderError,
    TransientProviderError,
)

DEFAULT_ENDPOINT = "https://api.openai.com/v1"
_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,100}$")
_SIZE_RE = re.compile(r"^\d{3,4}x\d{3,4}$")
MAX_IMAGE_BYTES = 40 * 1024 * 1024


class OpenAICompatImage(Adapter):
    adapter_name: ClassVar[str] = "openai_compat"
    kind: ClassVar[Kind] = Kind.IMAGE
    capabilities: ClassVar[frozenset[str]] = frozenset()  # no refs/seed on this endpoint
    requires_key: ClassVar[bool] = True
    default_max_concurrency: ClassVar[int] = 4
    default_requests_per_minute: ClassVar[float | None] = 20
    cost_model: ClassVar[str] = "per image (cost.per_image_usd)"
    license_note: ClassVar[str] = "output terms of the configured provider/model"

    async def generate(
        self,
        prompt: str,
        refs: list[Path],
        aspect: Aspect,
        seed: int,
        settings: dict[str, Any],
        *,
        out_path: Path,
    ) -> ImageResult:
        model = self.config.model or ""
        size = str(self.config.settings.get("size", "1536x864"))
        if not _MODEL_RE.match(model) or not _SIZE_RE.match(size):
            raise PermanentProviderError(f"{self.name}: invalid model or size in config")
        body: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "n": 1,
            "size": size,
            **self.config.settings.get("extra", {}),
        }
        url = f"{(self.config.endpoint or DEFAULT_ENDPOINT).rstrip('/')}/images/generations"
        try:
            async with http.client(self.config.timeout_s) as c:
                resp = await c.post(
                    url, json=body, headers={"Authorization": f"Bearer {self._api_key or ''}"}
                )
        except httpx.HTTPError as e:
            raise http.map_transport_error(e, self.name) from None
        http.raise_for_status(resp, self.name)
        try:
            item = resp.json()["data"][0]
        except (ValueError, KeyError, IndexError, TypeError):
            raise TransientProviderError(f"{self.name}: malformed response") from None
        if item.get("b64_json"):
            data = base64.b64decode(item["b64_json"], validate=True)
        elif item.get("url"):
            raw = out_path.with_suffix(".download")
            try:
                await http.download(
                    str(item["url"]),
                    raw,
                    max_bytes=MAX_IMAGE_BYTES,
                    allowed_hosts=self.config.settings.get("media_hosts", ()),
                    content_types=("image/png", "image/jpeg", "image/webp"),
                )
                data = raw.read_bytes()
            finally:
                raw.unlink(missing_ok=True)
        else:
            raise TransientProviderError(f"{self.name}: no image in response")
        w, h = save_image_as_png(data, out_path, max_bytes=MAX_IMAGE_BYTES)
        return ImageResult(
            path=out_path,
            provider=self.name,
            model=model,
            width=w,
            height=h,
            cost_usd=self.cost_rate("per_image_usd"),
        )
