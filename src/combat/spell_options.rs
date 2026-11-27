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
    /// The area of effect for a map template, when the range or description names one.
    pub area: Option<SpellArea>,
    /// The saving throw the spell's targets make, and whether a success halves the damage.
    pub save: Option<SpellSave>,
    /// The first damage type the description names, such as "fire".
    pub damage_type: Option<&'static str>,
    /// Template fill colour as `#rrggbb`, from the mechanics overlay.
    pub colour: Option<String>,
    /// True when the tracker's mechanics overlay matched this imported spell.
    pub overlay: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpellSave {
    pub ability: &'static str,
    /// True when a successful save takes half damage; false when it takes none.
    pub half: bool,
}

impl SpellSave {
    /// Compact form for the sheet, such as `dexterity half`.
    pub fn attribute(&self) -> String {
        format!(
            "{} {}",
            self.ability,
            if self.half { "half" } else { "none" }
        )
    }
}

const ABILITIES: [&str; 6] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
];
const DAMAGE_TYPES: [&str; 13] = [
    "acid",
    "bludgeoning",
    "cold",
    "fire",
    "force",
    "lightning",
    "necrotic",
    "piercing",
    "poison",
    "psychic",
    "radiant",
    "slashing",
    "thunder",
];

/// The first "<ability> saving throw" in a description, and whether a success halves damage.
pub fn spell_save(description: &str) -> Option<SpellSave> {
    let lower = description.to_ascii_lowercase();
    let words = super::words(&lower);
    let ability = words.windows(3).find_map(|w| {
        (w[1] == "saving" && w[2] == "throw")
            .then(|| ABILITIES.iter().find(|a| **a == w[0]).copied())
            .flatten()
    })?;
    let half = lower.contains("half as much damage") || lower.contains("half damage");
    Some(SpellSave { ability, half })
}

/// The first damage type named as "<type> damage".
pub fn damage_type(description: &str) -> Option<&'static str> {
    let lower = description.to_ascii_lowercase();
    super::words(&lower).windows(2).find_map(|w| {
        (w[1] == "damage")
            .then(|| DAMAGE_TYPES.iter().find(|t| **t == w[0]).copied())
            .flatten()
    })
}

/// A spell's area of effect in feet, for drawing a template on a virtual tabletop.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpellArea {
    pub shape: AreaShape,
    /// Radius for spheres, cylinders and emanations; length for cones and lines; side for cubes.
    pub size: u32,
    /// Width of a line.
    pub width: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AreaShape {
    Sphere,
    Cylinder,
    Cone,
    Cube,
    Line,
    /// A radius around the caster, such as Spirit Guardians.
    Emanation,
}

impl SpellArea {
    /// Compact form for the sheet, such as `line 100 5` or `sphere 20`.
    pub fn attribute(&self) -> String {
        let shape = match self.shape {
            AreaShape::Sphere => "sphere",
            AreaShape::Cylinder => "cylinder",
            AreaShape::Cone => "cone",
            AreaShape::Cube => "cube",
            AreaShape::Line => "line",
            AreaShape::Emanation => "emanation",
        };
        match self.width {
            Some(width) => format!("{shape} {} {width}", self.size),
            None => format!("{shape} {}", self.size),
        }
    }
}

fn feet(word: &str) -> Option<u32> {
    word.parse().ok().filter(|value| (1..=1000).contains(value))
}

/// Read an area from Aurora's range text, such as "Self (15-foot cone)", or from the
/// description, such as "20-foot-radius sphere" or "a line 100 feet long and 5 feet wide".
/// Returns nothing when no area is named; the cast dialog lets the player choose one.
pub fn area(range: Option<&str>, description: &str) -> Option<SpellArea> {
    let range = range.unwrap_or("").to_ascii_lowercase();
    if range.trim_start().starts_with("self")
        && let Some((_, inner)) = range.split_once('(')
    {
        let words = super::words(inner);
        if let Some(area) = scan(&words, true) {
            return Some(area);
        }
    }
    let lower = description.to_ascii_lowercase();
    let words = super::words(&lower);
    scan(&words, false).or_else(|| teleport(&words))
}

/// Teleports such as Misty Step have no area, but their reach is worth showing on the map:
/// "teleport up to 30 feet" becomes a 30-foot radius around the caster.
fn teleport(words: &[&str]) -> Option<SpellArea> {
    let start = words.iter().position(|word| word.starts_with("teleport"))?;
    let rest = &words[start..words.len().min(start + 8)];
    rest.windows(4).find_map(|window| {
        (window[0] == "up" && window[1] == "to" && matches!(window[3], "foot" | "feet" | "ft"))
            .then(|| feet(window[2]))
            .flatten()
            .map(|size| SpellArea {
                shape: AreaShape::Emanation,
                size,
                width: None,
            })
    })
}

fn scan(words: &[&str], from_self: bool) -> Option<SpellArea> {
    let area = |shape, size, width| Some(SpellArea { shape, size, width });
    for (index, window) in words.windows(3).enumerate() {
        let [number, unit, kind] = window else {
            continue;
        };
        if !matches!(*unit, "foot" | "feet" | "ft") {
            continue;
        }
        let Some(size) = feet(number) else { continue };
        let rest = &words[index + 3..words.len().min(index + 8)];
        match *kind {
            "cone" => return area(AreaShape::Cone, size, None),
            "cube" => return area(AreaShape::Cube, size, None),
            "line" => return area(AreaShape::Line, size, line_width(rest).or(Some(5))),
            "emanation" => return area(AreaShape::Emanation, size, None),
            "radius" => {
                if rest.first() == Some(&"sphere") {
                    return area(AreaShape::Sphere, size, None);
                }
                if rest.contains(&"cylinder") {
                    return area(AreaShape::Cylinder, size, None);
                }
                if from_self || rest.first() == Some(&"emanation") {
                    return area(AreaShape::Emanation, size, None);
                }
                if rest.contains(&"sphere") {
                    return area(AreaShape::Sphere, size, None);
                }
            }
            // "a line 100 feet long and 5 feet wide", or "a 100-foot-long, 5-foot-wide line".
            "long" if index > 0 && words[index - 1] == "line" || rest.contains(&"line") => {
                return area(AreaShape::Line, size, line_width(rest).or(Some(5)));
            }
            _ => {}
        }
    }
    None
}

/// "... and 5 feet wide" after a line's length.
fn line_width(rest: &[&str]) -> Option<u32> {
    rest.windows(3).find_map(|window| {
        (matches!(window[1], "foot" | "feet" | "ft") && window[2] == "wide")
            .then(|| feet(window[0]))
            .flatten()
    })
}

impl SpellOptions {
    /// Applies the tracker's mechanics overlay to a spell read from the player's import.
    /// A reviewed or structured area replaces the one read from the text; the colour comes
    /// from the overlay or the damage type.
    pub(super) fn apply_overlay(&mut self, name: &str, source: Option<&str>) {
        let overlay = crate::mechanics::overlay();
        let entry = overlay.spell(name, source);
        if let Some(entry) = entry {
            self.overlay = true;
            if let Some(area) = &entry.area {
                self.area = Some(area.spell_area());
            }
        }
        self.colour = overlay.template_colour(entry, self.damage_type);
    }

    pub(super) fn read(
        text: &str,
        range: Option<&str>,
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
            area: area(range, &plain),
            save: spell_save(&plain),
            damage_type: damage_type(&plain),
            colour: None,
            overlay: false,
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
