#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SpellOptions {
    pub school: Option<String>,
    pub material_notice: Option<String>,
    pub trigger: Option<String>,
    pub incoming_events: &'static str,
    pub effect: &'static str,
    pub healing: bool,
    pub target_counts: Vec<u32>,
    pub advantage: Option<&'static str>,
}

impl SpellOptions {
    pub(super) fn read(
        text: &str,
        time: Option<&str>,
        level: Option<u8>,
        school: Option<String>,
        material: Option<&str>,
    ) -> Self {
        let plain = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let lower = plain.to_ascii_lowercase();
        let reaction = time.is_some_and(|time| time.to_ascii_lowercase().contains("reaction"));
        let trigger = reaction.then(|| trigger(time, &plain)).flatten();
        let trigger_text = trigger.as_deref().unwrap_or("").to_ascii_lowercase();
        let attack = [
            "you are hit by an attack",
            "you're hit by an attack",
            "hits you with an attack",
            "hit you with an attack",
            "hit by an attack roll",
        ]
        .iter()
        .any(|phrase| trigger_text.contains(phrase));
        let missile = trigger_text.contains("magic missile");
        let incoming_events = match (attack, missile) {
            (true, true) => "attack missile",
            (true, false) => "attack",
            (false, true) => "missile",
            _ => "",
        };
        let healing = [
            "regains hit points",
            "regain hit points equal to",
            "regains a number of hit points",
            "regain a number of hit points",
            "restores hit points equal to",
        ]
        .iter()
        .any(|phrase| lower.contains(phrase))
            || lower
                .split_whitespace()
                .collect::<Vec<_>>()
                .windows(4)
                .any(|words| {
                    matches!(words[0], "regains" | "regain")
                        && words[1].parse::<u32>().is_ok()
                        && words[2] == "hit"
                        && words[3].trim_end_matches(['.', ',']) == "points"
                });
        let target_counts = level
            .filter(|level| *level > 0)
            .and_then(|level| slots_for_targets(&lower, level))
            .or_else(|| {
                if !healing {
                    return None;
                }
                let initial = super::words(&lower).windows(4).find_map(|words| {
                    (words[0..2] == ["up", "to"] && matches!(words[3], "creatures" | "targets"))
                        .then(|| count(words[2]))
                        .flatten()
                })?;
                Some(vec![initial; 9])
            })
            .unwrap_or_default();
        let effect = if !target_counts.is_empty()
            && lower.contains("can roll a d4")
            && lower.contains("attack roll or saving throw")
        {
            "bless"
        } else if lower.contains("starts its turn there")
            && lower.contains("enters the spell")
            && lower.contains("constitution saving throw")
            && lower.contains("radiant damage")
        {
            "moonbeam"
        } else if attack
            && lower.contains("+5 bonus to ac")
            && lower.contains("start of your next turn")
        {
            "shield"
        } else {
            ""
        };
        let material_notice = material
            .filter(|material| {
                let label = material.to_ascii_lowercase();
                label.contains("worth ")
                    || label.contains("consum") && !label.contains("not consumed")
                    || super::words(&label).windows(2).any(|tokens| {
                        tokens[0].bytes().all(|ch| ch.is_ascii_digit())
                            && matches!(tokens[1], "gp" | "sp" | "cp" | "pp" | "ep")
                    })
            })
            .map(str::to_owned);
        let advantage = lower
            .contains("advantage on the attack roll if the target is wearing armor made of metal")
            .then_some("Target wears metal armor");
        Self {
            school,
            material_notice,
            trigger,
            incoming_events,
            healing,
            effect,
            target_counts,
            advantage,
        }
    }
}

fn trigger(time: Option<&str>, description: &str) -> Option<String> {
    if let Some((_, tail)) = time?.split_once(',') {
        let tail = tail.trim();
        if !tail.is_empty() {
            return Some(tail.to_owned());
        }
    }
    let lower = description.to_ascii_lowercase();
    let tail = ["reaction trigger:", "reaction:"]
        .iter()
        .find_map(|prefix| {
            lower
                .starts_with(prefix)
                .then(|| description[prefix.len()..].trim())
        })?;
    let end = [". ", " An ", " Choose ", " You gain ", " A protective "]
        .iter()
        .filter_map(|marker| tail.find(marker))
        .min()
        .unwrap_or(tail.len());
    (end > 0).then(|| tail[..end].to_owned())
}

fn slots_for_targets(text: &str, base_level: u8) -> Option<Vec<u32>> {
    let (base, scaling) = text.split_once("at higher levels")?;
    let (increase, floor) = scaling.split_once(" for each slot level above ")?;
    let floor = floor
        .split_whitespace()
        .next()?
        .trim_end_matches(|ch: char| !ch.is_ascii_alphanumeric());
    if super::spell_scaling::ordinal(floor)? != base_level {
        return None;
    }
    let (singular, plural) = [
        ("creature", "creatures"),
        ("target", "targets"),
        ("humanoid", "humanoids"),
    ]
    .into_iter()
    .find(|(singular, _)| increase.ends_with(&format!("one additional {singular}")))?;
    let initial = super::words(base)
        .windows(4)
        .find_map(|words| {
            if words[0..2] == ["up", "to"] && (words[3] == plural || words[3] == singular) {
                return count(words[2]);
            }
            None
        })
        .or_else(|| {
            super::words(base)
                .windows(2)
                .any(|words| words == ["one", singular])
                .then_some(1)
        })?;
    let mut result = vec![0; usize::from(base_level - 1)];
    result.extend((base_level..=9).map(|level| initial + u32::from(level - base_level)));
    Some(result)
}

pub(super) fn count(word: &str) -> Option<u32> {
    let number = match word {
        "one" => 1,
        "two" => 2,
        "three" => 3,
        "four" => 4,
        "five" => 5,
        "six" => 6,
        word => word.parse().ok()?,
    };
    (1..=100).contains(&number).then_some(number)
}
