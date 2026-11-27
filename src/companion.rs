use std::collections::{BTreeMap, BTreeSet};

use crate::{
    aurora::{ContentDefinition, ContentElement, ContentNode, ImportedCharacter},
    concentration::parse_duration,
};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CompanionDetails {
    pub name: String,
    pub kind: String,
    pub armor_class: String,
    pub speed: String,
    pub stats: String,
    pub max_hp: Option<u32>,
    pub attacks: String,
    pub abilities: String,
    pub command: String,
    pub duration: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompanionTemplate {
    pub id: String,
    pub details: CompanionDetails,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum CompanionTurn {
    #[default]
    WithOwner,
    Separate(i32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompanionCard {
    pub id: u64,
    pub template_id: Option<String>,
    pub details: CompanionDetails,
    pub current_hp: Option<u32>,
    pub remaining_rounds: Option<u32>,
    pub turn: CompanionTurn,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CompanionRoster {
    pub cards: Vec<CompanionCard>,
    pub owner_initiative: Option<i32>,
    seen_imports: BTreeSet<String>,
    next_id: u64,
}

impl CompanionRoster {
    pub(crate) fn keep_sequence(&mut self, newer: &Self) {
        self.next_id = self.next_id.max(newer.next_id);
    }

    pub fn add(&mut self, template_id: Option<String>, details: CompanionDetails) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        let remaining_rounds = parse_duration(&details.duration).map(|seconds| seconds.div_ceil(6));
        self.cards.push(CompanionCard {
            id,
            template_id,
            current_hp: details.max_hp,
            details,
            remaining_rounds,
            turn: CompanionTurn::WithOwner,
        });
        id
    }

    pub fn sync_imported(&mut self, character: &ImportedCharacter) {
        let catalog = templates(character);
        for companion in &character.companions {
            if self.seen_imports.insert(companion.content_id.clone()) {
                let details = catalog
                    .get(&companion.content_id)
                    .cloned()
                    .unwrap_or_else(|| CompanionDetails {
                        name: companion
                            .saved_name
                            .clone()
                            .unwrap_or_else(|| companion.content_id.clone()),
                        ..CompanionDetails::default()
                    });
                self.add(Some(companion.content_id.clone()), details);
            }
        }
    }

    pub fn separate_turns(&self) -> Vec<(i32, u64)> {
        let mut turns: Vec<_> = self
            .cards
            .iter()
            .filter(|card| card.remaining_rounds != Some(0))
            .filter_map(|card| match card.turn {
                CompanionTurn::WithOwner => None,
                CompanionTurn::Separate(score) => Some((score, card.id)),
            })
            .collect();
        turns.sort_by_key(|&(score, id)| (std::cmp::Reverse(score), id));
        turns
    }
}

pub fn companion_templates(character: &ImportedCharacter) -> Vec<CompanionTemplate> {
    let mut templates: Vec<_> = templates(character)
        .into_iter()
        .map(|(id, details)| CompanionTemplate { id, details })
        .collect();
    templates.sort_by(|left, right| {
        left.details
            .name
            .cmp(&right.details.name)
            .then(left.id.cmp(&right.id))
    });
    templates
}

const CANNON: &str = "ID_WOTC_ERLW_ARCHETYPE_FEATURE_ARTILLERIST_ELDRITCH_CANNON";

/// Features whose action creates one of several companion variants (the sheet offers a Create
/// button and lets the player choose the variant).
pub fn is_summon_feature(id: &str) -> bool {
    id == CANNON
}

/// A summon feature by its Aurora ID, or by name and book in the tracker's mechanics overlay,
/// so other books' Eldritch Cannon content works too.
pub fn is_summon(id: &str, definition: Option<&ContentDefinition>) -> bool {
    is_summon_feature(id) || summon_mechanics(definition).is_some()
}

fn summon_mechanics(
    definition: Option<&ContentDefinition>,
) -> Option<&'static crate::mechanics::SummonMechanics> {
    let definition = definition?;
    if !definition
        .kind
        .as_deref()
        .is_some_and(crate::aurora::is_feature_kind)
    {
        return None;
    }
    crate::mechanics::overlay().summon(definition.name.as_deref()?, definition.source.as_deref())
}

/// The character's cannon feature: the known Aurora ID, or a feature the overlay recognizes.
fn cannon_feature(character: &ImportedCharacter) -> Option<(&str, &ContentDefinition)> {
    if let Some(cannon) = definition(character, CANNON) {
        return Some((CANNON, cannon));
    }
    character.features().find_map(|entry| {
        let definition = entry.definition.as_ref()?;
        summon_mechanics(Some(definition)).map(|_| (entry.content_id.as_str(), definition))
    })
}

/// The owner's level in a class, by the class's name, such as "Ranger".
fn class_level(character: &ImportedCharacter, class: &str) -> Option<u32> {
    let from_ids: u32 = character
        .class_levels
        .iter()
        .filter(|(id, _)| {
            definition(character, id)
                .and_then(|definition| definition.name.as_deref())
                .is_some_and(|name| name.eq_ignore_ascii_case(class))
                || id
                    .to_ascii_uppercase()
                    .ends_with(&format!("_CLASS_{}", class.to_ascii_uppercase()))
        })
        .map(|(_, level)| *level)
        .sum();
    if from_ids > 0 {
        return Some(from_ids);
    }
    profile_class_level(character, class)
}

fn ability_modifier(character: &ImportedCharacter, ability: &str) -> Option<i32> {
    let index = [
        "strength",
        "dexterity",
        "constitution",
        "intelligence",
        "wisdom",
        "charisma",
    ]
    .iter()
    .position(|name| name.eq_ignore_ascii_case(ability))?;
    character.profile.stats.modifiers[index]
}

fn formula_hp(character: &ImportedCharacter, formula: &crate::mechanics::HpFormula) -> Option<u32> {
    let level = class_level(character, &formula.class)?;
    let modifier = match &formula.ability {
        Some(ability) => Some(ability_modifier(character, ability)?),
        None => None,
    };
    formula.hit_points(level, modifier)
}

/// Fills what the import left out from the overlay: hit points worked out from the owner,
/// and, for a summon feature, its shared statistics and any variant the import lacks.
fn apply_overlay(
    character: &ImportedCharacter,
    templates: &mut BTreeMap<String, CompanionDetails>,
) {
    let overlay = crate::mechanics::overlay();
    for (id, details) in templates.iter_mut() {
        if details.max_hp.is_some() {
            continue;
        }
        let source = definition(character, id).and_then(|definition| definition.source.as_deref());
        let base_name = details.name.clone();
        let lookup = overlay.companion(&base_name, source).or_else(|| {
            let original = definition(character, id)?.name.as_deref()?;
            overlay.companion(original, source)
        });
        if let Some(companion) = lookup {
            details.max_hp = formula_hp(character, &companion.hp);
        }
    }
    let Some((feature_id, feature)) = cannon_feature(character) else {
        return;
    };
    let Some(summon) = summon_mechanics(Some(feature)) else {
        return;
    };
    let hp = summon
        .hp
        .as_ref()
        .and_then(|formula| formula_hp(character, formula));
    let fill = |value: &mut String, from: &str| {
        if value.trim().is_empty() {
            *value = from.to_owned();
        }
    };
    for variant in &summon.variants {
        let name = format!("{} — {}", summon.name, variant.name);
        let existing = templates.iter_mut().find(|(id, details)| {
            id.starts_with(feature_id)
                && details
                    .name
                    .to_ascii_lowercase()
                    .ends_with(&variant.name.to_ascii_lowercase())
        });
        let details = match existing {
            Some((_, details)) => details,
            None => {
                let key = format!(
                    "{feature_id}_{}",
                    variant.name.to_ascii_uppercase().replace(' ', "_")
                );
                let details = templates.entry(key).or_default();
                details.name = name;
                if variant.attack {
                    details.attacks = variant.summary.clone();
                } else {
                    details.abilities = variant.summary.clone();
                }
                details
            }
        };
        fill(&mut details.kind, &summon.kind);
        fill(&mut details.armor_class, &summon.armor_class);
        fill(&mut details.speed, &summon.speed);
        fill(&mut details.command, &summon.command);
        fill(&mut details.duration, &summon.duration);
        if details.max_hp.is_none() {
            details.max_hp = hp;
        }
    }
}

fn templates(character: &ImportedCharacter) -> BTreeMap<String, CompanionDetails> {
    let mut templates: BTreeMap<_, _> = character
        .companion_definitions
        .iter()
        .filter_map(|(id, definition)| {
            let definition = definition
                .as_ref()
                .filter(|definition| definition.kind.as_deref() == Some("Companion"))?;
            Some((id.clone(), read_template(character, id, definition)))
        })
        .collect();
    let command_sources: Vec<_> = character
        .features()
        .filter_map(|entry| entry.definition.as_ref())
        .filter(|source| {
            source.rules().any(|rule| {
                rule.tag == "select"
                    && rule
                        .attributes
                        .get("type")
                        .is_some_and(|kind| kind == "Companion")
            })
        })
        .filter_map(|source| command_sentence(&description(source)))
        .collect();
    for entry in &character.companions {
        let details = templates
            .entry(entry.content_id.clone())
            .or_insert_with(|| {
                entry.definition.as_ref().map_or_else(
                    || CompanionDetails {
                        name: entry.content_id.clone(),
                        ..CompanionDetails::default()
                    },
                    |definition| read_template(character, &entry.content_id, definition),
                )
            });
        if let Some(name) = &entry.saved_name {
            details.name = name.clone();
        }
        if details.command.is_empty() && command_sources.len() == 1 {
            details.command = command_sources[0].clone();
        }
    }
    if let Some((cannon_id, cannon)) = cannon_feature(character) {
        let shared = description(cannon);
        for grant in cannon.rules().filter(|rule| rule.tag == "grant") {
            let Some(id) = grant
                .attributes
                .get("id")
                .filter(|id| id.starts_with(cannon_id))
            else {
                continue;
            };
            let Some(variant) = definition(character, id) else {
                continue;
            };
            let mut details = read_template(character, id, variant);
            details.name = format!("Eldritch Cannon — {}", details.name);
            details.kind = "Construct".into();
            let activation = cannon_setter(variant, cannon, "command");
            details.command =
                activation.unwrap_or_else(|| command_sentence(&shared).unwrap_or_default());
            details.armor_class = cannon_setter(variant, cannon, "ac")
                .or_else(|| {
                    shared
                        .split_once("AC of ")?
                        .1
                        .split_whitespace()
                        .next()
                        .map(str::to_owned)
                })
                .unwrap_or_default();
            details.duration = cannon_setter(variant, cannon, "duration")
                .or_else(|| {
                    let rest = shared.split_once("or after ")?.1;
                    Some(
                        rest.split_whitespace()
                            .take(2)
                            .collect::<Vec<_>>()
                            .join(" ")
                            .trim_end_matches('.')
                            .to_owned(),
                    )
                })
                .unwrap_or_default();
            details.max_hp = details
                .max_hp
                .or_else(|| cannon_setter(variant, cannon, "hp").and_then(|hp| hp_number(&hp)))
                .or_else(|| {
                    if shared
                        .to_ascii_lowercase()
                        .contains("five times your artificer level")
                    {
                        artificer_level(character)?.checked_mul(5)
                    } else {
                        None
                    }
                });
            if details.max_hp.is_none() && setter(variant, "hp").is_none() {
                if let Some(formula) = setter(cannon, "hp") {
                    details.stats = append(details.stats, &format!("HP: {formula}"));
                }
            }
            details.speed = cannon_setter(variant, cannon, "speed")
                .or_else(|| {
                    if shared.contains("walk or climb up to 15 feet") {
                        Some("15 ft. walk or climb with legs".into())
                    } else {
                        None
                    }
                })
                .unwrap_or_default();
            let effect = description(variant);
            if effect.to_ascii_lowercase().contains("attack") {
                details.attacks = append(details.attacks, &effect);
            } else {
                details.abilities = append(details.abilities, &effect);
            }
            details.abilities = append(details.abilities, &shared);
            templates.insert(id.clone(), details);
        }
    }
    apply_overlay(character, &mut templates);
    templates
}

fn definition<'a>(character: &'a ImportedCharacter, id: &str) -> Option<&'a ContentDefinition> {
    character
        .definitions
        .get(id)
        .and_then(Option::as_ref)
        .or_else(|| {
            character
                .companion_definitions
                .get(id)
                .and_then(Option::as_ref)
        })
}

fn read_template(
    character: &ImportedCharacter,
    id: &str,
    source: &ContentDefinition,
) -> CompanionDetails {
    let get = |key| setter(source, key).unwrap_or_default();
    let mut details = CompanionDetails {
        name: source.name.clone().unwrap_or_else(|| id.to_owned()),
        kind: get("type"),
        armor_class: get("ac"),
        speed: get("speed"),
        max_hp: hp_number(&get("hp")),
        command: get("command"),
        duration: get("duration"),
        ..CompanionDetails::default()
    };
    let mut stats: Vec<_> = [
        "strength",
        "dexterity",
        "constitution",
        "intelligence",
        "wisdom",
        "charisma",
        "saves",
        "skills",
        "size",
        "senses",
        "immunities",
        "conditionImmunities",
        "languages",
    ]
    .into_iter()
    .filter_map(|name| setter(source, name).map(|value| format!("{name}: {value}")))
    .collect();
    if details.max_hp.is_none() && !get("hp").is_empty() {
        stats.push(format!("HP: {}", get("hp")));
    }
    details.stats = stats.join("\n");
    for reference in &source.referenced_ids {
        let Some(part) = definition(character, reference) else {
            continue;
        };
        let kind = part.kind.as_deref().unwrap_or("");
        if !kind.starts_with("Companion ") {
            continue;
        }
        let text = format!(
            "{}: {}",
            part.name.as_deref().unwrap_or(reference),
            description(part)
        );
        if kind == "Companion Action" && text.to_ascii_lowercase().contains("attack") {
            details.attacks = append(details.attacks, &text);
        } else {
            details.abilities = append(details.abilities, &text);
        }
    }
    if source.kind.as_deref() == Some("Companion") {
        details.abilities = append(details.abilities, &description(source));
    }
    details
}

pub(crate) fn hp_number(value: &str) -> Option<u32> {
    if let Ok(number) = value.parse() {
        return Some(number);
    }
    value.split_once(" (")?.0.parse().ok()
}

pub(crate) fn setter(source: &ContentDefinition, name: &str) -> Option<String> {
    source
        .element
        .children_named("setters")
        .flat_map(|setters| setters.children_named("set"))
        .find(|set| {
            set.attributes
                .get("name")
                .is_some_and(|key| key.eq_ignore_ascii_case(name))
        })
        .map(text)
        .filter(|value| !value.is_empty())
}

fn cannon_setter(
    variant: &ContentDefinition,
    parent: &ContentDefinition,
    name: &str,
) -> Option<String> {
    setter(variant, name).or_else(|| setter(parent, name))
}

pub(crate) fn description(source: &ContentDefinition) -> String {
    let full: Vec<_> = source
        .element
        .children_named("description")
        .map(text)
        .filter(|value| !value.is_empty())
        .collect();
    if !full.is_empty() {
        return full.join("\n");
    }
    source
        .element
        .children_named("sheet")
        .flat_map(|sheet| sheet.children_named("description"))
        .map(text)
        .collect::<Vec<_>>()
        .join("\n")
}

fn text(element: &ContentElement) -> String {
    let mut result = String::new();
    for child in &element.children {
        match child {
            ContentNode::Text(value) => result.push_str(value),
            ContentNode::Element(node) => {
                result.push_str(&text(node));
                if matches!(node.tag.as_str(), "p" | "li" | "td" | "tr" | "br") {
                    result.push('\n');
                }
            }
        }
    }
    result.trim().to_owned()
}

fn append(mut existing: String, addition: &str) -> String {
    if !addition.trim().is_empty() {
        if !existing.is_empty() {
            existing.push('\n');
        }
        existing.push_str(addition);
    }
    existing
}

fn command_sentence(source: &str) -> Option<String> {
    let commands = source
        .split_inclusive('.')
        .map(str::trim)
        .filter(|sentence| {
            let lower = sentence.to_ascii_lowercase();
            [
                "bonus action",
                "use your action",
                "use an action",
                "as an action",
                "no action required",
            ]
            .iter()
            .any(|cost| lower.contains(cost))
                && ["command", "activate"]
                    .iter()
                    .any(|verb| lower.contains(verb))
        })
        .collect::<Vec<_>>()
        .join(" ");
    (!commands.is_empty()).then_some(commands)
}

fn artificer_level(character: &ImportedCharacter) -> Option<u32> {
    profile_class_level(character, "Artificer")
}

fn profile_class_level(character: &ImportedCharacter, class: &str) -> Option<u32> {
    let classes = &character
        .profile
        .fields
        .iter()
        .find(|field| field.label == "Class")?
        .value;
    let artificer = classes.split('/').map(str::trim).find(|entry| {
        entry
            .split_whitespace()
            .next()
            .is_some_and(|name| name.eq_ignore_ascii_case(class))
    })?;
    if let Some((_, level)) = artificer.split_once('(') {
        return level.trim_end_matches(')').trim().parse().ok();
    }
    if classes.contains('/') {
        return None;
    }
    character
        .profile
        .fields
        .iter()
        .find(|field| field.label == "Level")?
        .value
        .parse()
        .ok()
}
