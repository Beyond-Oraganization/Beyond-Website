"""The pages and files that are not one page of content: 404, search, sitemap, feed, robots, search index.

Same two rules as render.py: everything from the config is escaped, and the
output is deterministic (no clock, no random ids) so ``build --check`` can
compare bytes. The search index is the one thing that needs the other pages'
text, so it is built from the finished pages (``build_search_index``), not
from the config.
"""

from __future__ import annotations

import html
import json
import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Mapping, Optional

from .render import (
    GENERATED_MARK, NAV, _template, describe, esc, fill, has_feed, page_url, published_posts, render_footer,
    render_head, render_header, safe_url, site_url,
)

NOT_FOUND_PAGE = "404.html"
SEARCH_PAGE = "search.html"
SEARCH_INDEX = "search-index.js"
SITEMAP = "sitemap.xml"
FEED = "feed.xml"
ROBOTS = "robots.txt"

# Pages that are tools, not content: nobody searches for them and search engines need not list them.
UNLISTED = (NOT_FOUND_PAGE, SEARCH_PAGE)
EPOCH = "1970-01-01T00:00:00Z"
MAX_INDEXED_CHARS = 30000


def render_not_found(config: Dict[str, Any]) -> str:
    title = f'{config["site"]["name"]} — page not found'
    description = "This page does not exist or has moved. Use the map or the search to get back into Beyondia."
    mapping = {
        "head": render_head(config, title, description, NOT_FOUND_PAGE, base=True),
        "header": render_header(),
        "footer": render_footer(config),
    }
    return fill(_template("notfound.html"), mapping, "notfound.html")


def render_search(config: Dict[str, Any]) -> str:
    title = f'{config["site"]["name"]} — search'
    description = "Search every page of Beyondia: stories, blog posts, the treatise, the rules and the rest."
    mapping = {
        "head": render_head(config, title, description, SEARCH_PAGE),
        "header": render_header(),
        "footer": render_footer(config),
    }
    return fill(_template("search.html"), mapping, "search.html")


# --------------------------------------------------------------------------
# files for search engines and feed readers
# --------------------------------------------------------------------------

def render_robots(config: Dict[str, Any]) -> str:
    lines = [f"# {GENERATED_MARK} from site.config.json.", "User-agent: *", "Allow: /"]
    if site_url(config):
        lines.append(f"Sitemap: {site_url(config)}{SITEMAP}")
    return "\n".join(lines) + "\n"


def render_sitemap(config: Dict[str, Any], page_names: List[str]) -> str:
    """Every content page, home first. No dates: the clock would make the output differ from run to run."""
    names = sorted((n for n in page_names if n not in UNLISTED), key=lambda n: (n != "index.html", n))
    urls = "\n".join(f"  <url><loc>{esc(safe_url(page_url(config, n)))}</loc></url>" for n in names)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f"<!-- {GENERATED_MARK} from the pages of the site. -->\n"
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{urls}\n"
        "</urlset>\n"
    )


def render_feed(config: Dict[str, Any]) -> str:
    """An Atom feed of the published posts, newest first."""
    base = site_url(config)
    posts = published_posts(config)
    name = config["site"]["name"]
    updated = f"{posts[0]['date']}T00:00:00Z" if posts else EPOCH
    entries = []
    for post in posts:
        link = esc(safe_url(base + post["file"]))
        entries.append(
            "  <entry>\n"
            f"    <title>{esc(post['title'])}</title>\n"
            f'    <link href="{link}"/>\n'
            f"    <id>{link}</id>\n"
            f"    <updated>{post['date']}T00:00:00Z</updated>\n"
            f"    <summary>{esc(post['summary'])}</summary>\n"
            + "".join(f'    <category term="{esc(tag)}"/>\n' for tag in post["tags"])
            + "  </entry>\n"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f"<!-- {GENERATED_MARK} from site.config.json. -->\n"
        '<feed xmlns="http://www.w3.org/2005/Atom">\n'
        f"  <title>{esc(name)} — {esc(config['blog']['title'])}</title>\n"
        f"  <subtitle>{esc(config['blog']['lead'])}</subtitle>\n"
        f'  <link rel="self" href="{esc(safe_url(base + FEED))}"/>\n'
        f'  <link href="{esc(safe_url(base + "blog.html"))}"/>\n'
        f"  <id>{esc(safe_url(base))}</id>\n"
        f"  <updated>{updated}</updated>\n"
        f"  <author><name>{esc(name)}</name></author>\n"
        + "".join(entries)
        + "</feed>\n"
    )


def render_site_files(config: Dict[str, Any], page_names: List[str]) -> Dict[str, str]:
    """The files that depend on the site address. Without an address only robots.txt is produced."""
    files = {ROBOTS: render_robots(config)}
    if site_url(config):
        files[SITEMAP] = render_sitemap(config, page_names)
        files[FEED] = render_feed(config)
    return files


# --------------------------------------------------------------------------
# search index
# --------------------------------------------------------------------------

_SKIP = {"script", "style", "svg", "nav", "header", "footer", "noscript", "template"}
_BLOCK = {"p", "li", "div", "section", "h1", "h2", "h3", "h4", "ul", "ol", "br", "tr", "td", "th", "article", "blockquote"}


class _PageText(HTMLParser):
    """The readable text of one page: only what is inside <main>, without navigation or decoration."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.h1 = ""
        self.headings: List[str] = []
        self.section = ""
        self.parts: List[str] = []
        self._in_title = False
        self._in_main = False
        self._skip = 0
        self._heading: Optional[str] = None
        self._heading_text: List[str] = []
        self._in_header_nav = False
        self._on_link = False

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        a = {k: (v or "") for k, v in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "main":
            self._in_main = True
        if tag == "nav" and a.get("aria-label") == "Main navigation":
            self._in_header_nav = True
        if self._in_header_nav and tag == "a" and (a.get("aria-current") == "page" or a.get("class") == "on"):
            self._on_link = True
        if tag in _SKIP:
            self._skip += 1
        if not self._in_main or self._skip:
            return
        if tag in _BLOCK:
            self.parts.append("\n")
        if tag in ("h1", "h2", "h3"):
            self._heading, self._heading_text = tag, []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "main":
            self._in_main = False
        elif tag == "a":
            self._on_link = False
        if tag in _SKIP and self._skip:
            self._skip -= 1
        if tag == "nav":
            self._in_header_nav = False
        if not self._in_main or self._skip:
            return
        if tag in _BLOCK:
            self.parts.append("\n")
        if tag == self._heading:
            text = " ".join("".join(self._heading_text).split())
            if tag == "h1":
                self.h1 = text
            elif text:
                self.headings.append(text)
            self._heading = None

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        if self._on_link and not self.section:
            self.section = " ".join(data.split()).title()
        if self._in_main and not self._skip:
            self.parts.append(data)
            if self._heading:
                self._heading_text.append(data)


def page_entry(name: str, text: str) -> Dict[str, Any]:
    parser = _PageText()
    parser.feed(text)
    parser.close()
    title = parser.h1 or " ".join(parser.title.split())
    body = " ".join("".join(parser.parts).split())
    return {
        "url": name,
        "title": title,
        "section": parser.section or "Home",
        "headings": parser.headings,
        "text": body[:MAX_INDEXED_CHARS],
    }


def build_search_index(pages: Mapping[str, str]) -> str:
    """``search-index.js``: a script that sets ``window.BEYONDIA_INDEX``.

    A script, not a JSON file, because a page opened from disk may load a
    neighbouring script but may not ``fetch`` a neighbouring file.
    """
    entries = [page_entry(name, pages[name]) for name in sorted(pages) if name.endswith(".html") and name not in UNLISTED]
    lines = []
    for entry in entries:
        encoded = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        lines.append(encoded.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029").replace("</", "<\\/"))
    return (
        f"/* {GENERATED_MARK} from the pages of the site. Edit the pages, not this file. */\n"
        "window.BEYONDIA_INDEX=[\n" + ",\n".join(lines) + "\n];\n"
    )
