from __future__ import annotations

import base64
import io

from PIL import Image

from stickforge.config import ProviderConfig


def png_bytes(w: int = 64, h: int = 36, color: str = "white") -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def b64png(w: int = 64, h: int = 36, color: str = "white") -> str:
    return base64.b64encode(png_bytes(w, h, color)).decode()


def pc(**kw) -> ProviderConfig:
    return ProviderConfig.model_validate(kw)


SECRET = "AIzaSy-test-secret-key-0123456789abcdef"
