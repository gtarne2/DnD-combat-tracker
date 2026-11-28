//! Converts 5etools bestiary JSON (`{"monster": [...]}`) into a native v2 monster pack.
//!
//! Rules text keeps the printed wording with 5etools `{@tag ...}` markup rendered as plain text.
//! Records that inherit through `_copy` are reported instead of resolved.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::monsters::{
    Action, ActionResolution, ConditionalArmor, Defenses, Monster, PACK_SCHEMA, Pack, PackInfo,
    PrintedInitiative, Recharge, RuleSection, SourceLocator, StatBlock, StatDetails,
};

#[derive(Debug, Serialize)]
pub struct FiveToolsImport {
    pub pack: Pack,
    pub warnings: Vec<String>,
}

const ABILITIES: [(&str, &str); 6] = [
    ("str", "Strength"),
    ("dex", "Dexterity"),
    ("con", "Constitution"),
    ("int", "Intelligence"),
    ("wis", "Wisdom"),
    ("cha", "Charisma"),
];

fn parse(json: &str) -> Result<Value, String> {
    serde_json::from_str(json.strip_prefix('\u{feff}').unwrap_or(json))
        .map_err(|err| format!("This file is not valid JSON: {err}"))
}

/// Book names for the 5etools source codes a DM is most likely to import. Other files fall
/// back to the file's own `_meta` name, then to the code.
const BOOKS: [(&str, &str); 24] = [
    ("MM", "Monster Manual (2014)"),
    ("XMM", "Monster Manual (2025)"),
    ("PHB", "Player's Handbook (2014)"),
    ("XPHB", "Player's Handbook (2024)"),
    ("DMG", "Dungeon Master's Guide (2014)"),
    ("XDMG", "Dungeon Master's Guide (2024)"),
    ("VGM", "Volo's Guide to Monsters"),
    ("MTF", "Mordenkainen's Tome of Foes"),
    ("MPMM", "Mordenkainen Presents: Monsters of the Multiverse"),
    ("TCE", "Tasha's Cauldron of Everything"),
    ("XGE", "Xanathar's Guide to Everything"),
    ("FTD", "Fizban's Treasury of Dragons"),
    ("BGG", "Bigby Presents: Glory of the Giants"),
    ("BMT", "The Book of Many Things"),
    ("BAM", "Boo's Astral Menagerie"),
    ("MPP", "Morte's Planar Parade"),
    ("VRGR", "Van Richten's Guide to Ravenloft"),
    ("ERLW", "Eberron: Rising from the Last War"),
    ("EFA", "Eberron: Forge of the Artificer"),
    ("EGW", "Explorer's Guide to Wildemount"),
    ("GGR", "Guildmasters' Guide to Ravnica"),
    ("MOT", "Mythic Odysseys of Theros"),
    ("CoS", "Curse of Strahd"),
    ("ToA", "Tomb of Annihilation"),
];
const MODERN_BOOKS: [&str; 3] = ["XPHB", "XMM", "XDMG"];

/// Converts a 5etools bestiary file without asking for pack details: the pack ID, book name and
/// rules edition come from the file. Reimporting the same book gives the same pack ID, so it
/// replaces the earlier copy.
pub fn import_fivetools_file(file_name: &str, json: &str) -> Result<FiveToolsImport, String> {
    let value = parse(json)?;
    let info = fivetools_pack_info(file_name, &value);
    import_value(info, &value)
}

pub fn fivetools_pack_info(file_name: &str, value: &Value) -> PackInfo {
    let empty = vec![];
    let records = value
        .get("monster")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    for record in records {
        if let Some(source) = record.get("source").and_then(Value::as_str) {
            *counts.entry(source).or_default() += 1;
        }
    }
    let code = counts
        .iter()
        .max_by_key(|(code, count)| (**count, std::cmp::Reverse(**code)))
        .map(|(code, _)| plain(code).trim().to_owned())
        .filter(|code| !code.is_empty());
    let stem = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .trim_end_matches(".json")
        .trim_end_matches(".JSON");
    let meta_name = value
        .pointer("/_meta/sources")
        .and_then(Value::as_array)
        .and_then(|sources| {
            sources
                .iter()
                .find(|s| {
                    code.is_some() && s.get("json").and_then(Value::as_str) == code.as_deref()
                })
                .or(sources.first())
        })
        .and_then(|s| s.get("full"))
        .and_then(Value::as_str)
        .map(|name| plain(name).trim().to_owned())
        .filter(|name| !name.is_empty());
    let book = code.as_deref().and_then(|code| {
        BOOKS
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(code))
            .map(|(_, name)| (*name).to_owned())
    });
    let name = book
        .or(meta_name)
        .or(code.clone())
        .unwrap_or_else(|| stem.to_owned());
    // Later books print 2024 stat blocks; their records carry fields older books never use.
    let modern = code.as_deref().is_some_and(|code| {
        MODERN_BOOKS
            .iter()
            .any(|key| key.eq_ignore_ascii_case(code))
    }) || records.iter().any(|record| {
        ["initiative", "treasure", "srd52", "basicRules2024"]
            .iter()
            .any(|key| record.get(key).is_some())
    });
    let id_part = code.as_deref().unwrap_or(stem);
    PackInfo {
        id: format!("5etools-{}", slug(id_part)),
        edition: if modern { "2024" } else { "2014" }.into(),
        source: name.chars().take(100).collect(),
        attribution: format!(
            "Imported from the local 5etools file {}.",
            stem.chars().take(200).collect::<String>()
        ),
        source_version: None,
        license: None,
    }
}

pub fn import_fivetools_pack(info: PackInfo, json: &str) -> Result<FiveToolsImport, String> {
    import_value(info, &parse(json)?)
}

fn import_value(info: PackInfo, value: &Value) -> Result<FiveToolsImport, String> {
    let records = match value {
        Value::Object(root) => match root.get("monster") {
            Some(Value::Array(list)) => list.clone(),
            _ if root.contains_key("name") => vec![value.clone()],
            _ => return Err("Expected a 5etools bestiary file with a \"monster\" list.".into()),
        },
        Value::Array(list) => list.clone(),
        _ => return Err("Expected a 5etools bestiary file with a \"monster\" list.".into()),
    };
    let mut warnings = vec![];
    let mut ids = BTreeSet::new();
    let mut monsters = vec![];
    for (index, record) in records.iter().enumerate() {
        let Some(record) = record.as_object() else {
            warnings.push(format!("Entry {} is not a monster object.", index + 1));
            continue;
        };
        let name = record
            .get("name")
            .and_then(Value::as_str)
            .map(|name| plain(name).trim().to_owned())
            .filter(|name| !name.is_empty());
        let Some(name) = name else {
            warnings.push(format!("Entry {} has no name and was skipped.", index + 1));
            continue;
        };
        let source = record.get("source").and_then(Value::as_str).unwrap_or("");
        if let Some(copy) = record.get("_copy") {
            let base = [copy.get("name"), copy.get("source")]
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" · ");
            warnings.push(format!(
                "{name} copies {base} with changes, which this importer does not apply. Skipped."
            ));
            continue;
        }
        let base_id = format!("5et:{}.{}", slug(&name), slug(source));
        let mut id = base_id.clone();
        let mut suffix = 2;
        while !ids.insert(id.clone()) {
            id = format!("{base_id}-{suffix}");
            suffix += 1;
        }
        let modern = info.edition.contains("2024");
        let monster = convert(
            id,
            name.chars().take(120).collect(),
            record,
            modern,
            &mut warnings,
        );
        monsters.push(monster);
    }
    if monsters.is_empty() {
        return Err(if warnings.is_empty() {
            "The file contains no monsters.".into()
        } else {
            format!("No monsters could be imported. {}", warnings.join(" "))
        });
    }
    let pack = Pack {
        schema_version: PACK_SCHEMA,
        info,
        monsters,
    };
    pack.validate()?;
    Ok(FiveToolsImport { pack, warnings })
}

fn convert(
    id: String,
    name: String,
    record: &Map<String, Value>,
    modern: bool,
    warnings: &mut Vec<String>,
) -> Monster {
    let get = |key: &str| record.get(key);
    let mut notes = vec![];
    let mut sections = vec![];

    let sizes: Vec<String> = match get("size") {
        Some(Value::Array(codes)) => codes.iter().filter_map(Value::as_str).map(size).collect(),
        Some(Value::String(code)) => vec![size(code)],
        _ => vec![],
    };
    let (creature_type, classification) = creature_type(get("type"));
    if let Some(text) = classification {
        sections.push(RuleSection {
            title: "Classification".into(),
            text,
        });
    }

    let mut defenses = Defenses::default();
    armor_class(get("ac"), &mut defenses);
    defenses.vulnerabilities = damage_list(get("vulnerable"), "vulnerable");
    defenses.resistances = damage_list(get("resist"), "resist");
    defenses.immunities = damage_list(get("immune"), "immune");
    defenses.condition_immunities = damage_list(get("conditionImmune"), "conditionImmune");

    let (hp, hit_dice) = match get("hp") {
        Some(Value::Object(hp)) => {
            if let Some(special) = hp.get("special").and_then(Value::as_str) {
                notes.push(format!("HP · {}", plain(special)));
            }
            (
                hp.get("average")
                    .and_then(Value::as_u64)
                    .and_then(|n| u32::try_from(n).ok()),
                hp.get("formula").and_then(Value::as_str).map(compact_dice),
            )
        }
        _ => (None, None),
    };

    let mut abilities = std::collections::BTreeMap::new();
    for (key, label) in ABILITIES {
        if let Some(score) = get(key).and_then(Value::as_i64) {
            abilities.insert(label.to_owned(), score as i32);
        }
    }

    let mut saves = std::collections::BTreeMap::new();
    let mut saves_text = vec![];
    if let Some(Value::Object(list)) = get("save") {
        for (key, value) in list {
            let label = ABILITIES
                .iter()
                .find(|(short, _)| short == key)
                .map_or_else(|| title(key), |(_, long)| (*long).to_owned());
            match value.as_str().and_then(bonus) {
                Some(n) => {
                    saves.insert(label, n);
                }
                None => saves_text.push(format!("{label} {}", text_of(value))),
            }
        }
    }
    let mut skills = std::collections::BTreeMap::new();
    let mut skills_text = vec![];
    if let Some(Value::Object(list)) = get("skill") {
        for (key, value) in list {
            match value.as_str().and_then(bonus) {
                Some(n) => {
                    skills.insert(title(key), n);
                }
                None => skills_text.push(format!("{} {}", title(key), text_of(value))),
            }
        }
    }

    let mut senses: Vec<String> = strings(get("senses"));
    if let Some(passive) = get("passive").filter(|v| !v.is_null()) {
        senses.push(format!("passive Perception {}", text_of(passive)));
    }
    let languages = strings(get("languages"));

    let (challenge, challenge_notes) = match get("cr") {
        Some(Value::String(cr)) => (Some(cr.clone()), None),
        Some(Value::Object(cr)) => {
            let extra: Vec<String> = cr
                .iter()
                .filter(|(key, _)| key.as_str() != "cr")
                .map(|(key, value)| format!("{} {}", key, text_of(value)))
                .collect();
            (
                cr.get("cr").and_then(Value::as_str).map(str::to_owned),
                (!extra.is_empty()).then(|| extra.join(", ")),
            )
        }
        _ => (None, None),
    };
    let proficiency = challenge.as_deref().and_then(proficiency_bonus);

    let mut traits = rules(get("trait"), "traits", warnings, &name);
    let mut actions = rules(get("action"), "actions", warnings, &name);
    let mut bonus_actions = rules(get("bonus"), "bonus_actions", warnings, &name);
    let mut reactions = rules(get("reaction"), "reactions", warnings, &name);
    let legendary_actions = rules(get("legendary"), "legendary_actions", warnings, &name);
    if let Some(Value::Array(casting)) = get("spellcasting") {
        for (index, entry) in casting.iter().enumerate() {
            let Some(rule) = spellcasting(entry, index) else {
                continue;
            };
            match entry.get("displayAs").and_then(Value::as_str) {
                Some("action") => actions.push(rule),
                Some("bonus") => bonus_actions.push(rule),
                Some("reaction") => reactions.push(rule),
                _ => traits.push(rule),
            }
        }
    }
    let mut used = BTreeSet::new();
    for list in [
        &mut traits,
        &mut actions,
        &mut bonus_actions,
        &mut reactions,
    ] {
        for action in list.iter_mut() {
            unique_id(action, &mut used);
        }
    }
    let mut legendary_actions = legendary_actions;
    for action in &mut legendary_actions {
        unique_id(action, &mut used);
    }

    let legendary_preamble = match get("legendaryHeader") {
        Some(header) => Some(entries_text(header)).filter(|text| !text.is_empty()),
        // 5etools prints its default header for 3 actions when a record gives none.
        None => (!legendary_actions.is_empty()).then(|| {
            let n = get("legendaryActions").and_then(Value::as_u64).unwrap_or(3);
            format!("Can take {n} legendary actions.")
        }),
    };
    if let Some(mythic) = get("mythic") {
        let mut text = vec![];
        if let Some(header) = get("mythicHeader") {
            text.push(entries_text(header));
        }
        for rule in rules(Some(mythic), "mythic", warnings, &name) {
            text.push(format!("{}. {}", rule.name, rule.text));
        }
        text.retain(|t| !t.is_empty());
        if !text.is_empty() {
            sections.push(RuleSection {
                title: "Mythic actions".into(),
                text: text.join("\n"),
            });
        }
    }
    if get("legendaryGroup").is_some() {
        notes.push(
            "Lair actions and regional effects live in a separate 5etools file and were not imported."
                .into(),
        );
    }

    // 2024 stat blocks print initiative; 5etools omits the field when it is only the Dexterity modifier.
    let empty = Value::Object(Map::new());
    let printed = get("initiative").or(modern.then_some(&empty));
    let initiative = initiative(printed, abilities.get("Dexterity"), proficiency);
    let gear = match get("gear") {
        Some(Value::Array(items)) => {
            let items: Vec<String> = items
                .iter()
                .map(|item| match item {
                    Value::Object(item) => {
                        let name = item.get("item").map(text_of).unwrap_or_default();
                        let name = name.split('|').next().unwrap_or("").to_owned();
                        match item.get("quantity").and_then(Value::as_u64) {
                            Some(n) if n > 1 => format!("{name} ({n})"),
                            _ => name,
                        }
                    }
                    // Untagged gear strings are item references such as "shield|xphb".
                    Value::String(item) if !item.contains("{@") => {
                        item.split('|').next().unwrap_or("").to_owned()
                    }
                    other => text_of(other),
                })
                .filter(|item| !item.is_empty())
                .collect();
            (!items.is_empty()).then(|| items.join(", "))
        }
        _ => None,
    };

    let source = record
        .get("source")
        .and_then(Value::as_str)
        .map(str::to_owned);
    notes.retain(|note| !note.is_empty());
    let single_size = (sizes.len() == 1).then(|| sizes[0].clone());
    let stats = StatBlock {
        creature_type,
        size: single_size,
        challenge: challenge.clone(),
        defenses,
        hp,
        hit_dice,
        speed: speed(get("speed")),
        abilities,
        saves,
        skills,
        senses: (!senses.is_empty()).then(|| senses.join(", ")),
        languages: (!languages.is_empty()).then(|| languages.join(", ")),
        notes: (!notes.is_empty()).then(|| notes.join("\n")),
        traits,
        actions,
        bonus_actions,
        reactions,
        legendary_actions,
        details: Some(StatDetails {
            sizes: if sizes.len() > 1 { sizes } else { vec![] },
            alignment: alignment(get("alignment")),
            initiative,
            proficiency_bonus: None,
            xp: challenge.as_deref().and_then(xp),
            challenge_notes,
            saves_text: (!saves_text.is_empty()).then(|| saves_text.join(", ")),
            skills_text: (!skills_text.is_empty()).then(|| skills_text.join(", ")),
            gear,
            legendary_preamble,
            sections,
        }),
    };
    let page = record
        .get("page")
        .and_then(Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0);
    Monster {
        id,
        name,
        stats,
        source_locator: Some(SourceLocator {
            entry_id: None,
            page,
            section: source.filter(|s| !s.trim().is_empty()),
            source_version: None,
        })
        .filter(|locator| locator.page.is_some() || locator.section.is_some()),
    }
}

fn unique_id(action: &mut Action, used: &mut BTreeSet<String>) {
    let base = action.id.clone();
    let mut suffix = 2;
    while !used.insert(action.id.clone()) {
        action.id = format!("{base}-{suffix}");
        suffix += 1;
    }
}

fn rules(
    value: Option<&Value>,
    prefix: &str,
    warnings: &mut Vec<String>,
    owner: &str,
) -> Vec<Action> {
    let Some(Value::Array(list)) = value else {
        return vec![];
    };
    let mut out = vec![];
    for entry in list {
        let raw_name = entry.get("name").and_then(Value::as_str).unwrap_or("");
        let name = plain(raw_name).trim().to_owned();
        let text = entry.get("entries").map(entries_text).unwrap_or_default();
        if text.trim().is_empty() {
            if !name.is_empty() {
                warnings.push(format!(
                    "{owner}: {name} has no rules text and was skipped."
                ));
            }
            continue;
        }
        let name = if name.is_empty() {
            "Rule".to_owned()
        } else {
            name
        };
        let raw_text = entry.get("entries").map(raw_strings).unwrap_or_default();
        let mut action = Action::text(
            format!("{prefix}.{}", slug(&name)),
            name.chars().take(120).collect(),
            text,
        );
        action.attack_bonus = first_tag(&raw_text, "hit").and_then(|n| bonus(&n));
        let dcs: BTreeSet<String> = all_tags(&raw_text, "dc").into_iter().collect();
        if dcs.len() == 1 {
            action.save_dc = dcs.into_iter().next().and_then(|n| n.trim().parse().ok());
        }
        if let Some(minimum) = recharge(raw_name) {
            action.recharge = Some(Recharge { die: 6, minimum });
        }
        if prefix == "legendary_actions"
            && let Some(cost) = legendary_cost(&action.name)
        {
            action.resolution = Some(ActionResolution {
                legendary_cost: Some(cost),
                ..Default::default()
            });
        }
        out.push(action);
    }
    out
}

fn spellcasting(entry: &Value, index: usize) -> Option<Action> {
    let name = entry
        .get("name")
        .and_then(Value::as_str)
        .map(plain)
        .unwrap_or_else(|| "Spellcasting".into());
    let mut lines = vec![];
    if let Some(header) = entry.get("headerEntries") {
        lines.push(entries_text(header));
    }
    if let Some(will) = entry.get("will") {
        lines.push(format!("At will: {}", spell_list(will)));
    }
    for (key, label) in [
        ("daily", "day"),
        ("rest", "rest"),
        ("weekly", "week"),
        ("monthly", "month"),
        ("yearly", "year"),
    ] {
        if let Some(Value::Object(groups)) = entry.get(key) {
            for (count, spells) in groups {
                let each = count.ends_with('e');
                let count = count.trim_end_matches('e');
                lines.push(format!(
                    "{count}/{label}{}: {}",
                    if each { " each" } else { "" },
                    spell_list(spells)
                ));
            }
        }
    }
    if let Some(Value::Object(levels)) = entry.get("spells") {
        let mut levels: Vec<_> = levels.iter().collect();
        levels.sort_by_key(|(level, _)| level.parse::<u32>().unwrap_or(99));
        for (level, group) in levels {
            let spells = group.get("spells").map(spell_list).unwrap_or_default();
            let label = match level.as_str() {
                "0" => "Cantrips (at will)".to_owned(),
                n => {
                    let ordinal = match n {
                        "1" => "1st",
                        "2" => "2nd",
                        "3" => "3rd",
                        _ => "",
                    };
                    let ordinal = if ordinal.is_empty() {
                        format!("{n}th")
                    } else {
                        ordinal.into()
                    };
                    match group.get("slots").and_then(Value::as_u64) {
                        Some(slots) => format!(
                            "{ordinal} level ({slots} slot{})",
                            if slots == 1 { "" } else { "s" }
                        ),
                        None => format!("{ordinal} level"),
                    }
                }
            };
            lines.push(format!("{label}: {spells}"));
        }
    }
    if let Some(footer) = entry.get("footerEntries") {
        lines.push(entries_text(footer));
    }
    lines.retain(|line| !line.trim().is_empty());
    if lines.is_empty() {
        return None;
    }
    Some(Action::text(
        format!("spellcasting.{}-{}", slug(&name), index + 1),
        name.chars().take(120).collect(),
        lines.join("\n"),
    ))
}

fn spell_list(value: &Value) -> String {
    match value {
        Value::Array(list) => list.iter().map(text_of).collect::<Vec<_>>().join(", "),
        other => text_of(other),
    }
}

/// Renders a 5etools entries value (string, list or nested object) as plain text.
fn entries_text(value: &Value) -> String {
    let mut lines = vec![];
    render(value, &mut lines);
    lines.retain(|line| !line.trim().is_empty());
    lines.join("\n")
}

fn render(value: &Value, lines: &mut Vec<String>) {
    match value {
        Value::String(text) => lines.push(plain(text)),
        Value::Array(list) => list.iter().for_each(|item| render(item, lines)),
        Value::Object(object) => {
            let kind = object.get("type").and_then(Value::as_str).unwrap_or("");
            let name = object.get("name").and_then(Value::as_str).map(plain);
            match kind {
                "list" => {
                    for item in object
                        .get("items")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                    {
                        let mut inner = vec![];
                        render(item, &mut inner);
                        if !inner.is_empty() {
                            lines.push(format!("• {}", inner.join(" ")));
                        }
                    }
                }
                "table" => {
                    if let Some(caption) = object.get("caption").and_then(Value::as_str) {
                        lines.push(plain(caption));
                    }
                    for row in [object.get("colLabels")].into_iter().flatten().chain(
                        object
                            .get("rows")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten(),
                    ) {
                        let cells = row
                            .as_array()
                            .or_else(|| row.get("row").and_then(Value::as_array));
                        if let Some(cells) = cells {
                            lines.push(cells.iter().map(text_of).collect::<Vec<_>>().join(" | "));
                        }
                    }
                }
                _ => {
                    let mut inner = vec![];
                    for key in ["entry", "entries", "items"] {
                        if let Some(child) = object.get(key) {
                            render(child, &mut inner);
                        }
                    }
                    match (name, inner.is_empty()) {
                        (Some(name), false) => {
                            let first = inner.remove(0);
                            let sep = if name.ends_with(['.', ':', '?', '!']) {
                                ""
                            } else {
                                "."
                            };
                            lines.push(format!("{name}{sep} {first}"));
                            lines.extend(inner);
                        }
                        (Some(name), true) => lines.push(name),
                        (None, _) => lines.extend(inner),
                    }
                }
            }
        }
        Value::Number(n) => lines.push(n.to_string()),
        _ => {}
    }
}

fn text_of(value: &Value) -> String {
    match value {
        Value::String(text) => plain(text),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => entries_text(other).replace('\n', " "),
    }
}

/// Collects raw strings so structured fields can read tags before rendering.
fn raw_strings(value: &Value) -> String {
    let mut out = String::new();
    fn walk(value: &Value, out: &mut String) {
        match value {
            Value::String(text) => {
                out.push_str(text);
                out.push('\n');
            }
            Value::Array(list) => list.iter().for_each(|v| walk(v, out)),
            Value::Object(object) => object.values().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    walk(value, &mut out);
    out
}

fn tag_spans(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans = vec![];
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'@' {
            let mut depth = 0;
            let mut end = None;
            for (j, &byte) in bytes.iter().enumerate().skip(i) {
                match byte {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            end = Some(j);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            match end {
                Some(end) => {
                    spans.push((i, end));
                    i = end + 1;
                }
                None => break,
            }
        } else {
            i += 1;
        }
    }
    spans
}

fn all_tags(text: &str, wanted: &str) -> Vec<String> {
    let mut found = vec![];
    for (start, end) in tag_spans(text) {
        let inner = &text[start + 2..end];
        let (tag, rest) = inner.split_once(' ').unwrap_or((inner, ""));
        if tag == wanted {
            found.push(rest.split('|').next().unwrap_or("").trim().to_owned());
        } else {
            found.extend(all_tags(rest, wanted));
        }
    }
    found
}

fn first_tag(text: &str, wanted: &str) -> Option<String> {
    all_tags(text, wanted).into_iter().next()
}

/// Replaces 5etools `{@tag text|source|display}` markup with readable text.
pub fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (start, end) in tag_spans(text) {
        out.push_str(&text[last..start]);
        let inner = &text[start + 2..end];
        let (tag, rest) = inner.split_once(' ').unwrap_or((inner, ""));
        out.push_str(&render_tag(tag, &plain(rest)));
        last = end + 1;
    }
    out.push_str(&text[last..]);
    out
}

fn render_tag(tag: &str, rest: &str) -> String {
    let parts: Vec<&str> = rest.split('|').collect();
    let first = parts[0].trim();
    let part = |index: usize| parts.get(index).map(|p| p.trim()).filter(|p| !p.is_empty());
    match tag {
        "h" => "Hit: ".into(),
        "m" => "Miss: ".into(),
        "hom" => "Hit or Miss: ".into(),
        "atk" | "atkr" => attack_label(tag, first),
        "hit" => part(1).map_or_else(|| signed_text(first), str::to_owned),
        "d20" => part(1).map_or_else(|| signed_text(first), str::to_owned),
        "dc" => part(1).map_or_else(|| format!("DC {first}"), str::to_owned),
        "damage" | "dice" | "autodice" => part(1).unwrap_or(first).to_owned(),
        "scaledice" | "scaledamage" => part(4).or(part(2)).unwrap_or(first).to_owned(),
        "recharge" => {
            let n = if first.is_empty() { "6" } else { first };
            if n == "6" {
                "(Recharge 6)".into()
            } else {
                format!("(Recharge {n}–6)")
            }
        }
        "chance" => part(1).map_or_else(|| format!("{first} percent"), str::to_owned),
        "actSave" => format!("{} Saving Throw:", ability_name(first)),
        "actSaveFail" => "Failure:".into(),
        "actSaveSuccess" => "Success:".into(),
        "actSaveSuccessOrFail" => "Failure or Success:".into(),
        "actSaveFailBy" => format!("Failure by {first} or More:"),
        "actTrigger" => "Trigger:".into(),
        "actResponse" => "Response:".into(),
        "spell" | "item" | "creature" | "condition" | "disease" | "status" | "background"
        | "race" | "optfeature" | "reward" | "feat" | "psionic" | "object" | "trap" | "hazard"
        | "variantrule" | "action" | "skill" | "sense" | "language" | "table" | "vehicle"
        | "card" | "deck" | "legroup" | "itemMastery" | "boon" | "cult" | "charoption"
        | "recipe" | "facility" | "class" | "subclass" | "classFeature" | "subclassFeature"
        | "hazard2" => part(2).unwrap_or(first).to_owned(),
        "quickref" => part(4).unwrap_or(first).to_owned(),
        "deity" => part(3).unwrap_or(first).to_owned(),
        _ => first.to_owned(),
    }
}

fn attack_label(tag: &str, codes: &str) -> String {
    let kinds: Vec<&str> = codes.split(',').map(str::trim).collect();
    let words = |code: &str| match code {
        "m" | "mw" | "ms" => "Melee",
        "r" | "rw" | "rs" => "Ranged",
        _ => "",
    };
    let reach: Vec<&str> = kinds
        .iter()
        .map(|code| words(code))
        .filter(|w| !w.is_empty())
        .collect();
    let reach = reach.join(" or ");
    if tag == "atkr" {
        return format!("{reach} Attack Roll:").trim().to_owned();
    }
    let spell = kinds.iter().all(|code| code.ends_with('s'));
    format!("{reach} {} Attack:", if spell { "Spell" } else { "Weapon" })
}

fn ability_name(codes: &str) -> String {
    codes
        .split(',')
        .map(|code| {
            ABILITIES
                .iter()
                .find(|(short, _)| *short == code.trim())
                .map_or_else(|| title(code.trim()), |(_, long)| (*long).to_owned())
        })
        .collect::<Vec<_>>()
        .join(" or ")
}

fn signed_text(value: &str) -> String {
    match value.parse::<i32>() {
        Ok(n) if n >= 0 => format!("+{n}"),
        Ok(n) => n.to_string(),
        Err(_) => value.to_owned(),
    }
}

fn bonus(text: &str) -> Option<i32> {
    let text = text.trim();
    text.strip_prefix('+').unwrap_or(text).parse().ok()
}

fn recharge(raw_name: &str) -> Option<u32> {
    let tag = first_tag(raw_name, "recharge")?;
    let minimum = if tag.is_empty() { 6 } else { tag.parse().ok()? };
    (1..=6).contains(&minimum).then_some(minimum)
}

fn legendary_cost(name: &str) -> Option<u32> {
    let lower = name.to_lowercase();
    let start = lower.find("(costs ")? + 7;
    let rest = &lower[start..];
    let number: String = rest.chars().take_while(char::is_ascii_digit).collect();
    number.parse().ok().filter(|n| *n > 0)
}

fn size(code: &str) -> String {
    match code {
        "T" => "Tiny",
        "S" => "Small",
        "M" => "Medium",
        "L" => "Large",
        "H" => "Huge",
        "G" => "Gargantuan",
        other => other,
    }
    .to_owned()
}

fn creature_type(value: Option<&Value>) -> (Option<String>, Option<String>) {
    match value {
        Some(Value::String(kind)) => (Some(title(kind)), None),
        Some(Value::Object(kind)) => {
            let base = match kind.get("type") {
                Some(Value::String(kind)) => title(kind),
                Some(Value::Object(choice)) => choice
                    .get("choose")
                    .and_then(Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter_map(Value::as_str)
                            .map(title)
                            .collect::<Vec<_>>()
                            .join(" or ")
                    })
                    .unwrap_or_default(),
                _ => String::new(),
            };
            let tags: Vec<String> = kind
                .get("tags")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|tag| match tag {
                    Value::Object(tag) => [tag.get("prefix"), tag.get("tag")]
                        .into_iter()
                        .flatten()
                        .map(text_of)
                        .collect::<Vec<_>>()
                        .join(" "),
                    other => text_of(other),
                })
                .filter(|tag| !tag.is_empty())
                .collect();
            let swarm = kind.get("swarmSize").and_then(Value::as_str);
            let display = match swarm {
                Some(code) => format!("Swarm of {} {}s", size(code), base),
                None => base.clone(),
            };
            let classification =
                (!tags.is_empty()).then(|| format!("{display} ({})", tags.join(", ")));
            (Some(display).filter(|d| !d.is_empty()), classification)
        }
        _ => (None, None),
    }
}

fn alignment(value: Option<&Value>) -> Option<String> {
    let Some(Value::Array(list)) = value else {
        return value.map(text_of).filter(|t| !t.is_empty());
    };
    if list.iter().all(Value::is_string) {
        let codes: BTreeSet<&str> = list.iter().filter_map(Value::as_str).collect();
        let has = |all: &[&str]| all.iter().all(|c| codes.contains(c));
        let text = if codes.len() == 1 && has(&["A"]) {
            "any alignment".to_owned()
        } else if codes.len() == 1 && has(&["U"]) {
            "unaligned".to_owned()
        } else if codes.len() >= 4 && has(&["L", "NX", "C", "E"]) && !codes.contains("G") {
            "any evil alignment".to_owned()
        } else if codes.len() >= 4 && has(&["L", "NX", "C", "G"]) && !codes.contains("E") {
            "any good alignment".to_owned()
        } else if codes.len() >= 4 && has(&["NX", "C", "G", "E"]) && !codes.contains("L") {
            "any non-lawful alignment".to_owned()
        } else if codes.len() >= 4 && has(&["L", "NX", "G", "E"]) && !codes.contains("C") {
            "any non-chaotic alignment".to_owned()
        } else {
            let words: Vec<&str> = list
                .iter()
                .filter_map(Value::as_str)
                .map(|code| match code {
                    "L" => "lawful",
                    "C" => "chaotic",
                    "N" | "NX" | "NY" => "neutral",
                    "G" => "good",
                    "E" => "evil",
                    "U" => "unaligned",
                    "A" => "any",
                    other => other,
                })
                .collect();
            let mut deduped: Vec<&str> = vec![];
            for word in words {
                if deduped.last() != Some(&word) {
                    deduped.push(word);
                }
            }
            deduped.join(" ")
        };
        return Some(text);
    }
    let options: Vec<String> = list
        .iter()
        .map(|entry| match entry {
            Value::Object(object) => {
                if let Some(special) = object.get("special") {
                    return text_of(special);
                }
                let base = alignment(object.get("alignment")).unwrap_or_default();
                match object.get("chance").and_then(Value::as_u64) {
                    Some(chance) => format!("{base} ({chance}%)"),
                    None => base,
                }
            }
            other => text_of(other),
        })
        .filter(|t| !t.is_empty())
        .collect();
    (!options.is_empty()).then(|| options.join(" or "))
}

fn armor_class(value: Option<&Value>, defenses: &mut Defenses) {
    let Some(Value::Array(list)) = value else {
        return;
    };
    let mut armor = vec![];
    for entry in list {
        match entry {
            Value::Number(n) if defenses.ac.is_none() => defenses.ac = n.as_i64().map(|n| n as i32),
            Value::Number(n) => defenses.conditional_ac.push(ConditionalArmor {
                ac: n.as_i64().map(|n| n as i32),
                qualifier: "alternate AC".into(),
            }),
            Value::Object(object) => {
                if let Some(special) = object.get("special") {
                    armor.push(text_of(special));
                    continue;
                }
                let ac = object.get("ac").and_then(Value::as_i64).map(|n| n as i32);
                let from: Vec<String> = object
                    .get("from")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(text_of)
                    .collect();
                match object
                    .get("condition")
                    .map(text_of)
                    .filter(|c| !c.is_empty())
                {
                    Some(condition) if defenses.ac.is_some() => {
                        let qualifier = if from.is_empty() {
                            condition
                        } else {
                            format!("{} {condition}", from.join(", "))
                        };
                        defenses
                            .conditional_ac
                            .push(ConditionalArmor { ac, qualifier });
                    }
                    condition => {
                        if defenses.ac.is_none() {
                            defenses.ac = ac;
                            armor.extend(from);
                            armor.extend(condition);
                        } else {
                            defenses.conditional_ac.push(ConditionalArmor {
                                ac,
                                qualifier: if from.is_empty() {
                                    "alternate AC".into()
                                } else {
                                    from.join(", ")
                                },
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    armor.retain(|a| !a.is_empty());
    defenses.armor = (!armor.is_empty()).then(|| armor.join(", "));
}

fn damage_list(value: Option<&Value>, key: &str) -> Option<String> {
    let Some(Value::Array(list)) = value else {
        return None;
    };
    let mut simple = vec![];
    let mut groups = vec![];
    for entry in list {
        match entry {
            Value::String(text) => simple.push(plain(text)),
            Value::Object(object) => {
                if let Some(special) = object.get("special") {
                    groups.push(text_of(special));
                    continue;
                }
                let inner = damage_list(object.get(key), key).unwrap_or_default();
                let text = [
                    object.get("preNote").map(text_of),
                    Some(inner),
                    object.get("note").map(text_of),
                ]
                .into_iter()
                .flatten()
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
                groups.push(text);
            }
            _ => {}
        }
    }
    let mut all = vec![];
    if !simple.is_empty() {
        all.push(simple.join(", "));
    }
    all.extend(groups.into_iter().filter(|g| !g.is_empty()));
    (!all.is_empty()).then(|| all.join("; "))
}

fn speed(value: Option<&Value>) -> Option<String> {
    let value = value?;
    let Value::Object(speeds) = value else {
        return Some(text_of(value)).filter(|t| !t.is_empty());
    };
    let hover = speeds.get("canHover").and_then(Value::as_bool) == Some(true);
    let mut parts = vec![];
    for mode in ["walk", "burrow", "climb", "fly", "swim"] {
        let Some(speed) = speeds.get(mode) else {
            continue;
        };
        let (number, condition) = match speed {
            Value::Number(n) => (n.to_string(), None),
            Value::Object(object) => (
                object.get("number").map(text_of).unwrap_or_default(),
                object
                    .get("condition")
                    .map(text_of)
                    .filter(|c| !c.is_empty()),
            ),
            Value::Bool(true) => ("equal to walking speed".into(), None),
            _ => continue,
        };
        let mut text = if mode == "walk" {
            format!("{number} ft.")
        } else {
            format!("{mode} {number} ft.")
        };
        if let Some(condition) = &condition {
            text.push(' ');
            text.push_str(condition);
        } else if mode == "fly" && hover {
            text.push_str(" (hover)");
        }
        parts.push(text);
    }
    (!parts.is_empty()).then(|| parts.join(", "))
}

fn initiative(
    value: Option<&Value>,
    dex: Option<&i32>,
    pb: Option<i32>,
) -> Option<PrintedInitiative> {
    let Value::Object(init) = value? else {
        return None;
    };
    let modifier = match init.get("initiative").and_then(Value::as_i64) {
        Some(n) => Some(n as i32),
        None => {
            let dex = (dex? - 10).div_euclid(2);
            let proficiency = init.get("proficiency").and_then(Value::as_i64).unwrap_or(0) as i32;
            Some(dex + proficiency * pb.unwrap_or(0))
        }
    };
    Some(PrintedInitiative {
        modifier,
        score: modifier.map(|m| 10 + m),
        qualifier: None,
    })
}

fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(list)) => list.iter().map(text_of).filter(|t| !t.is_empty()).collect(),
        Some(Value::String(text)) => vec![plain(text)],
        _ => vec![],
    }
}

fn compact_dice(formula: &str) -> String {
    plain(formula)
        .replace(" + ", "+")
        .replace(" - ", "-")
        .replace(' ', "")
}

fn proficiency_bonus(cr: &str) -> Option<i32> {
    let value = match cr {
        "0" | "1/8" | "1/4" | "1/2" => 0,
        other => other.parse::<i32>().ok()?,
    };
    Some(2 + (value.max(1) - 1) / 4)
}

fn xp(cr: &str) -> Option<u32> {
    let table = [
        ("0", 10),
        ("1/8", 25),
        ("1/4", 50),
        ("1/2", 100),
        ("1", 200),
        ("2", 450),
        ("3", 700),
        ("4", 1100),
        ("5", 1800),
        ("6", 2300),
        ("7", 2900),
        ("8", 3900),
        ("9", 5000),
        ("10", 5900),
        ("11", 7200),
        ("12", 8400),
        ("13", 10000),
        ("14", 11500),
        ("15", 13000),
        ("16", 15000),
        ("17", 18000),
        ("18", 20000),
        ("19", 22000),
        ("20", 25000),
        ("21", 33000),
        ("22", 41000),
        ("23", 50000),
        ("24", 62000),
        ("25", 75000),
        ("26", 90000),
        ("27", 105000),
        ("28", 120000),
        ("29", 135000),
        ("30", 155000),
    ];
    table.iter().find(|(key, _)| *key == cr).map(|(_, xp)| *xp)
}

fn title(text: &str) -> String {
    text.split(' ')
        .enumerate()
        .map(|(index, word)| {
            if index > 0 && matches!(word, "of" | "and" | "the") {
                return word.to_owned();
            }
            let mut chars = word.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_uppercase().chain(chars).collect()
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn slug(text: &str) -> String {
    let mut out = String::new();
    for c in plain(text).chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-');
    let out: String = out.chars().take(60).collect();
    if out.is_empty() { "x".into() } else { out }
}
