"""Shared test fixtures. Nothing here touches the network or the real site folder."""

from __future__ import annotations

import copy
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List

SITE_DIR = Path(__file__).resolve().parents[2]          # the real site folder
SAMPLE: Dict[str, Any] = {
    "schema": 1,
    "site": {
        "name": "Testland",
        "org_url": "https://github.com/test-org",
        "repo_url": "https://github.com/test-org/test-site",
    },
    "home": {
        "kicker": "A test country",
        "title": "Testland",
        "lead": "A lead sentence.",
        "buttons": [{"label": "Go", "href": "ideology.html", "style": "solid"}],
        "ticker": ["One", "Two"],
        "map": {
            "kicker": "The map",
            "title": "{count} doors.",
            "intro": "Intro text.",
            "tiles": [
                {"id": "alpha", "label": "Alpha", "title": "Alpha title", "text": "Alpha text.", "kids": "Rooms: a",
                 "href": "stories.html", "visible": True},
                {"id": "beta", "label": "Beta", "title": "Beta title", "text": "Beta text.",
                 "href": "plans.html", "visible": True},
            ],
        },
    },
    "github": {
        "title": "Code.",
        "lead": "Lead.",
        "repos": [
            {"id": "one", "name": "One", "url": "https://github.com/test-org/one", "description": "First repo.",
             "stack": ["Python"], "page": "techsales.html", "visible": True},
        ],
    },
    "stories": {
        "title": "Stories title.",
        "lead": "Stories lead.",
        "items": [
            {"id": "angel", "file": "storyangel.html", "title": "The Angel", "kind": "story", "tag": "#Tag",
             "summary": "An angel summary.", "aside": "An aside.", "visible": True,
             "body": [{"type": "note", "text": "A muted opening."}, {"type": "p", "text": "First paragraph."},
                      {"type": "heading", "text": "A heading"}, {"type": "p", "text": "Second paragraph."}]},
            {"id": "roman", "file": "storyroman.html", "title": "The Book", "kind": "verses", "tag": "Verses",
             "summary": "A verses summary.", "aside": "Verses aside.", "visible": True,
             "body": [{"type": "chapter", "text": "Chapter 1"},
                      {"type": "verse", "ref": "1:1", "paras": ["Verse one."]},
                      {"type": "verse", "ref": "1:2", "paras": ["Verse two a.", "Verse two b."]}]},
        ],
    },
    "blog": {
        "title": "Blog title.",
        "lead": "Blog lead.",
        "items": [
            {"id": "hello", "file": "blog-hello.html", "title": "Hello", "date": "2026-10-01", "tags": ["News", "Ideas"],
             "summary": "A hello summary.", "visible": True,
             "body": [{"type": "p", "text": "First post paragraph with a [link](https://example.com/page)."},
                      {"type": "heading", "text": "A heading"}, {"type": "p", "text": "More text."}]},
            {"id": "second", "file": "blog-second.html", "title": "Second", "date": "2026-10-20", "tags": [],
             "summary": "A second summary.", "visible": True,
             "body": [{"type": "note", "text": "A muted note."}, {"type": "p", "text": "Second post."}]},
        ],
    },
    "plans": {
        "title": "Plans title.",
        "lead": "Plans lead.",
        "lanes": [
            {"id": "writing", "label": "Writing", "items": [
                {"id": "book", "title": "The book", "text": "Book text.", "status": "In progress", "visible": True},
                {"id": "essay", "title": "The essay", "text": "Essay text.", "status": "Planned", "visible": True},
            ]},
            {"id": "building", "label": "Building", "items": [
                {"id": "site", "title": "The site", "text": "Site text.", "status": "Live", "visible": True},
            ]},
        ],
        "roadmap": {
            "kicker": "The road", "title": "Next, in order.", "intro": "Intro to the road.",
            "steps": [
                {"id": "first", "when": "Tomorrow", "title": "First step", "text": "First text.", "status": "Next", "visible": True},
                {"id": "second", "when": "Later", "title": "Second step", "text": "Second text.", "status": "Planned", "visible": True},
            ],
        },
    },
}


def sample() -> Dict[str, Any]:
    return copy.deepcopy(SAMPLE)


def tile(**overrides: Any) -> Dict[str, Any]:
    base = {"id": "gamma", "label": "Gamma", "title": "Gamma title", "text": "Gamma text.",
            "href": "plans.html", "visible": True}
    base.update(overrides)
    return base


class TempDirCase(unittest.TestCase):
    """Gives each test its own empty folder, removed afterwards."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name).resolve()


def copy_real_site(destination: Path) -> Path:
    """A private copy of the real pages, so tests can break things safely."""
    destination.mkdir(parents=True, exist_ok=True)
    for item in SITE_DIR.iterdir():
        if item.is_file() and item.suffix in (".html", ".css", ".jpg", ".json"):
            shutil.copy2(item, destination / item.name)
    return destination


FIXTURE_CONFIG = Path(__file__).resolve().parent / "fixtures" / "site.config.json"


def copy_fixture_site(destination: Path) -> Path:
    """The real pages, but with a frozen config, rebuilt from it.

    Functional tests (CLI, web, publish) use this so that editing the live
    site content never breaks them. Only the tests in test_site.py look at the
    live config, because their job is to check the live site.
    """
    from beyondia_manager import config as cfg
    from beyondia_manager.build import build
    copy_real_site(destination)
    shutil.copy2(FIXTURE_CONFIG, destination / "site.config.json")
    build(destination, cfg.load(destination / "site.config.json"))
    return destination


GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.invalid",
    "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
}


def git(cwd: Path, *args: str) -> str:
    env = dict(os.environ, **GIT_ENV)
    done = subprocess.run(["git", *args], cwd=str(cwd), env=env, capture_output=True, text=True)
    if done.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed in {cwd}: {done.stderr}")
    return done.stdout.strip()


class GitCase(TempDirCase):
    """A working copy wired to a local bare 'GitHub', plus a second clone to play a colleague."""

    def setUp(self) -> None:
        super().setUp()
        os.environ.update(GIT_ENV)
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in GIT_ENV])
        self.remote = self.tmp / "remote.git"
        self.work = self.tmp / "work"
        self.work.mkdir()
        git(self.tmp, "init", "--bare", "-b", "main", str(self.remote))
        git(self.work, "init", "-b", "main")
        git(self.work, "remote", "add", "origin", str(self.remote))

    def commit_all(self, repo: Path, message: str = "commit") -> None:
        git(repo, "add", "-A")
        git(repo, "commit", "-m", message)

    def clone_remote(self, name: str = "colleague") -> Path:
        path = self.tmp / name
        git(self.tmp, "clone", str(self.remote), str(path))
        return path

    def remote_files(self) -> List[str]:
        return git(self.remote, "ls-tree", "-r", "--name-only", "main").splitlines()

    def remote_log(self) -> List[str]:
        return git(self.remote, "log", "--format=%s", "main").splitlines()
