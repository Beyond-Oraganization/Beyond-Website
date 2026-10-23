"""A local web interface over the same operations as the command line.

Security model (a local server is still a target: any web page you open can
try to send requests to ``localhost``):

* The server listens on 127.0.0.1 only.
* Every request must carry a ``Host`` header naming this exact address. This
  defeats DNS rebinding, where a hostile site points its own name at 127.0.0.1
  to read our responses.
* Every POST must carry the secret token (made fresh at start-up and embedded
  in the page we serve) and a JSON content type. A hostile page cannot read our
  page, so it cannot learn the token. This defeats cross-site request forgery.
* Only a fixed list of operations exists; each takes only named parameters of
  the expected type. There is no way to name a file or run a command.
* The preview serves only ``*.html``, ``*.css`` and ``*.jpg`` files directly in
  the site folder.
* The interface builds its DOM with ``textContent``, never ``innerHTML``, so
  config text cannot run as script in the interface either.
"""

from __future__ import annotations

import hmac
import json
import re
import secrets
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

from . import config as cfg
from . import model, service, storytext
from .build import CONFIG_NAME
from .errors import ConfigError, EditError, ManagerError

UI_FILE = Path(__file__).resolve().parent / "ui" / "index.html"
MAX_BODY = 1024 * 1024          # a long story is tens of kilobytes; this still stops absurd requests
UNDO_DEPTH = 50
PREVIEW_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg"}
PREVIEW_NAME = re.compile(r"^[A-Za-z0-9_-]+\.(html|css|jpg)$")

CSP = (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
    "connect-src 'self'; frame-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; "
    "frame-ancestors 'none'"
)


# --------------------------------------------------------------------------
# the operation table
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Op:
    """One allowed edit: which model function, and exactly which parameters."""
    fn: Callable[..., Any]
    positional: Dict[str, str]                 # required, passed first, in order
    keyword: Dict[str, str]                    # optional, passed by name
    required: Tuple[str, ...] = ()             # keyword parameters that must be present


_STR, _INT, _BOOL, _STRS, _OPT_STR = "str", "int", "bool", "strs", "optstr"

OPS: Dict[str, Op] = {
    "home.set": Op(model.set_home, {}, {k: _STR for k in model.HOME_FIELDS}),
    "button.add": Op(model.add_button, {"label": _STR, "href": _STR}, {"style": _STR, "position": _INT}),
    "button.remove": Op(model.remove_button, {"position": _INT}, {}),
    "ticker.add": Op(model.add_ticker, {"text": _STR}, {"position": _INT}),
    "ticker.remove": Op(model.remove_ticker, {"position": _INT}, {}),
    "tile.add": Op(
        model.add_tile, {},
        {"id": _STR, "label": _STR, "title": _STR, "text": _STR, "href": _STR, "kids": _STR, "visible": _BOOL, "position": _INT},
        required=("id", "label", "title", "text", "href"),
    ),
    "tile.remove": Op(model.remove_tile, {"tile_id": _STR}, {}),
    "tile.move": Op(model.move_tile, {"tile_id": _STR, "position": _INT}, {}),
    "tile.update": Op(model.update_tile, {"tile_id": _STR}, {k: _STR for k in model.TILE_FIELDS}),
    "tile.visible": Op(model.set_tile_visible, {"tile_id": _STR, "visible": _BOOL}, {}),
    "plans.set": Op(model.set_plans, {}, {k: _STR for k in model.PLANS_FIELDS}),
    "lane.add": Op(model.add_lane, {}, {"id": _STR, "label": _STR, "position": _INT}, required=("id", "label")),
    "lane.remove": Op(model.remove_lane, {"lane_id": _STR}, {}),
    "lane.move": Op(model.move_lane, {"lane_id": _STR, "position": _INT}, {}),
    "lane.update": Op(model.update_lane, {"lane_id": _STR}, {k: _STR for k in model.LANE_FIELDS}),
    "plan.add": Op(
        model.add_plan, {},
        {"lane_id": _STR, "id": _STR, "title": _STR, "text": _STR, "status": _STR, "visible": _BOOL, "position": _INT},
        required=("lane_id", "id", "title", "text", "status"),
    ),
    "plan.remove": Op(model.remove_plan, {"plan_id": _STR}, {}),
    "plan.move": Op(model.move_plan, {"plan_id": _STR, "position": _INT}, {}),
    "plan.relane": Op(model.relane_plan, {"plan_id": _STR, "lane_id": _STR}, {"position": _INT}),
    "plan.update": Op(model.update_plan, {"plan_id": _STR}, {k: _STR for k in model.PLAN_FIELDS}),
    "plan.visible": Op(model.set_plan_visible, {"plan_id": _STR, "visible": _BOOL}, {}),
    "step.add": Op(
        model.add_step, {},
        {"id": _STR, "when": _STR, "title": _STR, "text": _STR, "status": _STR, "visible": _BOOL, "position": _INT},
        required=("id", "when", "title", "text", "status"),
    ),
    "step.remove": Op(model.remove_step, {"step_id": _STR}, {}),
    "step.move": Op(model.move_step, {"step_id": _STR, "position": _INT}, {}),
    "step.update": Op(model.update_step, {"step_id": _STR}, {k: _STR for k in model.STEP_FIELDS}),
    "step.visible": Op(model.set_step_visible, {"step_id": _STR, "visible": _BOOL}, {}),
    "stories.set": Op(model.set_stories, {}, {k: _STR for k in model.STORIES_FIELDS}),
    "story.add": Op(
        model.add_story, {},
        {"id": _STR, "title": _STR, "body_text": _STR, "kind": _STR, "tag": _STR, "summary": _STR, "aside": _STR,
         "visible": _BOOL, "position": _INT},
        required=("id", "title", "body_text", "summary", "aside"),
    ),
    "story.remove": Op(model.remove_story, {"story_id": _STR}, {}),
    "story.move": Op(model.move_story, {"story_id": _STR, "position": _INT}, {}),
    "story.update": Op(model.update_story, {"story_id": _STR}, {k: _STR for k in model.STORY_FIELDS}),
    "story.visible": Op(model.set_story_visible, {"story_id": _STR, "visible": _BOOL}, {}),
    "blog.set": Op(model.set_blog, {}, {k: _STR for k in model.BLOG_FIELDS}),
    "post.add": Op(
        model.add_post, {},
        {"id": _STR, "title": _STR, "date": _STR, "summary": _STR, "body_text": _STR, "tags": _STRS, "visible": _BOOL},
        required=("id", "title", "date", "summary", "body_text"),
    ),
    "post.remove": Op(model.remove_post, {"post_id": _STR}, {}),
    "post.update": Op(
        model.update_post, {"post_id": _STR},
        {"title": _STR, "date": _STR, "tags": _STRS, "summary": _STR, "body_text": _STR},
    ),
    "post.visible": Op(model.set_post_visible, {"post_id": _STR, "visible": _BOOL}, {}),
    "github.set": Op(model.set_github, {}, {k: _STR for k in model.GITHUB_FIELDS}),
    "repo.add": Op(
        model.add_repo, {},
        {"id": _STR, "name": _STR, "url": _STR, "description": _STR, "stack": _STRS, "page": _OPT_STR,
         "visible": _BOOL, "position": _INT},
        required=("id", "name", "url", "description"),
    ),
    "repo.remove": Op(model.remove_repo, {"repo_id": _STR}, {}),
    "repo.move": Op(model.move_repo, {"repo_id": _STR, "position": _INT}, {}),
    "repo.update": Op(model.update_repo, {"repo_id": _STR}, {"name": _STR, "url": _STR, "description": _STR, "stack": _STRS, "page": _OPT_STR}),
    "repo.visible": Op(model.set_repo_visible, {"repo_id": _STR, "visible": _BOOL}, {}),
}


def _typed(name: str, value: Any, kind: str) -> Any:
    ok = {
        _STR: isinstance(value, str),
        _INT: isinstance(value, int) and not isinstance(value, bool),
        _BOOL: isinstance(value, bool),
        _STRS: isinstance(value, list) and all(isinstance(v, str) for v in value),
        _OPT_STR: value is None or isinstance(value, str),
    }[kind]
    if not ok:
        raise EditError(f"parameter '{name}' has the wrong type (expected {kind})")
    return value


def build_edit(op_name: str, params: Any) -> Callable[[Dict[str, Any]], Dict[str, Any]]:
    """Check a request against the operation table and return the edit to apply."""
    op = OPS.get(op_name) if isinstance(op_name, str) else None
    if op is None:
        raise EditError(f"unknown operation: {op_name!r}")
    if not isinstance(params, dict):
        raise EditError("params must be an object")
    allowed = set(op.positional) | set(op.keyword)
    unknown = sorted(set(params) - allowed)
    if unknown:
        raise EditError(f"unknown parameter(s) for {op_name}: {', '.join(unknown)}")
    missing = [n for n in list(op.positional) + list(op.required) if n not in params]
    if missing:
        raise EditError(f"missing parameter(s) for {op_name}: {', '.join(missing)}")
    args = [_typed(n, params[n], k) for n, k in op.positional.items()]
    kwargs = {n: _typed(n, params[n], op.keyword[n]) for n in params if n in op.keyword}
    return lambda config: op.fn(config, *args, **kwargs)


# --------------------------------------------------------------------------
# the application (no HTTP in here, so it is easy to test)
# --------------------------------------------------------------------------

class App:
    def __init__(self, site: Path):
        self.site = Path(site)
        self.warnings: list = []
        self.history: list = []          # (config before, config after) of our own edits, newest last

    def state(self) -> Dict[str, Any]:
        status = service.site_status(self.site)
        config = None
        texts: Dict[str, str] = {}
        post_texts: Dict[str, str] = {}
        if status["valid"]:
            config = cfg.load(self.site / CONFIG_NAME)
            texts = {s["id"]: storytext.dump(s["body"]) for s in config["stories"]["items"]}
            post_texts = {p["id"]: storytext.dump(p["body"]) for p in config["blog"]["items"]}
        return {"config": config, "status": status, "story_texts": texts, "post_texts": post_texts, "undo": len(self.history)}

    def edit(self, op: Any, params: Any) -> Dict[str, Any]:
        change = build_edit(op, params)
        seen: Dict[str, Any] = {}

        def recorded(config: Dict[str, Any]) -> Dict[str, Any]:
            seen["before"] = config
            seen["after"] = change(config)
            return seen["after"]

        service.apply_edit(self.site, recorded, on_stale=self.warnings.append)
        self.history.append((seen["before"], seen["after"]))
        del self.history[:-UNDO_DEPTH]
        return self.state()

    def undo(self) -> Dict[str, Any]:
        if not self.history:
            raise EditError("there is nothing to undo")
        before, after = self.history[-1]

        def restore(config: Dict[str, Any]) -> Dict[str, Any]:
            if config != after:
                raise EditError(
                    "the config was changed by something else (the command line or a text editor) since your last "
                    "action here, so undo would overwrite that work. Nothing was changed"
                )
            return before

        service.apply_edit(self.site, restore, on_stale=self.warnings.append)
        self.history.pop()
        return self.state()

    def build(self) -> Dict[str, Any]:
        service.rebuild_pages(self.site, on_stale=self.warnings.append)
        return self.state()

    def publish(self, message: Any, dry_run: Any) -> Dict[str, Any]:
        if not isinstance(message, str) or not isinstance(dry_run, bool):
            raise EditError("publish needs a text message and a true/false dry_run")
        outcome = service.publish_site(self.site, message, dry_run=dry_run, on_stale=self.warnings.append)
        result = outcome.result
        return {
            "publish": {
                "status": result.status, "branch": result.branch, "files": result.files,
                "commands": result.commands, "commit": result.commit, "pages": outcome.pages,
            },
            **self.state(),
        }


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server: "Server"
    server_version = "BeyondiaManager"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:     # keep the terminal quiet
        pass

    # -- plumbing ----------------------------------------------------------

    def _send(self, status: int, body: bytes, content_type: str, extra: Optional[Dict[str, str]] = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: Dict[str, Any]) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _error(self, status: int, message: str) -> None:
        self._json(status, {"ok": False, "error": message})

    def _host_ok(self) -> bool:
        return self.headers.get("Host", "") in self.server.allowed_hosts

    # -- GET ---------------------------------------------------------------

    def do_GET(self) -> None:
        if not self._host_ok():
            return self._error(HTTPStatus.FORBIDDEN, "unexpected Host header")
        path = self.path.split("?", 1)[0]
        if path == "/":
            html = UI_FILE.read_text(encoding="utf-8").replace("__BM_TOKEN__", self.server.token)
            return self._send(HTTPStatus.OK, html.encode("utf-8"), "text/html; charset=utf-8", {"Content-Security-Policy": CSP})
        if path == "/api/state":
            try:
                return self._json(HTTPStatus.OK, {"ok": True, **self.server.app.state()})
            except ManagerError as error:
                return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(error))
        if path.startswith("/preview/"):
            return self._preview(path[len("/preview/"):])
        self._error(HTTPStatus.NOT_FOUND, "not found")

    def _preview(self, name: str) -> None:
        if not PREVIEW_NAME.match(name):
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        file = self.server.app.site / name
        if not file.is_file():
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        self._send(HTTPStatus.OK, file.read_bytes(), PREVIEW_TYPES[file.suffix])

    # -- POST --------------------------------------------------------------

    def do_POST(self) -> None:
        if not self._host_ok():
            return self._error(HTTPStatus.FORBIDDEN, "unexpected Host header")
        token = self.headers.get("X-BM-Token", "")
        if not hmac.compare_digest(token.encode("utf-8"), self.server.token.encode("utf-8")):
            return self._error(HTTPStatus.FORBIDDEN, "missing or wrong token; reload the page")
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{h}" for h in self.server.allowed_hosts}:
            return self._error(HTTPStatus.FORBIDDEN, "unexpected Origin header")
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return self._error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "expected application/json")
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._error(HTTPStatus.LENGTH_REQUIRED, "Content-Length is required")
        if not 0 <= length <= MAX_BODY:
            return self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request too large")
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._error(HTTPStatus.BAD_REQUEST, "body is not valid JSON")
        if not isinstance(body, dict):
            return self._error(HTTPStatus.BAD_REQUEST, "body must be an object")

        app = self.server.app
        routes: Dict[str, Callable[[], Dict[str, Any]]] = {
            "/api/edit": lambda: app.edit(body.get("op"), body.get("params", {})),
            "/api/build": app.build,
            "/api/undo": app.undo,
            "/api/publish": lambda: app.publish(body.get("message"), body.get("dry_run")),
        }
        route = routes.get(self.path.split("?", 1)[0])
        if route is None:
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        try:
            with self.server.busy:           # one operation at a time inside this process
                payload = route()
        except ConfigError as error:
            return self._error(HTTPStatus.CONFLICT, str(error))
        except ManagerError as error:        # EditError, LockError, GitError...
            return self._error(HTTPStatus.CONFLICT, str(error))
        self._json(HTTPStatus.OK, {"ok": True, **payload})


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, site: Path, port: int = 8787, token: Optional[str] = None):
        super().__init__(("127.0.0.1", port), Handler)
        self.app = App(site)
        self.token = token or secrets.token_urlsafe(24)
        self.busy = threading.Lock()
        number = self.server_address[1]
        self.allowed_hosts = {f"127.0.0.1:{number}", f"localhost:{number}"}

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/"


def make_server(site: Path, port: int = 8787, token: Optional[str] = None) -> Server:
    return Server(site, port, token)
