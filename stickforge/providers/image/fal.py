"""fal.ai queue API (e.g. FLUX models), raw REST via httpx.

Submit:  POST {endpoint}/{model}            (Authorization: Key <FAL_KEY>)
Poll:    GET  status_url  until COMPLETED
Result:  GET  response_url -> {"images": [{"url", "width", "height"}], ...}
The key is only ever sent to hosts in `settings.api_hosts`; result images are fetched
without credentials from `settings.media_hosts` through the hardened downloader.

settings:
  input:      extra model input merged into the request (model-specific, e.g.
              {"image_size": "landscape_16_9", "output_format": "png"})
  ref_field:  input field for reference images as data URIs (omit if unsupported)
  poll_interval_s: default 1.0
cost: per_image_usd or per_megapixel_usd
"""

from __future__ import annotations

import asyncio
import base64
import re
import time
from pathlib import Path
from typing import Any, ClassVar
from urllib.parse import urlsplit

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

DEFAULT_ENDPOINT = "https://queue.fal.run"
DEFAULT_API_HOSTS = ("queue.fal.run", "queue.falrun.com")
DEFAULT_MEDIA_HOSTS = ("fal.media", "fal.run", "falrun.com", "fal.ai")
_MODEL_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*){1,3}$")
MAX_REF_BYTES = 7 * 1024 * 1024
MAX_RESULT_BYTES = 40 * 1024 * 1024


def _data_uri(path: Path) -> str:
    validate_image(path, max_bytes=MAX_REF_BYTES)
    return f"data:{image_mime(path)};base64,{base64.b64encode(path.read_bytes()).decode()}"


class FalImage(Adapter):
    adapter_name: ClassVar[str] = "fal"
    kind: ClassVar[Kind] = Kind.IMAGE
    capabilities: ClassVar[frozenset[str]] = frozenset({"seed", "refs"})
    requires_key: ClassVar[bool] = True
    default_max_concurrency: ClassVar[int] = 4
    default_requests_per_minute: ClassVar[float | None] = 60
    cost_model: ClassVar[str] = "per image or per megapixel (cost.*)"
    license_note: ClassVar[str] = "fal.ai hosted model; license depends on the model (see config)"

    def has(self, capability: str) -> bool:
        if capability == "refs":  # only when the configured model takes reference images
            return bool(self.config.settings.get("ref_field"))
        return super().has(capability)

    def _api_hosts(self) -> tuple[str, ...]:
        return tuple(self.config.settings.get("api_hosts", DEFAULT_API_HOSTS))

    def _check_api_url(self, url: str) -> str:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        if parts.scheme != "https" or not any(
            host == h or host.endswith("." + h) for h in self._api_hosts()
        ):
            raise PermanentProviderError(f"fal: refusing to send credentials to {host!r}")
        return url

    def build_input(self, prompt: str, refs: list[Path], seed: int) -> dict[str, Any]:
        s = self.config.settings
        body: dict[str, Any] = {"prompt": prompt, "seed": seed, "num_images": 1}
        body.update(s.get("input", {}))
        ref_field = s.get("ref_field")
        if ref_field and refs:
            uris = [_data_uri(r) for r in refs[: int(s.get("max_refs", 4))]]
            body[ref_field] = uris if ref_field.endswith("s") else uris[0]
        return body

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
            raise PermanentProviderError(f"fal: invalid model id {model!r}")
        if aspect is not Aspect.LANDSCAPE_16_9:
            raise PermanentProviderError(f"fal: unsupported aspect {aspect}")
        headers = {"Authorization": f"Key {self._api_key or ''}"}
        base = (self.config.endpoint or DEFAULT_ENDPOINT).rstrip("/")
        deadline = time.monotonic() + self.config.timeout_s
        poll = float(self.config.settings.get("poll_interval_s", 1.0))
        try:
            async with http.client(min(60.0, self.config.timeout_s)) as c:
                resp = await c.post(
                    self._check_api_url(f"{base}/{model}"),
                    json=self.build_input(prompt, refs, seed),
                    headers=headers,
                )
                http.raise_for_status(resp, self.name)
                sub = resp.json()
                status_url = self._check_api_url(str(sub["status_url"]))
                response_url = self._check_api_url(str(sub["response_url"]))
                while True:
                    st = await c.get(status_url, headers=headers)
                    http.raise_for_status(st, self.name)
                    state = st.json().get("status")
                    if state == "COMPLETED":
                        break
                    if state not in {"IN_QUEUE", "IN_PROGRESS"}:
                        raise PermanentProviderError(f"fal: unexpected status {state!r}")
                    if time.monotonic() > deadline:
                        raise TransientProviderError("fal: timed out waiting for result")
                    await asyncio.sleep(poll)
                res = await c.get(response_url, headers=headers)
                http.raise_for_status(res, self.name)
                result = res.json()
            image = (result.get("images") or [None])[0]
            if not isinstance(image, dict) or not image.get("url"):
                raise PermanentProviderError("fal: no image in result")
            raw = out_path.with_suffix(".download")
            try:
                await http.download(
                    str(image["url"]),
                    raw,
                    allowed_hosts=self.config.settings.get("media_hosts", DEFAULT_MEDIA_HOSTS),
                    max_bytes=MAX_RESULT_BYTES,
                    content_types=("image/png", "image/jpeg", "image/webp"),
                    total_timeout_s=min(120.0, self.config.timeout_s),
                )
                w, h = save_image_as_png(raw.read_bytes(), out_path)
            finally:
                raw.unlink(missing_ok=True)
        except httpx.HTTPError as e:
            raise http.map_transport_error(e, self.name) from None
        except (KeyError, ValueError, TypeError) as e:
            raise TransientProviderError(f"fal: malformed response ({type(e).__name__})") from None
        cost = self.cost_rate("per_image_usd") + self.cost_rate("per_megapixel_usd") * w * h / 1e6
        return ImageResult(
            path=out_path,
            provider=self.name,
            model=model,
            width=w,
            height=h,
            seed=result.get("seed", seed),
            cost_usd=cost,
        )
