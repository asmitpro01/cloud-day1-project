"""Stage 2: narration audio per scene (parallel, cached). Voice length defines timing."""

from __future__ import annotations

import asyncio

from stickforge.core.cache import canonical_key
from stickforge.pipeline.context import RunContext, SceneState, frames_for
from stickforge.pipeline.util import run_all
from stickforge.providers.base import Adapter, AudioResult, Kind, TTSProvider


def tts_key(adapter: Adapter, voice: str, speed: float, text: str) -> str:
    return canonical_key(
        {
            "stage": "tts",
            "adapter": adapter.adapter_name,
            "model": adapter.config.model,
            "endpoint": adapter.config.endpoint,
            "settings": adapter.config.settings,
            "voice": voice,
            "speed": speed,
            "text": text,
        }
    )


async def run(ctx: RunContext) -> None:
    # One TTS provider for the whole project: mixing voices across scenes is never OK.
    adapter = ctx.registry.chain(ctx.mode.chains.tts, Kind.TTS)[0]
    assert isinstance(adapter, TTSProvider)
    voice = ctx.project.project.voice
    padding = ctx.project.project.output.scene_padding_s
    limit = asyncio.Semaphore(adapter.config.max_concurrency or adapter.default_max_concurrency)
    ctx.reporter.stage("tts", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        key = tts_key(adapter, voice.id, voice.speed, st.scene.narration)
        hit = None if ctx.force else ctx.cache.get(key)
        if hit is not None:
            result = AudioResult.model_validate({**hit.meta, "path": hit.path})
        else:
            async with limit:
                tmp = ctx.cache.tmp_path(key, ".wav")
                try:
                    raw = await adapter.synthesize(
                        st.scene.narration, voice.id, {"speed": voice.speed}, out_path=tmp
                    )
                    measured = await ctx.ffmpeg.validate_audio(tmp)
                    result = raw.model_copy(update={"duration_s": measured})
                    meta = result.model_dump(mode="json", exclude={"path"})
                    entry = ctx.cache.commit(key, tmp, ".wav", meta)
                except BaseException:
                    ctx.cache.discard(tmp)
                    raise
            result = result.model_copy(update={"path": entry.path})
            ctx.log.info(
                "tts.done",
                scene=st.scene.id,
                provider=adapter.name,
                duration_s=round(result.duration_s, 3),
            )
        st.audio, st.audio_key = result, key
        st.cache_hits["tts"] = hit is not None
        st.frames = frames_for(result.duration_s, padding, ctx.fps)
        ctx.reporter.advance("tts", cached=hit is not None)

    await run_all(one, ctx.scenes)
