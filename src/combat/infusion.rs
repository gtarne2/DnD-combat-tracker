use std::collections::BTreeMap;

use crate::aurora::ImportedCharacter;

use super::{CombatResource, description, lookup, plain_text, setter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InfusionAttack {
    pub scope: &'static str,
    pub attack: u32,
    pub damage: u32,
}

pub(super) fn resources(character: &ImportedCharacter) -> impl Iterator<Item = CombatResource> {
    character.infusions.iter().filter_map(|(id, name)| {
        let definition = lookup(character, id)?;
        let text = plain_text(&description(character, id, Some(definition))).to_ascii_lowercase();
        let words: Vec<_> = text
            .split(|ch: char| !ch.is_ascii_alphanumeric())
            .filter(|word| !word.is_empty())
            .collect();
        let capacity = setter(Some(definition), "charges")
            .and_then(|value| value.parse::<u32>().ok())
            .or_else(|| {
                words.windows(3).find_map(|phrase| match phrase {
                    ["has", value, "charges"] => value.parse::<u32>().ok(),
                    _ => None,
                })
            })?;
        let roll = words.windows(4).find_map(|phrase| match phrase {
            ["regains" | "regain", die, "expended", "charges"] => die
                .strip_prefix("1d")?
                .parse::<u32>()
                .ok()
                .filter(|die| (2..=100).contains(die)),
            _ => None,
        });
        // Mind Sharpener's printed recharge is at dawn. The tracker treats each rest as a recharge opportunity for this infusion.
        let recovery = if text.contains("short rest")
            || text.contains("short or long rest")
            || id.ends_with("_INFUSION_MIND_SHARPENER")
        {
            "short"
        } else if text.contains("long rest") {
            "long"
        } else {
            ""
        };
        (capacity > 0).then(|| CombatResource {
            key: format!("Charge:{id}"),
            name: name.clone(),
            capacity,
            recovery,
            recharge_die: roll,
            dawn_recharge: None,
        })
    })
}

pub(super) fn attack_bonuses(character: &ImportedCharacter) -> BTreeMap<String, InfusionAttack> {
    let level = character.class_levels.iter().find_map(|(id, level)| {
        (id.ends_with("_CLASS_ARTIFICER")
            || lookup(character, id).and_then(|class| class.name.as_deref()) == Some("Artificer"))
        .then_some(*level)
    });
    character
        .infusions
        .iter()
        .filter_map(|(id, _)| {
            let scope = if id.ends_with("_ENHANCED_ARCANE_FOCUS") {
                "spell"
            } else if ["_ENHANCED_WEAPON", "_RETURNING_WEAPON", "_REPEATING_SHOT"]
                .iter()
                .any(|suffix| id.ends_with(suffix))
            {
                "weapon"
            } else {
                return None;
            };
            let text = plain_text(&description(character, id, Some(lookup(character, id)?)))
                .to_ascii_lowercase();
            let clause = if scope == "spell" {
                " bonus to spell attack rolls"
            } else {
                " bonus to attack and damage rolls"
            };
            let attack = signed_bonus(text.split_once(clause)?.0.split_whitespace().last()?)?;
            let attack = if let Some((_, upgrade)) = text.split_once("bonus increases to ") {
                let (bonus, after) = upgrade.split_once(" when you reach ")?;
                let threshold = after
                    .split(|ch: char| !ch.is_ascii_digit())
                    .next()?
                    .parse::<u32>()
                    .ok()?;
                if level.is_some_and(|level| level >= threshold) {
                    signed_bonus(bonus)?
                } else {
                    attack
                }
            } else {
                attack
            };
            Some((
                id.clone(),
                InfusionAttack {
                    scope,
                    attack,
                    damage: if scope == "weapon" { attack } else { 0 },
                },
            ))
        })
        .collect()
}

fn signed_bonus(value: &str) -> Option<u32> {
    value.strip_prefix('+')?.parse().ok()
}
