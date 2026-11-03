"""Integrity checks over the real HTML files of the site.

These catch the mistakes that are invisible on one page and expensive on a
hundred: a link to a page that does not exist, a navigation that differs
between pages, a fonts link that asks for fonts the stylesheet no longer uses.
"""

from __future__ import annotations

import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import urlsplit

from .render import NAV

CSS_NAME = "beyondia.css"
REQUIRED_FILES = ("404.html", "search.html", "robots.txt", "logo.svg", "og-image.png", "beyondia.js", "search-index.js")
DESCRIPTION_MAX = 200
THIRD_PARTY_FONT_HOSTS = ("fonts.googleapis.com", "fonts.gstatic.com")
# (text colour token, background token, minimum contrast, what it is). WCAG AA is 4.5 for normal text and 3
# for large text; the bands (ticker) only carry large text.
CONTRAST_PAIRS = (
    ("c-fg", "c-bg", 4.5, "text on a section"),
    ("c-mute", "c-bg", 4.5, "muted text on a section"),
    ("c-fg", "c-alt", 4.5, "text on an alternate section"),
    ("c-mute", "c-alt", 4.5, "muted text on an alternate section"),
    ("d-fg", "d-bg", 4.5, "text on a band"),
    ("d-mute", "d-bg", 4.5, "muted text on a band"),
    ("d-lead", "d-bg", 4.5, "lead text on a band"),
    ("accent-ink", "accent", 4.5, "label text on the accent"),
    ("band-ink", "band", 3.0, "large text on the ticker"),
)
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
        self.metas: Dict[str, str] = {}       # name or property -> content
        self.scripts: List[str] = []          # <script src>
        self.preloads: List[str] = []         # <link rel=preload href>
        self.icons: List[str] = []            # <link rel=icon href>
        self.uses: List[str] = []             # <use href="#id">
        self.all_ids: List[str] = []          # every id, with repeats
        self.img_attrs: List[Dict[str, str]] = []
        self.main_count = 0
        self.skip_link = False
        self.current_count = 0                # links marked aria-current="page"
        self.lang = ""
        self.navs: Dict[str, List[str]] = {}  # aria-label -> hrefs inside it
        self._in_title = False
        self._nav: Optional[str] = None

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        a = {k: (v or "") for k, v in attrs}
        if "id" in a:
            self.ids.add(a["id"])
            self.all_ids.append(a["id"])
        if tag == "html":
            self.lang = a.get("lang", "")
        elif tag == "meta":
            key = a.get("name") or a.get("property")
            if key:
                self.metas[key] = a.get("content", "")
        elif tag == "script" and "src" in a:
            self.scripts.append(a["src"])
        elif tag == "main":
            self.main_count += 1
        elif tag == "use" and a.get("href", "").startswith("#"):
            self.uses.append(a["href"][1:])
        if tag == "a" and a.get("aria-current") == "page":
            self.current_count += 1
        if tag == "a" and a.get("class") == "skip" and a.get("href") == "#main":
            self.skip_link = True
        if tag == "link" and a.get("rel", "").lower() == "preload" and "href" in a:
            self.preloads.append(a["href"])
        elif tag == "link" and a.get("rel", "").lower() == "icon" and "href" in a:
            self.icons.append(a["href"])
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
            self.img_attrs.append(a)
        elif tag == "source" and "srcset" in a:
            self.images.append(a["srcset"].split()[0])

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


def css_font_faces(css_text: str) -> Dict[str, List[str]]:
    """family -> the font files its @font-face rules point to."""
    faces: Dict[str, List[str]] = {}
    for block in re.finditer(r"@font-face\s*\{([^}]*)\}", css_text):
        body = block.group(1)
        family = re.search(r"font-family\s*:\s*['\"]?([^;'\"]+)['\"]?\s*[;}]?", body)
        files = re.findall(r"url\(\s*['\"]?([^)'\"]+)['\"]?\s*\)", body)
        if family:
            faces.setdefault(family.group(1).strip(), []).extend(files)
    return faces


def css_tokens(css_text: str) -> Dict[str, Dict[str, str]]:
    """Colour tokens (--name: #hex) of each theme: 'classic' is the :root block, 'light' the light theme's."""
    themes: Dict[str, Dict[str, str]] = {}
    for theme, selector in (("classic", r":root\s*\{"), ("light", r':root\[data-theme="light"\]\s*\{')):
        block = re.search(selector + r"([^}]*)\}", css_text)
        if block:
            themes[theme] = {m.group(1): m.group(2).upper()
                             for m in re.finditer(r"--([a-z-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b", block.group(1))}
    return themes


def _luminance(hex_color: str) -> float:
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast_ratio(a: str, b: str) -> float:
    """WCAG contrast ratio of two #RRGGBB colours (1 to 21)."""
    high, low = sorted((_luminance(a), _luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def check_contrast(css_text: str) -> List[str]:
    """Every theme's text colours against their backgrounds, per WCAG AA."""
    problems: List[str] = []
    themes = css_tokens(css_text)
    for theme in ("classic", "light"):
        tokens = themes.get(theme)
        if tokens is None:
            problems.append(f"{CSS_NAME}: the {theme} theme's colour tokens are missing")
            continue
        merged = dict(themes.get("classic", {}), **tokens)   # the light theme only overrides what differs
        for fg, bg, minimum, what in CONTRAST_PAIRS:
            if fg not in merged or bg not in merged:
                problems.append(f"{CSS_NAME}: {theme} theme has no --{fg if fg not in merged else bg} token")
                continue
            ratio = contrast_ratio(merged[fg], merged[bg])
            if ratio < minimum:
                problems.append(f"{CSS_NAME}: {theme} theme: {what} has contrast {ratio:.2f}:1 ({merged[fg]} on {merged[bg]}), needs {minimum}:1")
    return problems


def _is_external(url: str) -> bool:
    return urlsplit(url).scheme.lower() in EXTERNAL_SCHEMES


def check_site(site_dir: Path, strict: bool = False) -> List[str]:
    """Return every integrity problem found; an empty list means healthy.

    ``strict`` adds the checks that are about quality, not breakage (two pages with the same title or
    description): CI and ``bm check`` use it, publishing does not, so a copied page never blocks a publish.
    """
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

        for resource in info.stylesheets + info.preloads + info.scripts + info.icons:
            if any(host in resource for host in THIRD_PARTY_FONT_HOSTS):
                problems.append(f"{name}: asks a third party for fonts ({resource}); the fonts are self-hosted")
        for resource in info.preloads + info.scripts + info.icons:
            if not (_is_external(resource) or resource.startswith("data:")) and not (site_dir / urlsplit(resource).path).is_file():
                problems.append(f"{name}: file not found: {resource}")
        problems += _check_page_quality(name, info)

    problems += _check_site_wide(site_dir, infos, css_path, strict)
    return problems


def _check_page_quality(name: str, info: PageInfo) -> List[str]:
    """What every page needs for search engines, sharing, keyboards and screen readers."""
    problems: List[str] = []
    description = info.metas.get("description", "").strip()
    if not description:
        problems.append(f"{name}: has no meta description")
    elif len(description) > DESCRIPTION_MAX:
        problems.append(f"{name}: the meta description has {len(description)} characters (at most {DESCRIPTION_MAX})")
    for key in ("og:title", "og:description"):
        if not info.metas.get(key):
            problems.append(f"{name}: has no {key}")
    if info.lang != "en":
        problems.append(f"{name}: <html> needs lang=\"en\"")
    if "viewport" not in info.metas:
        problems.append(f"{name}: has no viewport meta")
    if not info.icons:
        problems.append(f"{name}: has no icon link")
    if info.main_count != 1 or "main" not in info.ids:
        problems.append(f"{name}: must have exactly one <main id=\"main\"> (has {info.main_count})")
    if not info.skip_link:
        problems.append(f"{name}: has no \"Skip to content\" link to #main")
    if info.current_count > 1:
        problems.append(f"{name}: more than one link is marked aria-current=\"page\"")
    repeated = sorted(i for i, n in Counter(info.all_ids).items() if n > 1)
    if repeated:
        problems.append(f"{name}: id used more than once: {', '.join(repeated)}")
    for use in info.uses:
        if use not in info.ids:
            problems.append(f"{name}: <use href=\"#{use}\"> points to nothing on the page")
    for attrs in info.img_attrs:
        src = attrs.get("src", "")
        if "alt" not in attrs:
            problems.append(f"{name}: image {src} has no alt text (use alt=\"\" if it is decoration)")
        if not (attrs.get("width") and attrs.get("height")):
            problems.append(f"{name}: image {src} has no width and height (the page jumps while it loads)")
    if "beyondia.js" not in [urlsplit(s).path for s in info.scripts]:
        problems.append(f"{name}: does not load beyondia.js")
    return problems


def _check_site_wide(site_dir: Path, infos: Dict[str, PageInfo], css_path: Path, strict: bool) -> List[str]:
    problems: List[str] = []
    for required in REQUIRED_FILES:
        if not (site_dir / required).is_file():
            problems.append(f"{required}: file is missing")

    titles: Dict[str, List[str]] = {}
    descriptions: Dict[str, List[str]] = {}
    for name, info in infos.items():
        titles.setdefault(info.title.strip(), []).append(name)
        descriptions.setdefault(info.metas.get("description", "").strip(), []).append(name)
    for label, groups in (("title", titles), ("meta description", descriptions)):
        for text, names in groups.items():
            if strict and text and len(names) > 1:
                problems.append(f"{', '.join(names)}: share the same {label} ({text[:50]!r})")

    if css_path.exists():
        css_text = css_path.read_text(encoding="utf-8")
        faces = css_font_faces(css_text)
        for family in css_font_families(css_text):
            files = faces.get(family)
            if not files:
                problems.append(f"{CSS_NAME}: the stylesheet uses font '{family}' but has no @font-face for it")
                continue
            for file in files:
                if not (site_dir / urlsplit(file).path).is_file():
                    problems.append(f"{CSS_NAME}: font file not found: {file}")
        if any(host in css_text for host in THIRD_PARTY_FONT_HOSTS):
            problems.append(f"{CSS_NAME}: loads fonts from a third party; the fonts are self-hosted")
        problems += check_contrast(css_text)

    sitemap = site_dir / "sitemap.xml"
    if sitemap.is_file():
        listed = set(re.findall(r"<loc>([^<]*)</loc>", sitemap.read_text(encoding="utf-8")))
        listed_names = {urlsplit(loc).path.rsplit("/", 1)[-1] or "index.html" for loc in listed}
        for name in infos:
            if name not in ("404.html", "search.html") and name not in listed_names:
                problems.append(f"sitemap.xml: does not list {name} (run `bm build`)")
    return problems
