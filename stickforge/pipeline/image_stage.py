"""Stage 3: one 16:9 image per scene (parallel, cached), fallback across the chain."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from stickforge.core.cache import canonical_key, file_sha256
from stickforge.core.ratelimit import Limiter
from stickforge.core.retry import with_retry
from stickforge.core.security import MediaValidationError, validate_image
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.util import run_all
from stickforge.providers.base import (
    Adapter,
    Aspect,
    ImageProvider,
    ImageResult,
    Kind,
    ProviderError,
)
from stickforge.schema import Project, Scene

NO_TEXT_RULE = "Do not draw any text, letters, words, numbers, captions, logos, or watermarks."


def build_prompt(project: Project, scene: Scene) -> str:
    style = project.style
    cast = project.cast_by_name()
    parts = [
        style.prompt_prefix,
        "Stickman animation style illustration, 16:9 landscape composition.",
        f"Line style: {style.line_style}.",
        f"Background: {style.background}.",
        f"Color palette: {' '.join(style.palette)}.",
        f"Shot: {scene.shot.value}.",
        f"Scene: {scene.visual}",
    ]
    parts += [f"Character {n}: {cast[n].description}" for n in scene.characters]
    parts.append(NO_TEXT_RULE)
    return "\n".join(p for p in parts if p)


def scene_seed(base: int, scene_id: int, attempt: int = 0, override: int | None = None) -> int:
    """Deterministic per-scene seed; ``attempt`` re-rolls (QA), ``override`` from scenes.json."""
    origin = override if override is not None else base * 1_000_003 + scene_id * 7919
    return (origin + attempt * 104_729) % (2**31 - 1)


def image_key(adapter: Adapter, prompt: str, seed: int, ref_hashes: list[str]) -> str:
    return canonical_key(
        {
            "stage": "image",
            **adapter.cache_identity(),
            "prompt": prompt,
            "seed": seed,
            "aspect": Aspect.LANDSCAPE_16_9.value,
            "refs": ref_hashes,
        }
    )


def scene_refs(ctx: RunContext, scene: Scene) -> list[Path]:
    cast = ctx.project.project.cast_by_name()
    return [ctx.project.resolve(r) for n in scene.characters for r in cast[n].reference_images]


async def generate_scene_image(
    ctx: RunContext, st: SceneState, chain: list[Adapter], attempt: int, *, force: bool
) -> None:
    """Walk the chain in order for one scene/seed attempt; sets st.image / st.image_id.

    Each provider's own cache entry is checked first, so a scene that fell back last time
    is upgraded once the preferred provider works again.
    """
    prompt = build_prompt(ctx.project.project, st.scene)
    seed = scene_seed(ctx.config.seed, st.scene.id, attempt, st.scene.seed)
    all_refs = scene_refs(ctx, st.scene)
    errors: list[str] = []
    calls = 0
    t0 = time.monotonic()
    for adapter in chain:
        assert isinstance(adapter, ImageProvider)
        refs = all_refs if adapter.has("refs") else []
        key = image_key(adapter, prompt, seed, [file_sha256(r) for r in refs])
        hit = None if force else ctx.cache.get(key)
        if hit is not None:
            st.image = ImageResult.model_validate({**hit.meta, "path": hit.path})
            st.image_id, st.providers["image"] = hit.sha256, adapter.name
            st.cache_hits["image"] = True
            st.seed_attempt = attempt
            return
        tmp = ctx.cache.tmp_path(key, ".png")
        limiter = ctx.registry.limiter(adapter.name)

        async def call(
            adapter: ImageProvider = adapter,
            refs: list[Path] = refs,
            tmp: Path = tmp,
            limiter: Limiter = limiter,
        ) -> ImageResult:
            async with limiter.slot():
                return await adapter.generate(
                    prompt, refs, Aspect.LANDSCAPE_16_9, seed, {}, out_path=tmp
                )

        try:
            res, attempts = await with_retry(call, ctx.retry)
            calls += attempts
            w, h = await asyncio.to_thread(validate_image, tmp)
            res = res.model_copy(update={"width": w, "height": h})
            entry = ctx.cache.commit(
                key, tmp, ".png", res.model_dump(mode="json", exclude={"path"})
            )
        except (ProviderError, MediaValidationError) as e:
            ctx.cache.discard(tmp)
            n = ctx.retry.max_attempts if getattr(e, "retryable", False) else 1
            calls += n
            ctx.ledger.record(
                "image", st.scene.id, adapter.name, adapter.model, 0.0, attempts=n, ok=False
            )
            errors.append(f"{adapter.name}: {e}")
            ctx.log.warning(
                "image.provider_failed", scene=st.scene.id, provider=adapter.name, error=str(e)
            )
            continue
        except BaseException:
            ctx.cache.discard(tmp)
            raise
        st.image, st.image_id = res.model_copy(update={"path": entry.path}), entry.sha256
        st.providers["image"] = adapter.name
        st.attempts["image"] = st.attempts.get("image", 0) + calls
        st.cost_usd += res.cost_usd
        st.errors.extend(errors)
        st.cache_hits["image"] = False
        st.seed_attempt = attempt
        st.timings["image"] = round(st.timings.get("image", 0.0) + time.monotonic() - t0, 3)
        ctx.ledger.record(
            "image", st.scene.id, adapter.name, res.model, res.cost_usd, attempts=attempts
        )
        ctx.log.info(
            "image.done",
            scene=st.scene.id,
            provider=adapter.name,
            attempts=calls,
            seed_attempt=attempt,
        )
        return
    raise RuntimeError(f"scene {st.scene.id}: all image providers failed: {errors}")


async def run(ctx: RunContext) -> None:
    chain = ctx.registry.chain(ctx.mode.chains.image, Kind.IMAGE)
    if chain[0].has("stub"):
        msg = (
            f"images come from the '{chain[0].name}' stub. Run `stickforge doctor` to see "
            "why real providers are unavailable."
        )
        ctx.warnings.append(msg)
        ctx.reporter.note(f"[yellow]WARNING: {msg}")
    ctx.reporter.stage("images", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        await generate_scene_image(ctx, st, chain, 0, force=ctx.forced(st))
        ctx.reporter.advance("images", cached=st.cache_hits.get("image", False))

    await run_all(one, ctx.scenes)
