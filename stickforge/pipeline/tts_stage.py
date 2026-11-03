"""Stage 2: narration audio per scene (parallel, cached). Voice length defines timing."""

from __future__ import annotations

from stickforge.core.cache import canonical_key
from stickforge.core.retry import with_retry
from stickforge.pipeline.context import RunContext, SceneState, frames_for
from stickforge.pipeline.util import run_all
from stickforge.providers.base import Adapter, AudioResult, Kind, TTSProvider


def tts_key(adapter: Adapter, voice: str, speed: float, text: str) -> str:
    return canonical_key(
        {"stage": "tts", **adapter.cache_identity(), "voice": voice, "speed": speed, "text": text}
    )


async def run(ctx: RunContext) -> None:
    # One TTS provider for the whole project: mixing voices across scenes is never OK, so
    # the chain only falls back on readiness (missing key / dependency / model file).
    adapter = ctx.registry.chain(ctx.mode.chains.tts, Kind.TTS)[0]
    assert isinstance(adapter, TTSProvider)
    if adapter.has("stub"):
        ctx.reporter.note(
            f"[yellow]WARNING: TTS is the '{adapter.name}' stub — no real voice. "
            "Run `stickforge doctor` to see why real providers are unavailable."
        )
    voice = ctx.project.project.voice
    voice_id = voice.for_adapter(adapter.adapter_name)
    padding = ctx.project.project.output.scene_padding_s
    limiter = ctx.registry.limiter(adapter.name)
    ctx.reporter.stage("tts", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        key = tts_key(adapter, voice_id, voice.speed, st.scene.narration)
        hit = None if ctx.force else ctx.cache.get(key)
        if hit is not None:
            result = AudioResult.model_validate({**hit.meta, "path": hit.path})
        else:
            tmp = ctx.cache.tmp_path(key, ".wav")

            async def call() -> AudioResult:
                async with limiter.slot():
                    return await adapter.synthesize(
                        st.scene.narration, voice_id, {"speed": voice.speed}, out_path=tmp
                    )

            try:
                raw, attempts = await with_retry(call, ctx.retry)
                measured = await ctx.ffmpeg.validate_audio(tmp)
                result = raw.model_copy(update={"duration_s": measured})
                entry = ctx.cache.commit(
                    key, tmp, ".wav", result.model_dump(mode="json", exclude={"path"})
                )
            except BaseException:
                ctx.cache.discard(tmp)
                raise
            result = result.model_copy(update={"path": entry.path})
            st.attempts["tts"] = attempts
            st.cost_usd += result.cost_usd
            ctx.log.info(
                "tts.done",
                scene=st.scene.id,
                provider=adapter.name,
                attempts=attempts,
                duration_s=round(result.duration_s, 3),
            )
        st.audio, st.audio_key = result, key
        st.providers["tts"] = adapter.name
        st.cache_hits["tts"] = hit is not None
        st.frames = frames_for(result.duration_s, padding, ctx.fps)
        ctx.reporter.advance("tts", cached=hit is not None)

    await run_all(one, ctx.scenes)
