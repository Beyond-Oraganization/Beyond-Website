"""Loading, validating and saving ``site.config.json``.

Validation is pure: it looks only at the data, never at the disk. Checks that
need the disk (does a linked page exist?) live in ``checks.py``.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from .errors import ConfigError

SCHEMA_VERSION = 1

SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RELATIVE_PAGE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*\.html(?:#[A-Za-z0-9_-]+)?$")
SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")

BUTTON_STYLES = ("solid", "ghost")

# (min, max) item counts and maximum text lengths. One place, so the rules in
# PLAN.md section 4 and the code cannot drift apart unnoticed.
MAX_ID = 40
MAX_TILES = 24
MAX_REPOS = 50
TICKER_RANGE = (1, 12)
BUTTON_RANGE = (1, 3)
MAX_STACK = 8
LEN_SHORT = 40       # labels, kickers, stack items
LEN_TITLE = 80
LEN_LONG = 240       # lead, text, intro, description
LEN_KIDS = 120
LEN_NAME = 60
LANE_RANGE = (1, 3)      # the page lays lanes out in three columns
LANE_ITEMS = (0, 12)
MAX_STEPS = 24
LEN_STATUS = 24
LEN_WHEN = 30


# --------------------------------------------------------------------------
# small validators; each appends to ``problems`` and returns nothing
# --------------------------------------------------------------------------

def _is_text(value: Any, path: str, limit: int, problems: List[str], allow_empty: bool = False) -> None:
    if not isinstance(value, str):
        problems.append(f"{path}: must be text")
        return
    if not allow_empty and not value.strip():
        problems.append(f"{path}: must not be empty")
        return
    if len(value) > limit:
        problems.append(f"{path}: too long ({len(value)} characters, at most {limit})")
    if any(ord(ch) < 32 or ord(ch) == 127 or ch in "  " for ch in value):
        problems.append(f"{path}: must be a single line without control characters")


def url_problem(value: Any, allow_absolute: bool = True, allow_relative: bool = True) -> Optional[str]:
    """Return why ``value`` is not an acceptable link, or None if it is."""
    if not isinstance(value, str) or not value:
        return "must be a non-empty link"
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in value):
        return "must not contain spaces or control characters"
    if value.startswith("//"):
        return "protocol-relative links (//host) are not allowed"
    if SCHEME_RE.match(value):
        if not allow_absolute:
            return "must be a page of this site (name.html), not an absolute link"
        parts = urlsplit(value)
        if parts.scheme.lower() not in ("http", "https"):
            return f"scheme '{parts.scheme}' is not allowed (only http and https)"
        if not parts.netloc:
            return "absolute links need a host"
        if "@" in parts.netloc:
            return "links must not contain credentials"
        return None
    if not allow_relative:
        return "must be an absolute https:// link"
    if not RELATIVE_PAGE_RE.match(value):
        return "relative links must look like name.html or name.html#anchor"
    return None


def _is_url(value: Any, path: str, problems: List[str], allow_absolute: bool = True, allow_relative: bool = True) -> None:
    why = url_problem(value, allow_absolute, allow_relative)
    if why:
        problems.append(f"{path}: {why}")


def _is_slug(value: Any, path: str, problems: List[str]) -> None:
    if not isinstance(value, str) or not SLUG_RE.match(value) or len(value) > MAX_ID:
        problems.append(f"{path}: must be a slug (a-z, 0-9, single hyphens, at most {MAX_ID} characters)")


def _is_bool(value: Any, path: str, problems: List[str]) -> None:
    if not isinstance(value, bool):
        problems.append(f"{path}: must be true or false")


def _is_dict(value: Any, path: str, problems: List[str]) -> bool:
    if not isinstance(value, dict):
        problems.append(f"{path}: must be an object")
        return False
    return True


def _is_list(value: Any, path: str, problems: List[str], low: int, high: int) -> bool:
    if not isinstance(value, list):
        problems.append(f"{path}: must be a list")
        return False
    if not low <= len(value) <= high:
        problems.append(f"{path}: must have between {low} and {high} items (has {len(value)})")
    return True


def _require(obj: Dict[str, Any], keys: List[str], path: str, problems: List[str]) -> None:
    for key in keys:
        if key not in obj:
            problems.append(f"{path}.{key}: is missing")


def _unique_ids(items: List[Any], path: str, problems: List[str]) -> None:
    seen = set()
    for index, item in enumerate(items):
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            if item["id"] in seen:
                problems.append(f"{path}[{index}].id: '{item['id']}' is used twice")
            seen.add(item["id"])


# --------------------------------------------------------------------------
# the public validator
# --------------------------------------------------------------------------

def validate(data: Any) -> List[str]:
    """Return every problem found in ``data``; an empty list means valid."""
    problems: List[str] = []
    if not _is_dict(data, "config", problems):
        return problems

    if data.get("schema") != SCHEMA_VERSION or isinstance(data.get("schema"), bool):
        problems.append(f"schema: must be {SCHEMA_VERSION}")
    _require(data, ["site", "home", "github", "plans"], "config", problems)

    site = data.get("site")
    if site is not None and _is_dict(site, "site", problems):
        _require(site, ["name", "org_url", "repo_url"], "site", problems)
        if "name" in site:
            _is_text(site["name"], "site.name", LEN_SHORT, problems)
        if "org_url" in site:
            _is_url(site["org_url"], "site.org_url", problems, allow_relative=False)
        if "repo_url" in site:
            _is_url(site["repo_url"], "site.repo_url", problems, allow_relative=False)

    home = data.get("home")
    if home is not None and _is_dict(home, "home", problems):
        _validate_home(home, problems)

    github = data.get("github")
    if github is not None and _is_dict(github, "github", problems):
        _validate_github(github, problems)

    plans = data.get("plans")
    if plans is not None and _is_dict(plans, "plans", problems):
        _validate_plans(plans, problems)
    return problems


def _validate_home(home: Dict[str, Any], problems: List[str]) -> None:
    _require(home, ["kicker", "title", "lead", "buttons", "ticker", "map"], "home", problems)
    if "kicker" in home:
        _is_text(home["kicker"], "home.kicker", LEN_SHORT, problems)
    if "title" in home:
        _is_text(home["title"], "home.title", LEN_SHORT, problems)
    if "lead" in home:
        _is_text(home["lead"], "home.lead", LEN_LONG, problems)

    if "buttons" in home and _is_list(home["buttons"], "home.buttons", problems, *BUTTON_RANGE):
        for i, button in enumerate(home["buttons"]):
            path = f"home.buttons[{i}]"
            if not _is_dict(button, path, problems):
                continue
            _require(button, ["label", "href", "style"], path, problems)
            if "label" in button:
                _is_text(button["label"], f"{path}.label", LEN_SHORT, problems)
            if "href" in button:
                _is_url(button["href"], f"{path}.href", problems)
            if "style" in button and button["style"] not in BUTTON_STYLES:
                problems.append(f"{path}.style: must be one of {', '.join(BUTTON_STYLES)}")

    if "ticker" in home and _is_list(home["ticker"], "home.ticker", problems, *TICKER_RANGE):
        for i, item in enumerate(home["ticker"]):
            _is_text(item, f"home.ticker[{i}]", LEN_SHORT + 20, problems)

    map_ = home.get("map")
    if map_ is not None and _is_dict(map_, "home.map", problems):
        _require(map_, ["kicker", "title", "intro", "tiles"], "home.map", problems)
        if "kicker" in map_:
            _is_text(map_["kicker"], "home.map.kicker", LEN_SHORT, problems)
        if "title" in map_:
            _is_text(map_["title"], "home.map.title", LEN_TITLE, problems)
        if "intro" in map_:
            _is_text(map_["intro"], "home.map.intro", LEN_LONG, problems)
        if "tiles" in map_ and _is_list(map_["tiles"], "home.map.tiles", problems, 1, MAX_TILES):
            _validate_tiles(map_["tiles"], problems)


def _validate_tiles(tiles: List[Any], problems: List[str]) -> None:
    for i, tile in enumerate(tiles):
        path = f"home.map.tiles[{i}]"
        if not _is_dict(tile, path, problems):
            continue
        _require(tile, ["id", "label", "title", "text", "href", "visible"], path, problems)
        if "id" in tile:
            _is_slug(tile["id"], f"{path}.id", problems)
        if "label" in tile:
            _is_text(tile["label"], f"{path}.label", LEN_SHORT, problems)
        if "title" in tile:
            _is_text(tile["title"], f"{path}.title", LEN_TITLE, problems)
        if "text" in tile:
            _is_text(tile["text"], f"{path}.text", LEN_LONG, problems)
        if "kids" in tile:
            _is_text(tile["kids"], f"{path}.kids", LEN_KIDS, problems, allow_empty=True)
        if "href" in tile:
            _is_url(tile["href"], f"{path}.href", problems)
        if "visible" in tile:
            _is_bool(tile["visible"], f"{path}.visible", problems)
    _unique_ids(tiles, "home.map.tiles", problems)
    if not any(isinstance(t, dict) and t.get("visible") is True for t in tiles):
        problems.append("home.map.tiles: at least one tile must be visible")


def _validate_github(github: Dict[str, Any], problems: List[str]) -> None:
    _require(github, ["title", "lead", "repos"], "github", problems)
    if "title" in github:
        _is_text(github["title"], "github.title", LEN_TITLE, problems)
    if "lead" in github:
        _is_text(github["lead"], "github.lead", LEN_LONG, problems)
    if "repos" in github and _is_list(github["repos"], "github.repos", problems, 0, MAX_REPOS):
        for i, repo in enumerate(github["repos"]):
            path = f"github.repos[{i}]"
            if not _is_dict(repo, path, problems):
                continue
            _require(repo, ["id", "name", "url", "description", "stack", "visible"], path, problems)
            if "id" in repo:
                _is_slug(repo["id"], f"{path}.id", problems)
            if "name" in repo:
                _is_text(repo["name"], f"{path}.name", LEN_NAME, problems)
            if "url" in repo:
                _is_url(repo["url"], f"{path}.url", problems, allow_relative=False)
            if "description" in repo:
                _is_text(repo["description"], f"{path}.description", LEN_LONG, problems)
            if "stack" in repo and _is_list(repo["stack"], f"{path}.stack", problems, 0, MAX_STACK):
                for j, item in enumerate(repo["stack"]):
                    _is_text(item, f"{path}.stack[{j}]", LEN_SHORT, problems)
            if "page" in repo:
                _is_url(repo["page"], f"{path}.page", problems, allow_absolute=False)
            if "visible" in repo:
                _is_bool(repo["visible"], f"{path}.visible", problems)
        _unique_ids(github["repos"], "github.repos", problems)


def _validate_plans(plans: Dict[str, Any], problems: List[str]) -> None:
    _require(plans, ["title", "lead", "lanes", "roadmap"], "plans", problems)
    if "title" in plans:
        _is_text(plans["title"], "plans.title", LEN_TITLE, problems)
    if "lead" in plans:
        _is_text(plans["lead"], "plans.lead", LEN_LONG, problems)

    if "lanes" in plans and _is_list(plans["lanes"], "plans.lanes", problems, *LANE_RANGE):
        lanes = plans["lanes"]
        item_ids: Dict[str, str] = {}      # item ids are unique across all lanes
        for i, lane in enumerate(lanes):
            path = f"plans.lanes[{i}]"
            if not _is_dict(lane, path, problems):
                continue
            _require(lane, ["id", "label", "items"], path, problems)
            if "id" in lane:
                _is_slug(lane["id"], f"{path}.id", problems)
            if "label" in lane:
                _is_text(lane["label"], f"{path}.label", LEN_SHORT, problems)
            if "items" in lane and _is_list(lane["items"], f"{path}.items", problems, *LANE_ITEMS):
                for j, item in enumerate(lane["items"]):
                    ipath = f"{path}.items[{j}]"
                    _validate_plan_fields(item, ipath, [("title", LEN_TITLE), ("text", LEN_LONG), ("status", LEN_STATUS)], problems)
                    if isinstance(item, dict) and isinstance(item.get("id"), str):
                        if item["id"] in item_ids:
                            problems.append(f"{ipath}.id: '{item['id']}' is already used at {item_ids[item['id']]}")
                        item_ids.setdefault(item["id"], ipath)
        _unique_ids(lanes, "plans.lanes", problems)

    roadmap = plans.get("roadmap")
    if roadmap is not None and _is_dict(roadmap, "plans.roadmap", problems):
        _require(roadmap, ["kicker", "title", "intro", "steps"], "plans.roadmap", problems)
        if "kicker" in roadmap:
            _is_text(roadmap["kicker"], "plans.roadmap.kicker", LEN_SHORT, problems)
        if "title" in roadmap:
            _is_text(roadmap["title"], "plans.roadmap.title", LEN_TITLE, problems)
        if "intro" in roadmap:
            _is_text(roadmap["intro"], "plans.roadmap.intro", LEN_LONG, problems)
        if "steps" in roadmap and _is_list(roadmap["steps"], "plans.roadmap.steps", problems, 0, MAX_STEPS):
            for k, step in enumerate(roadmap["steps"]):
                _validate_plan_fields(
                    step, f"plans.roadmap.steps[{k}]",
                    [("when", LEN_WHEN), ("title", LEN_TITLE), ("text", LEN_LONG), ("status", LEN_STATUS)], problems)
            _unique_ids(roadmap["steps"], "plans.roadmap.steps", problems)


def _validate_plan_fields(item: Any, path: str, texts: List[Any], problems: List[str]) -> None:
    if not _is_dict(item, path, problems):
        return
    _require(item, ["id"] + [name for name, _ in texts] + ["visible"], path, problems)
    if "id" in item:
        _is_slug(item["id"], f"{path}.id", problems)
    for name, limit in texts:
        if name in item:
            _is_text(item[name], f"{path}.{name}", limit, problems)
    if "visible" in item:
        _is_bool(item["visible"], f"{path}.visible", problems)


def ensure_valid(data: Any) -> None:
    """Raise ConfigError listing all problems, or return quietly."""
    problems = validate(data)
    if problems:
        raise ConfigError(problems)


# --------------------------------------------------------------------------
# reading and writing
# --------------------------------------------------------------------------

def dumps(data: Dict[str, Any]) -> str:
    """The one canonical text form: same data, same bytes, always."""
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def load(path: Path) -> Dict[str, Any]:
    """Read and validate the config; every failure is a ConfigError."""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ConfigError([f"{path}: file not found"])
    except OSError as error:
        raise ConfigError([f"{path}: cannot be read ({error})"])
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise ConfigError([f"{path}: not valid JSON (line {error.lineno}, column {error.colno}: {error.msg})"])
    ensure_valid(data)
    return data


def atomic_write_text(path: Path, text: str) -> None:
    """Replace ``path`` with ``text`` so that readers see old or new, never half.

    The temporary file is created in the same directory because a rename is
    only atomic inside one filesystem.
    """
    path = Path(path)
    directory = path.parent
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(directory))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, str(path))
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def save(path: Path, data: Dict[str, Any]) -> None:
    """Validate, then write atomically. Invalid data never reaches the disk."""
    ensure_valid(data)
    atomic_write_text(path, dumps(data))
