"""Edits to the config, as pure functions.

Every function takes a config and returns a *new* config; the argument is
never changed. Every result is validated before it is returned, so no command
can produce a config that ``config.validate`` would refuse.

Positions are 1-based everywhere, as people count: position 1 is the first.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Optional

from .config import ConfigError, ensure_valid
from .errors import EditError

Config = Dict[str, Any]

HOME_FIELDS = {
    "kicker": ("home", "kicker"),
    "title": ("home", "title"),
    "lead": ("home", "lead"),
    "map_kicker": ("home", "map", "kicker"),
    "map_title": ("home", "map", "title"),
    "map_intro": ("home", "map", "intro"),
}
GITHUB_FIELDS = {"title": ("github", "title"), "lead": ("github", "lead")}
TILE_FIELDS = ("label", "title", "text", "kids", "href")
REPO_FIELDS = ("name", "url", "description", "stack", "page")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _finish(config: Config) -> Config:
    try:
        ensure_valid(config)
    except ConfigError as error:
        raise EditError("the change would make the config invalid:\n  - " + "\n  - ".join(error.problems))
    return config


def _tiles(config: Config) -> List[Dict[str, Any]]:
    return config["home"]["map"]["tiles"]


def _repos(config: Config) -> List[Dict[str, Any]]:
    return config["github"]["repos"]


def _index_of(items: List[Dict[str, Any]], item_id: str, what: str) -> int:
    for index, item in enumerate(items):
        if item.get("id") == item_id:
            return index
    known = ", ".join(item.get("id", "?") for item in items) or "none"
    raise EditError(f"there is no {what} with id '{item_id}' (known ids: {known})")


def _ensure_new_id(items: List[Dict[str, Any]], item_id: str, what: str) -> None:
    if any(item.get("id") == item_id for item in items):
        raise EditError(f"a {what} with id '{item_id}' already exists")


def _insert(items: List[Any], item: Any, position: Optional[int]) -> None:
    if position is None:
        items.append(item)
        return
    if not 1 <= position <= len(items) + 1:
        raise EditError(f"position must be between 1 and {len(items) + 1} (got {position})")
    items.insert(position - 1, item)


def _check_position(items: List[Any], position: int, what: str) -> int:
    if not 1 <= position <= len(items):
        raise EditError(f"there is no {what} at position {position} (there are {len(items)})")
    return position - 1


def _only_known(fields: Dict[str, Any], allowed: Iterable[str], what: str) -> None:
    unknown = sorted(set(fields) - set(allowed))
    if unknown:
        raise EditError(f"cannot change {what} field(s): {', '.join(unknown)}")
    if not fields:
        raise EditError(f"nothing to change: give at least one {what} field")


# --------------------------------------------------------------------------
# home page settings
# --------------------------------------------------------------------------

def set_home(config: Config, **fields: str) -> Config:
    _only_known(fields, HOME_FIELDS, "home page")
    new = copy.deepcopy(config)
    for name, value in fields.items():
        target = new
        *parents, last = HOME_FIELDS[name]
        for key in parents:
            target = target[key]
        target[last] = value
    return _finish(new)


def add_ticker(config: Config, text: str, position: Optional[int] = None) -> Config:
    new = copy.deepcopy(config)
    _insert(new["home"]["ticker"], text, position)
    return _finish(new)


def remove_ticker(config: Config, position: int) -> Config:
    new = copy.deepcopy(config)
    items = new["home"]["ticker"]
    del items[_check_position(items, position, "ticker item")]
    return _finish(new)


def add_button(config: Config, label: str, href: str, style: str = "ghost", position: Optional[int] = None) -> Config:
    new = copy.deepcopy(config)
    _insert(new["home"]["buttons"], {"label": label, "href": href, "style": style}, position)
    return _finish(new)


def remove_button(config: Config, position: int) -> Config:
    new = copy.deepcopy(config)
    items = new["home"]["buttons"]
    del items[_check_position(items, position, "button")]
    return _finish(new)


# --------------------------------------------------------------------------
# map tiles
# --------------------------------------------------------------------------

def add_tile(
    config: Config,
    *,
    id: str,
    label: str,
    title: str,
    text: str,
    href: str,
    kids: str = "",
    visible: bool = True,
    position: Optional[int] = None,
) -> Config:
    new = copy.deepcopy(config)
    _ensure_new_id(_tiles(new), id, "tile")
    tile = {"id": id, "label": label, "title": title, "text": text, "kids": kids, "href": href, "visible": visible}
    _insert(_tiles(new), tile, position)
    return _finish(new)


def remove_tile(config: Config, tile_id: str) -> Config:
    new = copy.deepcopy(config)
    tiles = _tiles(new)
    del tiles[_index_of(tiles, tile_id, "tile")]
    return _finish(new)


def move_tile(config: Config, tile_id: str, position: int) -> Config:
    new = copy.deepcopy(config)
    tiles = _tiles(new)
    index = _index_of(tiles, tile_id, "tile")
    target = _check_position(tiles, position, "tile slot")
    tiles.insert(target, tiles.pop(index))
    return _finish(new)


def update_tile(config: Config, tile_id: str, **fields: str) -> Config:
    _only_known(fields, TILE_FIELDS, "tile")
    new = copy.deepcopy(config)
    tiles = _tiles(new)
    tiles[_index_of(tiles, tile_id, "tile")].update(fields)
    return _finish(new)


def set_tile_visible(config: Config, tile_id: str, visible: bool) -> Config:
    new = copy.deepcopy(config)
    tiles = _tiles(new)
    tiles[_index_of(tiles, tile_id, "tile")]["visible"] = visible
    return _finish(new)


# --------------------------------------------------------------------------
# GitHub page
# --------------------------------------------------------------------------

def set_github(config: Config, **fields: str) -> Config:
    _only_known(fields, GITHUB_FIELDS, "GitHub page")
    new = copy.deepcopy(config)
    for name, value in fields.items():
        new["github"][GITHUB_FIELDS[name][1]] = value
    return _finish(new)


def add_repo(
    config: Config,
    *,
    id: str,
    name: str,
    url: str,
    description: str,
    stack: Iterable[str] = (),
    page: Optional[str] = None,
    visible: bool = True,
    position: Optional[int] = None,
) -> Config:
    new = copy.deepcopy(config)
    _ensure_new_id(_repos(new), id, "repository")
    repo: Dict[str, Any] = {"id": id, "name": name, "url": url, "description": description, "stack": list(stack), "visible": visible}
    if page:
        repo["page"] = page
    _insert(_repos(new), repo, position)
    return _finish(new)


def remove_repo(config: Config, repo_id: str) -> Config:
    new = copy.deepcopy(config)
    repos = _repos(new)
    del repos[_index_of(repos, repo_id, "repository")]
    return _finish(new)


def move_repo(config: Config, repo_id: str, position: int) -> Config:
    new = copy.deepcopy(config)
    repos = _repos(new)
    index = _index_of(repos, repo_id, "repository")
    target = _check_position(repos, position, "repository slot")
    repos.insert(target, repos.pop(index))
    return _finish(new)


def update_repo(config: Config, repo_id: str, **fields: Any) -> Config:
    _only_known(fields, REPO_FIELDS, "repository")
    new = copy.deepcopy(config)
    repos = _repos(new)
    repo = repos[_index_of(repos, repo_id, "repository")]
    for name, value in fields.items():
        if name == "page" and not value:
            repo.pop("page", None)
        elif name == "stack":
            repo["stack"] = list(value)
        else:
            repo[name] = value
    return _finish(new)


def set_repo_visible(config: Config, repo_id: str, visible: bool) -> Config:
    new = copy.deepcopy(config)
    repos = _repos(new)
    repos[_index_of(repos, repo_id, "repository")]["visible"] = visible
    return _finish(new)


# --------------------------------------------------------------------------
# plans page: settings, lanes, plans inside lanes, and the roadmap
# --------------------------------------------------------------------------

PLANS_FIELDS = {
    "title": ("plans", "title"),
    "lead": ("plans", "lead"),
    "roadmap_kicker": ("plans", "roadmap", "kicker"),
    "roadmap_title": ("plans", "roadmap", "title"),
    "roadmap_intro": ("plans", "roadmap", "intro"),
}
LANE_FIELDS = ("label",)
PLAN_FIELDS = ("title", "text", "status")
STEP_FIELDS = ("when", "title", "text", "status")


def _lanes(config: Config) -> List[Dict[str, Any]]:
    return config["plans"]["lanes"]


def _steps(config: Config) -> List[Dict[str, Any]]:
    return config["plans"]["roadmap"]["steps"]


def _all_plans(config: Config) -> List[Dict[str, Any]]:
    return [item for lane in _lanes(config) for item in lane["items"]]


def _find_plan(config: Config, plan_id: str):
    """Return (lane, index) of the plan with this id; ids are unique across lanes."""
    for lane in _lanes(config):
        for index, item in enumerate(lane["items"]):
            if item.get("id") == plan_id:
                return lane, index
    known = ", ".join(item.get("id", "?") for item in _all_plans(config)) or "none"
    raise EditError(f"there is no plan with id '{plan_id}' (known ids: {known})")


def set_plans(config: Config, **fields: str) -> Config:
    _only_known(fields, PLANS_FIELDS, "plans page")
    new = copy.deepcopy(config)
    for name, value in fields.items():
        target = new
        *parents, last = PLANS_FIELDS[name]
        for key in parents:
            target = target[key]
        target[last] = value
    return _finish(new)


# lanes -------------------------------------------------------------------

def add_lane(config: Config, *, id: str, label: str, position: Optional[int] = None) -> Config:
    new = copy.deepcopy(config)
    _ensure_new_id(_lanes(new), id, "lane")
    _insert(_lanes(new), {"id": id, "label": label, "items": []}, position)
    return _finish(new)


def remove_lane(config: Config, lane_id: str) -> Config:
    new = copy.deepcopy(config)
    lanes = _lanes(new)
    index = _index_of(lanes, lane_id, "lane")
    count = len(lanes[index]["items"])
    if count:
        raise EditError(
            f"lane '{lane_id}' still has {count} plan(s). Move them to another lane or remove them first, "
            "so no plan is deleted by accident"
        )
    del lanes[index]
    return _finish(new)


def move_lane(config: Config, lane_id: str, position: int) -> Config:
    new = copy.deepcopy(config)
    lanes = _lanes(new)
    index = _index_of(lanes, lane_id, "lane")
    target = _check_position(lanes, position, "lane slot")
    lanes.insert(target, lanes.pop(index))
    return _finish(new)


def update_lane(config: Config, lane_id: str, **fields: str) -> Config:
    _only_known(fields, LANE_FIELDS, "lane")
    new = copy.deepcopy(config)
    lanes = _lanes(new)
    lanes[_index_of(lanes, lane_id, "lane")].update(fields)
    return _finish(new)


# plans inside lanes ------------------------------------------------------

def add_plan(
    config: Config,
    *,
    lane_id: str,
    id: str,
    title: str,
    text: str,
    status: str,
    visible: bool = True,
    position: Optional[int] = None,
) -> Config:
    new = copy.deepcopy(config)
    _ensure_new_id(_all_plans(new), id, "plan")
    lanes = _lanes(new)
    lane = lanes[_index_of(lanes, lane_id, "lane")]
    _insert(lane["items"], {"id": id, "title": title, "text": text, "status": status, "visible": visible}, position)
    return _finish(new)


def remove_plan(config: Config, plan_id: str) -> Config:
    new = copy.deepcopy(config)
    lane, index = _find_plan(new, plan_id)
    del lane["items"][index]
    return _finish(new)


def move_plan(config: Config, plan_id: str, position: int) -> Config:
    """Reorder a plan inside its own lane."""
    new = copy.deepcopy(config)
    lane, index = _find_plan(new, plan_id)
    target = _check_position(lane["items"], position, "plan slot")
    lane["items"].insert(target, lane["items"].pop(index))
    return _finish(new)


def relane_plan(config: Config, plan_id: str, lane_id: str, position: Optional[int] = None) -> Config:
    """Move a plan to another lane (for example from Horizon to Building when work starts)."""
    new = copy.deepcopy(config)
    lanes = _lanes(new)
    target_lane = lanes[_index_of(lanes, lane_id, "lane")]
    lane, index = _find_plan(new, plan_id)
    item = lane["items"].pop(index)
    _insert(target_lane["items"], item, position)
    return _finish(new)


def update_plan(config: Config, plan_id: str, **fields: str) -> Config:
    _only_known(fields, PLAN_FIELDS, "plan")
    new = copy.deepcopy(config)
    lane, index = _find_plan(new, plan_id)
    lane["items"][index].update(fields)
    return _finish(new)


def set_plan_visible(config: Config, plan_id: str, visible: bool) -> Config:
    new = copy.deepcopy(config)
    lane, index = _find_plan(new, plan_id)
    lane["items"][index]["visible"] = visible
    return _finish(new)


# roadmap steps -----------------------------------------------------------

def add_step(
    config: Config,
    *,
    id: str,
    when: str,
    title: str,
    text: str,
    status: str,
    visible: bool = True,
    position: Optional[int] = None,
) -> Config:
    new = copy.deepcopy(config)
    _ensure_new_id(_steps(new), id, "roadmap step")
    step = {"id": id, "when": when, "title": title, "text": text, "status": status, "visible": visible}
    _insert(_steps(new), step, position)
    return _finish(new)


def remove_step(config: Config, step_id: str) -> Config:
    new = copy.deepcopy(config)
    steps = _steps(new)
    del steps[_index_of(steps, step_id, "roadmap step")]
    return _finish(new)


def move_step(config: Config, step_id: str, position: int) -> Config:
    new = copy.deepcopy(config)
    steps = _steps(new)
    index = _index_of(steps, step_id, "roadmap step")
    target = _check_position(steps, position, "roadmap slot")
    steps.insert(target, steps.pop(index))
    return _finish(new)


def update_step(config: Config, step_id: str, **fields: str) -> Config:
    _only_known(fields, STEP_FIELDS, "roadmap step")
    new = copy.deepcopy(config)
    steps = _steps(new)
    steps[_index_of(steps, step_id, "roadmap step")].update(fields)
    return _finish(new)


def set_step_visible(config: Config, step_id: str, visible: bool) -> Config:
    new = copy.deepcopy(config)
    steps = _steps(new)
    steps[_index_of(steps, step_id, "roadmap step")]["visible"] = visible
    return _finish(new)
