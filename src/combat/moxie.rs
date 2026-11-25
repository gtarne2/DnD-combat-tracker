use std::collections::BTreeMap;

use crate::aurora::{ContentDefinition, ImportedCharacter};

use super::{ActionGroup, CombatResource, attr, lookup, setter};

pub(super) const KEY: &str = "Resource:moxie";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoxieEffect {
    Spend(u32),
    Refill,
    FailedSave,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MoxieUse {
    pub effect: MoxieEffect,
    pub timing: Option<ActionGroup>,
    pub trigger: Option<&'static str>,
    pub summary: Option<&'static str>,
}

pub(super) fn is_pool(id: &str, name: &str) -> bool {
    id == "ID_DMSG_PUGL_CLASS_FEATURE_MOXIE" || name.eq_ignore_ascii_case("Moxie")
}

pub(super) fn requirement(value: Option<&str>, character: &ImportedCharacter) -> Option<bool> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Some(true);
    };
    let id = value.strip_prefix('!').unwrap_or(value);
    if character.active_ids.is_empty()
        || !id.starts_with("ID_")
        || !id
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_')
    {
        return None;
    }
    Some(character.active_ids.contains(id) != value.starts_with('!'))
}

pub(super) fn matches_requirements(value: Option<&str>, character: &ImportedCharacter) -> bool {
    requirement(value, character) == Some(true)
}

pub(super) fn pool(
    character: &ImportedCharacter,
    definition: Option<&ContentDefinition>,
    summary: Option<&str>,
) -> Option<CombatResource> {
    let summary = summary?.to_ascii_lowercase();
    let recovery = match (
        summary.contains("short rest") || summary.contains("short or long rest"),
        summary.contains("long rest"),
    ) {
        (true, _) => "short",
        (false, true) => "long",
        _ => return None,
    };
    let words: Vec<_> = summary.split_whitespace().collect();
    let literal = words.windows(5).find_map(|words| match words {
        ["you", "have", amount, "moxie", "points"] | ["you", "have", amount, "moxie", "point"] => {
            amount.parse::<u32>().ok()
        }
        _ => None,
    });
    let capacity = if let Some(capacity) = literal {
        capacity
    } else {
        let stat = summary.split_once("{{")?.1.split_once("}}")?.0.trim();
        if !stat.starts_with("moxie:") {
            return None;
        }
        let definition = definition?;
        let mut contributions = BTreeMap::<&str, u32>::new();
        let class_level = character.class_levels.iter().find_map(|(id, level)| {
            (id == "ID_DMSG_PUGL_CLASS_PUGILIST"
                || lookup(character, id)
                    .and_then(|class| class.name.as_deref())
                    .is_some_and(|name| name.eq_ignore_ascii_case("Pugilist")))
            .then_some(*level)
        });
        let mut total = 0u32;
        for rule in definition
            .rules()
            .filter(|rule| rule.tag == "stat" && attr(rule, "name") == Some(stat))
        {
            if !requirement(attr(rule, "requirements"), character)? {
                continue;
            }
            if let Some(level) = attr(rule, "level")
                && class_level? < level.parse::<u32>().ok()?
            {
                continue;
            }
            if attr(rule, "equipped").is_some() {
                return None;
            }
            let value = attr(rule, "value")?.trim().parse::<u32>().ok()?;
            if let Some(group) = attr(rule, "bonus") {
                contributions
                    .entry(group)
                    .and_modify(|existing| *existing = (*existing).max(value))
                    .or_insert(value);
            } else {
                total = total.checked_add(value)?;
            }
        }
        contributions
            .values()
            .try_fold(total, |total, value| total.checked_add(*value))?
    };
    (capacity > 0).then(|| CombatResource {
        key: KEY.into(),
        name: "Moxie".into(),
        capacity,
        recovery,
        recharge_die: None,
        dawn_recharge: None,
    })
}

pub(super) fn feature_use(
    id: &str,
    name: &str,
    summary: Option<&str>,
    definition: Option<&ContentDefinition>,
) -> Option<MoxieUse> {
    use ActionGroup::{BonusAction, Reaction};
    use MoxieEffect::{FailedSave, Refill, Spend};
    if is_pool(id, name) {
        return None;
    }
    let summary = summary.unwrap_or_default().to_ascii_lowercase();
    let (effect, timing, trigger, short) = match name.to_ascii_lowercase().as_str() {
        "bloodied but unbowed" if summary.contains("regain all expended moxie") => (
            Refill,
            Some(Reaction),
            Some("Damage leaves you at half HP or less"),
            Some("Gain temporary HP and refill Moxie."),
        ),
        "heelstomper" | "low blow"
            if summary.contains("on a failure") && summary.contains("gain 1 moxie") =>
        {
            (FailedSave, None, Some("After dealing unarmed damage"), None)
        }
        "pocket sand"
            if summary.contains("on a failure")
                && (summary.contains("gain 1 moxie") || summary.contains("gian 1 moxie")) =>
        {
            (
                FailedSave,
                Some(BonusAction),
                Some("Creature within 5 ft."),
                None,
            )
        }
        _ => {
            let fixed_cost = setter(definition, "moxieCost")
                .and_then(|value| value.parse::<u32>().ok())
                .or_else(|| {
                    let text = summary.trim_start_matches("you can ");
                    let eligible = text.starts_with("spend ")
                        || text.starts_with("expend ")
                        || matches!(name, "Brace Up" | "The Old One-Two" | "Stick and Move");
                    if !eligible {
                        return None;
                    }
                    text.split_whitespace()
                        .collect::<Vec<_>>()
                        .windows(4)
                        .find_map(|words| match words {
                            ["spend" | "expend", amount, "moxie", "point" | "points"] => {
                                amount.parse::<u32>().ok()
                            }
                            _ => None,
                        })
                })
                .filter(|amount| *amount > 0)?;
            let mut timing = None;
            let mut trigger = None;
            let short = match name {
                "Brace Up" => {
                    timing = Some(BonusAction);
                    Some("Gain temporary HP.")
                }
                "The Old One-Two" => {
                    timing = Some(BonusAction);
                    trigger = Some("Immediately after the Attack action");
                    Some("Make two unarmed strikes.")
                }
                "Stick and Move" => {
                    timing = Some(BonusAction);
                    Some("Shove or Dash.")
                }
                _ => None,
            };
            (Spend(fixed_cost), timing, trigger, short)
        }
    };
    Some(MoxieUse {
        effect,
        timing,
        trigger,
        summary: short,
    })
}
