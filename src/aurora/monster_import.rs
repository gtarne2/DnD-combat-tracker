use std::{collections::BTreeMap, path::PathBuf};

use roxmltree::Document;

use super::{ContentDefinition, content::ContentIndex};
use crate::{
    companion::{description, hp_number, setter},
    monsters::{
        Action, ActionResolution, Defenses, Monster, PACK_SCHEMA, Pack, PackInfo,
        PrintedInitiative, SourceLocator, StatBlock, StatDetails,
    },
};

pub fn import_monster_pack(info: PackInfo, files: &[String]) -> Result<Pack, String> {
    let mut index = ContentIndex::default();
    let paths: Vec<_> = (1..=files.len())
        .map(|index| PathBuf::from(format!("XML file {index}")))
        .collect();
    let documents = files
        .iter()
        .zip(&paths)
        .map(|(xml, path)| {
            Document::parse(xml.strip_prefix('\u{feff}').unwrap_or(xml))
                .map_err(|err| format!("{}: {err}", path.display()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    for (path, doc) in paths.iter().zip(&documents) {
        match doc.root_element().tag_name().name() {
            "elements" => index.add_file(path, doc).map_err(|err| err.to_string())?,
            "index" => {}
            _ => {
                return Err(format!(
                    "{}: Expected Aurora <elements> or <index>.",
                    path.display()
                ));
            }
        }
    }
    let definitions = index.resolve_companions();
    let monsters = definitions
        .iter()
        .filter_map(|(id, definition)| {
            let definition = definition.as_ref()?;
            if definition.kind.as_deref() != Some("Companion") {
                return None;
            }
            // Spell and character unlock definitions can also use the Companion type.
            let creature = ["ac", "armorClass", "hp", "speed", "size", "strength"]
                .iter()
                .any(|field| setter(definition, field).is_some());
            creature.then(|| convert(id, definition, &definitions))
        })
        .collect();
    let pack = Pack {
        schema_version: PACK_SCHEMA,
        info,
        monsters,
    };
    if pack.monsters.is_empty() {
        return Err("The selected XML contains no creature-shaped Aurora companions.".into());
    }
    pack.validate()?;
    Ok(pack)
}

fn convert(
    id: &str,
    definition: &ContentDefinition,
    definitions: &BTreeMap<String, Option<ContentDefinition>>,
) -> Monster {
    let get = |name| setter(definition, name);
    let hp = get("hp");
    let armor = get("ac").or_else(|| get("armorClass"));
    let ac = armor
        .as_deref()
        .and_then(|v| v.split_once(" (").map_or(v, |(base, _)| base).parse().ok());
    let mut notes = vec![description(definition)];
    if let Some(source) = &definition.source {
        notes.push(format!("Aurora source · {source}"));
    }
    let mut stats = StatBlock {
        creature_type: get("type"),
        size: get("size"),
        challenge: get("challenge").or_else(|| get("cr")),
        hp: hp.as_deref().and_then(hp_number),
        hit_dice: get("hitDice").or_else(|| {
            hp.as_deref()?
                .split_once(" (")?
                .1
                .strip_suffix(')')
                .map(str::to_owned)
        }),
        defenses: Defenses {
            ac,
            armor: armor.filter(|v| v.parse::<i32>().is_err()),
            vulnerabilities: get("vulnerabilities").or_else(|| get("damageVulnerabilities")),
            resistances: get("resistances").or_else(|| get("damageResistances")),
            immunities: get("immunities").or_else(|| get("damageImmunities")),
            condition_immunities: get("conditionImmunities"),
            ..Default::default()
        },
        speed: get("speed"),
        senses: get("senses"),
        languages: get("languages"),
        details: Some(StatDetails {
            alignment: get("alignment"),
            initiative: read_initiative(get("initiative"), &mut notes),
            proficiency_bonus: read_number(
                "Proficiency bonus",
                get("proficiencyBonus"),
                &mut notes,
            ),
            xp: read_number("XP", get("xp"), &mut notes),
            challenge_notes: get("challengeNotes"),
            gear: get("gear"),
            legendary_preamble: get("legendaryPreamble"),
            ..Default::default()
        }),
        ..Default::default()
    };
    if stats.hp.is_none()
        && let Some(hp) = hp
    {
        notes.push(format!("Unresolved Aurora HP · {hp}"));
    }
    for ability in [
        "strength",
        "dexterity",
        "constitution",
        "intelligence",
        "wisdom",
        "charisma",
    ] {
        if let Some(value) = get(ability) {
            match value.parse() {
                Ok(score) => {
                    stats.abilities.insert(ability.into(), score);
                }
                Err(_) => notes.push(format!("Unresolved Aurora {ability} · {value}")),
            }
        }
    }
    for (label, target) in [("saves", &mut stats.saves), ("skills", &mut stats.skills)] {
        if let Some(value) = get(label) {
            for entry in value.split(',').map(str::trim) {
                if let Some((name, bonus)) = entry.rsplit_once(char::is_whitespace)
                    && let Ok(bonus) = bonus.parse()
                {
                    target.insert(name.trim().into(), bonus);
                } else {
                    notes.push(format!("Unresolved Aurora {label} · {entry}"));
                }
            }
        }
    }
    for reference in &definition.referenced_ids {
        let Some(part) = definitions.get(reference).and_then(Option::as_ref) else {
            notes.push(format!("Unresolved Aurora reference · {reference}"));
            continue;
        };
        let target = match part.kind.as_deref() {
            Some("Companion Trait") => &mut stats.traits,
            Some("Companion Action") => &mut stats.actions,
            Some("Companion Bonus Action") => &mut stats.bonus_actions,
            Some("Companion Reaction") => &mut stats.reactions,
            Some("Companion Legendary Action") => &mut stats.legendary_actions,
            _ => continue,
        };
        let text = description(part);
        if text.is_empty() {
            notes.push(format!(
                "Aurora reference with no description · {reference}"
            ));
        } else {
            let mut action = Action::text(
                reference.clone(),
                part.name.clone().unwrap_or_else(|| reference.clone()),
                text,
            );
            action.resolution = Some(ActionResolution {
                manual_note: Some("Resolve using the imported Aurora rules text.".into()),
                ..Default::default()
            });
            target.push(action);
        }
    }
    notes.retain(|note| !note.is_empty());
    stats.notes = (!notes.is_empty()).then(|| notes.join("\n"));
    Monster {
        id: id.into(),
        name: definition.name.clone().unwrap_or_else(|| id.into()),
        stats,
        source_locator: Some(SourceLocator {
            entry_id: Some(id.into()),
            page: None,
            section: definition
                .source
                .clone()
                .filter(|source| !source.trim().is_empty()),
            source_version: definition
                .file_version
                .clone()
                .filter(|version| !version.trim().is_empty()),
        }),
    }
}

fn read_number<T: std::str::FromStr>(
    label: &str,
    value: Option<String>,
    notes: &mut Vec<String>,
) -> Option<T> {
    let value = value?;
    let parsed = value.parse().ok();
    if parsed.is_none() {
        notes.push(format!("Unresolved Aurora {label} · {value}"));
    }
    parsed
}

fn read_initiative(value: Option<String>, notes: &mut Vec<String>) -> Option<PrintedInitiative> {
    let value = value?;
    let (modifier, score) = if let Some((modifier, score)) = value.split_once(" (") {
        (
            modifier.parse().ok(),
            score.strip_suffix(')').and_then(|s| s.parse().ok()),
        )
    } else {
        (value.parse().ok(), None)
    };
    let unresolved = modifier.is_none() || value.contains(" (") && score.is_none();
    if unresolved {
        notes.push(format!("Unresolved Aurora initiative · {value}"));
    }
    Some(PrintedInitiative {
        modifier,
        score,
        qualifier: unresolved.then_some(value),
    })
}
