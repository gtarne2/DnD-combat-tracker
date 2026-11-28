"""Audit the generated pack against the pinned English CC PDF (requires pdfplumber)."""

import argparse
from pathlib import Path
import re

import pdfplumber

from srd_pdf_audit import CATEGORIES, ROOT, check_manual_rules, column_lines, paired_entries, text_key, verify_pdf

INPUTS = ROOT / "content" / "srd51"
SECTION_NAMES = {
    "monsters": "Monsters",
    "creatures": "Appendix MM-A — Miscellaneous Creatures",
    "npcs": "Appendix MM-B — Nonplayer Characters",
}


def pdf_blocks(path):
    blocks = []
    section = "monsters"
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[259:403]:
            for left, right in ((0, 306), (306, 612)):
                lines = list(column_lines(page, left, right, 760, r"System Reference Document 5\.1 \d+"))
                for i, line in enumerate(lines):
                    text, font, size, color, _ = line
                    if text == "Appendix MM-A:":
                        section = "creatures"
                    elif text == "Appendix MM-B:":
                        section = "npcs"
                    followed_by_ac = any(row[0].startswith("Armor Class ") for row in lines[i + 1:i + 4])
                    if font == "Calibri-Bold" and size == 12 and color[0] > 0 and followed_by_ac:
                        blocks.append((section, page.page_number, text, []))
                    elif blocks:
                        blocks[-1][3].append(line)
            page.close()
    return blocks


def printed_rules(lines):
    after_challenge = next(i for i, line in enumerate(lines) if line[0].startswith("Challenge ")) + 1
    rules = {category: [] for category in ["traits", *CATEGORIES.values()]}
    category = "traits"
    preamble = []
    current = None
    for text, font, size, _, prefix in lines[after_challenge:]:
        if font.startswith(("Gill", "Cambria")) or (size == 12 and font == "Calibri-Bold"):
            break
        if font == "Calibri-Bold" and text in CATEGORIES:
            category = CATEGORIES[text]
            current = None
            continue
        starts_rule = size == 10 and (
            font == "Calibri-BoldItalic"
            or (font == "Calibri-Bold" and prefix.endswith("."))
            or (font == "Calibri-Italic" and prefix in {
                "Forbiddance.", "HarmedbyRunningWater.", "StaketotheHeart.", "SunlightHypersensitivity.",
            })
        )
        if starts_rule:
            current = []
            rules[category].append(current)
        if current is not None:
            current.append(text)
        elif category == "legendary_actions":
            preamble.append(text)
    return rules, " ".join(preamble)


def audit(pdf, pack_path):
    verify_pdf(pdf, INPUTS)
    blocks = pdf_blocks(pdf)
    rule_count = 0
    preamble_count = 0
    for name, lines, stats in paired_entries(INPUTS, pack_path, blocks, SECTION_NAMES, 317):
        ac_start = next(i for i, line in enumerate(lines) if line[0].startswith("Armor Class "))
        hp_start = next(i for i, line in enumerate(lines) if line[0].startswith("Hit Points "))
        ac_line = " ".join(line[0] for line in lines[ac_start:hp_start])
        if stats["defenses"]["ac"] is not None:
            assert stats["defenses"]["ac"] == int(re.match(r"Armor Class (\d+)", ac_line)[1]), name
        else:
            assert stats["defenses"]["conditional_ac"], name
        printed_ac = text_key(ac_line).translate(str.maketrans("", "", "(),"))
        for alternative in stats["defenses"]["conditional_ac"]:
            qualifier = str(alternative["ac"]) + alternative["qualifier"].replace(", ", " ")
            assert text_key(qualifier) in printed_ac, (name, qualifier)
        hp_line = lines[hp_start][0]
        assert stats["hp"] == int(re.match(r"Hit Points ([\d,]+)", hp_line)[1].replace(",", "")), name
        assert text_key("(" + stats["hit_dice"] + ")") in text_key(hp_line), name
        challenge = next(line[0] for line in lines if line[0].startswith("Challenge "))
        expected_challenge = f"Challenge {stats['challenge']} ({stats['details']['xp']} XP)"
        assert text_key(challenge.replace(",", "")) == text_key(expected_challenge), name
        rules, preamble = printed_rules(lines)
        rule_count += check_manual_rules(name, rules, preamble, stats)
        preamble_count += bool(preamble)
    print(f"Matched {len(blocks)} official stat blocks, {rule_count} rules and {preamble_count} legendary preambles.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("pack", type=Path)
    args = parser.parse_args()
    audit(args.pdf, args.pack)
