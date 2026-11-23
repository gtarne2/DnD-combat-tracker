use std::collections::{BTreeMap, BTreeSet};

use roxmltree::Node;

use super::rolls::{RollBonuses, read_rolls};
use super::{
    ContentDefinition, ContentElement, ContentNode, SavedReference, child, children_named,
};

pub const ABILITIES: [&str; 6] = [
    "Strength",
    "Dexterity",
    "Constitution",
    "Intelligence",
    "Wisdom",
    "Charisma",
];

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct KeyStats {
    pub max_hp: Option<i32>,
    pub armor_class: Option<i32>,
    pub speed: Option<String>,
    pub modifiers: [Option<i32>; 6],
    pub saves: [Option<i32>; 6],
    pub checks: [Option<i32>; 6],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileSection {
    Identity,
    Background,
    Personality,
    Lore,
}

impl ProfileSection {
    pub const ALL: [Self; 4] = [
        Self::Identity,
        Self::Background,
        Self::Personality,
        Self::Lore,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::Identity => "Identity",
            Self::Background => "Background",
            Self::Personality => "Personality",
            Self::Lore => "Lore",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileField {
    pub section: ProfileSection,
    pub label: &'static str,
    pub value: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct CharacterProfile {
    pub stats: KeyStats,
    pub fields: Vec<ProfileField>,
    pub rolls: RollBonuses,
    pub senses: Vec<String>,
    pub languages: Vec<String>,
}

pub(super) fn read_profile(
    root: Node<'_, '_>,
    build: Node<'_, '_>,
    summary: &[SavedReference<'_, '_>],
    definitions: &BTreeMap<String, Option<ContentDefinition>>,
) -> CharacterProfile {
    use ProfileSection::{Background, Identity, Lore, Personality};
    let display = child(root, "display-properties");
    let input = child(build, "input");
    let mut fields = Vec::new();
    let mut add = |section, label, node: Option<Node<'_, '_>>| {
        if let Some(value) = node.and_then(text) {
            fields.push(ProfileField {
                section,
                label,
                value,
            });
        }
    };
    for (tag, label, section) in [
        ("race", "Ancestry", Identity),
        ("class", "Class", Identity),
        ("archetype", "Archetype", Identity),
        ("level", "Level", Identity),
        ("background", "Background", Background),
    ] {
        add(section, label, display.and_then(|node| child(node, tag)));
    }
    for (tag, label, section) in [
        ("backstory", "Backstory", Lore),
        ("additional-features", "Additional features", Lore),
        ("background-traits", "Traits", Personality),
        ("background-ideals", "Ideals", Personality),
        ("background-bonds", "Bonds", Personality),
        ("background-flaws", "Flaws", Personality),
        ("background-trinket", "Trinket", Background),
    ] {
        add(section, label, input.and_then(|node| child(node, tag)));
    }
    let organization = input.and_then(|node| child(node, "organization"));
    add(
        Lore,
        "Organization",
        organization.and_then(|node| child(node, "name")),
    );
    add(
        Lore,
        "Allies",
        organization.and_then(|node| child(node, "allies")),
    );
    let feature = input
        .and_then(|node| child(node, "background"))
        .and_then(|node| child(node, "feature"));
    add(
        Background,
        "Feature description",
        feature.and_then(|node| child(node, "description")),
    );
    for note in input
        .and_then(|node| child(node, "notes"))
        .into_iter()
        .flat_map(|notes| children_named(notes, "note"))
    {
        add(Lore, "Notes", Some(note));
    }
    if let Some(name) = feature
        .and_then(|node| node.attribute("name"))
        .filter(|name| !name.trim().is_empty())
    {
        fields.push(ProfileField {
            section: Background,
            label: "Feature",
            value: name.trim().to_owned(),
        });
    }

    let levels: Vec<_> = child(build, "elements")
        .into_iter()
        .flat_map(|node| children_named(node, "element"))
        .filter(|node| node.attribute("type") == Some("Level"))
        .collect();
    let level = display
        .and_then(|node| child(node, "level"))
        .and_then(number)
        .or_else(|| (!levels.is_empty()).then_some(levels.len() as i32))
        .filter(|level| *level > 0);
    let inventory: BTreeMap<_, _> = child(build, "equipment")
        .into_iter()
        .flat_map(|items| children_named(items, "item"))
        .filter_map(|item| Some((item.attribute("id")?, is_equipped(item).is_some())))
        .fold(BTreeMap::new(), |mut items, (id, equipped)| {
            *items.entry(id).or_insert(false) |= equipped;
            items
        });
    let active = summary
        .iter()
        .map(|reference| reference.id)
        .filter(|id| !inventory.contains_key(id))
        .chain(
            inventory
                .iter()
                .filter_map(|(&id, &equipped)| equipped.then_some(id)),
        )
        .collect::<BTreeSet<_>>();
    // The summary lists actual active elements. Linked options can include unavailable grants.
    let modifiers: Vec<_> = active
        .iter()
        .filter_map(|id| definition(definitions, id))
        .flat_map(ContentDefinition::rules)
        .filter(|rule| active_stat(rule, &active))
        .collect();

    let ability_modifiers = ABILITIES.map(|ability| {
        let key = ability.to_ascii_lowercase();
        let base = child(build, "abilities")
            .and_then(|node| child(node, &key))
            .and_then(number)?;
        let bonus = stat_bonus(&modifiers, &key);
        Some((base + bonus - 10).div_euclid(2))
    });
    let rolls = read_rolls(summary, definitions, &active, level, ability_modifiers);
    let max_hp = max_hp(&levels, summary, definitions, &active, ability_modifiers[2])
        .map(|base| base + stat_bonus(&modifiers, "hp"));
    let armor_class = armor_class(build, definitions, ability_modifiers[1])
        .map(|base| base + stat_bonus(&modifiers, "ac"));
    let speed = movement(&modifiers);
    CharacterProfile {
        stats: KeyStats {
            max_hp,
            armor_class,
            speed,
            modifiers: ability_modifiers,
            saves: rolls.saves.map(|roll| roll.total()),
            checks: rolls.checks.map(|roll| roll.total()),
        },
        fields,
        rolls,
        senses: reference_names(summary, definitions, &["Vision", "Sense"]),
        languages: reference_names(summary, definitions, &["Language"]),
    }
}

fn reference_names(
    summary: &[SavedReference<'_, '_>],
    definitions: &BTreeMap<String, Option<ContentDefinition>>,
    kinds: &[&str],
) -> Vec<String> {
    summary
        .iter()
        .filter_map(|reference| {
            let definition = definition(definitions, reference.id);
            let kind = reference.kind.or_else(|| definition?.kind.as_deref())?;
            if !kinds.contains(&kind) {
                return None;
            }
            definition
                .and_then(|definition| definition.name.as_deref())
                .or_else(|| reference.node.attribute("name"))
                .map(str::to_owned)
                .or_else(|| {
                    reference
                        .id
                        .strip_prefix("ID_LANGUAGE_")
                        .map(|name| name.to_ascii_lowercase().replace('_', " "))
                })
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn text(node: Node<'_, '_>) -> Option<String> {
    let value: String = node
        .descendants()
        .filter(Node::is_text)
        .filter_map(|node| node.text())
        .collect();
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

fn number(node: Node<'_, '_>) -> Option<i32> {
    node.text()?.trim().parse::<i16>().ok().map(i32::from)
}

fn definition<'a>(
    definitions: &'a BTreeMap<String, Option<ContentDefinition>>,
    id: &str,
) -> Option<&'a ContentDefinition> {
    definitions.get(id)?.as_ref()
}

fn active_stat(rule: &ContentElement, active: &BTreeSet<&str>) -> bool {
    if rule.tag != "stat"
        || rule.attributes.keys().any(|key| {
            !matches!(
                key.as_str(),
                "name" | "value" | "bonus" | "requirements" | "alt"
            )
        })
    {
        return false;
    }
    stat_requirement(rule, active) == Some(true)
}

pub(super) fn stat_requirement(rule: &ContentElement, active: &BTreeSet<&str>) -> Option<bool> {
    let Some(value) = rule
        .attributes
        .get("requirements")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return Some(true);
    };
    let id = value.strip_prefix('!').unwrap_or(value);
    (id.starts_with("ID_")
        && id
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_'))
    .then(|| active.contains(id) != value.starts_with('!'))
}

fn stat_bonus(rules: &[&ContentElement], name: &str) -> i32 {
    rules
        .iter()
        .filter(|rule| {
            rule.attributes
                .get("name")
                .is_some_and(|value| value == name)
        })
        .filter_map(|rule| rule.attributes.get("value")?.parse::<i16>().ok())
        .map(i32::from)
        .sum()
}

fn setter<'a>(definition: &'a ContentDefinition, name: &str) -> Option<&'a str> {
    let setter = definition
        .element
        .children_named("setters")
        .flat_map(|setters| setters.children_named("set"))
        .find(|setter| {
            setter
                .attributes
                .get("name")
                .is_some_and(|value| value == name)
        })?;
    setter.children.iter().find_map(|child| match child {
        ContentNode::Text(value) if !value.trim().is_empty() => Some(value.trim()),
        _ => None,
    })
}

fn max_hp(
    levels: &[Node<'_, '_>],
    summary: &[SavedReference<'_, '_>],
    definitions: &BTreeMap<String, Option<ContentDefinition>>,
    active: &BTreeSet<&str>,
    constitution: Option<i32>,
) -> Option<i32> {
    let constitution = constitution?;
    let mut classes = summary
        .iter()
        .filter(|reference| reference.kind == Some("Class"));
    let main = classes.next()?.id;
    if classes.next().is_some() || levels.is_empty() {
        return None;
    }
    let average = active.contains("ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP");
    let mut rolled = levels[0].attribute("rndhp").unwrap_or_default().split(',');
    let mut hp = 0;
    for (index, level) in levels.iter().enumerate() {
        let class = level
            .attribute("class")
            .filter(|value| !value.is_empty())
            .unwrap_or(main);
        let die = i32::from(
            setter(definition(definitions, class)?, "hd")?
                .strip_prefix('d')?
                .parse::<u8>()
                .ok()?,
        );
        if die < 2 {
            return None;
        }
        let roll = rolled.next();
        let base = if index == 0 {
            die
        } else if average {
            die / 2 + 1
        } else {
            roll?
                .trim()
                .parse::<i32>()
                .ok()
                .filter(|value| (1..=die).contains(value))?
        };
        hp += (base + constitution).max(1);
    }
    Some(hp)
}

fn is_equipped<'a, 'input>(item: Node<'a, 'input>) -> Option<Node<'a, 'input>> {
    child(item, "equipped").filter(|node| node.text().map(str::trim) == Some("true"))
}

fn armor_class(
    build: Node<'_, '_>,
    definitions: &BTreeMap<String, Option<ContentDefinition>>,
    dexterity: Option<i32>,
) -> Option<i32> {
    let mut armor = None;
    let mut shield = 0;
    for item in child(build, "equipment")
        .into_iter()
        .flat_map(|items| children_named(items, "item"))
    {
        let Some(equipped) = is_equipped(item) else {
            continue;
        };
        let data = item
            .attribute("id")
            .and_then(|id| definition(definitions, id));
        let Some(data) = data else {
            if matches!(
                equipped.attribute("location"),
                Some("Armor" | "Secondary Hand")
            ) {
                return None;
            }
            continue;
        };
        let Some(armor_type) = setter(data, "armor") else {
            if data.kind.as_deref() == Some("Armor") {
                return None;
            }
            continue;
        };
        let formula = setter(data, "armorClass")?;
        match armor_type {
            "Shield" if shield == 0 => shield = i32::from(formula.parse::<i16>().ok()?),
            "Light" | "Medium" | "Heavy" if armor.is_none() => {
                let lower = formula.to_ascii_lowercase();
                armor = Some(
                    if let Some((base, tail)) = lower.split_once(" + dex modifier") {
                        let dexterity = dexterity?;
                        let modifier = if tail.is_empty() {
                            dexterity
                        } else {
                            let cap = tail
                                .trim()
                                .strip_prefix("(max ")?
                                .strip_suffix(')')?
                                .parse::<i16>()
                                .ok()?;
                            dexterity.min(i32::from(cap))
                        };
                        i32::from(base.parse::<i16>().ok()?) + modifier
                    } else {
                        i32::from(formula.parse::<i16>().ok()?)
                    },
                );
            }
            _ => return None,
        }
    }
    Some(armor.or_else(|| dexterity.map(|modifier| 10 + modifier))? + shield)
}

fn movement(modifiers: &[&ContentElement]) -> Option<String> {
    let speeds = |key: &str, walk: Option<i32>| {
        modifiers
            .iter()
            .filter(|rule| {
                rule.attributes
                    .get("name")
                    .is_some_and(|value| value == key)
            })
            .filter_map(|rule| {
                let value = rule.attributes.get("value")?;
                if value == "speed" {
                    walk
                } else {
                    value.parse::<i16>().ok().map(i32::from)
                }
            })
            .max()
    };
    let walk = speeds("innate speed", None)
        .map(|speed| speed + stat_bonus(modifiers, "speed") + stat_bonus(modifiers, "speed:misc"));
    let mut labels = Vec::new();
    if let Some(walk) = walk {
        labels.push(format!("{walk} ft. walk"));
    }
    for (key, label) in [
        ("speed:climb", "climb"),
        ("speed:fly", "fly"),
        ("speed:swim", "swim"),
        ("speed:burrow", "burrow"),
    ] {
        if let Some(value) = speeds(key, walk) {
            labels.push(format!("{value} ft. {label}"));
        }
    }
    (!labels.is_empty()).then(|| labels.join(" · "))
}
