// Builds content/mechanics/overlay.json, the tracker's own mechanics overlay, from a local
// 5etools-src checkout plus the hand-reviewed entries in content/mechanics/curated.json.
//
//   node tools/build-mechanics-overlay.cjs <path to 5etools-src>
//
// The overlay holds only mechanics the tracker uses (spell area shape and size, template
// colour) keyed by spell name, rules edition and source book code. It never copies rules
// text: descriptions always come from the player's own imported content. An entry is used
// only when the player's import contains a spell with the same name from a listed book.
"use strict";
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
if (!root) {
  console.error("Usage: node tools/build-mechanics-overlay.cjs <path to 5etools-src>");
  process.exit(2);
}
const data = (file) => JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
const here = path.join(__dirname, "..", "content", "mechanics");
const curated = JSON.parse(fs.readFileSync(path.join(here, "curated.json"), "utf8"));

// Sources that are not D&D rules the tracker supports.
const SKIPPED_SOURCES = new Set(["WoW"]);
// Books written for the 2024 rules. Everything else is treated as 2014.
const EDITION_2024 = new Set(["XPHB", "XDMG", "XMM", "EFA", "FRHoF", "FRAiF", "NF", "LFL", "ABH", "AU", "RHW"]);

const books = {};
for (const list of [data("books.json").book, data("adventures.json").adventure]) {
  for (const book of list) {
    if (SKIPPED_SOURCES.has(book.source)) continue;
    books[book.name] = book.source;
    // Aurora names the 2014 core books without the year.
    const bare = book.name.replace(/ \((2014)\)$/, "");
    if (bare !== book.name) books[bare] = book.source;
  }
}
Object.assign(books, curated.book_aliases || {});

/** {@tag text|source|display} becomes its display text. */
function plain(text) {
  let previous;
  do {
    previous = text;
    text = text.replace(/\{@\w+ ([^{}]*?)\}/g, (_, body) => {
      const parts = body.split("|");
      return (parts.length >= 3 && parts[2]) || parts[0];
    });
  } while (text !== previous);
  return text;
}
function strings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, out));
  return out;
}

const GEOMETRIC = new Set(["S", "C", "N", "Y", "L", "H", "E", "R", "Q", "W"]);
const RANGE_SHAPES = { cone: "cone", line: "line", cube: "cube", emanation: "emanation", radius: "emanation", sphere: "sphere", hemisphere: "sphere" };

function lineWidth(text) {
  const match = text.match(/(\d+) (?:feet|foot) wide/) || text.match(/(\d+)-foot-wide/);
  return match ? Number(match[1]) : 5;
}

/** The area the spell's structured range or its text names, or null when unclear. */
function areaOf(spell, text) {
  const range = spell.range || {};
  const lower = text.toLowerCase();
  const shape = RANGE_SHAPES[range.type];
  if (shape && range.distance?.type === "feet" && range.distance.amount) {
    const area = { shape, size: range.distance.amount };
    if (shape === "line") area.width = lineWidth(lower);
    return area;
  }
  const patterns = [
    [/(\d+)-foot[- ]radius,? (?:\d+-foot-(?:tall|high) )?(sphere|cylinder|emanation|hemisphere)/, (m) => ({ shape: m[2] === "hemisphere" ? "sphere" : m[2], size: +m[1] })],
    [/(\d+)-foot (cone|cube|emanation|sphere|cylinder)/, (m) => ({ shape: m[2], size: +m[1] })],
    [/(\d+)-foot[- ]long,? (?:(\d+)-foot[- ]wide )?line/, (m) => ({ shape: "line", size: +m[1], width: m[2] ? +m[2] : 5 })],
    [/line (\d+) feet long and (\d+) feet wide/, (m) => ({ shape: "line", size: +m[1], width: +m[2] })],
    [/(\d+)-foot line/, (m) => ({ shape: "line", size: +m[1], width: lineWidth(lower) })],
    [/cylinder (?:that is \d+ feet tall )?with an? (\d+)-foot radius/, (m) => ({ shape: "cylinder", size: +m[1] })],
    // A square on the ground draws as a cube of the same side.
    [/(\d+)-foot square/, (m) => ({ shape: "cube", size: +m[1] })],
    [/(\d+)-foot[- ]radius/, (m) => ({ shape: "sphere", size: +m[1] })],
  ];
  for (const [pattern, build] of patterns) {
    const match = lower.match(pattern);
    if (match) return build(match);
  }
  return null;
}

const key = (name, edition) => `${name.toLowerCase()}|${edition}`;
const entries = new Map();
let total = 0;
let unresolved = [];
const index = data("spells/index.json");
for (const file of Object.values(index)) {
  for (const spell of data(path.join("spells", file)).spell) {
    if (SKIPPED_SOURCES.has(spell.source)) continue;
    if (!(spell.areaTags || []).some((tag) => GEOMETRIC.has(tag))) continue;
    total += 1;
    const edition = EDITION_2024.has(spell.source) || spell.basicRules2024 ? "2024" : "2014";
    const sources = [spell.source, ...(spell.otherSources || []).map((s) => s.source), ...(spell.additionalSources || []).map((s) => s.source)];
    const text = plain(strings(spell.entries).join(" "));
    const area = areaOf(spell, text);
    const id = key(spell.name, edition);
    const existing = entries.get(id);
    if (existing) {
      for (const source of sources) if (!existing.sources.includes(source)) existing.sources.push(source);
      continue;
    }
    if (!area) unresolved.push(`${spell.name} (${spell.source})`);
    const entry = { name: spell.name, edition, sources };
    if (area) entry.area = area;
    if (spell.damageInflict?.length) entry.damage_types = [...spell.damageInflict].sort();
    entries.set(id, entry);
  }
}

// Hand-reviewed entries replace or extend the generated ones field by field.
let curatedCount = 0;
for (const fix of curated.spells) {
  const editions = fix.edition === "any" ? ["2014", "2024"] : [fix.edition];
  for (const edition of editions) {
    const id = key(fix.name, edition);
    const base = entries.get(id);
    if (!base && fix.edition === "any") continue;
    const merged = { ...(base || { name: fix.name, edition, sources: fix.sources || [] }) };
    for (const field of ["area", "colour"]) if (fix[field]) merged[field] = fix[field];
    merged.reviewed = true;
    entries.set(id, merged);
    curatedCount += 1;
    unresolved = unresolved.filter((label) => !label.startsWith(`${fix.name} (`) || !merged.area);
  }
}

const spells = [...entries.values()].filter((entry) => entry.area || entry.colour)
  .sort((a, b) => a.name.localeCompare(b.name) || a.edition.localeCompare(b.edition));
const overlay = {
  schema: 1,
  about: "Aurora Combat Tracker mechanics overlay. Names, book codes and measurements only; no rules text. Used only for spells the player has imported.",
  generated_from: "5etools-src data/spells (structure only) and content/mechanics/curated.json",
  damage_colours: curated.damage_colours,
  // Map template looks (textures) for spells whose damage type does not say, by name.
  spell_looks: curated.spell_looks || {},
  books: Object.fromEntries(Object.entries(books).sort(([a], [b]) => a.localeCompare(b))),
  spells,
  // Feature timing, companion variants and companion hit points are hand-written only.
  features: curated.features || [],
  summons: curated.summons || [],
  companions: curated.companions || [],
  // Stat changes of buff spells such as Longstrider (R79), hand-written only.
  buffs: curated.buffs || [],
  // Summon spells such as Summon Beast (R82): numbers by slot level, built once from the
  // bestiary's summonedBySpell records and kept by hand in curated.json.
  spell_summons: curated.spell_summons || [],
};
fs.writeFileSync(path.join(here, "overlay.json"), JSON.stringify(overlay, null, 1) + "\n");
console.log(`${total} area spells, ${spells.length} overlay entries (${curatedCount} reviewed by hand).`);
if (unresolved.length) console.log(`No area found for ${unresolved.length}: ${unresolved.join(", ")}`);
