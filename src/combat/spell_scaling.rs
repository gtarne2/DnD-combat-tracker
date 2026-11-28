use crate::aurora::{ABILITIES, ImportedCharacter, SpellcastingStats};

#[derive(Clone, Copy, PartialEq, Eq)]
struct Dice {
    count: u16,
    sides: u16,
}

impl Dice {
    fn parse(word: &str) -> Option<Self> {
        let (count, sides) = word.split_once('d')?;
        let (count, sides) = (count.parse().ok()?, sides.parse().ok()?);
        (count > 0 && sides > 1).then_some(Self { count, sides })
    }

    fn display(self) -> String {
        format!("{}d{}", self.count, self.sides)
    }
}

pub(super) struct SpellPreview {
    pub label: &'static str,
    pub roll: String,
    pub slots: Vec<String>,
}

pub(super) fn casting_modifier(
    character: &ImportedCharacter,
    casting: Option<&SpellcastingStats>,
) -> Option<i32> {
    let ability = casting?.ability.as_deref()?.trim();
    let index = ABILITIES.iter().position(|name| {
        name.eq_ignore_ascii_case(ability)
            || name
                .get(..3)
                .is_some_and(|short| short.eq_ignore_ascii_case(ability))
    })?;
    character.profile.stats.modifiers[index]
}

pub(super) fn preview(
    text: &str,
    spell_level: Option<u8>,
    character_level: Option<u32>,
    casting_modifier: Option<i32>,
) -> Option<SpellPreview> {
    let text = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    let spell_level = spell_level?;
    if spell_level == 0 {
        let level = character_level?;
        let roll = cantrip_damage(&text, level).or_else(|| beams(&text, level))?;
        return Some(SpellPreview {
            label: "Damage",
            roll,
            slots: Vec::new(),
        });
    }
    let (base, upcast) = text.split_once("at higher levels")?;
    let (increase, floor) = upcast.split_once(" for each slot level above ")?;
    if ordinal(floor.split_whitespace().next()?.trim_end_matches('.'))? != spell_level {
        return None;
    }
    for (phrase, label) in [
        ("damage increases by ", "Damage"),
        ("healing increases by ", "Healing"),
    ] {
        if let Some((_, delta)) = increase.rsplit_once(phrase) {
            let delta = Dice::parse(delta)?;
            let (initial, suffix) = base_roll(base, label, casting_modifier)?;
            if initial.sides != delta.sides {
                return None;
            }
            return at_slots(spell_level, label, |extra| {
                let count = initial.count.checked_add(delta.count.checked_mul(extra)?)?;
                Some(format!("{}{}", Dice { count, ..initial }.display(), suffix))
            });
        }
    }
    for (singular, plural) in [("dart", "darts"), ("ray", "rays")] {
        if ![
            format!("one more {singular}"),
            format!("one additional {singular}"),
        ]
        .iter()
        .any(|phrase| increase.ends_with(phrase))
        {
            continue;
        }
        let count = base.split(['.', '!', '?']).find_map(|sentence| {
            let tokens = super::words(sentence);
            tokens.iter().enumerate().find_map(|(index, word)| {
                if *word != plural {
                    return None;
                }
                positive(tokens.get(index.checked_sub(1)?)?).or_else(|| {
                    // An adjective can separate the count from the projectile noun.
                    positive(tokens.get(index.checked_sub(2)?)?)
                })
            })
        })?;
        // A separate roll or point of impact for each projectile remains separate in the preview.
        let (dice, suffix) = base_roll(base, "Damage", casting_modifier)?;
        return at_slots(spell_level, "Damage", |extra| {
            Some(format!(
                "{} {plural} · {}{suffix} per {singular}",
                count.checked_add(extra)?,
                dice.display()
            ))
        });
    }
    None
}

fn at_slots(
    base: u8,
    label: &'static str,
    render: impl Fn(u16) -> Option<String>,
) -> Option<SpellPreview> {
    let roll = render(0)?;
    let mut slots = vec![String::new(); usize::from(base - 1)];
    for slot in base..=9 {
        slots.push(format!("{label}: {}", render(u16::from(slot - base))?));
    }
    Some(SpellPreview { label, roll, slots })
}

fn cantrip_damage(text: &str, level: u32) -> Option<String> {
    let clause = text.split(['.', '!', '?']).map(str::trim).find(|clause| {
        [
            "this spell’s damage increases by ",
            "this spell's damage increases by ",
            "the spell’s damage increases by ",
            "the spell's damage increases by ",
            "the damage increases by ",
        ]
        .iter()
        .any(|prefix| clause.starts_with(prefix))
    })?;
    let amounts: Vec<_> = ["5th", "11th", "17th"]
        .into_iter()
        .map(|level| {
            let pattern = format!("{level} level (");
            let (_, tail) = clause.split_once(&pattern)?;
            let (dice, _) = tail.split_once(')')?;
            dice.split(" or ")
                .map(Dice::parse)
                .collect::<Option<Vec<_>>>()
        })
        .collect::<Option<_>>()?;
    let step = clause
        .split_once("increases by ")?
        .1
        .split_once(" when you reach")?
        .0;
    let first = &amounts[0];
    let mut base = Vec::new();
    for (index, dice) in first.iter().enumerate() {
        let growth = if step == "one die" {
            1
        } else {
            let growth = Dice::parse(step)?;
            if first.len() != 1 || growth.sides != dice.sides {
                return None;
            }
            growth.count
        };
        let count = dice.count.checked_sub(growth)?;
        if count == 0
            || amounts.iter().enumerate().any(|(tier, values)| {
                values.len() != first.len()
                    || values.get(index).is_none_or(|next| {
                        next.sides != dice.sides
                            || Some(next.count)
                                != count.checked_add(growth.saturating_mul(tier as u16 + 1))
                    })
            })
        {
            return None;
        }
        base.push(Dice { count, ..*dice });
    }
    let tier = [5, 11, 17]
        .into_iter()
        .filter(|threshold| level >= *threshold)
        .count();
    let picks = if tier == 0 { &base } else { &amounts[tier - 1] };
    let damage_type = base_roll(text.split(clause).next()?, "Damage", None)
        .filter(|(roll, _)| base.len() == 1 && *roll == base[0])
        .map(|(_, suffix)| suffix)
        .unwrap_or_default();
    Some(format!(
        "{}{damage_type}",
        picks
            .iter()
            .map(|roll| roll.display())
            .collect::<Vec<_>>()
            .join(" or ")
    ))
}

fn beams(text: &str, level: u32) -> Option<String> {
    if ![
        "two beams at 5th level",
        "three beams at 11th level",
        "four beams at 17th level",
        "separate attack roll for each beam",
    ]
    .into_iter()
    .all(|phrase| text.contains(phrase))
    {
        return None;
    }
    let count = 1 + [5, 11, 17]
        .into_iter()
        .filter(|threshold| level >= *threshold)
        .count();
    let (dice, suffix) = base_roll(text, "Damage", None)?;
    if count == 1 {
        Some(format!("{}{suffix} per beam", dice.display()))
    } else {
        Some(format!(
            "{count} beams · {}{suffix} per beam",
            dice.display()
        ))
    }
}

fn base_roll(text: &str, label: &str, modifier: Option<i32>) -> Option<(Dice, String)> {
    let mut result = None;
    for sentence in text.split(['.', '!', '?']).filter(|sentence| {
        if label == "Healing" {
            sentence.contains("hit points equal to") || sentence.contains("hit points by")
        } else {
            sentence.contains("damage")
        }
    }) {
        for (index, word) in sentence.split_whitespace().enumerate() {
            let Some(dice) = Dice::parse(word.trim_matches(|ch: char| !ch.is_ascii_alphanumeric()))
            else {
                continue;
            };
            let rest = sentence
                .split_whitespace()
                .skip(index + 1)
                .collect::<Vec<_>>()
                .join(" ");
            let (modifier_text, tail) =
                if let Some(tail) = rest.strip_prefix("+ your spellcasting ability modifier") {
                    (
                        modifier.map_or_else(|| " + spellcasting modifier".into(), signed),
                        tail,
                    )
                } else if let Some((sign, more)) = rest.split_once(' ')
                    && matches!(sign, "+" | "-")
                {
                    let (amount, tail) = more.split_once(' ').unwrap_or((more, ""));
                    let value = amount.parse::<i32>().ok()?;
                    (signed(if sign == "-" { -value } else { value }), tail)
                } else {
                    (String::new(), rest.as_str())
                };
            let damage_type = if label == "Damage" {
                let words = super::words(tail);
                if words.first() == Some(&"damage") {
                    ""
                } else if words.get(1) == Some(&"damage") {
                    words[0]
                } else {
                    continue;
                }
            } else {
                ""
            };
            let suffix = if damage_type.is_empty() {
                modifier_text
            } else {
                format!("{modifier_text} {damage_type}")
            };
            let candidate = (dice, suffix);
            if result.as_ref().is_some_and(|other| other != &candidate) {
                return None;
            }
            result = Some(candidate);
        }
    }
    result
}

fn signed(value: i32) -> String {
    match value {
        0 => String::new(),
        value if value > 0 => format!(" + {value}"),
        value => format!(" − {}", value.unsigned_abs()),
    }
}

pub(super) fn ordinal(word: &str) -> Option<u8> {
    ["st", "nd", "rd", "th"]
        .into_iter()
        .find_map(|suffix| word.strip_suffix(suffix))?
        .parse()
        .ok()
}

fn positive(word: &str) -> Option<u16> {
    let number = match word {
        "one" => 1,
        "two" => 2,
        "three" => 3,
        "four" => 4,
        "five" => 5,
        word => word.parse().ok()?,
    };
    (number > 0).then_some(number)
}
