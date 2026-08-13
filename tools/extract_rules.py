#!/usr/bin/env python3
"""Build data/rules.json from the MMX decision .docx.

Word stores multilevel list numbering in numbering.xml rather than in the
paragraph text, so a naive text dump loses every clause number ("3.9.1", ...).
Those numbers are the citation surface for the whole chatbot, so we resolve the
numbering here and emit one record per clause.

Usage:  python3 tools/extract_rules.py
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source" / "mmx-qerar-3-21-28-3-6-4-2023.docx"
OUT = ROOT / "data" / "rules.json"

DOC_META = {
    "id": "MMX-3-21-28/3-6-4/2023",
    "issuer_az": "Azərbaycan Respublikası Maliyyə Monitorinqi Xidməti",
    "issuer_en": "Financial Monitoring Service of the Republic of Azerbaijan",
    "number": "3-21-28/3-6-4/2023",
    "date": "2023-02-21",
    "title_az": (
        "Müştəri uyğunluğu və yeni texnologiyaların tətbiqi zamanı verifikasiya "
        "tədbirlərinə, risk faktorlarının müəyyən edilməsinə və müştəri profilinin "
        "risk qruplarına aid edilməsinə dair Qaydalar"
    ),
    "title_en": (
        "Rules on customer due diligence and verification measures when applying new "
        "technologies, on the determination of risk factors, and on assigning the "
        "customer profile to risk groups"
    ),
    "parent_law_az": (
        "“Cinayət yolu ilə əldə edilmiş əmlakın leqallaşdırılmasına və terrorçuluğun "
        "maliyyələşdirilməsinə qarşı mübarizə haqqında” Azərbaycan Respublikasının "
        "Qanunu (30 dekabr 2022, № 781-VIQ)"
    ),
    "parent_law_en": (
        "Law of the Republic of Azerbaijan on Combating the Legalisation of "
        "Criminally Obtained Property and the Financing of Terrorism "
        "(30 December 2022, No. 781-VIQ)"
    ),
    "amended_by": [
        "MMX Decision 3-21-28/3-6-4/2024 of 14 June 2024 "
        "(State Register No. 23202406148368)"
    ],
}

# Part headings carried in the document body as unnumbered/level-0 paragraphs.
PART_TITLES = {
    "1": ("Ümumi müddəalar", "General provisions"),
    "2": (
        "Müştəri uyğunluğu tədbirləri çərçivəsində eyniləşdirmə tədbirləri",
        "Identification measures within customer due diligence",
    ),
    "3": (
        "Risk faktorlarının müəyyən edilməsi və müştəri profilinin risk qrupları",
        "Determination of risk factors and customer profile risk groups",
    ),
    "4": (
        "Sadələşdirilmiş müştəri uyğunluğu tədbirləri",
        "Simplified customer due diligence measures",
    ),
    "5": (
        "Gücləndirilmiş müştəri uyğunluğu tədbirləri",
        "Enhanced customer due diligence measures",
    ),
    "6": (
        "Müştəri uyğunluğu tədbirləri çərçivəsində verifikasiya tədbirləri",
        "Verification measures within customer due diligence",
    ),
    "7": (
        "Yeni texnologiyaların tətbiqi zamanı verifikasiya tədbirləri",
        "Verification measures when applying new technologies",
    ),
    "8": (
        "Müştəri uyğunluğu tədbirlərinin davamlı tətbiqi",
        "Ongoing application of customer due diligence measures",
    ),
}

# Topic tags let the retriever boost clauses for common compliance questions and
# let tools address groups of clauses without hardcoding clause numbers.
TOPIC_RULES: list[tuple[str, str]] = [
    (r"^2\.1\.2", "pep"),
    (r"^3\.4", "low-risk-factor,customer"),
    (r"^3\.5", "low-risk-factor,product"),
    (r"^3\.6", "low-risk-factor,channel"),
    (r"^3\.7", "low-risk-factor,geography"),
    (r"^3\.8", "low-risk-factor,transaction"),
    (r"^3\.9", "high-risk-factor,customer"),
    (r"^3\.10", "high-risk-factor,product"),
    (r"^3\.11", "high-risk-factor,channel"),
    (r"^3\.12", "high-risk-factor,geography"),
    (r"^3\.13", "high-risk-factor,transaction"),
    (r"^4\.", "sdd"),
    (r"^5\.", "edd"),
    (r"^6\.", "verification"),
    (r"^7\.", "remote-onboarding,new-technology"),
    (r"^8\.", "ongoing-monitoring,review-cycle"),
]


def load_numbering(z: zipfile.ZipFile):
    """Return (abstract_levels, num_id -> abstract_id)."""
    root = ET.fromstring(z.read("word/numbering.xml"))

    abstract: dict[str, dict[int, dict]] = {}
    for an in root.findall(f"{W}abstractNum"):
        aid = an.get(f"{W}abstractNumId")
        levels = {}
        for lvl in an.findall(f"{W}lvl"):
            ilvl = int(lvl.get(f"{W}ilvl"))
            fmt = lvl.find(f"{W}numFmt")
            txt = lvl.find(f"{W}lvlText")
            start = lvl.find(f"{W}start")
            levels[ilvl] = {
                "fmt": fmt.get(f"{W}val") if fmt is not None else "decimal",
                "text": txt.get(f"{W}val") if txt is not None else "%1.",
                "start": int(start.get(f"{W}val")) if start is not None else 1,
            }
        abstract[aid] = levels

    num_to_abstract = {}
    for n in root.findall(f"{W}num"):
        a = n.find(f"{W}abstractNumId")
        if a is not None:
            num_to_abstract[n.get(f"{W}numId")] = a.get(f"{W}val")

    return abstract, num_to_abstract


def paragraph_text(p) -> str:
    parts = []
    for node in p.iter():
        if node.tag == f"{W}t":
            parts.append(node.text or "")
        elif node.tag == f"{W}tab":
            parts.append(" ")
        elif node.tag == f"{W}br":
            parts.append(" ")
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def main() -> int:
    if not SRC.exists():
        print(f"source document not found: {SRC}", file=sys.stderr)
        return 1

    z = zipfile.ZipFile(SRC)
    abstract, num_to_abstract = load_numbering(z)
    counters: dict[tuple[str, int], int] = {}

    def render_number(num_id: str, ilvl: int) -> str:
        aid = num_to_abstract.get(num_id)
        if aid is None or aid not in abstract:
            return ""
        levels = abstract[aid]
        if ilvl not in levels:
            return ""

        key = (num_id, ilvl)
        counters[key] = counters.get(key, levels[ilvl]["start"] - 1) + 1
        for deeper in [k for k in counters if k[0] == num_id and k[1] > ilvl]:
            del counters[deeper]

        if levels[ilvl]["fmt"] == "none":
            return ""

        def sub(m: re.Match) -> str:
            lv = int(m.group(1)) - 1
            val = counters.get((num_id, lv), levels.get(lv, {}).get("start", 1))
            fmt = levels.get(lv, {}).get("fmt", "decimal")
            if fmt == "bullet":
                return "-"
            if fmt == "lowerLetter":
                return chr(ord("a") + val - 1)
            if fmt == "upperLetter":
                return chr(ord("A") + val - 1)
            return str(val)

        return re.sub(r"%(\d+)", sub, levels[ilvl]["text"])

    doc = ET.fromstring(z.read("word/document.xml"))
    body = doc.find(f"{W}body")

    clauses = []
    annex: list[str] = []
    in_annex = False

    for p in body.findall(f"{W}p"):
        text = paragraph_text(p)
        if not text:
            continue

        number = ""
        ppr = p.find(f"{W}pPr")
        if ppr is not None:
            numpr = ppr.find(f"{W}numPr")
            if numpr is not None:
                nid_el = numpr.find(f"{W}numId")
                ilvl_el = numpr.find(f"{W}ilvl")
                if nid_el is not None and nid_el.get(f"{W}val") != "0":
                    ilvl = int(ilvl_el.get(f"{W}val")) if ilvl_el is not None else 0
                    number = render_number(nid_el.get(f"{W}val"), ilvl)

        if text.startswith("Bu Qaydaların məqsədləri üçün şəxsiyyəti təsdiq edən"):
            in_annex = True
        if text.startswith("İSTİFADƏ OLUNMUŞ MƏNBƏ"):
            in_annex = False
            continue

        if in_annex:
            annex.append(f"{number} {text}".strip() if number else text)
            continue

        if not number:
            continue

        clause_id = number.rstrip(".")
        # Part headings are numbered "4." with the title as their text.
        depth = clause_id.count(".") + 1
        part = clause_id.split(".")[0]
        if depth == 1:
            continue

        topics = []
        for pattern, tags in TOPIC_RULES:
            if re.match(pattern, clause_id):
                topics.extend(tags.split(","))

        clauses.append(
            {
                "id": clause_id,
                "part": part,
                "part_title_az": PART_TITLES.get(part, ("", ""))[0],
                "part_title_en": PART_TITLES.get(part, ("", ""))[1],
                "depth": depth,
                "text": text,
                "topics": sorted(set(topics)),
            }
        )

    payload = {
        "document": DOC_META,
        "parts": [
            {"id": k, "title_az": v[0], "title_en": v[1]}
            for k, v in sorted(PART_TITLES.items(), key=lambda kv: int(kv[0]))
        ],
        "clauses": clauses,
        "annex_identity_documents": annex,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"wrote {OUT.relative_to(ROOT)}: {len(clauses)} clauses, {len(annex)} annex items")
    by_part: dict[str, int] = {}
    for c in clauses:
        by_part[c["part"]] = by_part.get(c["part"], 0) + 1
    for part in sorted(by_part, key=int):
        print(f"  part {part}: {by_part[part]:3d} clauses  {PART_TITLES[part][1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
