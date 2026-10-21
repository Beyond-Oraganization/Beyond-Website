"""The command line: ``bm <group> <action> ...``.

Every command that changes the config follows one path (``_apply``):
lock -> load -> edit in memory -> render in memory -> save -> write pages.
Rendering happens *before* saving, so a change that cannot be rendered is
refused without touching any file.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, TextIO

from . import config as cfg
from . import model, publisher, service
from .build import CONFIG_NAME, build
from .checks import check_site
from .config import BUTTON_STYLES
from .errors import ManagerError
from .publisher import Git
from .service import LOCK_NAME

ENV_SITE_DIR = "BEYONDIA_SITE_DIR"


def default_site_dir() -> Path:
    """The folder that contains ``manager/`` (this file is manager/beyondia_manager/cli.py)."""
    return Path(__file__).resolve().parents[2]


class Console:
    def __init__(self, out: TextIO, err: TextIO):
        self.out, self.err = out, err

    def say(self, text: str = "") -> None:
        print(text, file=self.out)

    def warn(self, text: str) -> None:
        print(text, file=self.err)


# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="bm",
        description="Edit the Beyondia home page and GitHub page, and publish the result.",
    )
    p.add_argument("--site-dir", help=f"site folder (default: ${ENV_SITE_DIR} or the folder above manager/)")
    p.add_argument("--no-build", action="store_true", help="change the config but do not rewrite the pages")
    groups = p.add_subparsers(dest="group", metavar="<command>")
    groups.required = True

    home = groups.add_parser("home", help="the headline block of the home page").add_subparsers(dest="action", required=True)
    home.add_parser("show", help="print the current values")
    h = home.add_parser("set", help="change one or more values")
    for name in ("kicker", "title", "lead", "map-kicker", "map-title", "map-intro"):
        h.add_argument(f"--{name}")

    button = groups.add_parser("button", help="buttons under the headline (1 to 3)").add_subparsers(dest="action", required=True)
    button.add_parser("list")
    b = button.add_parser("add")
    b.add_argument("label")
    b.add_argument("href")
    b.add_argument("--style", choices=BUTTON_STYLES, default="ghost")
    b.add_argument("--position", type=int)
    button.add_parser("remove").add_argument("position", type=int)

    ticker = groups.add_parser("ticker", help="the moving strip of short phrases (1 to 12)").add_subparsers(dest="action", required=True)
    ticker.add_parser("list")
    t = ticker.add_parser("add")
    t.add_argument("text")
    t.add_argument("--position", type=int)
    ticker.add_parser("remove").add_argument("position", type=int)

    tile = groups.add_parser("tile", help="the doors on the home page map").add_subparsers(dest="action", required=True)
    tile.add_parser("list")
    tile.add_parser("info").add_argument("id")
    ta = tile.add_parser("add")
    ta.add_argument("id")
    for name in ("label", "title", "text", "href"):
        ta.add_argument(f"--{name}", required=True)
    ta.add_argument("--kids", default="")
    ta.add_argument("--hidden", action="store_true", help="add it, but do not show it yet")
    ta.add_argument("--position", type=int)
    tile.add_parser("remove").add_argument("id")
    tm = tile.add_parser("move")
    tm.add_argument("id")
    tm.add_argument("position", type=int)
    ts = tile.add_parser("set")
    ts.add_argument("id")
    for name in ("label", "title", "text", "kids", "href"):
        ts.add_argument(f"--{name}")
    tile.add_parser("hide").add_argument("id")
    tile.add_parser("unhide").add_argument("id")

    github = groups.add_parser("github", help="the GitHub page").add_subparsers(dest="action", required=True)
    github.add_parser("show")
    gs = github.add_parser("set")
    gs.add_argument("--title")
    gs.add_argument("--lead")

    repo = groups.add_parser("repo", help="repositories listed on the GitHub page").add_subparsers(dest="action", required=True)
    repo.add_parser("list")
    ra = repo.add_parser("add")
    ra.add_argument("id")
    for name in ("name", "url", "description"):
        ra.add_argument(f"--{name}", required=True)
    ra.add_argument("--stack", default="", help="comma separated, e.g. Python,Bybit API")
    ra.add_argument("--page", help="a details page of this site, e.g. techbot.html")
    ra.add_argument("--hidden", action="store_true")
    ra.add_argument("--position", type=int)
    rs = repo.add_parser("set")
    rs.add_argument("id")
    for name in ("name", "url", "description", "stack", "page"):
        rs.add_argument(f"--{name}", help="empty text clears --stack and --page" if name in ("stack", "page") else None)
    repo.add_parser("remove").add_argument("id")
    rm = repo.add_parser("move")
    rm.add_argument("id")
    rm.add_argument("position", type=int)
    repo.add_parser("hide").add_argument("id")
    repo.add_parser("unhide").add_argument("id")

    plans = groups.add_parser("plans", help="the plans page: title, lead and roadmap heading").add_subparsers(dest="action", required=True)
    plans.add_parser("show")
    pset = plans.add_parser("set")
    for name in ("title", "lead", "roadmap-kicker", "roadmap-title", "roadmap-intro"):
        pset.add_argument(f"--{name}")

    lane = groups.add_parser("lane", help="columns of the plans page (1 to 3)").add_subparsers(dest="action", required=True)
    lane.add_parser("list")
    la = lane.add_parser("add")
    la.add_argument("id")
    la.add_argument("--label", required=True)
    la.add_argument("--position", type=int)
    lane.add_parser("remove").add_argument("id")
    lm = lane.add_parser("move")
    lm.add_argument("id")
    lm.add_argument("position", type=int)
    ls = lane.add_parser("set")
    ls.add_argument("id")
    ls.add_argument("--label")

    plan = groups.add_parser("plan", help="plans inside the lanes").add_subparsers(dest="action", required=True)
    plan.add_parser("list")
    plan.add_parser("info").add_argument("id")
    pa = plan.add_parser("add")
    pa.add_argument("id")
    pa.add_argument("--lane", required=True, help="id of the lane (see `lane list`)")
    for name in ("title", "text", "status"):
        pa.add_argument(f"--{name}", required=True)
    pa.add_argument("--hidden", action="store_true")
    pa.add_argument("--position", type=int)
    plan.add_parser("remove").add_argument("id")
    pm = plan.add_parser("move", help="reorder inside its lane")
    pm.add_argument("id")
    pm.add_argument("position", type=int)
    pt = plan.add_parser("to-lane", help="move to another lane")
    pt.add_argument("id")
    pt.add_argument("lane")
    pt.add_argument("--position", type=int)
    ps = plan.add_parser("set")
    ps.add_argument("id")
    for name in ("title", "text", "status"):
        ps.add_argument(f"--{name}")
    plan.add_parser("hide").add_argument("id")
    plan.add_parser("unhide").add_argument("id")

    step = groups.add_parser("step", help="the roadmap section of the plans page").add_subparsers(dest="action", required=True)
    step.add_parser("list")
    step.add_parser("info").add_argument("id")
    sa = step.add_parser("add")
    sa.add_argument("id")
    for name in ("when", "title", "text", "status"):
        sa.add_argument(f"--{name}", required=True)
    sa.add_argument("--hidden", action="store_true")
    sa.add_argument("--position", type=int)
    step.add_parser("remove").add_argument("id")
    sm = step.add_parser("move")
    sm.add_argument("id")
    sm.add_argument("position", type=int)
    ss = step.add_parser("set")
    ss.add_argument("id")
    for name in ("when", "title", "text", "status"):
        ss.add_argument(f"--{name}")
    step.add_parser("hide").add_argument("id")
    step.add_parser("unhide").add_argument("id")

    groups.add_parser("validate", help="check site.config.json")
    groups.add_parser("check", help="check links, anchors, navigation and fonts of the pages")
    bp = groups.add_parser("build", help="write index.html and github.html from the config")
    bp.add_argument("--check", action="store_true", help="write nothing; fail if the pages are out of date")
    groups.add_parser("status", help="what is out of date or unpublished")
    pp = groups.add_parser("publish", help="build, commit the managed files, pull --rebase and push")
    pp.add_argument("-m", "--message", required=True)
    pp.add_argument("--dry-run", action="store_true", help="show what would happen; change nothing")
    up = groups.add_parser("ui", help="open the graphical interface in your browser")
    up.add_argument("--port", type=int, default=8787, help="port on this computer (default 8787)")
    up.add_argument("--no-open", action="store_true", help="do not open the browser automatically")
    return p


# --------------------------------------------------------------------------
# shared steps
# --------------------------------------------------------------------------

def _csv(text: str) -> List[str]:
    return [part.strip() for part in text.split(",") if part.strip()]


def _given(args: argparse.Namespace, names: Sequence[str]) -> Dict[str, Any]:
    """Only the options the user actually typed (None means 'not given')."""
    return {n: getattr(args, n.replace("-", "_")) for n in names if getattr(args, n.replace("-", "_")) is not None}


def _apply(site: Path, con: Console, edit: Callable[[Dict[str, Any]], Dict[str, Any]], no_build: bool, done: str) -> int:
    result = service.apply_edit(site, edit, rebuild=not no_build, on_stale=con.warn)
    con.say(done)
    if result is None:
        con.say("Pages not rebuilt (--no-build). Run `bm build` before publishing.")
    else:
        _report_build(con, result)
    return 0


def _report_build(con: Console, result: Any) -> None:
    if result.changed:
        con.say("Rebuilt: " + ", ".join(result.changed))
    else:
        con.say("Pages already up to date.")


def _visible_mark(item: Dict[str, Any]) -> str:
    return "" if item.get("visible") else "  [hidden]"


# --------------------------------------------------------------------------
# read-only commands
# --------------------------------------------------------------------------

def _show_home(config: Dict[str, Any], con: Console) -> None:
    home = config["home"]
    for key, value in (
        ("kicker", home["kicker"]), ("title", home["title"]), ("lead", home["lead"]),
        ("map-kicker", home["map"]["kicker"]), ("map-title", home["map"]["title"]), ("map-intro", home["map"]["intro"]),
    ):
        con.say(f"{key:11} {value}")


def _list_buttons(config: Dict[str, Any], con: Console) -> None:
    for i, b in enumerate(config["home"]["buttons"], 1):
        con.say(f"{i}. {b['label']}  ->  {b['href']}  ({b['style']})")


def _list_ticker(config: Dict[str, Any], con: Console) -> None:
    for i, text in enumerate(config["home"]["ticker"], 1):
        con.say(f"{i}. {text}")


def _list_tiles(config: Dict[str, Any], con: Console) -> None:
    for i, t in enumerate(config["home"]["map"]["tiles"], 1):
        con.say(f"{i:2}. {t['id']:14} {t['title']}  ->  {t['href']}{_visible_mark(t)}")


def _info(items: List[Dict[str, Any]], item_id: str, what: str, con: Console) -> None:
    for item in items:
        if item["id"] == item_id:
            for key, value in item.items():
                con.say(f"{key:12} {value}")
            return
    raise ManagerError(f"there is no {what} with id '{item_id}'")


def _list_repos(config: Dict[str, Any], con: Console) -> None:
    repos = config["github"]["repos"]
    if not repos:
        con.say("(no repositories)")
    for i, r in enumerate(repos, 1):
        con.say(f"{i:2}. {r['id']:16} {r['url']}{_visible_mark(r)}")


def _show_github(config: Dict[str, Any], con: Console) -> None:
    con.say(f"title       {config['github']['title']}")
    con.say(f"lead        {config['github']['lead']}")
    con.say(f"repos       {len(config['github']['repos'])}")


def _show_plans(config: Dict[str, Any], con: Console) -> None:
    plans = config["plans"]
    for key, value in (
        ("title", plans["title"]), ("lead", plans["lead"]), ("road-kicker", plans["roadmap"]["kicker"]),
        ("road-title", plans["roadmap"]["title"]), ("road-intro", plans["roadmap"]["intro"]),
    ):
        con.say(f"{key:12} {value}")


def _list_lanes(config: Dict[str, Any], con: Console) -> None:
    for i, lane in enumerate(config["plans"]["lanes"], 1):
        con.say(f"{i}. {lane['id']:12} {lane['label']}  ({len(lane['items'])} plans)")


def _list_plans(config: Dict[str, Any], con: Console) -> None:
    for lane in config["plans"]["lanes"]:
        con.say(f"{lane['label']} [{lane['id']}]")
        for i, item in enumerate(lane["items"], 1):
            con.say(f"  {i:2}. {item['id']:22} {item['title']}  ({item['status']}){_visible_mark(item)}")


def _list_steps(config: Dict[str, Any], con: Console) -> None:
    steps = config["plans"]["roadmap"]["steps"]
    if not steps:
        con.say("(no steps)")
    for i, st in enumerate(steps, 1):
        con.say(f"{i:2}. {st['id']:20} {st['when']}: {st['title']}  ({st['status']}){_visible_mark(st)}")


def _all_plan_items(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [item for lane in config["plans"]["lanes"] for item in lane["items"]]


def _cmd_check(site: Path, con: Console) -> int:
    problems = check_site(site)
    if problems:
        con.warn(f"{len(problems)} problem(s) found:")
        for problem in problems:
            con.warn("  - " + problem)
        return 1
    con.say("Site checks passed.")
    return 0


def _cmd_status(site: Path, con: Console) -> int:
    config = cfg.load(site / CONFIG_NAME)
    stale = build(site, config, check=True).changed
    con.say("Config:  valid")
    con.say("Pages:   " + ("up to date" if not stale else "OUT OF DATE (" + ", ".join(stale) + ") - run `bm build`"))
    git = Git(site)
    if not git.ok("rev-parse", "--is-inside-work-tree"):
        con.say("Git:     not a Git repository")
        return 0
    changed = publisher._changed_managed(git)
    con.say("Git:     " + ("nothing to publish" if not changed else "unpublished changes in " + ", ".join(changed)))
    return 0


def _cmd_publish(site: Path, args: argparse.Namespace, con: Console) -> int:
    outcome = service.publish_site(site, args.message, dry_run=args.dry_run, on_stale=con.warn)
    result = outcome.result
    if outcome.pages:
        con.say(("Would rebuild: " if args.dry_run else "Rebuilt: ") + ", ".join(outcome.pages))
    if result.status == "dry-run":
        con.say("Dry run - nothing was changed. Would run:")
        for command in result.commands:
            con.say("  " + command)
    elif result.status == "nothing":
        con.say("Nothing to publish.")
    else:
        con.say(f"Published {result.commit} to origin/{result.branch}: " + (", ".join(result.files) or "earlier local commits"))
    return 0


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------

def _cmd_ui(site: Path, args: argparse.Namespace, con: Console) -> int:
    from . import web                     # imported here: the other commands never need the server code
    try:
        server = web.make_server(site, args.port)
    except OSError as error:
        raise ManagerError(f"cannot listen on port {args.port} ({error.strerror}). Try --port with another number.")
    con.say(f"Beyondia manager is running at {server.url}")
    con.say("Press Ctrl+C to stop.")
    if not args.no_open:
        import webbrowser
        webbrowser.open(server.url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        con.say("\nStopped.")
    finally:
        server.server_close()
    return 0


def run(args: argparse.Namespace, con: Console) -> int:
    site = Path(args.site_dir or os.environ.get(ENV_SITE_DIR) or default_site_dir())
    g, a, nb = args.group, getattr(args, "action", None), args.no_build

    if g == "validate":
        cfg.load(site / CONFIG_NAME)
        con.say("Config is valid.")
        return 0
    if g == "check":
        return _cmd_check(site, con)
    if g == "status":
        return _cmd_status(site, con)
    if g == "publish":
        return _cmd_publish(site, args, con)
    if g == "ui":
        return _cmd_ui(site, args, con)
    if g == "build":
        config = cfg.load(site / CONFIG_NAME)
        result = build(site, config, check=args.check)
        if args.check:
            if result.changed:
                con.warn("Out of date: " + ", ".join(result.changed) + " - run `bm build`.")
                return 1
            con.say("Pages are up to date.")
            return 0
        _report_build(con, result)
        return 0

    # read-only views
    views = {
        ("home", "show"): _show_home, ("button", "list"): _list_buttons, ("ticker", "list"): _list_ticker,
        ("tile", "list"): _list_tiles, ("github", "show"): _show_github, ("repo", "list"): _list_repos,
        ("plans", "show"): _show_plans, ("lane", "list"): _list_lanes, ("plan", "list"): _list_plans,
        ("step", "list"): _list_steps,
    }
    if (g, a) in views:
        views[(g, a)](cfg.load(site / CONFIG_NAME), con)
        return 0
    if (g, a) == ("tile", "info"):
        _info(cfg.load(site / CONFIG_NAME)["home"]["map"]["tiles"], args.id, "tile", con)
        return 0

    if (g, a) == ("plan", "info"):
        _info(_all_plan_items(cfg.load(site / CONFIG_NAME)), args.id, "plan", con)
        return 0
    if (g, a) == ("step", "info"):
        _info(cfg.load(site / CONFIG_NAME)["plans"]["roadmap"]["steps"], args.id, "roadmap step", con)
        return 0

    # edits
    if g == "plans":
        fields = {k.replace("-", "_"): v for k, v in _given(args, ["title", "lead", "roadmap-kicker", "roadmap-title", "roadmap-intro"]).items()}
        return _apply(site, con, lambda c: model.set_plans(c, **fields), nb, "Plans page updated.")
    if g == "lane":
        if a == "add":
            return _apply(site, con, lambda c: model.add_lane(c, id=args.id, label=args.label, position=args.position), nb, f"Lane '{args.id}' added.")
        if a == "remove":
            return _apply(site, con, lambda c: model.remove_lane(c, args.id), nb, f"Lane '{args.id}' removed.")
        if a == "move":
            return _apply(site, con, lambda c: model.move_lane(c, args.id, args.position), nb, f"Lane '{args.id}' moved to {args.position}.")
        fields = _given(args, ["label"])
        return _apply(site, con, lambda c: model.update_lane(c, args.id, **fields), nb, f"Lane '{args.id}' updated.")
    if g == "plan":
        if a == "add":
            return _apply(site, con, lambda c: model.add_plan(
                c, lane_id=args.lane, id=args.id, title=args.title, text=args.text, status=args.status,
                visible=not args.hidden, position=args.position), nb, f"Plan '{args.id}' added.")
        if a == "remove":
            return _apply(site, con, lambda c: model.remove_plan(c, args.id), nb, f"Plan '{args.id}' removed.")
        if a == "move":
            return _apply(site, con, lambda c: model.move_plan(c, args.id, args.position), nb, f"Plan '{args.id}' moved to {args.position}.")
        if a == "to-lane":
            return _apply(site, con, lambda c: model.relane_plan(c, args.id, args.lane, args.position), nb, f"Plan '{args.id}' moved to lane '{args.lane}'.")
        if a == "set":
            fields = _given(args, ["title", "text", "status"])
            return _apply(site, con, lambda c: model.update_plan(c, args.id, **fields), nb, f"Plan '{args.id}' updated.")
        visible = a == "unhide"
        return _apply(site, con, lambda c: model.set_plan_visible(c, args.id, visible), nb, f"Plan '{args.id}' is now {'visible' if visible else 'hidden'}.")
    if g == "step":
        if a == "add":
            return _apply(site, con, lambda c: model.add_step(
                c, id=args.id, when=args.when, title=args.title, text=args.text, status=args.status,
                visible=not args.hidden, position=args.position), nb, f"Step '{args.id}' added.")
        if a == "remove":
            return _apply(site, con, lambda c: model.remove_step(c, args.id), nb, f"Step '{args.id}' removed.")
        if a == "move":
            return _apply(site, con, lambda c: model.move_step(c, args.id, args.position), nb, f"Step '{args.id}' moved to {args.position}.")
        if a == "set":
            fields = _given(args, ["when", "title", "text", "status"])
            return _apply(site, con, lambda c: model.update_step(c, args.id, **fields), nb, f"Step '{args.id}' updated.")
        visible = a == "unhide"
        return _apply(site, con, lambda c: model.set_step_visible(c, args.id, visible), nb, f"Step '{args.id}' is now {'visible' if visible else 'hidden'}.")
    if g == "home":
        fields = {k.replace("-", "_"): v for k, v in _given(args, ["kicker", "title", "lead", "map-kicker", "map-title", "map-intro"]).items()}
        return _apply(site, con, lambda c: model.set_home(c, **fields), nb, "Home page updated.")
    if g == "button":
        if a == "add":
            return _apply(site, con, lambda c: model.add_button(c, args.label, args.href, args.style, args.position), nb, f"Button '{args.label}' added.")
        return _apply(site, con, lambda c: model.remove_button(c, args.position), nb, f"Button {args.position} removed.")
    if g == "ticker":
        if a == "add":
            return _apply(site, con, lambda c: model.add_ticker(c, args.text, args.position), nb, "Ticker item added.")
        return _apply(site, con, lambda c: model.remove_ticker(c, args.position), nb, f"Ticker item {args.position} removed.")
    if g == "tile":
        if a == "add":
            return _apply(site, con, lambda c: model.add_tile(
                c, id=args.id, label=args.label, title=args.title, text=args.text, href=args.href,
                kids=args.kids, visible=not args.hidden, position=args.position), nb, f"Tile '{args.id}' added.")
        if a == "remove":
            return _apply(site, con, lambda c: model.remove_tile(c, args.id), nb, f"Tile '{args.id}' removed.")
        if a == "move":
            return _apply(site, con, lambda c: model.move_tile(c, args.id, args.position), nb, f"Tile '{args.id}' moved to {args.position}.")
        if a == "set":
            fields = _given(args, ["label", "title", "text", "kids", "href"])
            return _apply(site, con, lambda c: model.update_tile(c, args.id, **fields), nb, f"Tile '{args.id}' updated.")
        visible = a == "unhide"
        return _apply(site, con, lambda c: model.set_tile_visible(c, args.id, visible), nb, f"Tile '{args.id}' is now {'visible' if visible else 'hidden'}.")
    if g == "github":
        fields = _given(args, ["title", "lead"])
        return _apply(site, con, lambda c: model.set_github(c, **fields), nb, "GitHub page updated.")
    if g == "repo":
        if a == "add":
            return _apply(site, con, lambda c: model.add_repo(
                c, id=args.id, name=args.name, url=args.url, description=args.description,
                stack=_csv(args.stack), page=args.page, visible=not args.hidden, position=args.position), nb, f"Repository '{args.id}' added.")
        if a == "remove":
            return _apply(site, con, lambda c: model.remove_repo(c, args.id), nb, f"Repository '{args.id}' removed.")
        if a == "move":
            return _apply(site, con, lambda c: model.move_repo(c, args.id, args.position), nb, f"Repository '{args.id}' moved to {args.position}.")
        if a == "set":
            fields = _given(args, ["name", "url", "description", "stack", "page"])
            if "stack" in fields:
                fields["stack"] = _csv(fields["stack"])
            return _apply(site, con, lambda c: model.update_repo(c, args.id, **fields), nb, f"Repository '{args.id}' updated.")
        visible = a == "unhide"
        return _apply(site, con, lambda c: model.set_repo_visible(c, args.id, visible), nb, f"Repository '{args.id}' is now {'visible' if visible else 'hidden'}.")
    raise ManagerError(f"unhandled command: {g} {a}")   # unreachable unless the parser and this table drift apart


def main(argv: Optional[Sequence[str]] = None, out: Optional[TextIO] = None, err: Optional[TextIO] = None) -> int:
    con = Console(out or sys.stdout, err or sys.stderr)
    parser = _parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exit_:                      # argparse already printed its message
        return int(exit_.code or 0)
    try:
        return run(args, con)
    except ManagerError as error:
        con.warn(f"Error: {error}")
        return 1
