"""Turning the config into HTML.

Two rules hold everywhere in this file:

1. Text from the config is escaped (``esc``) before it goes into any fragment.
   There is no way to put raw HTML from the config on the page.
2. Output is deterministic: the same config gives the same bytes (no dates,
   no random ids, stable ordering), so ``build --check`` can compare bytes.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Tuple
from urllib.parse import urlsplit

from .config import url_problem
from .errors import ManagerError

TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"

# (key, label, href). The single definition of the site navigation; the
# integrity checks verify every page against this list.
NAV: Tuple[Tuple[str, str, str], ...] = (
    ("stories", "STORIES", "stories.html"),
    ("conclusions", "CONCLUSIONS", "conclusions.html"),
    ("ideology", "IDEOLOGY", "ideology.html"),
    ("plans", "PLANS", "plans.html"),
    ("technologies", "TECHNOLOGIES", "technologies.html"),
    ("github", "GITHUB", "github.html"),
    ("community", "COMMUNITY", "community.html"),
    ("creator", "CREATOR", "creator.html"),
)

ARROW = (
    '<svg width="28" height="12" viewBox="0 0 28 12" fill="none" stroke="currentColor" '
    'stroke-width="2.5" aria-hidden="true"><path d="M0 6H26M21 1L26 6L21 11"></path></svg>'
)

_NUMBER_WORDS = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty",
]

_PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def number_word(count: int) -> str:
    """'Seven' for 7; plain digits above twenty."""
    if 0 <= count < len(_NUMBER_WORDS):
        return _NUMBER_WORDS[count].capitalize()
    return str(count)


def safe_url(url: str) -> str:
    """Escape a link for an attribute, refusing anything the config would refuse.

    The config is already validated, so this should never fire; it is a second
    line of defence in case a template or a caller skips validation.
    """
    why = url_problem(url)
    if why:
        raise ManagerError(f"refusing to render link {url!r}: {why}")
    return esc(url)


def link_attrs(url: str) -> str:
    """href (plus a safe new-tab setting for links that leave the site)."""
    href = safe_url(url)
    if urlsplit(url).scheme:
        return f'href="{href}" target="_blank" rel="noopener"'
    return f'href="{href}"'


def fill(template: str, mapping: Mapping[str, str], name: str) -> str:
    """Replace ``{{key}}`` placeholders in one pass.

    A placeholder without a value, or a value without a placeholder, is an
    error: it means template and code have drifted apart. One pass means text
    that itself contains ``{{...}}`` is never expanded a second time.
    """
    used = set()

    def replace(match: "re.Match[str]") -> str:
        key = match.group(1)
        if key not in mapping:
            raise ManagerError(f"template {name}: no value for placeholder {{{{{key}}}}}")
        used.add(key)
        return mapping[key]

    result = _PLACEHOLDER.sub(replace, template)
    unused = sorted(set(mapping) - used)
    if unused:
        raise ManagerError(f"template {name}: values given but not used: {', '.join(unused)}")
    return result


def _template(name: str) -> str:
    try:
        return (TEMPLATE_DIR / name).read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ManagerError(f"template missing: {TEMPLATE_DIR / name}")


def _trim(text: str) -> str:
    return text.rstrip("\n")


# --------------------------------------------------------------------------
# shared partials
# --------------------------------------------------------------------------

def render_head(title: str) -> str:
    return _trim(fill(_template("head.html"), {"title": esc(title)}, "head.html"))


def render_header(current: str = "") -> str:
    items = [
        '<li><a href="{href}" class="{cls}">{label}</a></li>'.format(
            href=esc(href), cls="on" if key == current else "", label=esc(label)
        )
        for key, label, href in NAV
    ]
    return _trim(fill(_template("header.html"), {"nav": "\n        ".join(items)}, "header.html"))


def render_footer() -> str:
    items = ['<li><a href="{}">{}</a></li>'.format(esc(href), esc(label)) for _key, label, href in NAV]
    return _trim(fill(_template("footer.html"), {"nav": "\n          ".join(items)}, "footer.html"))


# --------------------------------------------------------------------------
# home page
# --------------------------------------------------------------------------

def visible(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [item for item in items if item.get("visible")]


def _tile(tile: Dict[str, Any]) -> str:
    lines = [
        f'<a {link_attrs(tile["href"])} class="tile">',
        f'  <span class="label" style="color: var(--mute)">{esc(tile["label"])}</span>',
        f'  <h3>{esc(tile["title"])}</h3>',
        f'  <p class="small">{esc(tile["text"])}</p>',
    ]
    if tile.get("kids"):
        lines.append(f'  <span class="kids">{esc(tile["kids"])}</span>')
    lines += ['  <span class="more">Open</span>', "</a>"]
    return "\n          ".join(lines).replace("\n          </a>", "\n        </a>")


def _ticker(items: List[str]) -> str:
    group = "".join(f"<span>{esc(item)}</span><i></i>" for item in items)
    return (
        '<div class="ticker" aria-hidden="true">\n'
        '    <div class="ticker-track">\n'
        f'      <div class="ticker-group">{group}</div>\n'
        f'      <div class="ticker-group">{group}</div>\n'
        "    </div>\n"
        "  </div>"
    )


def map_title(config: Dict[str, Any]) -> str:
    tiles = visible(config["home"]["map"]["tiles"])
    return config["home"]["map"]["title"].replace("{count}", number_word(len(tiles)))


def render_home(config: Dict[str, Any]) -> str:
    home = config["home"]
    site_name = config["site"]["name"]
    buttons = [
        '<a {attrs} class="btn btn-{style}">{label}</a>'.format(
            attrs=link_attrs(b["href"]), style=esc(b["style"]), label=esc(b["label"])
        )
        for b in home["buttons"]
    ]
    tiles = [_tile(t) for t in visible(home["map"]["tiles"])]
    mapping = {
        "head": render_head(f"{site_name} — home"),
        "header": render_header(),
        "kicker": esc(home["kicker"]),
        "title": esc(home["title"]),
        "lead": esc(home["lead"]),
        "buttons": "\n        ".join(buttons),
        "ticker": _ticker(home["ticker"]),
        "map_kicker": esc(home["map"]["kicker"]),
        "map_title": esc(map_title(config)),
        "map_intro": esc(home["map"]["intro"]),
        "tiles": "\n        ".join(tiles),
        "footer": render_footer(),
    }
    return fill(_template("home.html"), mapping, "home.html")


# --------------------------------------------------------------------------
# GitHub page
# --------------------------------------------------------------------------

def _repo(repo: Dict[str, Any]) -> str:
    pills = ""
    if repo["stack"]:
        items = "".join(f'<li class="pill">{esc(item)}</li>' for item in repo["stack"])
        pills = f'\n        <ul class="pills">{items}</ul>'
    details = ""
    if repo.get("page"):
        details = f'\n        <a {link_attrs(repo["page"])} class="more">Details {ARROW}</a>'
    url = link_attrs(repo["url"])
    return (
        '<li class="g2">\n'
        "      <div>\n"
        '        <p class="label" style="margin-bottom: 16px; color: var(--mute)">Repository</p>'
        f"{pills}\n"
        "      </div>\n"
        "      <div>\n"
        f'        <h2 class="h3-lg" style="margin-bottom: 16px"><a {url}>{esc(repo["name"])}</a></h2>\n'
        f'        <p class="p" style="margin-bottom: 24px">{esc(repo["description"])}</p>\n'
        '        <div style="display: flex; flex-wrap: wrap; gap: 4px 32px">\n'
        f'          <a {url} class="more">View on GitHub {ARROW}</a>{details}\n'
        "        </div>\n"
        "      </div>\n"
        "    </li>"
    )


def _repos(repos: List[Dict[str, Any]]) -> str:
    shown = visible(repos)
    if not shown:
        return '<p class="p mute">No repositories are listed yet.</p>'
    rows = "\n    ".join(_repo(r) for r in shown)
    return f'<ul class="rows">\n    {rows}\n      </ul>'


def _org_link(org_url: str) -> str:
    label = re.sub(r"^https?://", "", org_url).rstrip("/")
    return f'<a {link_attrs(org_url)} style="text-decoration: underline">{esc(label)}</a>'


def render_github(config: Dict[str, Any]) -> str:
    github = config["github"]
    mapping = {
        "head": render_head(f'{config["site"]["name"]} — GitHub'),
        "header": render_header("github"),
        "title": esc(github["title"]),
        "lead": esc(github["lead"]),
        "repos": _repos(github["repos"]),
        "org_link": _org_link(config["site"]["org_url"]),
        "footer": render_footer(),
    }
    return fill(_template("github.html"), mapping, "github.html")


# --------------------------------------------------------------------------
# plans page
# --------------------------------------------------------------------------

def _lane(lane: Dict[str, Any]) -> str:
    shown = visible(lane["items"])
    if shown:
        items = "\n".join(
            "            <li>\n"
            f'              <h3>{esc(item["title"])}</h3>\n'
            f'              <p class="small mute">{esc(item["text"])}</p>\n'
            f'              <span class="pill">{esc(item["status"])}</span>\n'
            "            </li>"
            for item in shown
        )
    else:
        items = '            <li><p class="small mute">Nothing is listed here yet.</p></li>'
    return (
        '<div class="lane">\n'
        f'          <span class="label">{esc(lane["label"])}</span>\n'
        "          <ul>\n"
        f"{items}\n"
        "          </ul>\n"
        "        </div>"
    )


def _step(step: Dict[str, Any]) -> str:
    return (
        '<li class="g2">\n'
        "        <div>\n"
        f'          <p class="label" style="margin-bottom: 16px; color: var(--mute)">{esc(step["when"])}</p>\n'
        f'          <span class="pill">{esc(step["status"])}</span>\n'
        "        </div>\n"
        "        <div>\n"
        f'          <h3 class="h3" style="margin-bottom: 12px">{esc(step["title"])}</h3>\n'
        f'          <p class="p">{esc(step["text"])}</p>\n'
        "        </div>\n"
        "      </li>"
    )


def _steps(steps: List[Dict[str, Any]]) -> str:
    shown = visible(steps)
    if not shown:
        return '<p class="p mute">No steps are planned yet.</p>'
    rows = "\n      ".join(_step(s) for s in shown)
    return f'<ul class="rows">\n      {rows}\n      </ul>'


def render_plans(config: Dict[str, Any]) -> str:
    plans = config["plans"]
    roadmap = plans["roadmap"]
    mapping = {
        "head": render_head(f'{config["site"]["name"]} — plans'),
        "header": render_header("plans"),
        "title": esc(plans["title"]),
        "lead": esc(plans["lead"]),
        "lanes": "\n        ".join(_lane(lane) for lane in plans["lanes"]),
        "roadmap_kicker": esc(roadmap["kicker"]),
        "roadmap_title": esc(roadmap["title"]),
        "roadmap_intro": esc(roadmap["intro"]),
        "steps": _steps(roadmap["steps"]),
        "footer": render_footer(),
    }
    return fill(_template("plans.html"), mapping, "plans.html")
