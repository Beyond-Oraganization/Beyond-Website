"""The operations shared by the command line and the web interface.

Both front ends call these, so a rule (lock, validate, render before saving,
refuse before publishing) is written once and tested once.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import config as cfg
from . import publisher
from .build import CONFIG_NAME, BuildResult, build, render_all
from .checks import check_site
from .errors import ConfigError, ManagerError
from .locking import FileLock
from .publisher import Git, PublishResult

LOCK_NAME = ".bm.lock"

Config = Dict[str, Any]


def apply_edit(
    site: Path,
    edit: Callable[[Config], Config],
    rebuild: bool = True,
    on_stale: Optional[Callable[[str], None]] = None,
) -> Optional[BuildResult]:
    """lock -> load -> edit in memory -> render in memory -> save -> write pages.

    Rendering happens *before* saving, so a change that cannot be rendered is
    refused without touching any file.
    """
    site = Path(site)
    with FileLock(site / LOCK_NAME, on_stale=on_stale):
        new = edit(cfg.load(site / CONFIG_NAME))
        render_all(new)
        cfg.save(site / CONFIG_NAME, new)
        return build(site, new) if rebuild else None


def rebuild_pages(site: Path, on_stale: Optional[Callable[[str], None]] = None) -> BuildResult:
    with FileLock(Path(site) / LOCK_NAME, on_stale=on_stale):
        return build(Path(site), cfg.load(Path(site) / CONFIG_NAME))


@dataclass
class PublishOutcome:
    pages: List[str]                       # pages rebuilt (or that would be, in a dry run)
    result: PublishResult


def publish_site(
    site: Path,
    message: str,
    dry_run: bool = False,
    on_stale: Optional[Callable[[str], None]] = None,
) -> PublishOutcome:
    """Build, check the whole site, then commit and push the managed files."""
    site = Path(site)
    with FileLock(site / LOCK_NAME, on_stale=on_stale):
        config = cfg.load(site / CONFIG_NAME)
        pages = build(site, config, check=dry_run).changed
        problems = check_site(site)
        if problems:
            raise ManagerError("site checks failed, nothing was published:\n  - " + "\n  - ".join(problems))
        return PublishOutcome(pages, publisher.publish(site, message, dry_run=dry_run))


def git_summary(site: Path) -> Optional[Dict[str, Any]]:
    """What Git knows about the managed files, or None if this is not a repository."""
    git = Git(Path(site))
    if not git.ok("rev-parse", "--is-inside-work-tree"):
        return None
    branch = git.run("symbolic-ref", "--short", "-q", "HEAD", check=False).stdout.strip()
    has_origin = git.ok("remote", "get-url", "origin")
    return {"branch": branch or None, "origin": has_origin, "changed": publisher._changed_managed(git)}


def site_status(site: Path) -> Dict[str, Any]:
    """Everything the status panel shows. Never raises for a bad config: reports it."""
    site = Path(site)
    status: Dict[str, Any] = {"valid": True, "problems": [], "stale": [], "site_problems": [], "git": None}
    try:
        config = cfg.load(site / CONFIG_NAME)
    except ConfigError as error:
        status.update(valid=False, problems=list(error.problems))
        return status
    status["stale"] = build(site, config, check=True).changed
    status["site_problems"] = check_site(site)
    status["git"] = git_summary(site)
    return status
