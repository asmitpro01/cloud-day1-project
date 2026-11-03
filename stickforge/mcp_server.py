"""MCP server: Stickforge as tools for an AI client (`stickforge mcp --root <workspace>`).

Projects are folders directly under one workspace root and are addressed by name only, so a
client can never read or write outside it. Renders are long, so they run as background jobs:
`render` / `script_to_video` return a job id at once and `job_status` reports progress.
Jobs run one at a time (rendering is CPU-bound and the run log is process-wide).

The tool logic lives in `StickforgeService` (plain async methods, testable without MCP);
`build_server` only registers those methods with the MCP SDK (`pip install stickforge[mcp]`).
"""

from __future__ import annotations

import asyncio
import functools
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from stickforge.config import EngineConfig
from stickforge.core.cache import atomic_write_text
from stickforge.core.security import REDACTOR, safe_project_path
from stickforge.lint import lint_scenes
from stickforge.planner import PlanError, plan_script, write_project
from stickforge.providers.registry import Registry
from stickforge.schema import Camera, ProjectError, Shot, load_project

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MAX_JOBS_KEPT = 50

Mode = Literal["draft", "final"]


class ToolError(Exception):
    """A problem the client should see as a plain message (no traceback, redacted)."""


def _clean(e: BaseException) -> str:
    return REDACTOR.text(f"{type(e).__name__}: {e}")


@dataclass
class Job:
    id: str
    project: str
    mode: str
    status: str = "queued"  # queued | running | done | failed
    created: float = field(default_factory=time.time)
    finished: float | None = None
    stages: dict[str, dict[str, int]] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: str | None = None
    task: asyncio.Task[None] | None = None

    def view(self) -> dict[str, Any]:
        return {
            "job_id": self.id,
            "project": self.project,
            "mode": self.mode,
            "status": self.status,
            "stages": self.stages,
            "elapsed_s": round((self.finished or time.time()) - self.created, 1),
            "result": self.result,
            "error": self.error,
        }


class _JobReporter:
    """Pipeline Reporter that records per-stage progress on a Job."""

    def __init__(self, job: Job) -> None:
        self.job = job

    def stage(self, name: str, total: int) -> None:
        self.job.stages[name] = {"done": 0, "total": total, "cached": 0}

    def advance(self, name: str, *, cached: bool = False) -> None:
        st = self.job.stages.setdefault(name, {"done": 0, "total": 0, "cached": 0})
        st["done"] += 1
        st["cached"] += int(cached)

    def note(self, message: str) -> None:
        pass


class StickforgeService:
    def __init__(self, root: Path, config: EngineConfig) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.config = config
        self.jobs: dict[str, Job] = {}
        self._render_lock = asyncio.Lock()

    # -- helpers -----------------------------------------------------------------

    def project_dir(self, name: str) -> Path:
        if not NAME_RE.match(name or ""):
            raise ToolError("project name must be 1-64 of A-Z a-z 0-9 . _ - (no paths)")
        return safe_project_path(self.root, name)

    def _existing(self, name: str) -> Path:
        d = self.project_dir(name)
        if not (d / "project.yaml").is_file():
            raise ToolError(f"no project named {name!r}")
        return d

    def _load(self, name: str) -> Any:
        try:
            return load_project(self._existing(name))
        except ProjectError as e:
            raise ToolError("invalid project:\n" + "\n".join(e.problems)) from None

    # -- tools -------------------------------------------------------------------

    async def list_projects(self) -> list[dict[str, Any]]:
        out = []
        for d in sorted(p for p in self.root.iterdir() if p.is_dir()):
            if not (d / "project.yaml").is_file() or not NAME_RE.match(d.name):
                continue
            renders = sorted(
                f.parent.name for f in (d / self.config.output_dir).glob("*/report.json")
            )
            out.append({"name": d.name, "renders": renders})
        return out

    async def create_project(
        self,
        name: str,
        script: str,
        title: str | None = None,
        use_llm: bool = True,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        dest = self.project_dir(name)
        try:
            plan = await plan_script(script, self.config, title=title, use_llm=use_llm)
            write_project(dest, plan, overwrite=overwrite)
        except (PlanError, ProjectError) as e:
            raise ToolError(str(e)) from None
        return {
            "project": name,
            "title": plan.title,
            "scenes": len(plan.scenes),
            "planner": plan.source,
            "cost_usd": round(plan.cost_usd, 6),
            "notes": plan.notes,
        }

    async def get_project(self, name: str) -> dict[str, Any]:
        loaded = self._load(name)
        return {
            "project": loaded.project.model_dump(mode="json"),
            "scenes": [s.model_dump(mode="json") for s in loaded.scenes],
            "lint": [str(w) for w in lint_scenes(loaded.scenes)],
        }

    async def update_scene(
        self,
        name: str,
        scene_id: int,
        narration: str | None = None,
        visual: str | None = None,
        shot: str | None = None,
        camera: str | None = None,
        on_screen_text: str | None = None,
    ) -> dict[str, Any]:
        d = self._existing(name)
        changes = {
            k: v
            for k, v in {
                "narration": narration,
                "visual": visual,
                "shot": shot,
                "camera": camera,
                "on_screen_text": on_screen_text,
            }.items()
            if v is not None
        }
        if not changes:
            raise ToolError("nothing to change")
        sfile = d / "scenes.json"
        before = sfile.read_text(encoding="utf-8")
        scenes = json.loads(before)
        match = [s for s in scenes if isinstance(s, dict) and s.get("id") == scene_id]
        if not match:
            raise ToolError(f"no scene {scene_id}")
        match[0].update(changes)
        atomic_write_text(sfile, json.dumps(scenes, indent=1, ensure_ascii=False) + "\n")
        try:
            loaded = load_project(d)
        except ProjectError as e:
            atomic_write_text(sfile, before)  # never leave an invalid project behind
            raise ToolError("change rejected:\n" + "\n".join(e.problems)) from None
        return {
            "scene": next(s for s in loaded.scenes if s.id == scene_id).model_dump(mode="json"),
            "lint": [str(w) for w in lint_scenes(loaded.scenes)],
        }

    async def render(
        self,
        name: str,
        mode: Mode = "draft",
        only_scenes: list[int] | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        if mode not in ("draft", "final"):
            raise ToolError("mode must be draft or final")
        self._load(name)  # fail fast on an invalid project
        job = Job(id=uuid.uuid4().hex[:12], project=name, mode=mode)
        self._remember(job)
        job.task = asyncio.create_task(
            self._run(job, set(only_scenes) if only_scenes else None, force)
        )
        return job.view()

    async def script_to_video(
        self,
        name: str,
        script: str,
        title: str | None = None,
        mode: Mode = "draft",
        use_llm: bool = True,
        overwrite: bool = False,
    ) -> dict[str, Any]:
        created = await self.create_project(
            name, script, title=title, use_llm=use_llm, overwrite=overwrite
        )
        return {"plan": created, "job": await self.render(name, mode=mode)}

    async def job_status(self, job_id: str, wait_s: float = 0.0) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if job is None:
            raise ToolError(f"unknown job {job_id!r}")
        if wait_s > 0 and job.task is not None and not job.task.done():
            # Bounded long-poll so clients need fewer calls; capped at 60 s.
            done, _ = await asyncio.wait({job.task}, timeout=min(wait_s, 60.0))
            del done
        return job.view()

    async def get_report(self, name: str, mode: Mode | None = None) -> dict[str, Any]:
        d = self._existing(name)
        found = sorted(
            (d / self.config.output_dir).glob("*/report.json"), key=lambda p: p.stat().st_mtime
        )
        if mode:
            found = [f for f in found if f.parent.name == mode]
        if not found:
            raise ToolError("no report yet; render the project first")
        doc: dict[str, Any] = json.loads(found[-1].read_text(encoding="utf-8"))
        return doc

    async def providers(self) -> list[dict[str, Any]]:
        reg = Registry(self.config)
        out = []
        for n in self.config.providers:
            st = reg.status(n)
            out.append(
                {
                    "name": n,
                    "adapter": st.adapter,
                    "kind": str(st.kind),
                    "model": st.model,
                    "ready": st.ready,
                    "reason": st.reason,
                }
            )
        return out

    # -- jobs --------------------------------------------------------------------

    def _remember(self, job: Job) -> None:
        self.jobs[job.id] = job
        finished = [j for j in self.jobs.values() if j.status in ("done", "failed")]
        for old in sorted(finished, key=lambda j: j.created)[
            : max(0, len(self.jobs) - MAX_JOBS_KEPT)
        ]:
            self.jobs.pop(old.id, None)

    async def _run(self, job: Job, only: set[int] | None, force: bool) -> None:
        from stickforge.pipeline.orchestrator import render as do_render

        async with self._render_lock:
            job.status = "running"
            try:
                res = await do_render(
                    self.project_dir(job.project),
                    self.config,
                    mode=job.mode,
                    force=force,
                    only_scenes=only,
                    reporter=_JobReporter(job),
                )
            except ProjectError as e:
                job.status, job.error = "failed", "\n".join(e.problems)
            except Exception as e:  # reported to the client, redacted; trace is in the run log
                job.status, job.error = "failed", _clean(e)
            else:
                out = (res.report or {}).get("output") or {}
                job.status = "done"
                job.result = {
                    "video": str(res.output),
                    "srt": out.get("srt"),
                    "vtt": out.get("vtt"),
                    "duration_s": round(res.duration_s, 3),
                    "scenes": res.scenes,
                    "cost_usd": round(res.cost_usd, 6),
                    "cache_hits": res.cache_hits,
                    "loudness_lufs": out.get("loudness_lufs"),
                    "warnings": [str(w) for w in res.lint],
                    "report_status": (res.report or {}).get("status"),
                }
            finally:
                job.finished = time.time()


INSTRUCTIONS = f"""Stickforge renders narrated stickman explainer videos (16:9 MP4 + SRT/VTT).
Typical flow: script_to_video(name, script) -> job_status(job_id, wait_s=30) until done.
Or create_project, inspect with get_project, edit with update_scene, then render.
Draft renders are fast (720p); final is 1080p with vision QA. Rerenders reuse a cache.
Shots: {", ".join(s.value for s in Shot)}. Cameras: {", ".join(c.value for c in Camera)}."""


def build_server(service: StickforgeService) -> Any:
    """Register the service's methods as MCP tools (works with mcp 1.x and 2.x)."""
    try:
        from mcp.server.mcpserver import MCPServer as Server
        from mcp.server.mcpserver.exceptions import ToolError as SdkToolError
    except ImportError:  # mcp 1.x
        from mcp.server.fastmcp import FastMCP as Server  # type: ignore[no-redef,attr-defined,import-not-found,unused-ignore]
        from mcp.server.fastmcp.exceptions import (  # type: ignore[no-redef,attr-defined,import-not-found,unused-ignore]
            ToolError as SdkToolError,
        )

    server = Server("stickforge", instructions=INSTRUCTIONS)

    def wrap(fn: Any, description: str) -> None:
        # functools.wraps keeps the method's signature, which the SDK turns into the
        # tool's input schema; ToolError becomes a plain error message for the client.
        @functools.wraps(fn)
        async def tool(**kwargs: Any) -> Any:
            try:
                return await fn(**kwargs)
            except ToolError as e:
                raise SdkToolError(str(e)) from None

        server.tool(name=fn.__name__, description=description)(tool)

    wrap(service.list_projects, "List projects in the workspace and which modes were rendered.")
    wrap(
        service.create_project,
        "Turn a narration script into a new project (scene plan). Uses the configured LLM "
        "when ready, otherwise a rule-based planner. Does not render.",
    )
    wrap(service.get_project, "Show a project's settings, scenes and style-lint warnings.")
    wrap(
        service.update_scene,
        "Edit one scene's narration, visual, shot, camera or on_screen_text. Invalid edits "
        "are rejected and the project is left unchanged.",
    )
    wrap(
        service.render,
        "Start rendering a project (mode draft or final). Returns a job id at once; poll "
        "job_status. only_scenes regenerates just those scenes.",
    )
    wrap(
        service.script_to_video,
        "Create a project from a script and start rendering it in one step. Returns the "
        "plan summary and a job id.",
    )
    wrap(
        service.job_status,
        "Progress and result of a render job. wait_s (<= 60) waits for it to finish first.",
    )
    wrap(service.get_report, "The last report.json of a project (per-scene providers, QA, cost).")
    wrap(service.providers, "Configured providers and whether each is ready (never shows keys).")
    return server


def serve(root: Path, config: EngineConfig) -> None:
    server = build_server(StickforgeService(root, config))
    server.run("stdio")
