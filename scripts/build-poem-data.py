#!/usr/bin/env python3
"""Build the checked-in, one-line poem lists from their cited public sources."""

from __future__ import annotations

import csv
import io
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
TEI_NS = "http://www.tei-c.org/ns/1.0"
NS = {"tei": TEI_NS}
XML_NS = "http://www.w3.org/XML/1998/namespace"

# Pin the transcription to the reviewed upstream revision; update deliberately.
KOKIN_REF = "a9bdc1b934621f5458531d974588c53515d42544"
KOKIN_XML_URL = (
    "https://raw.githubusercontent.com/kokubunken/kokinwakashu/"
    f"{KOKIN_REF}/Kokinwakashu_200003050_20240922.xml"
)
SHIKI_CSV_BASE = (
    "https://www.city.matsuyama.ehime.jp/shisei/opendata/metadata/"
    "shikihaiku.files/"
)
SHIKI_FILES = (
    "haru.csv",
    "natsu.csv",
    "aki.csv",
    "huyu.csv",
    "sinsyun.csv",
    "zatsu.csv",
)
KOKIN_SUFFIX = " — {author}〔古今集・国文研〕"
SHIKI_SUFFIX = " — 正岡子規〔松山市・子規俳句〕"
CHAT_MAX = 60


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "potalk-cli-poem-data-builder"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def one_line(value: str) -> str:
    value = re.sub(r"[\x00-\x1f\x7f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def chosen_tei_text(element: ET.Element) -> str:
    """Read literal text, selecting only the edition's <lem> inside <app>."""
    pieces: list[str] = []

    def visit(node: ET.Element) -> None:
        tag = node.tag.rsplit("}", 1)[-1]
        if tag in {"note", "pb", "lb"}:
            return
        if tag == "app":
            lemma = node.find("tei:lem", NS)
            if lemma is not None:
                visit(lemma)
            return
        if node.text:
            pieces.append(node.text)
        for child in node:
            visit(child)
            if child.tail:
                pieces.append(child.tail)

    visit(element)
    return one_line("".join(pieces))


def author_for(div: ET.Element, line: ET.Element) -> str | None:
    for note in div.findall('./tei:note[@type="作者名"]', NS):
        for person in note.findall('.//tei:persName[@type="作者"]', NS):
            references = [ref[1:] for ref in (person.get("corresp") or "").split() if ref.startswith("#")]
            if references:
                return one_line("・".join(references))
            label = chosen_tei_text(person)
            if label:
                return label
    # The TEI line's resp points to the transcribed author where no display note is present.
    references = [ref[1:] for ref in (line.get("resp") or "").split() if ref.startswith("#")]
    if references:
        return one_line("・".join(references))
    return None


def build_waka() -> tuple[list[dict[str, str]], dict[str, int]]:
    root = ET.fromstring(download(KOKIN_XML_URL))
    entries: list[dict[str, str]] = []
    counts = {"divisions": 0, "not_single_line": 0, "empty_text": 0, "missing_author": 0, "over_limit": 0}
    for div in root.findall('.//tei:div[@type="和歌"]', NS):
        counts["divisions"] += 1
        lines = div.findall("./tei:l", NS)
        if len(lines) != 1:
            counts["not_single_line"] += 1
            continue
        line = lines[0]
        text = chosen_tei_text(line)
        author = author_for(div, line)
        if not text:
            counts["empty_text"] += 1
            continue
        if not author:
            counts["missing_author"] += 1
            continue
        message = text + KOKIN_SUFFIX.format(author=author)
        if len(message) > CHAT_MAX or "\n" in message:
            counts["over_limit"] += 1
            continue
        entries.append({"id": line.get("n", ""), "text": text, "author": author})
    return entries, counts


def build_haiku() -> tuple[list[dict[str, str]], dict[str, int]]:
    entries: list[dict[str, str]] = []
    counts = {"rows": 0, "empty": 0, "over_limit": 0}
    for filename in SHIKI_FILES:
        source = download(SHIKI_CSV_BASE + filename).decode("utf-8-sig")
        for row in csv.DictReader(io.StringIO(source, newline="")):
            counts["rows"] += 1
            text = one_line(row.get("俳句") or "")
            if not text:
                counts["empty"] += 1
                continue
            message = text + SHIKI_SUFFIX
            if len(message) > CHAT_MAX or "\n" in message:
                counts["over_limit"] += 1
                continue
            entries.append({
                "id": f"{filename}:{row.get('番号', '')}",
                "text": text,
                "author": "正岡子規",
                "season": one_line(row.get("季節") or ""),
            })
    return entries, counts


def write_json(name: str, entries: list[dict[str, str]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / name).write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    waka, waka_counts = build_waka()
    haiku, haiku_counts = build_haiku()
    write_json("kokin-wakashu.json", waka)
    write_json("shiki-haiku.json", haiku)
    print(f"kokin-wakashu.json: {len(waka)} entries; {waka_counts}")
    print(f"shiki-haiku.json: {len(haiku)} entries; {haiku_counts}")
    print("Sources: pinned NIJL TEI revision and the six official Matsuyama CSV files.")


if __name__ == "__main__":
    main()
