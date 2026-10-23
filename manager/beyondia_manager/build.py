"""Writing the generated pages from the config."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

from .config import ITEM_PAGE_RE, atomic_write_text
from .render import (
    GENERATED_MARK, render_blog, render_github, render_home, render_plans, render_post_pages, render_stories,
    render_story_pages,
)

CONFIG_NAME = "site.config.json"
GENERATED_FILES = ("index.html", "github.html", "plans.html", "stories.html", "blog.html")
# The files the manager always owns. Story and post pages come on top of these: see
# service.managed_files(), because which of them exist depends on the config.
MANAGED_FILES = (CONFIG_NAME,) + GENERATED_FILES


@dataclass
class BuildResult:
    changed: List[str] = field(default_factory=list)    # written, or stale in check mode
    unchanged: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)    # generated story/post pages that no longer belong

    @property
    def stale(self) -> List[str]:
        """Everything a build would still have to do: pages to write and pages to delete."""
        return self.changed + [f"{name} (to delete)" for name in self.removed]


def render_all(config: Dict[str, Any]) -> Dict[str, str]:
    pages = {
        "index.html": render_home(config),
        "github.html": render_github(config),
        "plans.html": render_plans(config),
        "stories.html": render_stories(config),
        "blog.html": render_blog(config),
    }
    pages.update(render_story_pages(config))
    pages.update(render_post_pages(config))
    return pages


def find_orphans(site_dir: Path, wanted: Dict[str, str]) -> List[str]:
    """Generated story and post pages that no visible story or post owns any more.

    A file counts only if its name has the shape of a story page (story*.html)
    or a post page (blog-*.html), it carries the generated-page comment and
    nothing wants it. A page written by hand (no comment) is never reported, so
    it can never be deleted, and neither can any other page of the site.
    """
    orphans = []
    for path in sorted(Path(site_dir).glob("*.html")):
        if path.name in wanted or not ITEM_PAGE_RE.match(path.name) or not path.is_file():
            continue
        try:
            head = path.read_text(encoding="utf-8")[:2000]
        except (OSError, UnicodeDecodeError):
            continue
        if GENERATED_MARK in head:
            orphans.append(path.name)
    return orphans


def build(site_dir: Path, config: Dict[str, Any], check: bool = False) -> BuildResult:
    """Render every generated page; write only the ones whose bytes differ.

    With ``check=True`` nothing is written or deleted: ``changed`` and
    ``removed`` then list what is out of date with the config.
    """
    site_dir = Path(site_dir)
    result = BuildResult()
    pages = render_all(config)
    for name, content in pages.items():
        target = site_dir / name
        if target.exists() and target.read_bytes() == content.encode("utf-8"):
            result.unchanged.append(name)
            continue
        result.changed.append(name)
        if not check:
            atomic_write_text(target, content)
    result.removed = find_orphans(site_dir, pages)
    if not check:
        for name in result.removed:
            os.unlink(str(site_dir / name))
    return result
