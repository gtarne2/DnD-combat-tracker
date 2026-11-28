"""Audit the 2024 pack against the pinned English CC PDF (requires pdfplumber)."""

import argparse
from collections import Counter
from pathlib import Path
import re

import pdfplumber

from srd_pdf_audit import CATEGORIES, ROOT, check_manual_rules, column_lines, paired_entries, text_key, verify_pdf


INPUTS = ROOT / "content" / "srd521"
SECTION_NAMES = {"monsters": "Monsters A–Z", "animals": "Animals"}
RULE_SECTIONS = {"Traits": "traits", **CATEGORIES}
ABILITIES = {
    "str": "Strength", "dex": "Dexterity", "con": "Constitution",
    "int": "Intelligence", "wis": "Wisdom", "cha": "Charisma",
}
SCORE_ROW = re.compile(r"(Str|Dex|Con|Int|Wis|Cha)\s*(\d+)\s*([+−-]\d+)\s*([+−-]?\d+)", re.I)
CR_LINE = re.compile(r"([\d/]+) \((?:XP (\d+)(?: or (\d+) in lair)?|(\d+) XP); PB ([+-]?\d+)\)")


def pdf_blocks(path):
    blocks = []
    section = "monsters"
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[257:364]:
            for left, right in ((0, 297), (297, 594)):
                lines = list(column_lines(page, left, right, 748, r"\d+ System Reference Document 5\.2\.1"))
                for i, line in enumerate(lines):
                    text, font, size, _, _ = line
                    if text == "Animals" and size == 26:
                        section = "animals"
                    followed_by_ac = any(re.match(r"AC \d+ Initiative ", row[0]) for row in lines[i + 1:i + 4])
                    if font == "GillSans-SemiBold" and size == 15 and followed_by_ac:
                        blocks.append((section, page.page_number, text, []))
                    elif blocks:
                        blocks[-1][3].append(line)
            page.close()
    assert Counter(block[0] for block in blocks) == {"monsters": 235, "animals": 95}
    return blocks


def printed_rules(lines):
    rules = {category: [] for category in RULE_SECTIONS.values()}
    category = "traits"
    current = None
    preamble = []
    for text, font, size, _, prefix in lines:
        if font == "GillSans" and size == 12 and text in RULE_SECTIONS:
            category = RULE_SECTIONS[text]
            current = None
            continue
        if font.startswith(("GillSans", "Cambria")):
            break
        # Numbered branches, e.g. Gibbering, belong to the preceding rule.
        starts_rule = prefix[:1].isalpha() and (
            font == "Optima-BoldItalic" or (font == "Optima-Bold" and prefix.endswith("."))
        )
        if starts_rule:
            current = []
            rules[category].append(current)
        if current is not None:
            current.append(text)
        elif category == "legendary_actions":
            preamble.append(text)
    return rules, " ".join(preamble)


def header_value(lines, label):
    prefix = label + " "
    index = next((i for i, row in enumerate(lines) if row[0].startswith(prefix)), None)
    if index is None:
        return ""
    values = [lines[index][0][len(prefix):]]
    for text, font, size, _, _ in lines[index + 1:]:
        if font != "Optima-Regular" or size != 9:
            break
        values.append(text)
    return " ".join(values)


def check_header(name, lines, stats):
    details = stats["details"]
    ac = re.fullmatch(r"(\d+) Initiative ([+−-]\d+) \((\d+)\)", header_value(lines, "AC"))
    assert ac is not None, name
    assert stats["defenses"]["ac"] == int(ac[1]), name
    assert details["initiative"] == {"modifier": int(ac[2].replace("−", "-")), "score": int(ac[3])}, name
    hp = re.fullmatch(r"([\d,]+) \((.+)\)", header_value(lines, "HP"))
    assert hp and stats["hp"] == int(hp[1].replace(",", "")) and text_key(stats["hit_dice"]) == text_key(hp[2]), name
    cr = CR_LINE.fullmatch(header_value(lines, "CR").replace(",", ""))
    assert cr, name
    assert (stats["challenge"], details["xp"], details["proficiency_bonus"]) == (cr[1], int(cr[2] or cr[4]), int(cr[5])), name
    lair_xp = f"{int(cr[3]):,} XP in lair" if cr[3] else None
    assert details.get("challenge_notes") == lair_xp, name

    sizes = details.get("sizes", [stats["size"]])
    creature = next(row[0] for row in lines if row[1] == "Optima-Italic")
    assert text_key(creature).startswith(text_key(" or ".join(sizes))), (name, sizes, creature)
    score_rows = [row[0] for row in lines if row[1] == "GillSans-SemiBold-SC700"]
    scores = {}
    saves = {}
    for score_row in score_rows:
        for ab, score, mod, save in SCORE_ROW.findall(score_row):
            ability = ABILITIES[ab.lower()]
            scores[ability] = int(score)
            if save[0] in "+−-":
                saves[ability] = int(save.replace("−", "-"))
            else:
                assert name == "Young White Dragon" and ability == "Intelligence" and save == "2" and mod == "−2"
                assert details.get("saves_text") == "Intelligence SAVE is printed as an unsigned 2 (MOD −2). Resolve at the table."
    assert len(scores) == 6 and scores == stats["abilities"] and saves == stats["saves"], (name, scores, saves)

    defenses = stats["defenses"]
    immunities = "; ".join(part for part in [defenses.get("immunities"), defenses.get("condition_immunities")] if part)
    for label, value in [
        ("Gear", details.get("gear")), ("Speed", stats["speed"]), ("Senses", stats["senses"]),
        ("Languages", stats["languages"]), ("Vulnerabilities", defenses.get("vulnerabilities")),
        ("Resistances", defenses.get("resistances")), ("Immunities", immunities),
    ]:
        # Layout wraps and list delimiters vary. Keep the words, numbers, and their order.
        separators = str.maketrans("", "", ".,;:")
        assert text_key(value or "").translate(separators) == text_key(header_value(lines, label)).translate(separators), (name, label)


def audit(pdf, pack_path):
    verify_pdf(pdf, INPUTS)
    blocks = pdf_blocks(pdf)
    rule_count = 0
    preamble_count = 0
    for name, lines, stats in paired_entries(INPUTS, pack_path, blocks, SECTION_NAMES, 330):
        cr = next(i for i, line in enumerate(lines) if line[0].startswith("CR "))
        check_header(name, lines[:cr + 1], stats)
        rules, preamble = printed_rules(lines[cr + 1:])
        rule_count += check_manual_rules(name, rules, preamble, stats)
        preamble_count += bool(preamble)
    print(f"Matched {len(blocks)} official stat blocks, {rule_count} rules and {preamble_count} legendary preambles.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("pack", type=Path)
    args = parser.parse_args()
    audit(args.pdf, args.pack)
