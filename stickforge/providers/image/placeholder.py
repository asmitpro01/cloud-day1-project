"""Offline placeholder images drawn with Pillow (stickmen on a palette background).

Deterministic in (prompt, seed). Palette colors are parsed from the prompt so the
adapter needs nothing beyond the ImageProvider interface.
"""

from __future__ import annotations

import asyncio
import hashlib
import random
import re
from pathlib import Path
from typing import Any, ClassVar

from PIL import Image, ImageDraw

from stickforge.providers.base import Adapter, Aspect, ImageResult, Kind

_HEX = re.compile(r"#[0-9A-Fa-f]{6}\b")


def _stickman(d: ImageDraw.ImageDraw, x: int, base_y: int, h: int, color: str, w: int) -> None:
    head_r = h // 8
    neck_y = base_y - h + 2 * head_r
    hip_y = base_y - h // 3
    d.ellipse((x - head_r, base_y - h, x + head_r, neck_y), outline=color, width=w)
    d.line((x, neck_y, x, hip_y), fill=color, width=w)
    arm_y = neck_y + (hip_y - neck_y) // 4
    d.line((x - h // 4, arm_y + h // 8, x, arm_y, x + h // 4, arm_y + h // 8), fill=color, width=w)
    d.line((x - h // 6, base_y, x, hip_y, x + h // 6, base_y), fill=color, width=w)


def render_placeholder(prompt: str, seed: int, width: int, height: int, out: Path) -> None:
    digest = hashlib.sha256(f"{seed}:{prompt}".encode()).hexdigest()
    rng = random.Random(digest)  # noqa: S311 - not crypto
    palette = _HEX.findall(prompt) or ["#F4F1EA", "#1D1D1D", "#E63946", "#457B9D"]
    bg = palette[0]
    ink = palette[1] if len(palette) > 1 else "#1D1D1D"
    accents = palette[2:] or [ink]
    im = Image.new("RGB", (width, height), bg)
    d = ImageDraw.Draw(im)
    lw = max(3, width // 240)
    ground = int(height * 0.82)
    d.line((0, ground, width, ground), fill=ink, width=lw)
    for _ in range(3):  # background props
        cx, cy, r = (
            rng.randint(0, width),
            rng.randint(height // 8, height // 2),
            rng.randint(height // 20, height // 8),
        )
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=rng.choice(accents), width=lw)
    n = max(1, min(4, prompt.count("Character ")))
    for i in range(n):
        x = int(width * (i + 1) / (n + 1)) + rng.randint(-width // 30, width // 30)
        _stickman(d, x, ground, int(height * 0.45), ink, lw)
    # Small corner swatch for debugging which prompt produced this image.
    d.rectangle((lw, lw, lw + width // 40, lw + width // 40), fill=f"#{digest[:6]}")
    im.save(out, format="PNG", optimize=False)


class PlaceholderImage(Adapter):
    adapter_name: ClassVar[str] = "placeholder"
    kind: ClassVar[Kind] = Kind.IMAGE
    capabilities: ClassVar[frozenset[str]] = frozenset({"seed"})
    default_max_concurrency: ClassVar[int] = 4
    license_note: ClassVar[str] = "generated locally by stickforge (MIT)"

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
        if aspect is not Aspect.LANDSCAPE_16_9:
            raise ValueError(f"unsupported aspect {aspect}")
        w = int(self.config.settings.get("width", 1920))
        h = w * 9 // 16
        await asyncio.to_thread(render_placeholder, prompt, seed, w, h, out_path)
        return ImageResult(
            path=out_path, provider=self.name, model="placeholder", width=w, height=h, seed=seed
        )
