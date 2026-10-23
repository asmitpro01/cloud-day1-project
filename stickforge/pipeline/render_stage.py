"""Stage 5: render each scene to a video-only segment (parallel, cached).

Segment = eased camera move over the scene image, on-screen title (Pillow PNG),
optional burned-in captions (Pillow PNGs), optional crossfade from the previous
scene's final camera view. All segments share identical encoder parameters so stage 6
can concat them with stream copy; each segment is exactly ``frames`` long, so
transitions never shift the audio sync.
"""

from __future__ import annotations

import asyncio

from stickforge.core.cache import canonical_key
from stickforge.core.ffmpeg import Overlay, build_segment
from stickforge.pipeline.camera import (
    CameraSettings,
    Motion,
    motion_for,
    render_frame,
    zoompan_filter,
)
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.overlays import TextStyle, render_title
from stickforge.pipeline.util import run_all
from stickforge.schema import Transition

SEGMENT_VERSION = 2  # bump when segment rendering changes


def camera_settings(ctx: RunContext) -> CameraSettings:
    c = ctx.config.render.camera
    return CameraSettings(
        zoom_amount=c.zoom_amount,
        pan_zoom=c.pan_zoom,
        oversample=ctx.mode.camera_oversample or c.oversample,
    )


def title_style(ctx: RunContext) -> TextStyle:
    style = ctx.project.project.style
    ink = style.palette[1] if len(style.palette) > 1 else "#1D1D1D"
    font = ctx.project.resolve(style.font) if style.font else None
    return TextStyle(fg="#FFFFFF", bg=ink, bg_alpha=215, font_file=font)


def crossfade_s(ctx: RunContext, st: SceneState) -> float:
    out = ctx.project.project.output
    if out.transition is not Transition.CROSSFADE:
        return 0.0
    return min(out.crossfade_s, st.duration_s(ctx.fps) / 2)


async def _prepare(ctx: RunContext, st: SceneState, motion: Motion, needs_end: bool) -> None:
    """Title PNG and (if a crossfade follows) this scene's final camera view."""
    w, h = ctx.mode.width, ctx.mode.height
    text = st.scene.on_screen_text
    if text:
        style = title_style(ctx)
        key = canonical_key(
            {"stage": "title_png", "v": 1, "text": text, "w": w, "h": h, "style": repr(style)}
        )
        hit = ctx.cache.get(key)
        if hit is None:
            tmp = ctx.cache.tmp_path(key, ".png")
            await asyncio.to_thread(render_title, text, w, h, tmp, style)
            hit = ctx.cache.commit(key, tmp, ".png", {})
        st.title_png, st.title_key = hit.path, key
    if needs_end:
        assert st.image is not None
        key = canonical_key(
            {
                "stage": "end_frame",
                "v": 1,
                "image": st.image_key,
                "motion": repr(motion),
                "title": st.title_key,
                "w": w,
                "h": h,
            }
        )
        hit = ctx.cache.get(key)
        if hit is None:
            tmp = ctx.cache.tmp_path(key, ".png")
            overlays = (st.title_png,) if st.title_png else ()
            await asyncio.to_thread(render_frame, st.image.path, motion, 1.0, w, h, tmp, overlays)
            hit = ctx.cache.commit(key, tmp, ".png", {})
        st.end_frame, st.end_frame_key = hit.path, key


def _overlays(ctx: RunContext, st: SceneState) -> list[Overlay]:
    out: list[Overlay] = []
    if st.title_png is not None:
        r = ctx.config.render
        out.append(Overlay(st.title_png, start_s=r.title_delay_s, fade_in_s=r.title_fade_in_s))
    out += [Overlay(png, start_s=a, end_s=b) for png, a, b, _ in st.caption_pngs]
    return out


async def run(ctx: RunContext) -> None:
    settings = camera_settings(ctx)
    motions = [motion_for(st.scene.camera, settings) for st in ctx.scenes]
    crossfading = ctx.project.project.output.transition is Transition.CROSSFADE
    await run_all(
        lambda i: _prepare(ctx, ctx.scenes[i], motions[i], crossfading and i + 1 < len(ctx.scenes)),
        range(len(ctx.scenes)),
    )

    limit = asyncio.Semaphore(ctx.config.render.parallelism())
    ctx.reporter.stage("render", len(ctx.scenes))
    w, h = ctx.mode.width, ctx.mode.height

    async def one(i: int) -> None:
        st = ctx.scenes[i]
        assert st.image is not None and st.image_key is not None
        prev = ctx.scenes[i - 1] if i > 0 else None
        xf = crossfade_s(ctx, st) if prev is not None and prev.end_frame else 0.0
        overlays = _overlays(ctx, st)
        key = canonical_key(
            {
                "stage": "segment",
                "v": SEGMENT_VERSION,
                "image": st.image_key,
                "frames": st.frames,
                "w": w,
                "h": h,
                "motion": repr(motions[i]),
                "encoder": ctx.encoder.to_args(),
                "title": st.title_key,
                "title_timing": [
                    ctx.config.render.title_delay_s,
                    ctx.config.render.title_fade_in_s,
                ],
                "captions": [(k, a, b) for _, a, b, k in st.caption_pngs],
                "prev": prev.end_frame_key if xf and prev else None,
                "crossfade": xf,
            }
        )
        hit = None if ctx.force else ctx.cache.get(key)
        st.cache_hits["segment"] = hit is not None
        if hit is None:
            tmp = ctx.cache.tmp_path(key, ".mp4")
            args = build_segment(
                ctx.ffmpeg.ffmpeg,
                st.image.path,
                tmp,
                frames=st.frames,
                width=w,
                height=h,
                enc=ctx.encoder,
                motion_filter=zoompan_filter(motions[i], st.frames, w, h, ctx.fps),
                overlays=overlays,
                prev_frame=prev.end_frame if xf and prev else None,
                crossfade_s=xf,
            )
            try:
                async with limit:
                    await ctx.ffmpeg.run(
                        args,
                        timeout_s=ctx.ffmpeg.timeout_for(
                            st.duration_s(ctx.fps) * motions[i].oversample
                        ),
                    )
                hit = ctx.cache.commit(key, tmp, ".mp4", {"frames": st.frames})
            except BaseException:
                ctx.cache.discard(tmp)
                raise
            ctx.log.info(
                "segment.done", scene=st.scene.id, frames=st.frames, camera=st.scene.camera.value
            )
            ctx.reporter.advance("render")
        else:
            ctx.reporter.advance("render", cached=True)
        st.segment, st.segment_key = hit.path, key

    await run_all(one, range(len(ctx.scenes)))
