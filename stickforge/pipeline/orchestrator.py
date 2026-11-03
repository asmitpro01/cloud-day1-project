"""Runs the stages in order. Every stage is cache-backed, so a rerun resumes for free."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from pathlib import Path

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
    render_stage,
    tts_stage,
)
from stickforge.pipeline.context import NullReporter, Reporter, RunContext, SceneState
from stickforge.providers.registry import Registry
from stickforge.schema import load_project


@dataclass(frozen=True)
class RenderResult:
    output: Path
    duration_s: float
    wall_s: float
    scenes: int
    lint: list[LintWarning]
    cache_hits: dict[str, int]


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
    reporter: Reporter | None = None,
) -> RenderResult:
    t0 = time.monotonic()
    loaded = load_project(project_dir)
    warnings = lint_scenes(loaded.scenes)
    mode_cfg = config.modes[mode]
    reporter = reporter or NullReporter()

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
        retry=RetryPolicy(**config.retry.model_dump()),
        scenes=[SceneState(scene=s) for s in loaded.scenes],
    )
    log.info("render.start", scenes=len(ctx.scenes), encoder=codec)
    for w in warnings:
        log.warning("lint", scene=w.scene_id, message=w.message)

    try:
        # Independent stages: TTS (local CPU) and images (network) overlap.
        async def voice_then_captions() -> None:
            await tts_stage.run(ctx)
            await captions_stage.run(ctx)

        async with asyncio.TaskGroup() as tg:
            tg.create_task(voice_then_captions())
            tg.create_task(image_stage.run(ctx))
        await render_stage.run(ctx)
        await audio_stage.run(ctx)
        output = await assemble_stage.run(ctx)
    except* Exception as eg:
        log.exception("render.failed")
        raise eg.exceptions[0] from None

    hits: dict[str, int] = {}
    for st in ctx.scenes:
        for stage, was_hit in st.cache_hits.items():
            hits[stage] = hits.get(stage, 0) + int(was_hit)
    wall = time.monotonic() - t0
    log.info("render.done", output=str(output), wall_s=round(wall, 2), cache_hits=hits)
    return RenderResult(
        output=output,
        duration_s=ctx.total_frames() / ctx.fps,
        wall_s=wall,
        scenes=len(ctx.scenes),
        lint=warnings,
        cache_hits=hits,
    )
