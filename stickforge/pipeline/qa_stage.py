"""Stage 4 (optional): vision QA of each scene image, re-rolling the seed on failure.

A failed image is regenerated with the next seed attempt, up to ``qa.max_retries``;
after that the attempt with the fewest issues is kept and the scene is *flagged* in
the report instead of looping forever. Verdicts are cached by image content, so a
rerun replays every decision for free (and attempt N's image is itself cached).
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from stickforge.core.cache import canonical_key
from stickforge.core.retry import with_retry
from stickforge.pipeline.context import RunContext, SceneState
from stickforge.pipeline.image_stage import generate_scene_image
from stickforge.pipeline.util import run_all
from stickforge.providers.base import Adapter, Kind, ProviderError, QAResult, VisionQAProvider


async def _check(ctx: RunContext, st: SceneState, qa_chain: list[Adapter]) -> QAResult | None:
    """QA verdict for the scene's current image, from cache or the first working provider."""
    assert st.image is not None
    style = ctx.project.project.style
    for adapter in qa_chain:
        assert isinstance(adapter, VisionQAProvider)
        key = canonical_key(
            {
                "stage": "qa",
                **adapter.cache_identity(),
                "image": st.image_id,
                "visual": st.scene.visual,
                "characters": st.scene.characters,
                "shot": st.scene.shot.value,
                "style": style.model_dump(),
            }
        )
        hit = None if ctx.forced(st) else ctx.cache.get(key)
        if hit is not None:
            return QAResult.model_validate_json(hit.path.read_text(encoding="utf-8"))
        image = st.image.path

        async def call(adapter: VisionQAProvider = adapter, image: Path = image) -> QAResult:
            async with ctx.registry.limiter(adapter_name(adapter)).slot():
                return await adapter.check(image, st.scene, style)

        try:
            result, attempts = await with_retry(call, ctx.retry)
        except ProviderError as e:
            ctx.log.warning(
                "qa.provider_failed",
                scene=st.scene.id,
                provider=adapter_name(adapter),
                error=str(e),
            )
            ctx.ledger.record(
                "qa", st.scene.id, adapter_name(adapter), adapter_model(adapter), 0.0, ok=False
            )
            continue
        ctx.ledger.record(
            "qa",
            st.scene.id,
            result.provider,
            adapter_model(adapter),
            result.cost_usd,
            attempts=attempts,
        )
        st.cost_usd += result.cost_usd
        tmp = ctx.cache.tmp_path(key, ".json")
        tmp.write_text(result.model_dump_json(), encoding="utf-8")
        ctx.cache.commit(key, tmp, ".json", {"passed": result.passed})
        return result
    return None


def adapter_name(a: object) -> str:
    return str(getattr(a, "name", "?"))


def adapter_model(a: object) -> str | None:
    model = getattr(a, "model", None)
    return str(model) if model else None


async def run(ctx: RunContext) -> None:
    if not ctx.qa:
        return
    names = ctx.mode.chains.vision_qa
    ready = [n for n in names if ctx.registry.status(n).ready]
    if not ready:
        msg = f"QA requested but no vision-QA provider is ready (chain: {names}); QA skipped"
        ctx.warnings.append(msg)
        ctx.reporter.note(f"[yellow]WARNING: {msg}")
        return
    qa_chain = ctx.registry.chain(ready, Kind.VISION_QA)
    image_chain = ctx.registry.chain(ctx.mode.chains.image, Kind.IMAGE)
    stubs = {a.name for a in image_chain if a.has("stub")}
    max_retries = ctx.config.qa.max_retries
    ctx.reporter.stage("qa", len(ctx.scenes))

    async def one(st: SceneState) -> None:
        t0 = time.monotonic()
        if st.providers.get("image") in stubs:
            st.qa_status = "skipped"  # placeholder art: nothing meaningful to check
            ctx.reporter.advance("qa", cached=True)
            return
        best: tuple[int, int, list[dict[str, str]]] | None = None  # (issues, attempt, issues)
        for attempt in range(st.seed_attempt, st.seed_attempt + max_retries + 1):
            if attempt != st.seed_attempt:
                await generate_scene_image(ctx, st, image_chain, attempt, force=ctx.forced(st))
                if st.providers.get("image") in stubs:
                    break  # the chain fell back to placeholder art; stop re-rolling
            verdict = await _check(ctx, st, qa_chain)
            st.qa_attempts += 1
            if verdict is None:
                st.qa_status = "error"
                ctx.warnings.append(f"scene {st.scene.id}: QA unavailable, image kept unchecked")
                break
            issues = [i.model_dump() for i in verdict.issues]
            if verdict.passed:
                st.qa_status, st.qa_issues = "passed", []
                break
            if best is None or len(issues) < best[0]:
                best = (len(issues), attempt, issues)
            ctx.log.info("qa.failed", scene=st.scene.id, attempt=attempt, issues=json.dumps(issues))
        else:
            assert best is not None
            if best[1] != st.seed_attempt:  # restore the least-bad attempt (cache hit)
                await generate_scene_image(ctx, st, image_chain, best[1], force=False)
            st.qa_status, st.qa_issues = "flagged", best[2]
            ctx.warnings.append(
                f"scene {st.scene.id}: QA still failing after {max_retries} "
                f"retries — flagged ({', '.join(i['code'] for i in best[2])})"
            )
        st.timings["qa"] = round(time.monotonic() - t0, 3)
        ctx.reporter.advance("qa")

    await run_all(one, ctx.scenes)
