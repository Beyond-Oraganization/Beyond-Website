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

from .config import LINK_RE, url_problem
from .errors import ManagerError

TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"

# (key, label, href). The single definition of the site navigation; the
# integrity checks verify every page against this list.
NAV: Tuple[Tuple[str, str, str], ...] = (
    ("stories", "STORIES", "stories.html"),
    ("blog", "BLOG", "blog.html"),
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


def _with_story_count(text: str, words: Tuple[str, str]) -> str:
    return text.replace("{stories}", words[0]).replace("{Stories}", words[1])


def _tile(tile: Dict[str, Any], words: Tuple[str, str] = ("", "")) -> str:
    tile = dict(tile, text=_with_story_count(tile["text"], words), kids=_with_story_count(tile.get("kids", ""), words))
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
    words = story_count_words(config)
    tiles = [_tile(t, words) for t in visible(home["map"]["tiles"])]
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


# --------------------------------------------------------------------------
# stories
# --------------------------------------------------------------------------

GENERATED_MARK = "Generated by the Beyondia site manager"
KIND_LABEL = {"story": "Story", "verses": "Verses"}
READ_LABEL = {"story": "Read the story", "verses": "Read the verses"}


def visible_stories(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    return visible(config["stories"]["items"])


def story_count_words(config: Dict[str, Any]) -> Tuple[str, str]:
    """(lowercase, Capitalised) number words for the tokens {stories} and {Stories}."""
    word = number_word(len(visible_stories(config)))
    return word.lower(), word


def _story_row(story: Dict[str, Any]) -> str:
    kind = story["kind"]
    return (
        '<li class="g2">\n'
        "          <div>\n"
        f'            <p class="label" style="margin-bottom: 16px; color: var(--mute)">{esc(KIND_LABEL[kind])}</p>\n'
        f'            <ul class="pills"><li class="pill">{esc(story["tag"])}</li></ul>\n'
        "          </div>\n"
        "          <div>\n"
        f'            <h2 class="h3-lg" style="margin-bottom: 16px"><a {link_attrs(story["file"])}>{esc(story["title"])}</a></h2>\n'
        f'            <p class="p" style="margin-bottom: 24px">{esc(story["summary"])}</p>\n'
        f'            <a {link_attrs(story["file"])} class="more">{esc(READ_LABEL[kind])} {ARROW}</a>\n'
        "          </div>\n"
        "        </li>"
    )


def render_stories(config: Dict[str, Any]) -> str:
    stories = config["stories"]
    shown = visible_stories(config)
    if shown:
        rows = "\n        ".join(_story_row(s) for s in shown)
        listing = f'<ul class="rows">\n        {rows}\n      </ul>'
    else:
        listing = '<p class="p mute">No stories are published yet.</p>'
    mapping = {
        "head": render_head(f'{config["site"]["name"]} — Stories'),
        "header": render_header("stories"),
        "title": esc(stories["title"]),
        "lead": esc(stories["lead"]),
        "stories": listing,
        "footer": render_footer(),
    }
    return fill(_template("stories.html"), mapping, "stories.html")


def _block(block: Dict[str, Any], first: bool) -> str:
    kind = block["type"]
    if kind == "p":
        return f'<p>{esc(block["text"])}</p>'
    if kind == "note":
        return f'<p class="mute">{esc(block["text"])}</p>'
    if kind == "heading":
        margin = "margin-bottom: 24px" if first else "margin: 56px 0 24px"
        return f'<h2 class="h3" style="{margin}">{esc(block["text"])}</h2>'
    if kind == "chapter":
        return f'<h2 class="chapter">{esc(block["text"])}</h2>'
    if kind == "verse":
        ref = f'<span class="label">{esc(block["ref"])}</span>'
        paras = block["paras"]
        if len(paras) == 1:
            return f'<div class="verse">{ref}<p>{esc(paras[0])}</p></div>'
        inner = "\n            ".join(
            f"<p>{esc(t)}</p>" if i == 0 else f'<p style="margin-top: 24px">{esc(t)}</p>' for i, t in enumerate(paras)
        )
        return f'<div class="verse">{ref}<div>\n            {inner}\n          </div></div>'
    raise ManagerError(f"unknown block type: {kind}")


def _pager_link(label: str, title: str, href: str, next_: bool) -> str:
    cls = ' class="next"' if next_ else ""
    return (
        f'<a href="{esc(href)}"{cls}>\n'
        f'          <span class="label">{esc(label)}</span>\n'
        f"          <h3>{esc(title)}</h3>\n"
        "        </a>"
    )


def render_story(config: Dict[str, Any], story: Dict[str, Any]) -> str:
    shown = visible_stories(config)
    index = next(i for i, s in enumerate(shown) if s["id"] == story["id"])
    left = (_pager_link("Previous story", shown[index - 1]["title"], shown[index - 1]["file"], False)
            if index > 0 else _pager_link("Back", "All stories", "stories.html", False))
    right = (_pager_link("Next story", shown[index + 1]["title"], shown[index + 1]["file"], True)
             if index < len(shown) - 1 else _pager_link("Back", "All stories", "stories.html", True))
    blocks = [_block(b, i == 0) for i, b in enumerate(story["body"])]
    mapping = {
        "head": render_head(f'{config["site"]["name"]} — {story["title"]}'),
        "header": render_header("stories"),
        "title": esc(story["title"]),
        "tag": esc(story["tag"]),
        "kind": esc(KIND_LABEL[story["kind"]]),
        "aside": esc(story["aside"]),
        "body": "\n          ".join(blocks),
        "pager": left + "\n        " + right,
        "footer": render_footer(),
    }
    return fill(_template("story.html"), mapping, "story.html")


def render_story_pages(config: Dict[str, Any]) -> Dict[str, str]:
    return {story["file"]: render_story(config, story) for story in visible_stories(config)}


# --------------------------------------------------------------------------
# blog
# --------------------------------------------------------------------------

_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
WORDS_PER_MINUTE = 200


def format_date(iso: str) -> str:
    """'2026-10-23' -> '23 October 2026'. Pure text: it never looks at the clock."""
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {_MONTHS[month - 1]} {year}"


def render_inline(text: str) -> str:
    """Escape text and turn [label](url) into a link, if the url passes the same rule as every link."""
    out: List[str] = []
    position = 0
    for match in LINK_RE.finditer(text):
        out.append(esc(text[position:match.start()]))
        url = match.group(2)
        if url_problem(url) is None:
            out.append(f"<a {link_attrs(url)}>{esc(match.group(1))}</a>")
        else:
            out.append(esc(match.group(0)))
        position = match.end()
    out.append(esc(text[position:]))
    return "".join(out)


def reading_minutes(post: Dict[str, Any]) -> int:
    words = 0
    for block in post["body"]:
        words += len(block["text"].split()) if "text" in block else sum(len(p.split()) for p in block["paras"])
    return max(1, round(words / WORDS_PER_MINUTE))


def published_posts(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Visible posts, newest first; equal dates keep the order of the config."""
    return sorted(visible(config["blog"]["items"]), key=lambda post: post["date"], reverse=True)


def _tag_pills(tags: List[str]) -> str:
    return "".join(f'<li class="pill">{esc(t)}</li>' for t in tags)


def _post_row(post: Dict[str, Any]) -> str:
    tags = f'\n            <ul class="pills" style="margin-top: 12px">{_tag_pills(post["tags"])}</ul>' if post["tags"] else ""
    return (
        '<li class="g2">\n'
        "          <div>\n"
        f'            <p class="label" style="margin-bottom: 8px; color: var(--mute)">{esc(format_date(post["date"]))}</p>\n'
        f'            <p class="small mute">{reading_minutes(post)} min read</p>{tags}\n'
        "          </div>\n"
        "          <div>\n"
        f'            <h2 class="h3-lg" style="margin-bottom: 16px"><a {link_attrs(post["file"])}>{esc(post["title"])}</a></h2>\n'
        f'            <p class="p" style="margin-bottom: 24px">{esc(post["summary"])}</p>\n'
        f'            <a {link_attrs(post["file"])} class="more">Read the post {ARROW}</a>\n'
        "          </div>\n"
        "        </li>"
    )


def render_blog(config: Dict[str, Any]) -> str:
    blog = config["blog"]
    posts = published_posts(config)
    if posts:
        rows = "\n        ".join(_post_row(p) for p in posts)
        listing = f'<ul class="rows">\n        {rows}\n      </ul>'
    else:
        listing = '<p class="p mute">No posts are published yet.</p>'
    mapping = {
        "head": render_head(f'{config["site"]["name"]} — Blog'),
        "header": render_header("blog"),
        "title": esc(blog["title"]),
        "lead": esc(blog["lead"]),
        "posts": listing,
        "footer": render_footer(),
    }
    return fill(_template("blog.html"), mapping, "blog.html")


def _post_block(block: Dict[str, Any], first: bool) -> str:
    kind = block["type"]
    if kind == "p":
        return f'<p>{render_inline(block["text"])}</p>'
    if kind == "note":
        return f'<p class="mute">{render_inline(block["text"])}</p>'
    if kind == "heading":
        margin = "margin-bottom: 24px" if first else "margin: 56px 0 24px"
        return f'<h2 class="h3" style="{margin}">{esc(block["text"])}</h2>'
    raise ManagerError(f"a post cannot contain a {kind} block")


def render_post(config: Dict[str, Any], post: Dict[str, Any]) -> str:
    ordered = published_posts(config)
    index = next(i for i, p in enumerate(ordered) if p["id"] == post["id"])
    left = (_pager_link("Newer post", ordered[index - 1]["title"], ordered[index - 1]["file"], False)
            if index > 0 else _pager_link("Back", "All posts", "blog.html", False))
    right = (_pager_link("Older post", ordered[index + 1]["title"], ordered[index + 1]["file"], True)
             if index < len(ordered) - 1 else _pager_link("Back", "All posts", "blog.html", True))
    tags = f'<ul class="pills" style="margin-bottom: 32px">{_tag_pills(post["tags"])}</ul>' if post["tags"] else ""
    mapping = {
        "head": render_head(f'{config["site"]["name"]} — {post["title"]}'),
        "header": render_header("blog"),
        "title": esc(post["title"]),
        "tags": tags,
        "date": esc(format_date(post["date"])),
        "minutes": str(reading_minutes(post)),
        "body": "\n          ".join(_post_block(b, i == 0) for i, b in enumerate(post["body"])),
        "pager": left + "\n        " + right,
        "footer": render_footer(),
    }
    return fill(_template("post.html"), mapping, "post.html")


def render_post_pages(config: Dict[str, Any]) -> Dict[str, str]:
    return {post["file"]: render_post(config, post) for post in published_posts(config)}
