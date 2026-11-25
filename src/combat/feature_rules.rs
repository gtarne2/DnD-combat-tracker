use std::{
    cell::OnceCell,
    collections::{BTreeMap, HashSet},
};

use crate::aurora::{
    ABILITIES, ContentDefinition, ContentElement, ImportedCharacter, is_feature_kind,
};

use super::{CombatOption, CombatResource, OptionKind, attr, lookup, moxie, plain_text, words};

pub(super) fn attacks_per_action(character: &ImportedCharacter) -> u32 {
    character
        .features()
        .filter_map(|feature| {
            let values =
                RuleValues::new(character, &feature.content_id, feature.definition.as_ref());
            let attacks = u32::try_from(values.value("extra attack:count")?).ok()?;
            (2..=20).contains(&attacks).then_some(attacks)
        })
        .max()
        .unwrap_or(1)
}

pub(super) fn sneak_attack(character: &ImportedCharacter) -> Option<String> {
    character.features().find_map(|feature| {
        let values = RuleValues::new(character, &feature.content_id, feature.definition.as_ref());
        let count = values.value("sneak-attack:count")?;
        let sides = values.value("sneak-attack:die")?;
        (count > 0 && sides > 1).then(|| format!("{count}d{sides}"))
    })
}

pub(super) struct RuleValues<'a> {
    character: &'a ImportedCharacter,
    definition: Option<&'a ContentDefinition>,
    id: &'a str,
    owner: OnceCell<Option<(&'a str, u32)>>,
}

impl<'a> RuleValues<'a> {
    pub fn new(
        character: &'a ImportedCharacter,
        id: &'a str,
        definition: Option<&'a ContentDefinition>,
    ) -> Self {
        Self {
            character,
            definition,
            id,
            owner: OnceCell::new(),
        }
    }

    pub fn class_level(&self) -> Option<u32> {
        self.owner().map(|(_, level)| level)
    }

    fn owner(&self) -> Option<(&'a str, u32)> {
        *self.owner.get_or_init(|| self.find_owner())
    }

    fn find_owner(&self) -> Option<(&'a str, u32)> {
        let kind = self.definition?.kind.as_deref()?;
        if !matches!(kind, "Class Feature" | "Archetype Feature") {
            return None;
        }
        let mut candidates = self
            .character
            .class_levels
            .iter()
            .filter(|(id, _)| class_grants(self.character, id, self.id));
        if let Some((id, level)) = candidates.next() {
            candidates.next().is_none().then_some((id.as_str(), *level))
        } else {
            self.character
                .class_levels
                .iter()
                .next()
                .filter(|_| self.character.class_levels.len() == 1)
                .map(|(id, level)| (id.as_str(), *level))
        }
    }

    pub fn value(&self, name: &str) -> Option<i32> {
        self.resolve(name, &mut HashSet::new())
    }

    fn resolve(&self, name: &str, path: &mut HashSet<String>) -> Option<i32> {
        let name = name.trim();
        if let Ok(value) = name.parse() {
            return Some(value);
        }
        if name == "proficiency" {
            return self.character.profile.rolls.proficiency_bonus;
        }
        if let Some(ability) = name.strip_suffix(":modifier")
            && let Some(index) = ABILITIES
                .iter()
                .position(|name| name.eq_ignore_ascii_case(ability))
        {
            return self.character.profile.stats.modifiers[index];
        }
        if let Some(class) = name.strip_prefix("level:") {
            let mut matches = self.character.class_levels.iter().filter(|(id, _)| {
                lookup(self.character, id)
                    .and_then(|definition| definition.name.as_deref())
                    .is_some_and(|name| name.eq_ignore_ascii_case(class))
            });
            let level = *matches.next()?.1;
            return matches
                .next()
                .is_none()
                .then(|| i32::try_from(level).ok())
                .flatten();
        }
        if path.len() >= 32 || !path.insert(name.to_owned()) {
            return None;
        }
        let result = self.stat(name, path);
        path.remove(name);
        result
    }

    fn stat(&self, name: &str, path: &mut HashSet<String>) -> Option<i32> {
        let definition = self.definition?;
        let matches =
            |rule: &ContentElement| rule.tag == "stat" && attr(rule, "name") == Some(name);
        let related = self
            .character
            .features()
            .filter(|entry| {
                entry.content_id != self.id && self.character.active_ids.contains(&entry.content_id)
            })
            .filter_map(|entry| Some((entry, entry.definition.as_ref()?)))
            .filter(|(entry, definition)| {
                definition.rules().any(matches)
                    && self.owner().is_some_and(|(class, _)| {
                        class_grants(self.character, class, &entry.content_id)
                    })
            })
            .flat_map(|(_, definition)| definition.rules());
        let mut total = None::<i32>;
        let mut bonuses = BTreeMap::<&str, i32>::new();
        for rule in definition
            .rules()
            .chain(related)
            .filter(|rule| matches(rule))
        {
            if !moxie::requirement(attr(rule, "requirements"), self.character)? {
                continue;
            }
            if let Some(level) = attr(rule, "level")
                && self.class_level()? < level.parse().ok()?
            {
                continue;
            }
            if rule.attributes.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "name" | "value" | "bonus" | "level" | "requirements"
                )
            }) {
                return None;
            }
            let value = self.resolve(attr(rule, "value")?, path)?;
            if let Some(group) = attr(rule, "bonus") {
                bonuses
                    .entry(group)
                    .and_modify(|best| *best = (*best).max(value))
                    .or_insert(value);
            } else {
                total = Some(total.unwrap_or(0).checked_add(value)?);
            }
        }
        if total.is_none() && bonuses.is_empty() {
            return None;
        }
        bonuses
            .values()
            .try_fold(total.unwrap_or(0), |sum, value| sum.checked_add(*value))
    }

    pub fn interpolate(&self, text: &str) -> String {
        let mut output = String::new();
        let mut rest = text;
        while let Some((prefix, tail)) = rest.split_once("{{")
            && let Some((stat, remainder)) = tail.split_once("}}")
        {
            output.push_str(prefix);
            if let Some(value) = self.value(stat) {
                output.push_str(&value.to_string());
            } else {
                output.push_str("{{");
                output.push_str(stat);
                output.push_str("}}");
            }
            rest = remainder;
        }
        output.push_str(rest);
        output
    }
}

fn class_grants(character: &ImportedCharacter, class: &str, target: &str) -> bool {
    let mut pending = vec![class];
    let mut seen = HashSet::new();
    while let Some(id) = pending.pop() {
        if id == target {
            return true;
        }
        if !seen.insert(id) {
            continue;
        }
        let Some(definition) = lookup(character, id) else {
            continue;
        };
        for rule in definition.rules() {
            if rule.tag == "grant"
                && attr(rule, "type")
                    .is_some_and(|kind| is_feature_kind(kind) || kind == "Archetype")
                && let Some(id) = attr(rule, "id")
            {
                pending.push(id);
            }
            if rule.tag == "select"
                && attr(rule, "type") == Some("Archetype")
                && let Some(support) = attr(rule, "supports")
            {
                pending.extend(
                    character
                        .build_elements
                        .iter()
                        .filter(|reference| {
                            reference.kind() == Some("Archetype")
                                && reference.definition.as_ref().is_some_and(|archetype| {
                                    archetype.element.children_named("supports").any(|node| {
                                        plain_text(&node.children)
                                            .split(',')
                                            .any(|tag| tag.trim() == support)
                                    })
                                })
                        })
                        .map(|reference| reference.content_id.as_str()),
                );
            }
        }
    }
    false
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceBinding {
    pub key: String,
    /// A missing cost lets the player choose how much to spend.
    pub cost: Option<u32>,
}

const SHARED: [(&str, &str); 4] = [
    ("ki:points", "Ki"),
    ("sorcery-points", "Sorcery Points"),
    ("superiority dice:amount", "Superiority Dice"),
    ("channel divinity:count", "Channel Divinity"),
];

pub(super) fn shared_pool(
    character: &ImportedCharacter,
    option: &CombatOption,
) -> Option<CombatResource> {
    let key = option.pin_key.as_deref()?;
    let id = key.strip_prefix("Feature:")?;
    let definition = lookup(character, id)?;
    let (stat, name) = shared_stat(definition)?;
    let text = plain_text(&option.description).to_ascii_lowercase();
    let recovery = if text.contains("short or long rest") || text.contains("short rest") {
        "short"
    } else if text.contains("long rest") {
        "long"
    } else {
        return None;
    };
    let capacity =
        u32::try_from(RuleValues::new(character, id, Some(definition)).value(stat)?).ok()?;
    (capacity > 0).then(|| CombatResource {
        key: key.to_owned(),
        name: name.to_owned(),
        capacity,
        recovery,
        recharge_die: None,
        dawn_recharge: None,
    })
}

fn shared_stat(definition: &ContentDefinition) -> Option<(&'static str, &'static str)> {
    SHARED.into_iter().find(|(stat, _)| {
        definition
            .rules()
            .any(|rule| rule.tag == "stat" && attr(rule, "name") == Some(stat))
    })
}

pub(super) fn bind_pool(
    character: &ImportedCharacter,
    option: &CombatOption,
    pools: &[CombatResource],
) -> Option<ResourceBinding> {
    if option.kind != OptionKind::Feature || option.moxie.is_some() {
        return None;
    }
    let key = option.pin_key.as_deref()?;
    let definition = lookup(character, key.strip_prefix("Feature:")?)?;
    if definition.element.children_named("sheet").any(|sheet| {
        attr(sheet, "usage")
            .into_iter()
            .chain(
                sheet
                    .children_named("description")
                    .filter_map(|entry| attr(entry, "usage")),
            )
            .any(|usage| usage.starts_with("{{lay on hands:hp pool}}/"))
    }) && pools.iter().any(|pool| pool.key == key)
    {
        return Some(ResourceBinding {
            key: key.to_owned(),
            cost: None,
        });
    }
    if shared_stat(definition).is_some()
        || option.details.iter().any(|detail| {
            detail.label == "Uses"
                && (detail.value.contains('/') || detail.value.eq_ignore_ascii_case("Unlimited"))
        })
    {
        return None;
    }
    let text = plain_text(&option.description).to_ascii_lowercase();
    let mut choices = pools.iter().filter_map(|pool| {
        if pool.key == key {
            return None;
        }
        let cost = match pool.name.as_str() {
            "Ki" => fixed_cost(&text, "ki", "point", "points"),
            "Sorcery Points" => fixed_cost(&text, "sorcery", "point", "points"),
            "Superiority Dice" => fixed_cost(&text, "superiority", "die", "dice"),
            "Channel Divinity" => option
                .details
                .iter()
                .any(|entry| entry.label == "Uses" && entry.value == pool.name)
                .then_some(1),
            _ => None,
        }?;
        Some(ResourceBinding {
            key: pool.key.clone(),
            cost: Some(cost),
        })
    });
    let binding = choices.next()?;
    choices.next().is_none().then_some(binding)
}

pub(super) fn pool_save_dc(
    character: &ImportedCharacter,
    option: &CombatOption,
    binding: &ResourceBinding,
) -> Option<String> {
    if option
        .details
        .iter()
        .any(|detail| detail.label == "Save DC")
        || !plain_text(&option.description)
            .to_ascii_lowercase()
            .contains("saving throw")
    {
        return None;
    }
    let id = binding.key.strip_prefix("Feature:")?;
    let definition = lookup(character, id)?;
    let stat = match shared_stat(definition)?.0 {
        "ki:points" => "ki:dc",
        "superiority dice:amount" => "superiority dice:dc",
        _ => return None,
    };
    let dc = RuleValues::new(character, id, Some(definition)).value(stat)?;
    (dc > 0).then(|| dc.to_string())
}

fn fixed_cost(text: &str, resource: &str, unit: &str, plural: &str) -> Option<u32> {
    let tokens = words(text);
    let mut costs = tokens.windows(4).filter_map(|phrase| {
        if !matches!(phrase[0], "spend" | "expend" | "spending" | "expending")
            || phrase[2] != resource
            || (phrase[3] != unit && phrase[3] != plural)
        {
            return None;
        }
        let amount = match phrase[1] {
            "a" | "one" => 1,
            "two" => 2,
            "three" => 3,
            "four" => 4,
            "five" => 5,
            amount => amount.parse().ok()?,
        };
        (amount > 0).then_some(amount)
    });
    let first = costs.next()?;
    costs.all(|cost| cost == first).then_some(first)
}
