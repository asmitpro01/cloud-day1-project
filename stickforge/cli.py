"""stickforge command line."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import platform
import shutil
import sys
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TaskID, TextColumn
from rich.table import Table

from stickforge.config import EngineConfig, load_config
from stickforge.lint import lint_scenes
from stickforge.providers.registry import Registry, RegistryError
from stickforge.schema import ProjectError, load_project

app = typer.Typer(add_completion=False, no_args_is_help=True, help=__doc__)
console = Console()

ConfigOpt = Annotated[
    Path | None, typer.Option("--config", "-c", help="Engine config.yaml (merged over defaults)")
]
ProjectArg = Annotated[Path, typer.Argument(help="Project folder", exists=True, file_okay=False)]


def _config(path: Path | None) -> EngineConfig:
    try:
        return load_config(path)
    except Exception as e:  # pydantic/yaml errors carry no secrets (values come from env)
        console.print(f"[red]config error:[/red] {e}")
        raise typer.Exit(2) from None


@app.command()
def doctor(config: ConfigOpt = None) -> None:
    """Check the environment and provider keys (never prints secret values)."""
    from stickforge.pipeline.orchestrator import make_ffmpeg

    cfg = _config(config)
    t = Table(title="stickforge doctor", show_header=True)
    t.add_column("check")
    t.add_column("status")
    ok = True

    def row(name: str, good: bool, detail: str) -> None:
        nonlocal ok
        ok &= good
        t.add_row(name, f"[green]ok[/green]  {detail}" if good else f"[red]FAIL[/red] {detail}")

    py_ok = sys.version_info >= (3, 11)
    row("python", py_ok, platform.python_version())
    row("os", True, f"{platform.system()} {platform.release()} ({platform.machine()})")
    ff = make_ffmpeg(cfg)
    if ff.available():
        encs = asyncio.run(ff.encoders())
        row("ffmpeg", True, ff.ffmpeg)
        row("h264 encoders", "libx264" in encs or bool(encs), ", ".join(encs) or "none")
    else:
        row("ffmpeg", False, "ffmpeg/ffprobe not found on PATH — see README 'Install FFmpeg'")
    free = shutil.disk_usage(Path.cwd()).free / 1e9
    row("disk free", free > 5, f"{free:.1f} GB")
    for mod in ("kokoro_onnx", "whisperx", "litellm"):
        found = importlib.util.find_spec(mod) is not None
        t.add_row(
            f"optional: {mod}", "[green]installed[/green]" if found else "[dim]not installed[/dim]"
        )
    reg = Registry(cfg)
    for name in cfg.providers:
        st = reg.status(name)
        t.add_row(
            f"provider: {name}",
            "[green]ready[/green]" if st.ready else f"[yellow]{st.reason}[/yellow]",
        )
    console.print(t)
    if not ok:
        raise typer.Exit(1)


@app.command()
def providers(config: ConfigOpt = None) -> None:
    """List adapters, capabilities and configured status."""
    cfg = _config(config)
    reg = Registry(cfg)
    t = Table(title="adapters")
    for col in ("adapter", "kind", "capabilities", "needs key", "cost model", "license"):
        t.add_column(col)
    for name, cls in sorted(reg.adapters.items()):
        t.add_row(
            name,
            cls.kind.value,
            ", ".join(sorted(cls.capabilities)) or "-",
            "yes" if cls.requires_key else "no",
            cls.cost_model,
            cls.license_note,
        )
    console.print(t)
    t2 = Table(title="configured providers")
    for col in ("name", "adapter", "model", "status"):
        t2.add_column(col)
    for name in cfg.providers:
        st = reg.status(name)
        t2.add_row(
            name,
            st.adapter,
            st.model or "-",
            "[green]ready[/green]" if st.ready else f"[yellow]{st.reason}[/yellow]",
        )
    console.print(t2)
    for mname, m in cfg.modes.items():
        console.print(
            f"[bold]{mname}[/bold]: {m.width}x{m.height}@{m.fps} "
            f"tts={m.chains.tts} image={m.chains.image}"
        )


@app.command()
def validate(project: ProjectArg) -> None:
    """Validate project.yaml + scenes.json and lint the scene plan."""
    try:
        loaded = load_project(project)
    except ProjectError as e:
        console.print(f"[red]{len(e.problems)} problem(s):[/red]")
        for p in e.problems:
            console.print(f"  • {p}", markup=False)
        raise typer.Exit(1) from None
    warnings = lint_scenes(loaded.scenes)
    for w in warnings:
        console.print(f"[yellow]warning[/yellow] {w}", highlight=False)
    words = sum(s.word_count for s in loaded.scenes)
    console.print(
        f"[green]valid[/green]: {len(loaded.scenes)} scenes, {words} words "
        f"(~{words / 150:.1f} min at 150 wpm), {len(warnings)} warning(s)"
    )


class _RichReporter:
    def __init__(self, progress: Progress) -> None:
        self.p = progress
        self.tasks: dict[str, TaskID] = {}
        self.cached: dict[str, int] = {}

    def stage(self, name: str, total: int) -> None:
        self.tasks[name] = self.p.add_task(name, total=total)
        self.cached[name] = 0

    def advance(self, name: str, *, cached: bool = False) -> None:
        self.cached[name] += int(cached)
        self.p.update(
            self.tasks[name],
            advance=1,
            description=f"{name} [dim]({self.cached[name]} cached)[/dim]",
        )

    def note(self, message: str) -> None:
        self.p.console.print(message)


@app.command()
def render(
    project: ProjectArg,
    draft: Annotated[bool, typer.Option("--draft", help="Cheap/fast models, 720p, no QA")] = False,
    final: Annotated[bool, typer.Option("--final", help="Best models, 1080p, QA on")] = False,
    force: Annotated[bool, typer.Option("--force", help="Ignore cache, regenerate all")] = False,
    config: ConfigOpt = None,
) -> None:
    """Render a project to a finished MP4."""
    from stickforge.pipeline.orchestrator import render as do_render

    if draft == final:
        console.print("[red]choose exactly one of --draft / --final[/red]")
        raise typer.Exit(2)
    cfg = _config(config)
    mode = "draft" if draft else "final"
    with Progress(
        TextColumn("{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        console=console,
        transient=False,
    ) as progress:
        try:
            res = asyncio.run(
                do_render(project, cfg, mode=mode, force=force, reporter=_RichReporter(progress))
            )
        except ProjectError as e:
            for p in e.problems:
                console.print(f"  • {p}", markup=False)
            raise typer.Exit(1) from None
        except (RegistryError, RuntimeError) as e:
            console.print(f"[red]render failed:[/red] {e}", markup=False)
            raise typer.Exit(1) from None
    for w in res.lint:
        console.print(f"[yellow]warning[/yellow] {w}", highlight=False)
    console.print(
        f"[green]done[/green] {res.output}  ({res.duration_s:.1f}s video, "
        f"{res.scenes} scenes, {res.wall_s:.1f}s wall, cache hits {res.cache_hits})"
    )


@app.command()
def report(project: ProjectArg, config: ConfigOpt = None) -> None:
    """Pretty-print the last report.json (written from M4 on)."""
    cfg = _config(config)
    found = sorted((project / cfg.output_dir).glob("*/report.json"))
    if not found:
        console.print("no report.json yet (reports arrive in M4)")
        raise typer.Exit(1)
    for f in found:
        console.print_json(json.dumps(json.loads(f.read_text(encoding="utf-8"))))


if __name__ == "__main__":
    app()
