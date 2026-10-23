"""The plain-text form of a story body, and the conversion both ways.

The stored form is a list of typed blocks (what validation and rendering use);
the text form is what a person types. See PLAN.md section 13.2 for the table of
syntax. ``parse`` and ``dump`` are exact inverses: ``parse(dump(blocks)) == blocks``.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from .errors import EditError

Block = Dict[str, Any]

SPECIAL = "#>[+\\"
VERSE_RE = re.compile(r"^\[([0-9A-Za-z.:-]{1,12})\][ \t]+(.*)$")


def _unescape(line: str) -> str:
    if len(line) >= 2 and line[0] == "\\" and line[1] in SPECIAL:
        return line[1:]
    return line


def _escape(text: str) -> str:
    return "\\" + text if text and text[0] in SPECIAL else text


def _blocks_of_lines(text: str) -> List[Tuple[int, List[str]]]:
    """Split on blank lines; return (first line number, stripped lines) per block."""
    blocks: List[Tuple[int, List[str]]] = []
    current: List[str] = []
    start = 0
    for number, raw in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), 1):
        line = raw.strip()
        if not line:
            if current:
                blocks.append((start, current))
                current = []
            continue
        if current and (line == "+" or line.startswith("+ ")):
            blocks.append((start, current))       # "+ text" always starts a new paragraph of a verse
            current = []
        if not current:
            start = number
        current.append(line)
    if current:
        blocks.append((start, current))
    return blocks


def parse(text: str) -> List[Block]:
    """Turn the text form into blocks, or raise EditError naming the line."""
    if not isinstance(text, str):
        raise EditError("the story body must be text")
    result: List[Block] = []
    for number, lines in _blocks_of_lines(text):
        first = lines[0]

        def body_after(prefix_len: int) -> str:
            return " ".join([first[prefix_len:].strip()] + lines[1:]).strip()

        if first.startswith("## "):
            result.append({"type": "heading", "text": body_after(3)})
        elif first.startswith("# "):
            result.append({"type": "chapter", "text": body_after(2)})
        elif first.startswith(">"):
            result.append({"type": "note", "text": body_after(1)})
        elif first.startswith("+") and (len(first) == 1 or first[1] in " \t"):
            if not result or result[-1]["type"] != "verse":
                raise EditError(f"line {number}: '+' continues a verse, but no verse comes before it")
            result[-1]["paras"].append(body_after(1))
        else:
            match = VERSE_RE.match(first)
            if match:
                text_ = " ".join([match.group(2).strip()] + lines[1:]).strip()
                result.append({"type": "verse", "ref": match.group(1), "paras": [text_]})
            elif first[0] in "#>" and first.rstrip("#> ") == "":
                raise EditError(f"line {number}: a marker with no text after it")
            else:
                result.append({"type": "p", "text": " ".join([_unescape(first)] + lines[1:])})
        last = result[-1]
        if last["type"] in ("heading", "chapter", "note", "p") and not last["text"]:
            raise EditError(f"line {number}: this block has no text")
        if last["type"] == "verse" and not all(last["paras"]):
            raise EditError(f"line {number}: this verse has no text")
    return result


def dump(blocks: List[Block]) -> str:
    """Turn blocks into the text form (blocks separated by a blank line)."""
    out: List[str] = []
    for block in blocks:
        kind = block["type"]
        if kind == "p":
            out.append(_escape(block["text"]))
        elif kind == "note":
            out.append("> " + block["text"])
        elif kind == "heading":
            out.append("## " + block["text"])
        elif kind == "chapter":
            out.append("# " + block["text"])
        elif kind == "verse":
            out.append(f"[{block['ref']}] {block['paras'][0]}")
            out.extend("+ " + extra for extra in block["paras"][1:])
        else:
            raise EditError(f"unknown block type: {kind}")
    return "\n\n".join(out) + ("\n" if out else "")


def summary(blocks: List[Block]) -> str:
    counts = {"p": 0, "note": 0, "heading": 0, "chapter": 0, "verse": 0}
    for block in blocks:
        counts[block["type"]] = counts.get(block["type"], 0) + 1
    paragraphs = counts["p"] + counts["note"]
    parts = [f"{paragraphs} paragraph(s)"]
    for key, label in (("heading", "heading(s)"), ("chapter", "chapter(s)"), ("verse", "verse(s)")):
        if counts[key]:
            parts.append(f"{counts[key]} {label}")
    return ", ".join(parts)
