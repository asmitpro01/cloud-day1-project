"""report.json: what was rendered, by whom, at what cost, and what needs attention."""

from __future__ import annotations

import json
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from stickforge.core.cache import atomic_write_text
from stickforge.core.security import REDACTOR
from stickforge.pipeline.context import RunContext, SceneState


def _version() -> str:
    try:
        return version("stickforge")
    except PackageNotFoundError:
        return "dev"


def scene_status(ctx: RunContext, st: SceneState, first_image: str | None) -> str:
    if st.qa_status == "flagged":
        return "qa_flagged"
    used = st.providers.get("image")
    if used is not None and first_image is not None and used != first_image:
        return "fallback"
    return "ok" if st.segment is not None else "incomplete"


def licenses(ctx: RunContext) -> list[dict[str, str | None]]:
    out: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for st in ctx.scenes:
        for stage, name in st.providers.items():
            if name in seen or name not in ctx.config.providers:
                continue
            seen.add(name)
            pc = ctx.config.providers[name]
            cls = ctx.registry.adapter_class(name)
            out.append(
                {
                    "component": stage,
                    "provider": name,
                    "model": pc.model,
                    "note": pc.license_note or cls.license_note,
                }
            )
    for name, pc in ctx.config.providers.items():  # local model files actually in use
        if name in seen:
            for role in ("model", "voices"):
                key = pc.settings.get(role)
                if key in ctx.config.models:
                    out.append(
                        {
                            "component": "model_file",
                            "provider": name,
                            "model": key,
                            "note": ctx.config.models[key].license_note,
                        }
                    )
    music = ctx.project.project.music
    if music is not None:
        out.append(
            {
                "component": "music",
                "provider": "user",
                "model": music.file,
                "note": "user-supplied — make sure you hold the rights for YouTube use",
            }
        )
    font = ctx.project.project.style.font
    out.append(
        {
            "component": "font",
            "provider": "user" if font else "pillow",
            "model": font or "Pillow bundled default font",
            "note": "user-supplied" if font else "bundled with Pillow (see Pillow license)",
        }
    )
    return out


def build(
    ctx: RunContext,
    *,
    started: float,
    error: BaseException | None,
    stage_s: dict[str, float],
    output: dict[str, Any] | None,
) -> dict[str, Any]:
    chain = ctx.mode.chains.image
    first_image = next((n for n in chain if ctx.registry.status(n).ready), None)
    scenes: list[dict[str, Any]] = []
    for st in ctx.scenes:
        scenes.append(
            {
                "id": st.scene.id,
                "status": scene_status(ctx, st, first_image),
                "duration_s": round(st.duration_s(ctx.fps), 3) if st.frames else None,
                "frames": st.frames,
                "providers": st.providers,
                "attempts": st.attempts,
                "seed_attempt": st.seed_attempt,
                "cache_hits": st.cache_hits,
                "cost_usd": round(st.cost_usd, 6),
                "timings_s": st.timings,
                "qa": {"status": st.qa_status, "attempts": st.qa_attempts, "issues": st.qa_issues},
                "provider_errors": [REDACTOR.text(e) for e in st.errors],
            }
        )
    return {
        "stickforge_version": _version(),
        "project": ctx.project.project.title,
        "mode": ctx.mode_name,
        "status": "failed" if error else "ok",
        "error": REDACTOR.text(f"{type(error).__name__}: {error}") if error else None,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
        "wall_s": round(time.time() - started, 2),
        "stages_s": stage_s,
        "only_scenes": sorted(ctx.only_scenes) if ctx.only_scenes is not None else None,
        "output": output,
        "cost": {
            "total_usd": ctx.ledger.total_usd,
            "by_provider": ctx.ledger.by("provider"),
            "by_stage": ctx.ledger.by("stage"),
            "provider_calls": ctx.ledger.calls(),
            "note": "spend for calls made in this run; cache hits cost nothing. Prices come "
            "from config (cost.*) — keep them current.",
        },
        "scenes": scenes,
        "summary": {
            "scenes": len(scenes),
            "fallback": sum(s["status"] == "fallback" for s in scenes),
            "qa_flagged": sum(s["status"] == "qa_flagged" for s in scenes),
            "qa_passed": sum(s["qa"]["status"] == "passed" for s in scenes),
        },
        "warnings": [REDACTOR.text(w) for w in ctx.warnings],
        "licenses": licenses(ctx),
    }


def write(ctx: RunContext, report: dict[str, Any]) -> Path:
    path = ctx.out_dir / "report.json"
    atomic_write_text(path, json.dumps(report, indent=2, ensure_ascii=False))
    ctx.ledger.write_jsonl(ctx.out_dir / "costs.jsonl")
    return path
