"""Stage 5: render each scene to a video-only segment (parallel, cached).

All segments share identical encoder parameters so stage 6 can concat with stream copy.
"""

from __future__ import annotations

import asyncio

from stickforge.core.cache import canonical_key
from stickforge.core.ffmpeg import build_static_segment
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.util import run_all

SEGMENT_VERSION = 1  # bump when segment rendering changes


def segment_key(ctx: RunContext, st: SceneState) -> str:
    assert st.image_key is not None
    return canonical_key(
        {
            "stage": "segment",
            "v": SEGMENT_VERSION,
            "image": st.image_key,
            "frames": st.frames,
            "width": ctx.mode.width,
            "height": ctx.mode.height,
            "camera": st.scene.camera.value,
            "encoder": ctx.encoder.to_args(),
        }
    )


async def run(ctx: RunContext) -> None:
    limit = asyncio.Semaphore(ctx.config.render.parallelism())
    ctx.reporter.stage("render", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        assert st.image is not None
        key = segment_key(ctx, st)
        hit = None if ctx.force else ctx.cache.get(key)
        st.cache_hits["segment"] = hit is not None
        if hit is None:
            tmp = ctx.cache.tmp_path(key, ".mp4")
            # M1: every camera renders static; camera moves arrive in M3.
            args = build_static_segment(
                ctx.ffmpeg.ffmpeg,
                st.image.path,
                tmp,
                frames=st.frames,
                width=ctx.mode.width,
                height=ctx.mode.height,
                enc=ctx.encoder,
            )
            try:
                async with limit:
                    await ctx.ffmpeg.run(
                        args, timeout_s=ctx.ffmpeg.timeout_for(st.duration_s(ctx.fps))
                    )
                hit = ctx.cache.commit(key, tmp, ".mp4", {"frames": st.frames})
            except BaseException:
                ctx.cache.discard(tmp)
                raise
            ctx.log.info("segment.done", scene=st.scene.id, frames=st.frames)
            ctx.reporter.advance("render")
        else:
            ctx.reporter.advance("render", cached=True)
        st.segment, st.segment_key = hit.path, key

    await run_all(one, ctx.scenes)
