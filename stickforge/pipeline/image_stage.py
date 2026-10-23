"""Stage 3: one 16:9 image per scene (parallel, cached), fallback across the chain."""

from __future__ import annotations

import asyncio
from pathlib import Path

from stickforge.core.cache import canonical_key, file_sha256
from stickforge.core.security import validate_image
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.util import run_all
from stickforge.providers.base import Adapter, Aspect, ImageProvider, ImageResult, Kind
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
            "adapter": adapter.adapter_name,
            "model": adapter.config.model,
            "endpoint": adapter.config.endpoint,
            "settings": adapter.config.settings,
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
    limits = {
        a.name: asyncio.Semaphore(a.config.max_concurrency or a.default_max_concurrency)
        for a in chain
    }
    ctx.reporter.stage("images", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        prompt = build_prompt(ctx.project.project, st.scene)
        seed = scene_seed(ctx.config.seed, st.scene.id)
        all_refs = scene_refs(ctx, st.scene)
        errors: list[str] = []
        for adapter in chain:
            assert isinstance(adapter, ImageProvider)
            refs = all_refs if "refs" in adapter.capabilities else []
            key = image_key(adapter, prompt, seed, [file_sha256(r) for r in refs])
            hit = None if ctx.force else ctx.cache.get(key)
            if hit is not None:
                st.image = ImageResult.model_validate({**hit.meta, "path": hit.path})
                st.image_key = key
                st.cache_hits["image"] = True
                ctx.reporter.advance("images", cached=True)
                return
            tmp = ctx.cache.tmp_path(key, ".png")
            try:
                async with limits[adapter.name]:
                    res = await adapter.generate(
                        prompt, refs, Aspect.LANDSCAPE_16_9, seed, {}, out_path=tmp
                    )
                w, h = await asyncio.to_thread(validate_image, tmp)
                res = res.model_copy(update={"width": w, "height": h})
                entry = ctx.cache.commit(
                    key, tmp, ".png", res.model_dump(mode="json", exclude={"path"})
                )
            except Exception as e:  # fall through to the next provider in the chain
                ctx.cache.discard(tmp)
                errors.append(f"{adapter.name}: {e}")
                ctx.log.warning(
                    "image.provider_failed", scene=st.scene.id, provider=adapter.name, error=str(e)
                )
                continue
            st.image, st.image_key = res.model_copy(update={"path": entry.path}), key
            st.cache_hits["image"] = False
            ctx.log.info("image.done", scene=st.scene.id, provider=adapter.name)
            ctx.reporter.advance("images")
            return
        raise RuntimeError(f"scene {st.scene.id}: all image providers failed: {errors}")

    await run_all(one, ctx.scenes)
