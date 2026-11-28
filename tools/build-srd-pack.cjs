const assert = require("node:assert/strict");
const {createHash} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const categories = ["traits","actions","bonus_actions","reactions","legendary_actions"];
const abilities = {str:"Strength",dex:"Dexterity",con:"Constitution",int:"Intelligence",wis:"Wisdom",cha:"Charisma"};
const license = {name:"Creative Commons Attribution 4.0 International (CC BY 4.0)",
  url:"https://creativecommons.org/licenses/by/4.0/legalcode"};
const modifications = "Borealis structured the SRD stat blocks. Aurora Combat Tracker adapted that data to its pack format, normalized display text, and restored selected labels and rule boundaries using the official PDF. Action rules are for manual adjudication.";
const upstreamNotice = "The upstream pack notice records normalization of hyphenation and line breaks. The CC BY 4.0 Section 5 disclaimer of warranties and limitation of liability applies.";

function readPinnedFiles(input, manifest) {
  return Object.fromEntries(Object.entries(manifest.files).map(([filename,expected]) => {
    const bytes = fs.readFileSync(path.join(input,"upstream",filename));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash,expected,"Pinned Borealis file changed: " + filename);
    return [filename,bytes.toString("utf8")];
  }));
}

function readEntries(input, sectionInfo) {
  const [heading,...lines] = fs.readFileSync(path.join(input,"entries.tsv"),"utf8").trimEnd().split(/\r?\n/);
  assert.equal(heading,"section\tpage\tofficial-entry\tborealis-id");
  const entries = lines.map(line => {
    const [section,page,name,id,...remainder] = line.split("\t");
    assert.ok(Object.hasOwn(sectionInfo,section) && /^\d+$/.test(page) && name && id && !remainder.length,line);
    return {section,page:Number(page),name,id};
  });
  assert.equal(new Set(entries.map(e=>e.id)).size,entries.length,"Duplicate entry ledger ID");
  for (const [section,{count}] of Object.entries(sectionInfo))
    assert.equal(entries.filter(e=>e.section===section).length,count,"Official inventory for " + section);
  return entries;
}

function title(value) {
  return value.replace(/_/g," ").replace(/\b[a-z]/g,c=>c.toUpperCase());
}

function qualifiers(rule) {
  const result = [];
  if (rule.condition) result.push(rule.condition);
  if (rule.usage?.per_day != null) result.push(rule.usage.per_day + "/Day");
  if (rule.usage?.per_day_in_lair) {
    const {normal,lair} = rule.usage.per_day_in_lair;
    result.push(normal + "/Day, or " + lair + "/Day in Lair");
  }
  if (rule.usage?.recharge) {
    const {min,max} = rule.usage.recharge;
    result.push("Recharge " + (min === max ? min : min + "–" + max));
  }
  if (rule.usage?.on_rest) {
    assert.equal(rule.usage.on_rest,"short_or_long");
    result.push("Recharges after a Short or Long Rest");
  }
  if (rule.cost != null) result.push("Costs " + rule.cost + " Actions");
  return result.length ? " (" + result.join("; ") + ")" : "";
}

function formatRules(upstream, category, override) {
  let rules = upstream ?? [];
  if (override?.category === category) {
    const index = rules.findIndex(rule=>rule.name===override.replaces);
    assert.ok(index >= 0,"Reviewed rule override no longer matches " + override.replaces);
    rules = rules.toSpliced(index,1,...override.rules);
  }
  const ids = new Set();
  return rules.map(rule => {
    const slug = rule.name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
    const id = category + "." + slug;
    assert.ok(slug && !ids.has(id),"Duplicate rule ID requires review: " + id);
    ids.add(id);
    const text = /spellcasting/i.test(rule.name)
      ? rule.text.replace(/\s+(?=(?:At will:|\d+\/day(?: each)?:|\d+(?:st|nd|rd|th) level \(|Cantrips \())/gi,"\n")
      : rule.text;
    return {id,name:rule.title ?? rule.name + qualifiers(rule),text};
  });
}

function formatSpeed(speed) {
  const moves = ["walk","burrow","climb","fly","swim"].filter(mode=>speed[mode] != null).map(mode =>
    (mode === "walk" ? "" : mode + " ") + speed[mode] + " ft." + (mode === "fly" && speed.hover ? " (hover)" : ""));
  return moves.join(", ") + (speed.note ? " (" + speed.note.replace(/^walk: /,"") + ")" : "");
}

function formatSenses(senses) {
  const modes = ["blindsight","darkvision","tremorsense","truesight"];
  const notes = new Map((senses.notes ?? []).map(note=>note.split(": ")));
  const parts = modes.filter(mode=>senses[mode] != null).map(mode => {
    const qualifiers = [notes.get(mode)];
    let range = senses[mode] + " ft.";
    if (mode === "blindsight") {
      if (senses.deafened_range != null) range += " or " + senses.deafened_range + " ft. while deafened";
      if (senses.blind_beyond) qualifiers.push("blind beyond this radius");
    }
    const extra = qualifiers.filter(Boolean);
    return mode + " " + range + (extra.length ? " (" + extra.join(", ") + ")" : "");
  });
  return [...parts,"passive Perception " + senses.passive_perception].join(", ");
}

function convert(entry, element, override, sectionInfo) {
  const d = element.data;
  if (override) assert.equal(override.page,entry.page);
  const baseAc = d.ac.find(a=>!a.condition);
  const defense = list=>list?.map(item=>item.text ?? item.types.join(", ")).join("; ");
  const languages = [...(d.languages ?? [])];
  if (d.telepathy != null) languages.push("telepathy " + d.telepathy + " ft.");
  const details = {alignment:d.alignment,xp:d.xp,legendary_preamble:d.legendary?.preamble};
  if (d.initiative) details.initiative = d.initiative;
  if (d.initiative && d.proficiency_bonus != null) details.proficiency_bonus = d.proficiency_bonus;
  if (d.xp_lair != null)
    details.challenge_notes = String(d.xp_lair).replace(/\B(?=(\d{3})+(?!\d))/g,",") + " XP in lair";
  if (d.gear?.length) details.gear = d.gear.join(", ");
  if (d.size.length > 1) details.sizes = d.size.map(title);
  if (d.skill_notes?.length) details.skills_text = d.skill_notes.join("\n");
  if (d.tags?.length || d.swarm_of) details.sections = [{
    title:"Classification",
    text:(d.swarm_of ? "Swarm of " + title(d.swarm_of) + " " + d.creature_type + "s" : title(d.creature_type))
      + (d.tags?.length ? " (" + d.tags.join(", ") + ")" : "")
  }];
  const stats = {
    size:d.size.length === 1 ? title(d.size[0]) : null,
    creature_type:title(d.creature_type),
    challenge:d.cr,
    defenses:{
      ac:baseAc?.value ?? null, armor:baseAc?.source,
      conditional_ac:d.ac.filter(ac=>ac.condition).map(ac=>({
        ac:ac.value,qualifier:[ac.source,ac.condition].filter(Boolean).join(", ")
      })),
      vulnerabilities:defense(d.damage_vulnerabilities),
      resistances:defense(d.damage_resistances),
      immunities:defense(d.damage_immunities),
      condition_immunities:d.condition_immunities?.join(", ")
    },
    hp:d.hp.average,hit_dice:d.hp.formula,
    speed:formatSpeed(d.speed),senses:formatSenses(d.senses),
    abilities:Object.fromEntries(Object.entries(d.abilities).map(([key,value])=>[abilities[key],value])),
    saves:Object.fromEntries(d.initiative
      ? Object.entries(d.abilities).map(([key,value])=>[abilities[key],d.saves?.[key] ?? Math.floor((value-10)/2)])
      : Object.entries(d.saves ?? {}).map(([key,value])=>[abilities[key],value])),
    skills:Object.fromEntries(Object.entries(d.skills ?? {}).map(([key,value])=>[title(key),value])),
    languages:languages.join(", ") || (d.initiative ? "None" : "—"),
    notes:d.description,
    details
  };
  for (const category of categories) stats[category] = formatRules(
    category === "legendary_actions" ? d.legendary?.actions : d[category],category,override);
  // Source corrections retain the upstream identity and change only reviewed fields.
  if (override?.stats) {
    const {details:detailsOverride,...statOverrides} = override.stats;
    Object.assign(stats,statOverrides);
    Object.assign(details,detailsOverride);
  }
  return {id:entry.id,name:entry.name,stats,source_locator:{
    entry_id:entry.id,page:entry.page,section:sectionInfo[entry.section].name
  }};
}

function buildSrdPack({folder,edition,version,sectionInfo,officialAttribution}) {
  const [, , output] = process.argv;
  if (!output || process.argv.length !== 3) throw new Error("Usage: node " + path.basename(process.argv[1]) + " <output-directory>");
  const input = path.join(__dirname,"..","content",folder);
  const manifest = require(path.join(input,"inputs.json"));
  const overrides = require(path.join(input,"overrides.json"));
  const files = readPinnedFiles(input,manifest);
  const manifestData = JSON.parse(files["pack.json"]);
  assert.equal(manifestData.format,"borealis-pack/1");
  assert.equal(manifestData.license,"CC-BY-4.0");
  assert.equal(manifestData.id,"srd-"+version+"-monsters");
  const ruleset = "dnd"+edition;
  assert.deepEqual(manifestData.rulesets,[ruleset]);
  const approved = ["source.json",...Object.keys(sectionInfo).map(section=>section+".json")];
  assert.deepEqual(manifestData.files.map(file=>file.path),approved);
  const sources = new Map();
  for (const section of Object.keys(sectionInfo)) {
    const file = JSON.parse(files[section+".json"]);
    assert.equal(file.format,"borealis-content/1");
    assert.equal(file.ruleset,ruleset);
    for (const element of file.elements) {
      assert.equal(element.type,"Monster");
      assert.equal(element.data.ruleset,ruleset);
      assert.ok(!sources.has(element.id),"Repeated source ID " + element.id);
      sources.set(element.id,{section,element});
    }
  }
  const entries = readEntries(input,sectionInfo);
  const monsters = entries.map(entry => {
    const source = sources.get(entry.id);
    assert.equal(source?.section,entry.section,"No source in the official section for " + entry.id);
    assert.equal(entry.name.replace(/’/g,"'"),source.element.name.replace(/’/g,"'"),"Official name for " + entry.id);
    sources.delete(entry.id);
    return convert(entry,source.element,overrides[entry.id],sectionInfo);
  });
  assert.equal(sources.size,0,"Unreconciled Borealis entries");
  for (const id of Object.keys(overrides)) assert.ok(entries.some(entry=>entry.id===id),"Orphan override " + id);
  const upstreamUrl = "https://github.com/TeamBorealis/borealis/tree/" + manifest.borealis_revision + "/content/" + manifestData.id;
  const attribution = [officialAttribution,"Structured data adapted from Borealis. " + upstreamUrl,modifications,upstreamNotice].join("\n\n");
  const pack = {schema_version:2,info:{id:manifestData.id,edition,source:"System Reference Document " + version,
    source_version:version,attribution,license},monsters};
  const notices = [
    "Aurora Combat Tracker — SRD " + version + " monster pack",attribution,
    "Official English Creative Commons PDF\n" + manifest.official_pdf.url + "\nSHA-256 " + manifest.official_pdf.sha256,
    "Borealis revision " + manifest.borealis_revision,
    "Borealis SRD " + version + " monster pack notice (as published)\n\n" + files["ATTRIBUTION.md"].trim()
  ].join("\n\n") + "\n";
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,pack.info.id+".json"),JSON.stringify(pack,null,2)+"\n");
  fs.writeFileSync(path.join(output,"SRD-" + version + "-NOTICES.txt"),notices);
  console.log("Built " + monsters.length + " SRD " + version + " stat blocks.");
}

module.exports = {buildSrdPack};
