"""Google Gemini native image generation (AI Studio key), raw REST via httpx.

POST {endpoint}/models/{model}:generateContent, header x-goog-api-key.
settings:
  image_size: "512px" | "1K" | "2K" | "4K"   (model-dependent; see config)
  max_refs:   max reference images the model accepts (e.g. 3 lite, 14 flash)
cost: per_image_usd
"""

from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any, ClassVar

import httpx

from stickforge.core import http
from stickforge.core.security import image_mime, save_image_as_png, validate_image
from stickforge.providers.base import (
    Adapter,
    Aspect,
    ImageResult,
    Kind,
    PermanentProviderError,
    TransientProviderError,
)

DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"
_MODEL_RE = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,80}$")
MAX_REF_BYTES = 7 * 1024 * 1024


def build_request(
    prompt: str, refs: list[Path], aspect: Aspect, seed: int, image_size: str | None
) -> dict[str, Any]:
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for ref in refs:
        validate_image(ref, max_bytes=MAX_REF_BYTES)
        parts.append(
            {
                "inlineData": {
                    "mimeType": image_mime(ref),
                    "data": base64.b64encode(ref.read_bytes()).decode(),
                }
            }
        )
    image_config: dict[str, Any] = {"aspectRatio": aspect.value}
    if image_size:
        image_config["imageSize"] = image_size
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": image_config,
            "seed": seed,
        },
    }


def extract_image(payload: dict[str, Any]) -> bytes:
    """Return the final (non-thought) image bytes, or raise with the block reason."""
    block = (payload.get("promptFeedback") or {}).get("blockReason")
    if block:
        raise PermanentProviderError(f"gemini: prompt blocked ({block})")
    candidates = payload.get("candidates") or []
    if not candidates:
        raise TransientProviderError("gemini: no candidates returned")
    cand = candidates[0]
    parts = (cand.get("content") or {}).get("parts") or []
    images = [
        p["inlineData"]
        for p in parts
        if isinstance(p, dict)
        and not p.get("thought")
        and isinstance(p.get("inlineData"), dict)
        and str(p["inlineData"].get("mimeType", "")).startswith("image/")
    ]
    if images:
        return base64.b64decode(images[-1]["data"], validate=True)
    reason = cand.get("finishReason", "UNKNOWN")
    if reason in {
        "SAFETY",
        "IMAGE_SAFETY",
        "PROHIBITED_CONTENT",
        "BLOCKLIST",
        "RECITATION",
        "SPII",
        "IMAGE_PROHIBITED_CONTENT",
    }:
        raise PermanentProviderError(f"gemini: image refused ({reason})")
    # Model sometimes answers with text only; a retry usually yields an image.
    raise TransientProviderError(f"gemini: no image in response (finishReason={reason})")


class GeminiImage(Adapter):
    adapter_name: ClassVar[str] = "gemini"
    kind: ClassVar[Kind] = Kind.IMAGE
    capabilities: ClassVar[frozenset[str]] = frozenset({"refs", "seed"})
    requires_key: ClassVar[bool] = True
    default_max_concurrency: ClassVar[int] = 4
    default_requests_per_minute: ClassVar[float | None] = 10
    cost_model: ClassVar[str] = "per image (cost.per_image_usd)"
    license_note: ClassVar[str] = (
        "Google Gemini API output; subject to Gemini API Terms; images carry SynthID watermark"
    )

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
        if not _MODEL_RE.match(model):
            raise PermanentProviderError(f"gemini: invalid model id {model!r}")
        max_refs = int(self.config.settings.get("max_refs", 3))
        body = build_request(
            prompt, refs[:max_refs], aspect, seed, self.config.settings.get("image_size")
        )
        base = (self.config.endpoint or DEFAULT_ENDPOINT).rstrip("/")
        url = f"{base}/models/{model}:generateContent"
        headers = {"x-goog-api-key": self._api_key or "", "content-type": "application/json"}
        try:
            async with http.client(self.config.timeout_s) as c:
                resp = await c.post(url, json=body, headers=headers)
        except httpx.HTTPError as e:
            raise http.map_transport_error(e, self.name) from None
        http.raise_for_status(resp, self.name)
        try:
            payload = resp.json()
        except ValueError:
            raise TransientProviderError("gemini: invalid JSON response") from None
        w, h = save_image_as_png(extract_image(payload), out_path)
        return ImageResult(
            path=out_path,
            provider=self.name,
            model=model,
            width=w,
            height=h,
            seed=seed,
            cost_usd=self.cost_rate("per_image_usd"),
            meta={"refs_sent": min(len(refs), max_refs)},
        )
