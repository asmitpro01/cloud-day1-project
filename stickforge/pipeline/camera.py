"""Camera moves as eased zoompan expressions (numbers only — no user text).

Smoothness: zoompan snaps its crop window to whole input pixels, which shows as
jitter on slow moves. Rendering from an input upscaled ``oversample``x (default 4)
makes each snap a fraction of an output pixel; measured RMS jitter at 4x is ~0.2 px,
at the measurement floor of a sub-pixel reference render (see DECISIONS.md).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from stickforge.schema import Camera


@dataclass(frozen=True)
class CameraSettings:
    zoom_amount: float = 0.12  # slow zoom: 1.0 <-> 1.0 + zoom_amount
    pan_zoom: float = 1.12  # pans run at this fixed zoom
    oversample: int = 4


@dataclass(frozen=True)
class Motion:
    """zoompan parameters for one scene. ``t`` in expressions is the eased 0..1 progress."""

    camera: Camera
    zoom_start: float
    zoom_end: float
    pan_from: float  # horizontal position of the crop window, 0 = left edge, 1 = right
    pan_to: float
    oversample: int

    @property
    def is_static(self) -> bool:
        return self.camera is Camera.STATIC

    def state(self, t: float) -> tuple[float, float]:
        """(zoom, pan position) at eased progress t in [0, 1]."""
        return (
            self.zoom_start + (self.zoom_end - self.zoom_start) * t,
            self.pan_from + (self.pan_to - self.pan_from) * t,
        )


def motion_for(camera: Camera, s: CameraSettings) -> Motion:
    z = 1.0 + s.zoom_amount
    table = {
        Camera.STATIC: (1.0, 1.0, 0.5, 0.5),
        Camera.SLOW_ZOOM_IN: (1.0, z, 0.5, 0.5),
        Camera.SLOW_ZOOM_OUT: (z, 1.0, 0.5, 0.5),
        Camera.PAN_RIGHT: (s.pan_zoom, s.pan_zoom, 0.0, 1.0),
        Camera.PAN_LEFT: (s.pan_zoom, s.pan_zoom, 1.0, 0.0),
    }
    z0, z1, p0, p1 = table[camera]
    return Motion(camera, z0, z1, p0, p1, 1 if camera is Camera.STATIC else s.oversample)


def _f(x: float) -> str:
    return f"{x:.6f}"


def zoompan_filter(m: Motion, frames: int, width: int, height: int, fps: int) -> str:
    """Input-scaling + zoompan chain producing exactly ``frames`` frames at width x height."""
    iw, ih = width * m.oversample, height * m.oversample
    denom = max(1, frames - 1)
    ease = f"(1-cos(PI*on/{denom}))/2"  # cosine ease-in-out, 0..1
    dz = m.zoom_end - m.zoom_start
    dp = m.pan_to - m.pan_from
    z = _f(m.zoom_start) if dz == 0 else f"{_f(m.zoom_start)}+{_f(dz)}*{ease}"
    x = (
        f"(iw-iw/zoom)*{_f(m.pan_from)}"
        if dp == 0
        else f"(iw-iw/zoom)*({_f(m.pan_from)}+{_f(dp)}*{ease})"
    )
    return (
        f"scale={iw}:{ih}:force_original_aspect_ratio=increase:flags=lanczos,crop={iw}:{ih},"
        f"zoompan=z='{z}':x='{x}':y='(ih-ih/zoom)/2':d={frames}:s={width}x{height}:fps={fps},"
        "setsar=1,format=yuv420p"
    )


def render_frame(
    image: Path,
    m: Motion,
    t: float,
    width: int,
    height: int,
    out: Path,
    overlays: tuple[Path, ...] = (),
) -> None:
    """Pillow render of the camera view at progress t (used as a crossfade source)."""
    from PIL import Image

    with Image.open(image) as src:
        im = src.convert("RGB")
    # cover-crop to 16:9, like the ffmpeg chain
    scale = max(width / im.width, height / im.height)
    cw, ch = width / scale, height / scale
    cx, cy = (im.width - cw) / 2, (im.height - ch) / 2
    zoom, pan = m.state(t)
    vw, vh = cw / zoom, ch / zoom
    x0 = cx + (cw - vw) * pan
    y0 = cy + (ch - vh) / 2
    frame = im.resize((width, height), Image.Resampling.LANCZOS, box=(x0, y0, x0 + vw, y0 + vh))
    for ov in overlays:
        with Image.open(ov) as layer:
            frame.paste(layer.convert("RGBA"), (0, 0), layer.convert("RGBA"))
    frame.save(out, format="PNG")
