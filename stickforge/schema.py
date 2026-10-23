"""Input contract: project.yaml + scenes.json, validated strictly."""

from __future__ import annotations

import json
import re
from enum import StrEnum
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from stickforge.core.security import PathEscapeError, safe_project_path


class Shot(StrEnum):
    WIDE = "wide"
    MEDIUM = "medium"
    CLOSE_UP = "close-up"
    SPLIT_SCREEN = "split-screen"
    DIAGRAM = "diagram"
    MAP = "map"
    CHART = "chart"


class Camera(StrEnum):
    STATIC = "static"
    SLOW_ZOOM_IN = "slow_zoom_in"
    SLOW_ZOOM_OUT = "slow_zoom_out"
    PAN_LEFT = "pan_left"
    PAN_RIGHT = "pan_right"


class Transition(StrEnum):
    CUT = "cut"
    CROSSFADE = "crossfade"


_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class Scene(_Strict):
    id: int = Field(ge=1)
    narration: str = Field(min_length=1, max_length=5000)
    visual: str = Field(min_length=1, max_length=4000)
    characters: list[str] = Field(default_factory=list)
    shot: Shot = Shot.MEDIUM
    camera: Camera = Camera.STATIC
    on_screen_text: str = Field(default="", max_length=200)
    sfx: str = ""  # relative path inside the project, or empty

    @property
    def word_count(self) -> int:
        return len(self.narration.split())


class Style(_Strict):
    palette: list[str] = Field(min_length=1, max_length=12)
    line_style: str = "thick clean black outlines, flat colors"
    background: str = "plain off-white background"
    prompt_prefix: str = ""

    @field_validator("palette")
    @classmethod
    def _hex_colors(cls, v: list[str]) -> list[str]:
        bad = [c for c in v if not _HEX.match(c)]
        if bad:
            raise ValueError(f"palette colors must be #RRGGBB, got {bad}")
        return v


class CastMember(_Strict):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(min_length=1, max_length=1000)
    reference_images: list[str] = Field(default_factory=list)


class Voice(_Strict):
    id: str = "default"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


class Music(_Strict):
    file: str
    volume_db: float = Field(default=-18.0, ge=-60.0, le=0.0)


class Output(_Strict):
    filename: str = Field(default="final.mp4", pattern=r"^[A-Za-z0-9._-]{1,100}\.mp4$")
    transition: Transition = Transition.CUT
    crossfade_s: float = Field(default=0.3, ge=0.0, le=2.0)
    scene_padding_s: float = Field(default=0.35, ge=0.0, le=5.0)
    burn_in_captions: bool = False


class Project(_Strict):
    title: str = Field(min_length=1, max_length=200)
    style: Style
    cast: list[CastMember] = Field(default_factory=list)
    voice: Voice = Voice()
    music: Music | None = None
    output: Output = Output()

    @model_validator(mode="after")
    def _unique_cast(self) -> Project:
        names = [c.name for c in self.cast]
        dupes = sorted({n for n in names if names.count(n) > 1})
        if dupes:
            raise ValueError(f"duplicate cast names: {dupes}")
        return self

    def cast_by_name(self) -> dict[str, CastMember]:
        return {c.name: c for c in self.cast}


class ProjectError(Exception):
    """Human-readable, possibly multi-line validation failure."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("\n".join(problems))


class LoadedProject(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    root: Path
    project: Project
    scenes: list[Scene]

    def resolve(self, rel: str) -> Path:
        return safe_project_path(self.root, rel)


def _fmt_loc(loc: tuple[int | str, ...]) -> str:
    return ".".join(str(p) for p in loc) or "(root)"


def _scene_errors(raw: Any) -> tuple[list[Scene], list[str]]:
    if not isinstance(raw, list):
        return [], ["scenes.json: top level must be a JSON array of scenes"]
    scenes: list[Scene] = []
    problems: list[str] = []
    for idx, item in enumerate(raw):
        sid = item.get("id", "?") if isinstance(item, dict) else "?"
        label = f"scene {sid} (#{idx + 1})"
        try:
            scenes.append(Scene.model_validate(item))
        except ValidationError as e:
            for err in e.errors():
                problems.append(f"{label}: field '{_fmt_loc(err['loc'])}': {err['msg']}")
    ids = [s.id for s in scenes]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"scene {dup}: duplicate scene id")
    if not raw:
        problems.append("scenes.json: no scenes")
    return scenes, problems


def load_project(root: Path) -> LoadedProject:
    """Load and validate a project folder. Raises ProjectError listing every problem."""
    root = root.resolve()
    problems: list[str] = []
    pfile, sfile = root / "project.yaml", root / "scenes.json"
    for f in (pfile, sfile):
        if not f.is_file():
            problems.append(f"missing {f.name} in {root}")
    if problems:
        raise ProjectError(problems)

    try:
        raw_project = yaml.safe_load(pfile.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise ProjectError([f"project.yaml: invalid YAML: {e}"]) from None
    try:
        raw_scenes = json.loads(sfile.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ProjectError([f"scenes.json: invalid JSON at line {e.lineno}: {e.msg}"]) from None

    project: Project | None = None
    try:
        project = Project.model_validate(raw_project)
    except ValidationError as e:
        for err in e.errors():
            problems.append(f"project.yaml: field '{_fmt_loc(err['loc'])}': {err['msg']}")

    scenes, scene_problems = _scene_errors(raw_scenes)
    problems.extend(scene_problems)

    if project is not None:
        cast = project.cast_by_name()
        for s in scenes:
            unknown = [c for c in s.characters if c not in cast]
            if unknown:
                problems.append(f"scene {s.id}: unknown characters {unknown} (not in cast)")
        problems.extend(_check_paths(root, project, scenes))

    if problems or project is None:
        raise ProjectError(problems)
    return LoadedProject(root=root, project=project, scenes=scenes)


def _check_paths(root: Path, project: Project, scenes: list[Scene]) -> list[str]:
    refs: list[tuple[str, str]] = []
    for c in project.cast:
        refs += [(f"project.yaml: cast '{c.name}' reference_images", r) for r in c.reference_images]
    if project.music:
        refs.append(("project.yaml: music.file", project.music.file))
    refs += [(f"scene {s.id}: sfx", s.sfx) for s in scenes if s.sfx]
    problems = []
    for label, rel in refs:
        try:
            p = safe_project_path(root, rel)
        except PathEscapeError as e:
            problems.append(f"{label}: {e}")
            continue
        if not p.is_file():
            problems.append(f"{label}: file not found: {rel}")
    return problems
