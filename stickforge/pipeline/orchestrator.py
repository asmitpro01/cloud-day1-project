"""Runs the stages in order. Every stage is cache-backed, so a rerun resumes for free."""

from __future__ import annotations

import time
from collections.abc import Awaitable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from stickforge import logs
from stickforge.config import EngineConfig
from stickforge.core.cache import Cache
from stickforge.core.ffmpeg import EncoderParams, FFmpeg
from stickforge.core.retry import RetryPolicy
from stickforge.core.security import safe_project_path
from stickforge.lint import LintWarning, lint_scenes
from stickforge.pipeline import (
    assemble_stage,
    audio_stage,
    captions_stage,
    image_stage,
    qa_stage,
    render_stage,
    report,
    tts_stage,
)
from stickforge.pipeline.context import NullReporter, Reporter, RunContext, SceneState
from stickforge.pipeline.util import settle
from stickforge.providers.registry import Registry
from stickforge.schema import ProjectError, load_project


@dataclass(frozen=True)
class RenderResult:
    output: Path
    duration_s: float
    wall_s: float
    scenes: int
    lint: list[LintWarning]
    cache_hits: dict[str, int]
    cost_usd: float = 0.0
    report: dict[str, Any] | None = None


def make_ffmpeg(config: EngineConfig) -> FFmpeg:
    r = config.render
    return FFmpeg.from_paths(
        r.ffmpeg_path,
        r.ffprobe_path,
        timeout_base_s=r.timeout_base_s,
        timeout_per_media_s=r.timeout_per_media_s,
    )


async def render(
    project_dir: Path,
    config: EngineConfig,
    *,
    mode: str = "draft",
    force: bool = False,
    only_scenes: set[int] | None = None,
    qa: bool | None = None,
    reporter: Reporter | None = None,
) -> RenderResult:
    t0 = time.monotonic()
    started = time.time()
    loaded = load_project(project_dir)
    warnings = lint_scenes(loaded.scenes)
    mode_cfg = config.modes[mode]
    reporter = reporter or NullReporter()
    if only_scenes is not None:
        unknown = sorted(only_scenes - {s.id for s in loaded.scenes})
        if unknown:
            raise ProjectError([f"--only-scenes: unknown scene ids {unknown}"])

    # cache/output dirs are config values, guarded like any other project path.
    out_dir = safe_project_path(loaded.root, config.output_dir) / mode
    cache = Cache(safe_project_path(loaded.root, config.cache_dir))
    logs.configure(out_dir / "stickforge.log.jsonl")
    log = logs.get_logger(project=loaded.project.title, mode=mode)

    ffmpeg = make_ffmpeg(config)
    codec = await ffmpeg.pick_encoder(config.render.encoder)
    encoder = EncoderParams(
        codec=codec, preset=mode_cfg.x264_preset, crf=mode_cfg.crf, fps=mode_cfg.fps
    )
    ctx = RunContext(
        project=loaded,
        config=config,
        mode_name=mode,
        mode=mode_cfg,
        registry=Registry(config),
        cache=cache,
        ffmpeg=ffmpeg,
        encoder=encoder,
        out_dir=out_dir,
        reporter=reporter,
        log=log,
        force=force,
        only_scenes=frozenset(only_scenes) if only_scenes is not None else None,
        qa=mode_cfg.qa if qa is None else qa,
        retry=RetryPolicy(**config.retry.model_dump()),
        scenes=[SceneState(scene=s) for s in loaded.scenes],
    )
    ctx.warnings.extend(str(w) for w in warnings)
    log.info(
        "render.start",
        scenes=len(ctx.scenes),
        encoder=codec,
        qa=ctx.qa,
        only_scenes=sorted(only_scenes) if only_scenes else None,
    )
    for w in warnings:
        log.warning("lint", scene=w.scene_id, message=w.message)

    stage_s: dict[str, float] = {}
    error: BaseException | None = None
    output_info: dict[str, object] | None = None

    async def timed(name: str, coro: Awaitable[object]) -> object:
        s0 = time.monotonic()
        try:
            return await coro
        finally:
            stage_s[name] = round(time.monotonic() - s0, 2)

    try:
        try:
            # Independent branches: voice (local CPU) and images (network) overlap.
            async def voice_then_captions() -> None:
                await timed("tts", tts_stage.run(ctx))
                await timed("captions", captions_stage.run(ctx))

            async def images_then_qa() -> None:
                await timed("images", image_stage.run(ctx))
                await timed("qa", qa_stage.run(ctx))

            await settle(voice_then_captions(), images_then_qa())
            await timed("render", render_stage.run(ctx))
            await timed("audio", audio_stage.run(ctx))
            output = await timed("assemble", assemble_stage.run(ctx))
            assert isinstance(output, Path)
            loud = ctx.artifacts_meta.get("loudness", {})
            output_info = {
                "video": str(output),
                "srt": str(ctx.artifacts.get("srt", "")),
                "duration_s": round(ctx.total_frames() / ctx.fps, 3),
                "width": mode_cfg.width,
                "height": mode_cfg.height,
                "fps": mode_cfg.fps,
                "encoder": codec,
                "loudness_lufs": loud.get("i"),
                "true_peak_dbtp": loud.get("tp"),
                "loudness_target": {"i": config.audio.loudness_i, "tp": config.audio.true_peak},
            }
        except Exception as e:
            error = e
            log.exception("render.failed")
            raise
    finally:
        report_doc = report.build(
            ctx, started=started, error=error, stage_s=stage_s, output=output_info
        )
        report.write(ctx, report_doc)

    hits: dict[str, int] = {}
    for st in ctx.scenes:
        for stage, was_hit in st.cache_hits.items():
            hits[stage] = hits.get(stage, 0) + int(was_hit)
    wall = time.monotonic() - t0
    log.info(
        "render.done",
        output=str(output),
        wall_s=round(wall, 2),
        cache_hits=hits,
        cost_usd=ctx.ledger.total_usd,
    )
    return RenderResult(
        output=output,
        duration_s=ctx.total_frames() / ctx.fps,
        wall_s=wall,
        scenes=len(ctx.scenes),
        lint=warnings,
        cache_hits=hits,
        cost_usd=ctx.ledger.total_usd,
        report=report_doc,
    )
