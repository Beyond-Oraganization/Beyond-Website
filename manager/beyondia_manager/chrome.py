"""Keeping the shared parts of hand-written pages in step.

Some pages (the treatise, the rules, the community page ...) are written by
hand and are not generated from the config. They still share the head, the
header (navigation, theme toggle, search) and the footer with every other
page. ``sync_page`` rebuilds exactly those three parts and leaves everything
between the header and the footer untouched, so changing the navigation, the
icon or a script means editing one template and running ``bm build``, not
editing twenty files.

A page is only touched if it has the expected shape (a header, a footer, and
nothing after the footer but the closing tags). Anything else is left alone
and the integrity checks report it.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from .render import (
    GENERATED_MARK, NAV, SYNCED_NOTE, _template, describe, fill, render_footer, render_head, render_header,
)

_TITLE = re.compile(r"<title>(.*?)</title>", re.S)
_DESCRIPTION = re.compile(r'<meta name="description" content="([^"]*)"')
_LEAD = re.compile(r'<p class="lead[^"]*"[^>]*>(.*?)</p>', re.S)
_TAGS = re.compile(r"<[^>]+>")
_ON = re.compile(r'<a href="([^"]+)" class="on"')
_MAIN_OPEN = re.compile(r"^<main\b[^>]*>\s*")
_MAIN_CLOSE = re.compile(r"\s*</main>$")
_TAIL = re.compile(r"</footer>\s*</div>\s*</body>\s*</html>\s*$")


def is_handwritten(text: str) -> bool:
    """True for a page that is not generated: it lacks the generated-page comment."""
    return GENERATED_MARK not in text[:2000]


def _text(fragment: str) -> str:
    return " ".join(html.unescape(_TAGS.sub("", fragment)).split())


def sync_page(config: Dict[str, Any], name: str, text: str) -> Optional[str]:
    """The page with a fresh head, header and footer, or None if its shape is not recognised."""
    title_match = _TITLE.search(text)
    header_end = text.find("</header>")
    footer_start = text.rfind("<footer")
    if not title_match or header_end == -1 or footer_start == -1 or footer_start < header_end:
        return None
    if not _TAIL.search(text[footer_start:]):
        return None

    title = html.unescape(title_match.group(1)).strip()
    description_match = _DESCRIPTION.search(text)
    if description_match:
        description = html.unescape(description_match.group(1))
    else:
        lead = _LEAD.search(text[header_end:footer_start])
        description = describe(_text(lead.group(1))) if lead else title

    on = _ON.search(text[:header_end])
    current = next((key for key, _label, href in NAV if on and href == on.group(1)), "")

    content = text[header_end + len("</header>"):footer_start].strip()
    content = _MAIN_CLOSE.sub("", _MAIN_OPEN.sub("", content)).strip()

    mapping = {
        "head": render_head(config, title, description, name, note=SYNCED_NOTE),
        "header": render_header(current),
        "content": content,
        "footer": render_footer(config),
    }
    return fill(_template("handwritten.html"), mapping, "handwritten.html")


def sync_handwritten(site_dir: Path, config: Dict[str, Any], skip: Mapping[str, str]) -> Dict[str, str]:
    """Synced text of every hand-written page in the folder that is not already a generated page (``skip``)."""
    result: Dict[str, str] = {}
    for path in sorted(Path(site_dir).glob("*.html")):
        if path.name in skip or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if not is_handwritten(text):
            continue
        synced = sync_page(config, path.name, text)
        if synced is not None:
            result[path.name] = synced
    return result


def synced_names(site_dir: Path, config: Dict[str, Any], skip: Mapping[str, str]) -> List[str]:
    """Names of the hand-written pages the build keeps in step: those with the shape ``sync_page`` knows.

    Only these are managed (and so published with the rest of the site). A hand-written page with another
    shape is left completely alone, and ``bm check`` reports what it lacks.
    """
    return sorted(sync_handwritten(site_dir, config, skip))
