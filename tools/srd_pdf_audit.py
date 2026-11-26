"""Shared text and inventory checks for the pinned SRD PDFs."""

import csv
import hashlib
import json
from pathlib import Path
import re
from unicodedata import normalize


ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {
    "Actions": "actions",
    "Bonus Actions": "bonus_actions",
    "Reactions": "reactions",
    "Legendary Actions": "legendary_actions",
}
DASHES = str.maketrans({"‐": "-", "‑": "-", "−": "-", "–": "-", "’": "'", "‘": "'", "“": '"', "”": '"'})


def text_key(text):
    # Ignore layout whitespace, typographic dash/quote variants and letter hyphenation.
    text = normalize("NFKC", text.replace("\xad", "")).translate(DASHES).lower()
    text = re.sub(r"-+", "-", re.sub(r"\s+", "", text))
    return re.sub(r"(?<=[a-z])-(?=[a-z])", "", text)


def column_lines(page, left, right, bottom, footer):
    for line in page.crop((left, 0, right, bottom)).extract_text_lines(return_chars=True):
        text = line["text"].strip()
        chars = [char for char in line["chars"] if char["text"].strip()]
        if not chars or re.fullmatch(footer, text):
            continue
        first = chars[0]
        prefix = []
        for char in chars:
            if char["fontname"] != first["fontname"]:
                break
            prefix.append(char["text"])
        yield text, first["fontname"].split("+")[-1], round(first["size"]), first["non_stroking_color"], "".join(prefix)


def verify_pdf(path, inputs):
    pin = json.loads((inputs / "inputs.json").read_text(encoding="utf-8"))
    assert hashlib.sha256(path.read_bytes()).hexdigest() == pin["official_pdf"]["sha256"], "Unexpected PDF revision"


def paired_entries(inputs, pack_path, blocks, section_names, count):
    with (inputs / "entries.tsv").open(encoding="utf-8") as ledger:
        entries = list(csv.DictReader(ledger, delimiter="\t"))
    monsters = json.loads(pack_path.read_text(encoding="utf-8"))["monsters"]
    assert len(blocks) == len(entries) == len(monsters) == count
    for (section, page, heading, lines), entry, monster in zip(blocks, entries, monsters, strict=True):
        name = entry["official-entry"]
        assert (entry["section"], int(entry["page"]), text_key(name)) == (section, page, text_key(heading)), (name, page, heading)
        locator = monster["source_locator"]
        assert (monster["name"], monster["id"], locator["entry_id"], locator["page"], locator["section"]) == (
            name, entry["borealis-id"], entry["borealis-id"], page, section_names[section]
        ), name
        yield name, lines, monster["stats"]


def check_manual_rules(name, rules, preamble, stats):
    rule_count = 0
    for category, printed in rules.items():
        assert len(printed) == len(stats[category]), (name, category, len(printed), len(stats[category]))
        for official, rule in zip(printed, stats[category], strict=True):
            assert text_key(" ".join(official)) == text_key(rule["name"] + ". " + rule["text"]), (name, rule["name"])
            assert set(rule) == {"id", "name", "text"}, (name, rule["name"], "unexpected structured mechanics")
            rule_count += 1
    assert text_key(preamble) == text_key(stats["details"].get("legendary_preamble", "")), name
    return rule_count
