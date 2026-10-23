from __future__ import annotations

import pytest
from conftest import BASE_PROJECT, scene

from stickforge.lint import lint_scenes
from stickforge.schema import ProjectError, Scene, load_project


def test_valid_project(make_project):
    root = make_project(BASE_PROJECT, [scene(1, characters=["Max"]), scene(2)])
    loaded = load_project(root)
    assert [s.id for s in loaded.scenes] == [1, 2]


def test_errors_name_scene_ids(make_project):
    bad = [
        scene(1),
        {"id": 7, "narration": "x", "visual": "y", "camera": "spin"},
        scene(1),
        scene(3, characters=["Nobody"]),
        {"id": 9, "visual": "v", "extra": 1},
    ]
    with pytest.raises(ProjectError) as ei:
        load_project(make_project(BASE_PROJECT, bad))
    text = str(ei.value)
    assert "scene 7 (#2): field 'camera'" in text
    assert "scene 1: duplicate scene id" in text
    assert "scene 3: unknown characters ['Nobody']" in text
    assert "scene 9 (#5): field 'narration'" in text
    assert "scene 9 (#5): field 'extra'" in text


def test_invalid_json_and_yaml(make_project):
    with pytest.raises(ProjectError, match="invalid JSON at line"):
        load_project(make_project(BASE_PROJECT, "[{"))
    with pytest.raises(ProjectError, match="invalid YAML"):
        load_project(make_project("title: [", [scene(1)]))


def test_bad_palette_and_missing_files(make_project):
    proj = {**BASE_PROJECT, "style": {"palette": ["red"]}}
    with pytest.raises(ProjectError, match="palette"):
        load_project(make_project(proj, [scene(1)]))
    proj = {**BASE_PROJECT, "music": {"file": "music/missing.mp3"}}
    with pytest.raises(ProjectError, match=r"music\.file: file not found"):
        load_project(make_project(proj, [scene(1)]))


def test_path_traversal_in_project_rejected(make_project):
    proj = {
        **BASE_PROJECT,
        "cast": [{"name": "Max", "description": "d", "reference_images": ["../../etc/passwd"]}],
    }
    with pytest.raises(ProjectError, match=r"'\.\.' is not allowed"):
        load_project(make_project(proj, [scene(1, sfx="/etc/hosts")]))


def _s(i: int, **kw) -> Scene:
    return Scene.model_validate(scene(i, **kw))


def test_lint_rules():
    long = " ".join(["word"] * 41)
    scenes = [
        _s(1, camera="pan_left", shot="wide"),
        _s(2, camera="pan_left", shot="wide"),
        _s(3, camera="static", shot="wide"),
        _s(4, camera="static", shot="wide", narration=long),
        _s(5, camera="slow_zoom_in", shot="wide"),
        _s(6, camera="slow_zoom_out", shot="medium"),
    ]
    msgs = [str(w) for w in lint_scenes(scenes)]
    assert msgs == [
        "scene 2: same camera move 'pan_left' as previous scene",
        "scene 4: narration has 41 words (> 40)",
        "scene 4: more than 3 consecutive 'wide' shots",
    ]


def test_lint_clean():
    assert lint_scenes([_s(1, camera="pan_left"), _s(2, camera="pan_right")]) == []
