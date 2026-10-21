"""Writing the generated pages from the config."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

from .config import atomic_write_text
from .render import render_github, render_home, render_plans

CONFIG_NAME = "site.config.json"
GENERATED_FILES = ("index.html", "github.html", "plans.html")
# The only files the manager ever stages or commits (PLAN.md section 7).
MANAGED_FILES = (CONFIG_NAME,) + GENERATED_FILES


@dataclass
class BuildResult:
    changed: List[str] = field(default_factory=list)    # written, or stale in check mode
    unchanged: List[str] = field(default_factory=list)


def render_all(config: Dict[str, Any]) -> Dict[str, str]:
    return {"index.html": render_home(config), "github.html": render_github(config), "plans.html": render_plans(config)}


def build(site_dir: Path, config: Dict[str, Any], check: bool = False) -> BuildResult:
    """Render every generated page; write only the ones whose bytes differ.

    With ``check=True`` nothing is written: ``changed`` then lists the pages
    that are out of date with the config.
    """
    result = BuildResult()
    for name, content in render_all(config).items():
        target = Path(site_dir) / name
        wanted = content.encode("utf-8")
        if target.exists() and target.read_bytes() == wanted:
            result.unchanged.append(name)
            continue
        result.changed.append(name)
        if not check:
            atomic_write_text(target, content)
    return result
