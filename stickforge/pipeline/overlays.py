"""Text rendered with Pillow to transparent full-frame PNGs.

On-screen text and burned-in captions never go through ffmpeg's drawtext: any string
from a scene plan or an LLM stays out of the filter graph entirely.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FontT = ImageFont.FreeTypeFont | ImageFont.ImageFont


def clean_text(text: str) -> str:
    """Drop control/format characters (incl. bidi overrides); collapse whitespace."""
    spaced = "".join(" " if ch.isspace() else ch for ch in text)
    kept = "".join(ch for ch in spaced if not unicodedata.category(ch).startswith("C"))
    return " ".join(kept.split())


def _font(size: int, font_file: Path | None) -> FontT:
    if font_file is not None:
        return ImageFont.truetype(str(font_file), size)
    return ImageFont.load_default(size=size)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: FontT, max_w: int) -> list[str]:
    lines: list[str] = []
    cur = ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if cur and draw.textlength(trial, font=font) > max_w:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def _balance(draw: ImageDraw.ImageDraw, text: str, font: FontT, max_w: int) -> list[str]:
    """Wrap into the fewest lines; for two lines, pick the split with the most even widths."""
    lines = _wrap(draw, text, font, max_w)
    if len(lines) != 2:
        return lines
    words = text.split()
    best: tuple[float, list[str]] | None = None
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        widest = max(draw.textlength(a, font=font), draw.textlength(b, font=font))
        if widest <= max_w and (best is None or widest < best[0]):
            best = (widest, [a, b])
    return best[1] if best else lines


def _hex(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    c = color.lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha


@dataclass(frozen=True)
class TextStyle:
    fg: str = "#FFFFFF"
    bg: str = "#1D1D1D"
    bg_alpha: int = 200
    font_file: Path | None = None


def _fit(
    draw: ImageDraw.ImageDraw,
    text: str,
    size: int,
    min_size: int,
    max_w: int,
    max_lines: int,
    font_file: Path | None,
) -> tuple[FontT, list[str]]:
    while True:
        font = _font(size, font_file)
        lines = _balance(draw, text, font, max_w)
        if len(lines) <= max_lines or size <= min_size:
            return font, lines[:max_lines]
        size = int(size * 0.9)


def render_title(text: str, width: int, height: int, out: Path, style: TextStyle) -> None:
    """On-screen text: a rounded card near the top, up to 2 lines."""
    text = clean_text(text)
    im = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    font, lines = _fit(
        d, text, int(height * 0.065), int(height * 0.035), int(width * 0.8), 2, style.font_file
    )
    line_h = int(font.size * 1.25) if isinstance(font, ImageFont.FreeTypeFont) else 20
    pad = int(height * 0.02)
    text_w = max(int(d.textlength(line, font=font)) for line in lines) if lines else 0
    box_w, box_h = text_w + 2 * pad, line_h * len(lines) + 2 * pad
    x0, y0 = (width - box_w) // 2, int(height * 0.07)
    d.rounded_rectangle(
        (x0, y0, x0 + box_w, y0 + box_h), radius=pad, fill=_hex(style.bg, style.bg_alpha)
    )
    for i, line in enumerate(lines):
        lw = d.textlength(line, font=font)
        d.text(((width - lw) / 2, y0 + pad + i * line_h), line, font=font, fill=_hex(style.fg))
    im.save(out, format="PNG")


def render_caption(text: str, width: int, height: int, out: Path, style: TextStyle) -> None:
    """Burned-in caption: white text on a translucent dark box in the lower safe area."""
    text = clean_text(text)
    im = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    font, lines = _fit(
        d, text, int(height * 0.044), int(height * 0.03), int(width * 0.8), 2, style.font_file
    )
    line_h = int(font.size * 1.3) if isinstance(font, ImageFont.FreeTypeFont) else 20
    pad_x, pad_y = int(height * 0.018), int(height * 0.008)
    bottom = int(height * 0.92)
    for i, line in enumerate(lines):
        lw = d.textlength(line, font=font)
        y = bottom - line_h * (len(lines) - i)
        x = (width - lw) / 2
        d.rectangle(
            (x - pad_x, y - pad_y, x + lw + pad_x, y + line_h - pad_y),
            fill=_hex(style.bg, style.bg_alpha),
        )
        d.text((x, y), line, font=font, fill=_hex(style.fg))
    im.save(out, format="PNG")
