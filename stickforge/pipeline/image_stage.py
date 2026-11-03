"""Stage 3: one 16:9 image per scene (parallel, cached), fallback across the chain."""

from __future__ import annotations

import asyncio
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


def scene_seed(base: int, scene_id: int, attempt: int = 0) -> int:
    return (base * 1_000_003 + scene_id * 7919 + attempt * 104_729) % (2**31 - 1)


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


async def run(ctx: RunContext) -> None:
    chain = ctx.registry.chain(ctx.mode.chains.image, Kind.IMAGE)
    if chain[0].has("stub"):
        ctx.reporter.note(
            f"[yellow]WARNING: images come from the '{chain[0].name}' stub. "
            "Run `stickforge doctor` to see why real providers are unavailable."
        )
    ctx.reporter.stage("images", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        prompt = build_prompt(ctx.project.project, st.scene)
        seed = scene_seed(ctx.config.seed, st.scene.id)
        all_refs = scene_refs(ctx, st.scene)
        errors: list[str] = []
        calls = 0
        # Walk the chain in order; each provider's own cache entry is checked first, so a
        # scene that fell back last time is upgraded once the preferred provider works.
        for adapter in chain:
            assert isinstance(adapter, ImageProvider)
            refs = all_refs if adapter.has("refs") else []
            key = image_key(adapter, prompt, seed, [file_sha256(r) for r in refs])
            hit = None if ctx.force else ctx.cache.get(key)
            if hit is not None:
                st.image = ImageResult.model_validate({**hit.meta, "path": hit.path})
                st.image_key, st.providers["image"] = key, adapter.name
                st.cache_hits["image"] = True
                ctx.reporter.advance("images", cached=True)
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
                calls += ctx.retry.max_attempts if getattr(e, "retryable", False) else 1
                errors.append(f"{adapter.name}: {e}")
                ctx.log.warning(
                    "image.provider_failed", scene=st.scene.id, provider=adapter.name, error=str(e)
                )
                continue
            except BaseException:
                ctx.cache.discard(tmp)
                raise
            st.image, st.image_key = res.model_copy(update={"path": entry.path}), key
            st.providers["image"], st.attempts["image"] = adapter.name, calls
            st.cost_usd += res.cost_usd
            st.errors.extend(errors)
            st.cache_hits["image"] = False
            ctx.log.info("image.done", scene=st.scene.id, provider=adapter.name, attempts=calls)
            ctx.reporter.advance("images")
            return
        raise RuntimeError(f"scene {st.scene.id}: all image providers failed: {errors}")

    await run_all(one, ctx.scenes)
