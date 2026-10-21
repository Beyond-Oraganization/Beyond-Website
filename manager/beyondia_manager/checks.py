"""Integrity checks over the real HTML files of the site.

These catch the mistakes that are invisible on one page and expensive on a
hundred: a link to a page that does not exist, a navigation that differs
between pages, a fonts link that asks for fonts the stylesheet no longer uses.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import unquote, urlsplit

from .render import NAV

CSS_NAME = "beyondia.css"
MAIN_NAV = "Main navigation"
FOOTER_NAV = "Footer navigation"
EXTERNAL_SCHEMES = ("http", "https", "mailto", "tel")


class PageInfo(HTMLParser):
    """Collects what the checks need from one page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: Set[str] = set()
        self.links: List[str] = []            # <a href>
        self.stylesheets: List[str] = []      # <link rel=stylesheet href>
        self.images: List[str] = []           # <img src>
        self.title = ""
        self.h1_count = 0
        self.navs: Dict[str, List[str]] = {}  # aria-label -> hrefs inside it
        self._in_title = False
        self._nav: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "title":
            self._in_title = True
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "nav":
            self._nav = a.get("aria-label", "")
            self.navs.setdefault(self._nav, [])
        elif tag == "a" and "href" in a:
            self.links.append(a["href"])
            if self._nav is not None:
                self.navs[self._nav].append(a["href"])
        elif tag == "link" and a.get("rel", "").lower() == "stylesheet" and "href" in a:
            self.stylesheets.append(a["href"])
        elif tag == "img" and "src" in a:
            self.images.append(a["src"])

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "nav":
            self._nav = None

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def parse_page(path: Path) -> PageInfo:
    info = PageInfo()
    info.feed(path.read_text(encoding="utf-8"))
    info.close()
    return info


def css_font_families(css_text: str) -> List[str]:
    """First (quoted) family of each ``--f-*`` variable in ``:root``."""
    families: List[str] = []
    root = re.search(r":root\s*\{([^}]*)\}", css_text)
    if not root:
        return families
    for match in re.finditer(r"--f-[a-z]+\s*:\s*([^;]+);?", root.group(1)):
        first = match.group(1).split(",")[0].strip().strip("'\"")
        if first:
            families.append(first)
    return families


def google_font_families(href: str) -> List[str]:
    families = []
    for part in urlsplit(href).query.split("&"):
        if part.startswith("family="):
            name = unquote(part[len("family="):].split(":")[0].replace("+", " "))
            families.append(name)
    return families


def _is_external(url: str) -> bool:
    return urlsplit(url).scheme.lower() in EXTERNAL_SCHEMES


def check_site(site_dir: Path) -> List[str]:
    """Return every integrity problem found; an empty list means healthy."""
    site_dir = Path(site_dir)
    problems: List[str] = []
    pages = sorted(site_dir.glob("*.html"))
    if not pages:
        return [f"{site_dir}: no .html pages found"]

    infos: Dict[str, PageInfo] = {}
    for page in pages:
        try:
            infos[page.name] = parse_page(page)
        except (OSError, UnicodeDecodeError) as error:
            problems.append(f"{page.name}: cannot be read ({error})")

    expected_nav = [href for _key, _label, href in NAV]
    css_path = site_dir / CSS_NAME
    css_families = css_font_families(css_path.read_text(encoding="utf-8")) if css_path.exists() else []
    if not css_path.exists():
        problems.append(f"{CSS_NAME}: file is missing")

    for name, info in infos.items():
        if not info.title.strip():
            problems.append(f"{name}: has no <title>")
        if info.h1_count != 1:
            problems.append(f"{name}: must have exactly one <h1> (has {info.h1_count})")

        for resource in info.stylesheets + info.images:
            if _is_external(resource) or resource.startswith("data:"):
                continue
            if not (site_dir / urlsplit(resource).path).is_file():
                problems.append(f"{name}: file not found: {resource}")

        for link in info.links:
            if _is_external(link):
                continue
            parts = urlsplit(link)
            if parts.scheme:
                problems.append(f"{name}: unsupported link scheme: {link}")
                continue
            target_name = parts.path or name
            target = site_dir / target_name
            if not target.is_file():
                problems.append(f"{name}: broken link: {link}")
                continue
            if parts.fragment and target_name.endswith(".html"):
                target_info = infos.get(target_name)
                if target_info is not None and parts.fragment not in target_info.ids:
                    problems.append(f"{name}: anchor #{parts.fragment} does not exist in {target_name}")

        for label in (MAIN_NAV, FOOTER_NAV):
            hrefs = info.navs.get(label)
            if hrefs is None:
                problems.append(f"{name}: missing navigation '{label}'")
            elif hrefs != expected_nav:
                problems.append(f"{name}: navigation '{label}' differs from the site navigation: {hrefs}")

        font_links = [h for h in info.stylesheets if "fonts.googleapis.com" in h]
        if not font_links:
            problems.append(f"{name}: no Google Fonts link")
        else:
            loaded = {f for h in font_links for f in google_font_families(h)}
            for family in css_families:
                if family not in loaded:
                    problems.append(f"{name}: the stylesheet uses font '{family}' but the page does not load it")
    return problems
