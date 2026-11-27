use std::collections::{BTreeMap, BTreeSet};

use super::{
    ABILITIES, ContentDefinition, ContentElement, SavedReference,
    profile::{WornGear, equipped_requirement, stat_requirement},
};

pub const SKILLS: [(&str, usize); 18] = [
    ("Acrobatics", 1),
    ("Animal Handling", 4),
    ("Arcana", 3),
    ("Athletics", 0),
    ("Deception", 5),
    ("History", 3),
    ("Insight", 4),
    ("Intimidation", 5),
    ("Investigation", 3),
    ("Medicine", 4),
    ("Nature", 3),
    ("Perception", 4),
    ("Performance", 5),
    ("Persuasion", 5),
    ("Religion", 3),
    ("Sleight of Hand", 1),
    ("Stealth", 1),
    ("Survival", 4),
];

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RollProficiency {
    #[default]
    None,
    Half,
    HalfRoundedUp,
    Full,
    Expertise,
}

impl RollProficiency {
    pub fn label(self) -> &'static str {
        match self {
            Self::None => "",
            Self::Half => "Half proficiency",
            Self::HalfRoundedUp => "Half proficiency (rounded up)",
            Self::Full => "Proficient",
            Self::Expertise => "Expertise",
        }
    }

    fn bonus(self, proficiency: Option<i32>) -> Option<i32> {
        if self == Self::None {
            return Some(0);
        }
        let proficiency = proficiency?;
        Some(match self {
            Self::None => 0,
            Self::Half => proficiency / 2,
            Self::HalfRoundedUp => (proficiency + 1) / 2,
            Self::Full => proficiency,
            Self::Expertise => 2 * proficiency,
        })
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct RollModifier {
    pub ability: Option<i32>,
    pub training: RollProficiency,
    pub proficiency: Option<i32>,
    pub other: Option<i32>,
}

impl RollModifier {
    pub fn total(self) -> Option<i32> {
        Some(self.ability? + self.proficiency? + self.other?)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolProficiency {
    pub name: String,
    pub training: RollProficiency,
    pub bonus: Option<i32>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RollBonuses {
    pub proficiency_bonus: Option<i32>,
    pub skills: [RollModifier; 18],
    pub saves: [RollModifier; 6],
    pub checks: [RollModifier; 6],
    pub initiative: RollModifier,
    pub passive: [Option<i32>; 3],
    pub tools: Vec<ToolProficiency>,
}

pub(super) fn read_rolls(
    summary: &[SavedReference<'_, '_>],
    definitions: &BTreeMap<String, Option<ContentDefinition>>,
    active: &BTreeSet<&str>,
    gear: WornGear,
    level: Option<i32>,
    abilities: [Option<i32>; 6],
) -> RollBonuses {
    let mut stats = BTreeMap::<&str, Vec<&ContentElement>>::new();
    for rule in active
        .iter()
        .filter_map(|id| definitions.get(*id)?.as_ref())
        .flat_map(ContentDefinition::rules)
        .filter(|rule| {
            rule.tag == "stat"
                && stat_requirement(rule, active) != Some(false)
                && equipped_requirement(rule, gear) != Some(false)
        })
    {
        if let Some(name) = rule.attributes.get("name") {
            stats.entry(name).or_default().push(rule);
        }
    }
    let rules = RollRules {
        stats,
        active,
        gear,
        abilities,
        proficiency: level.map(|level| 2 + (level - 1) / 4),
    };
    // Aurora writes the 2014 Bard's general check bonus as individual skill and initiative rules.
    let general_training = if active.contains("ID_WOTC_PHB_CLASS_FEATURE_BARD_JACK_OF_ALL_TRADES") {
        RollProficiency::Half
    } else {
        RollProficiency::None
    };
    let check_names =
        ABILITIES.map(|ability| format!("{}:check:misc", ability.to_ascii_lowercase()));
    let checks = std::array::from_fn(|i| {
        rules.roll(
            i,
            general_training,
            &["ability check:misc", &check_names[i]],
            true,
        )
    });
    let saves = std::array::from_fn(|i| {
        let key = ABILITIES[i].to_ascii_lowercase();
        let proficient = active
            .contains(format!("ID_PROFICIENCY_SAVINGTHROW_{}", key.to_ascii_uppercase()).as_str());
        let training = rules.training(&format!("{key}:save:proficiency"), proficient);
        rules.roll(
            i,
            training,
            &[&format!("{key}:save:misc")],
            !summary.is_empty(),
        )
    });
    let skills = std::array::from_fn(|i| {
        let (name, ability) = SKILLS[i];
        let key = name.to_ascii_lowercase();
        let id = name.to_ascii_uppercase().replace(' ', "");
        let proficient = active.contains(format!("ID_PROFICIENCY_SKILL_{id}").as_str());
        let training = rules.training(&format!("{key}:proficiency"), proficient);
        rules.roll(
            ability,
            training.max(general_training),
            &[
                "ability check:misc",
                &check_names[ability],
                &format!("{key}:misc"),
            ],
            !summary.is_empty(),
        )
    });
    let initiative = rules.roll(
        1,
        general_training,
        &[
            "ability check:misc",
            &check_names[1],
            "initiative",
            "initiative:misc",
        ],
        !summary.is_empty(),
    );
    let passive = [(11, "perception"), (8, "investigation"), (6, "insight")].map(|(index, key)| {
        Some(10 + skills[index].total()? + rules.bonuses(&[&format!("{key}:passive")], false)?.1)
    });
    // These features double all trained tools and have no individual stat rules in Aurora.
    let tool_expertise = [
        "ID_WOTC_ERLW_CLASS_FEATURE_ARTIFICER_TOOL_EXPERTISE",
        "ID_WOTC_TCOE_CLASS_FEATURE_ARTIFICER_TOOL_EXPERTISE",
    ]
    .into_iter()
    .any(|id| active.contains(id));
    let mut tools = Vec::new();
    let mut seen_tools = BTreeSet::new();
    for reference in summary {
        let Some(id) = reference
            .id
            .strip_prefix("ID_PROFICIENCY_TOOL_PROFICIENCY_")
        else {
            continue;
        };
        if !seen_tools.insert(id) {
            continue;
        }
        let key = id.to_ascii_lowercase().replace('_', " ");
        let training = if tool_expertise {
            RollProficiency::Expertise
        } else {
            rules.training(&format!("{key}:proficiency"), true)
        };
        let name = definitions
            .get(reference.id)
            .and_then(Option::as_ref)
            .and_then(|definition| definition.name.as_deref())
            .or_else(|| reference.node.attribute("name"))
            .map(|name| {
                name.strip_prefix("Tool Proficiency (")
                    .and_then(|name| name.strip_suffix(')'))
                    .unwrap_or(name)
                    .to_owned()
            })
            .unwrap_or_else(|| key.clone());
        tools.push(ToolProficiency {
            name,
            training,
            bonus: training.bonus(rules.proficiency),
        });
    }
    tools.sort_by_cached_key(|tool| tool.name.to_ascii_lowercase());
    RollBonuses {
        proficiency_bonus: rules.proficiency,
        skills,
        saves,
        checks,
        initiative,
        passive,
        tools,
    }
}

struct RollRules<'a> {
    stats: BTreeMap<&'a str, Vec<&'a ContentElement>>,
    active: &'a BTreeSet<&'a str>,
    gear: WornGear,
    abilities: [Option<i32>; 6],
    proficiency: Option<i32>,
}

impl RollRules<'_> {
    fn applicable(&self, rule: &ContentElement) -> bool {
        stat_requirement(rule, self.active) == Some(true)
            && !rule.attributes.contains_key("level")
            && equipped_requirement(rule, self.gear) == Some(true)
    }

    fn training(&self, key: &str, proficient: bool) -> RollProficiency {
        if self.stats.get(key).into_iter().flatten().any(|rule| {
            self.applicable(rule)
                && rule
                    .attributes
                    .get("bonus")
                    .is_some_and(|value| value == "double")
                && rule
                    .attributes
                    .get("value")
                    .is_some_and(|value| value == "proficiency")
        }) {
            RollProficiency::Expertise
        } else if proficient {
            RollProficiency::Full
        } else {
            RollProficiency::None
        }
    }

    fn roll(
        &self,
        index: usize,
        training: RollProficiency,
        keys: &[&str],
        known: bool,
    ) -> RollModifier {
        let bonuses = self.bonuses(keys, true);
        let training = bonuses.map_or(training, |(extra, _)| extra.max(training));
        RollModifier {
            ability: self.abilities[index],
            training,
            proficiency: known.then(|| training.bonus(self.proficiency)).flatten(),
            other: bonuses.map(|(_, other)| other),
        }
    }

    fn bonuses(&self, keys: &[&str], separate_proficiency: bool) -> Option<(RollProficiency, i32)> {
        let mut training = RollProficiency::None;
        let mut other = 0;
        let mut named = BTreeMap::<(&str, &str), i32>::new();
        for &key in keys {
            for rule in self.stats.get(key).into_iter().flatten() {
                if rule
                    .attributes
                    .get("inline")
                    .is_some_and(|value| value == "true")
                {
                    continue;
                }
                if !self.applicable(rule) {
                    return None;
                }
                let value = rule.attributes.get("value")?.trim();
                let contribution = match value {
                    "proficiency:half" | "proficiency:half:down" => RollProficiency::Half,
                    "proficiency:half:up" => RollProficiency::HalfRoundedUp,
                    "proficiency"
                        if key == "initiative"
                            || rule
                                .attributes
                                .get("bonus")
                                .is_some_and(|value| value == "proficiency") =>
                    {
                        RollProficiency::Full
                    }
                    _ => RollProficiency::None,
                };
                if separate_proficiency && contribution != RollProficiency::None {
                    training = training.max(contribution);
                    continue;
                }
                let amount = match value {
                    "proficiency" => self.proficiency?,
                    _ if contribution != RollProficiency::None => {
                        contribution.bonus(self.proficiency)?
                    }
                    _ if value.ends_with(":modifier") => {
                        let ability = value.strip_suffix(":modifier")?;
                        self.abilities[ABILITIES
                            .iter()
                            .position(|name| name.eq_ignore_ascii_case(ability))?]?
                    }
                    _ => i32::from(value.parse::<i16>().ok()?),
                };
                if let Some(group) = rule
                    .attributes
                    .get("bonus")
                    .filter(|value| !value.is_empty())
                {
                    named
                        .entry((key, group))
                        .and_modify(|current| *current = (*current).max(amount))
                        .or_insert(amount);
                } else {
                    other += amount;
                }
            }
        }
        Some((training, other + named.values().sum::<i32>()))
    }
}
