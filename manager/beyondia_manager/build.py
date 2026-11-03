"""Writing the generated pages from the config."""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List

from .chrome import sync_handwritten, synced_names
from .config import ITEM_PAGE_RE, atomic_write_text
from .extras import (
    FEED, NOT_FOUND_PAGE, ROBOTS, SEARCH_INDEX, SEARCH_PAGE, SITEMAP, build_search_index, render_not_found,
    render_search, render_site_files,
)
from .render import (
    GENERATED_MARK, render_blog, render_github, render_home, render_plans, render_post_pages, render_stories,
    render_story_pages,
)

CONFIG_NAME = "site.config.json"
GENERATED_FILES = ("index.html", "github.html", "plans.html", "stories.html", "blog.html", NOT_FOUND_PAGE, SEARCH_PAGE)
# Files built from the pages themselves (or from the site address). The sitemap and the feed exist only
# while the config has a site address; the others always.
SITE_FILES = (ROBOTS, SITEMAP, FEED, SEARCH_INDEX)
# The files the manager always owns. Story and post pages, and the hand-written pages whose header and
# footer it keeps in step, come on top of these: see service.managed_files(), because which of them
# exist depends on the config and on the folder.
MANAGED_FILES = (CONFIG_NAME,) + GENERATED_FILES + SITE_FILES
# Generated files that may be deleted when nothing wants them any more (the site address was removed).
OPTIONAL_FILES = (SITEMAP, FEED)


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
    """Every generated page, from the config alone (no disk): enough to know a change can be rendered."""
    pages = {
        "index.html": render_home(config),
        "github.html": render_github(config),
        "plans.html": render_plans(config),
        "stories.html": render_stories(config),
        "blog.html": render_blog(config),
        NOT_FOUND_PAGE: render_not_found(config),
        SEARCH_PAGE: render_search(config),
    }
    pages.update(render_story_pages(config))
    pages.update(render_post_pages(config))
    return pages


# Files every page loads by a fixed name. Each link gets ?v=<hash of the file>, so a browser that cached an
# older version fetches the new one as soon as a page that needs it arrives: a new page is never shown with
# an old stylesheet (which looks badly broken: wrong fonts, unstyled buttons, huge icons).
VERSIONED_ASSETS = (("href", "beyondia.css"), ("src", "beyondia.js"), ("src", SEARCH_INDEX))


def asset_version(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()[:10]


def stamp_assets(text: str, versions: Dict[str, str]) -> str:
    """Add ?v=<version> to every link to a versioned asset (links that already carry one are re-stamped)."""
    for attr, name in VERSIONED_ASSETS:
        if name in versions:
            text = re.sub(rf'{attr}="{re.escape(name)}(?:\?v=[0-9a-f]+)?"', f'{attr}="{name}?v={versions[name]}"', text)
    return text


def render_site(site_dir: Path, config: Dict[str, Any]) -> Dict[str, str]:
    """Everything the build writes: the generated pages, the hand-written pages with a fresh head, header
    and footer, and the files made from all of those (search index, sitemap, feed, robots.txt)."""
    pages = render_all(config)
    pages.update(sync_handwritten(site_dir, config, skip=pages))
    files = {SEARCH_INDEX: build_search_index(pages)}
    files.update(render_site_files(config, sorted(pages)))
    versions = {SEARCH_INDEX: asset_version(files[SEARCH_INDEX].encode("utf-8"))}
    for _attr, name in VERSIONED_ASSETS:
        path = Path(site_dir) / name
        if name not in versions and path.is_file():
            versions[name] = asset_version(path.read_bytes())
    pages = {name: stamp_assets(text, versions) for name, text in pages.items()}
    return {**pages, **files}


def generated_page_names(config: Dict[str, Any]) -> List[str]:
    """Names of the generated pages (cheap: no rendering)."""
    return (list(GENERATED_FILES) + [s["file"] for s in config["stories"]["items"] if s.get("visible")]
            + [p["file"] for p in config["blog"]["items"] if p.get("visible")])


def synced_page_names(site_dir: Path, config: Dict[str, Any]) -> List[str]:
    """Hand-written pages whose head, header and footer the build keeps in step."""
    return synced_names(site_dir, config, {name: "" for name in generated_page_names(config)})


def find_orphans(site_dir: Path, wanted: Dict[str, str]) -> List[str]:
    """Generated story and post pages that no visible story or post owns any more.

    A file counts only if its name has the shape of a story page (story*.html)
    or a post page (blog-*.html), it carries the generated-page comment and
    nothing wants it. A page written by hand (no comment) is never reported, so
    it can never be deleted, and neither can any other page of the site.
    """
    orphans = []
    candidates = [p for p in sorted(Path(site_dir).glob("*.html")) if ITEM_PAGE_RE.match(p.name)]
    candidates += [Path(site_dir) / name for name in OPTIONAL_FILES]
    for path in candidates:
        if path.name in wanted or not path.is_file():
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
    pages = render_site(site_dir, config)
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
