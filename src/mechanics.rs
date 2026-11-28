//! The tracker's own mechanics overlay: spell template shapes, sizes and colours that the
//! tracker ships, keyed by spell name, rules edition and book.
//!
//! The overlay holds names, book codes and measurements only, never rules text. An entry is
//! used only when the player's imported content has a spell with the same name from a book
//! the entry lists, so the overlay adds nothing a player has not imported themselves. The
//! description the sheet shows always comes from the import.
//!
//! `content/mechanics/overlay.json` is built by `tools/build-mechanics-overlay.cjs` from the
//! structure of a 5etools-src checkout plus the hand-reviewed `content/mechanics/curated.json`.

use std::{collections::HashMap, sync::OnceLock};

use serde::{Deserialize, Serialize};

use crate::combat::{AreaShape, SpellArea};

const OVERLAY_JSON: &str = include_str!("../content/mechanics/overlay.json");

#[derive(Debug, Deserialize)]
struct OverlayFile {
    schema: u32,
    #[serde(default)]
    damage_colours: HashMap<String, String>,
    /// Map template look by spell name, for spells whose damage type does not pick one.
    #[serde(default)]
    spell_looks: HashMap<String, String>,
    #[serde(default)]
    books: HashMap<String, String>,
    #[serde(default)]
    spells: Vec<SpellMechanics>,
    #[serde(default)]
    features: Vec<FeatureMechanics>,
    #[serde(default)]
    summons: Vec<SummonMechanics>,
    #[serde(default)]
    companions: Vec<CompanionMechanics>,
    #[serde(default)]
    buffs: Vec<BuffMechanics>,
    #[serde(default)]
    spell_summons: Vec<SpellSummon>,
}

/// A summon spell's creature (R83), such as Summon Beast's Bestial Spirit: AC, HP and attack
/// numbers that grow with the slot level, plus names. No rules text; the spell's description
/// still comes from the player's import. The sheet sends it to the cast dialog as JSON.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct SpellSummon {
    pub name: String,
    #[serde(default)]
    pub sources: Vec<String>,
    /// The spell's own level, which the HP growth counts from.
    pub level: u8,
    pub creature: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub size: String,
    /// Forms the caster picks from, such as Air, Land and Water.
    #[serde(default)]
    pub forms: Vec<String>,
    pub ac: SummonNumber,
    pub hp: SummonHp,
    #[serde(default)]
    pub speed: String,
    #[serde(default)]
    pub form_speed: std::collections::BTreeMap<String, String>,
    /// Strength to Charisma.
    #[serde(default)]
    pub abilities: Vec<i32>,
    /// Attacks equal to half the slot level, rounded down.
    #[serde(default)]
    pub multiattack: bool,
    #[serde(default)]
    pub attacks: Vec<SummonAttack>,
    /// Trait and other action names, such as "Pack Tactics (Land and Water Only)".
    #[serde(default)]
    pub features: Vec<String>,
}

/// AC: a base plus the slot level, plus an extra amount for some forms.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct SummonNumber {
    pub base: i32,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub form: std::collections::BTreeMap<String, i32>,
}

/// HP: a base (or a base per form) plus an amount for each slot level above the spell's.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct SummonHp {
    pub base: u32,
    pub per_level: u32,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub form: std::collections::BTreeMap<String, u32>,
}

/// An attack whose damage is the dice plus a bonus plus the slot level, and whose attack
/// bonus is the caster's spell attack.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct SummonAttack {
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub reach: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dice: Option<String>,
    #[serde(default)]
    pub bonus: i32,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub damage_type: Option<String>,
    /// Forms that have this attack. Empty means every form.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub forms: Vec<String>,
}

impl SpellSummon {
    fn valid(&self) -> bool {
        let dice = |text: &str| {
            text.split_once('d').is_some_and(|(count, sides)| {
                count.parse::<u8>().is_ok_and(|n| (1..=20).contains(&n))
                    && sides
                        .parse::<u8>()
                        .is_ok_and(|n| matches!(n, 4 | 6 | 8 | 10 | 12 | 20))
            })
        };
        (1..=9).contains(&self.level)
            && !self.creature.trim().is_empty()
            && (0..=30).contains(&self.ac.base)
            && self.hp.base <= 1000
            && self.hp.per_level <= 100
            && self.abilities.iter().all(|score| (1..=30).contains(score))
            && self.attacks.iter().all(|attack| {
                attack.dice.as_deref().is_none_or(dice) && (-10..=20).contains(&attack.bonus)
            })
    }
}

/// Stat changes a spell puts on its targets, such as Longstrider's +10 feet of speed (R79).
/// Numbers only; the description still comes from the player's import.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct BuffMechanics {
    pub name: String,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub speed: i16,
    #[serde(default)]
    pub ac: i16,
    #[serde(default)]
    pub attack: i16,
    /// A die added to attack rolls once, such as 4 for Bless's 1d4.
    #[serde(default)]
    pub attack_die: u8,
    #[serde(default)]
    pub damage: i16,
    #[serde(default)]
    pub save: i16,
    #[serde(default)]
    pub save_die: u8,
    /// How long the spell lasts when it is not concentration.
    #[serde(default)]
    pub seconds: Option<u32>,
    /// Targets at the spell's own level, and how many more each higher slot adds.
    #[serde(default)]
    pub targets: Option<u32>,
    #[serde(default)]
    pub per_slot: u32,
}

impl BuffMechanics {
    /// Compact form for the sheet, such as `speed=10,seconds=3600`.
    pub fn attribute(&self) -> String {
        let mut parts = Vec::new();
        for (key, value) in [
            ("speed", i32::from(self.speed)),
            ("ac", i32::from(self.ac)),
            ("attack", i32::from(self.attack)),
            ("attackDie", i32::from(self.attack_die)),
            ("damage", i32::from(self.damage)),
            ("save", i32::from(self.save)),
            ("saveDie", i32::from(self.save_die)),
        ] {
            if value != 0 {
                parts.push(format!("{key}={value}"));
            }
        }
        if let Some(seconds) = self.seconds {
            parts.push(format!("seconds={seconds}"));
        }
        parts.join(",")
    }

    fn valid(&self) -> bool {
        let dice = |die: u8| matches!(die, 0 | 4 | 6 | 8 | 10 | 12);
        [self.speed, self.ac, self.attack, self.damage, self.save]
            .iter()
            .all(|value| (-100..=100).contains(value))
            && dice(self.attack_die)
            && dice(self.save_die)
            && self
                .seconds
                .is_none_or(|seconds| (1..=864_000).contains(&seconds))
            && self.targets.is_none_or(|count| (1..=20).contains(&count))
            && self.per_slot <= 5
    }

    /// Targets for each slot level 1 to 9, given the spell's own level.
    pub fn target_counts(&self, level: u8) -> Vec<u32> {
        let Some(base) = self.targets else {
            return Vec::new();
        };
        (1..=9u8)
            .map(|slot| {
                if slot < level {
                    0
                } else {
                    base + self.per_slot * u32::from(slot - level)
                }
            })
            .collect()
    }
}

/// When a class feature, feat or trait is used, for features whose imported content does not
/// say. The imported content's own timing always wins.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct FeatureMechanics {
    pub name: String,
    #[serde(default)]
    pub sources: Vec<String>,
    pub activation: Activation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Activation {
    Action,
    Bonus,
    Reaction,
    /// Used as part of something else, such as on a hit, or with no action.
    None,
}

/// Hit points worked out from the owner: `base + per_level × class level + ability modifier`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct HpFormula {
    #[serde(default)]
    pub base: u32,
    #[serde(default)]
    pub per_level: u32,
    /// The class whose level counts, such as "Artificer".
    pub class: String,
    /// The owner's ability whose modifier is added, such as "intelligence".
    #[serde(default)]
    pub ability: Option<String>,
}

impl HpFormula {
    /// The hit points for an owner of this class level and modifier, at least 1.
    pub fn hit_points(&self, class_level: u32, modifier: Option<i32>) -> Option<u32> {
        if self.ability.is_some() && modifier.is_none() {
            return None;
        }
        let total = i64::from(self.base)
            + i64::from(self.per_level) * i64::from(class_level)
            + i64::from(modifier.unwrap_or(0));
        u32::try_from(total.max(1)).ok()
    }
}

/// A feature that creates a companion in one of several variants, such as Eldritch Cannon.
/// Only measurements and short summaries the tracker wrote; the import's text is shown too.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SummonMechanics {
    pub name: String,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub armor_class: String,
    #[serde(default)]
    pub hp: Option<HpFormula>,
    #[serde(default)]
    pub speed: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub duration: String,
    #[serde(default)]
    pub variants: Vec<SummonVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SummonVariant {
    pub name: String,
    /// The tracker's one-line summary, such as "15-ft cone · Dex save · 2d8 fire".
    pub summary: String,
    /// True when the summary is an attack rather than an ability.
    #[serde(default)]
    pub attack: bool,
}

/// A companion whose hit points depend on its owner.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct CompanionMechanics {
    pub name: String,
    #[serde(default)]
    pub sources: Vec<String>,
    pub hp: HpFormula,
}

/// One spell's mechanics for one rules edition.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SpellMechanics {
    pub name: String,
    /// "2014" or "2024".
    pub edition: String,
    /// 5etools book codes that print this version of the spell, such as "PHB" or "XGE".
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub area: Option<OverlayArea>,
    /// Template fill colour as `#rrggbb`, when the spell has a colour of its own.
    #[serde(default)]
    pub colour: Option<String>,
    #[serde(default)]
    pub damage_types: Vec<String>,
    /// True when the entry was checked by hand rather than read from structure alone.
    #[serde(default)]
    pub reviewed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct OverlayArea {
    pub shape: OverlayShape,
    pub size: u32,
    #[serde(default)]
    pub width: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayShape {
    Sphere,
    Cylinder,
    Cone,
    Cube,
    Line,
    Emanation,
}

impl OverlayArea {
    pub fn spell_area(&self) -> SpellArea {
        let shape = match self.shape {
            OverlayShape::Sphere => AreaShape::Sphere,
            OverlayShape::Cylinder => AreaShape::Cylinder,
            OverlayShape::Cone => AreaShape::Cone,
            OverlayShape::Cube => AreaShape::Cube,
            OverlayShape::Line => AreaShape::Line,
            OverlayShape::Emanation => AreaShape::Emanation,
        };
        SpellArea {
            shape,
            size: self.size,
            width: match self.shape {
                OverlayShape::Line => Some(self.width.unwrap_or(5)),
                _ => None,
            },
        }
    }
}

pub struct Overlay {
    damage_colours: HashMap<String, String>,
    /// Normalized spell name to its map template look, such as "mist".
    spell_looks: HashMap<String, String>,
    /// Normalized book name to 5etools code.
    books: HashMap<String, String>,
    /// Normalized spell name to its editions.
    spells: HashMap<String, Vec<SpellMechanics>>,
    features: Vec<FeatureMechanics>,
    summons: Vec<SummonMechanics>,
    companions: Vec<CompanionMechanics>,
    buffs: Vec<BuffMechanics>,
    spell_summons: Vec<SpellSummon>,
}

/// An entry with this name from the import's book, or the first when the import names none.
fn by_book<'a, T>(
    overlay: &Overlay,
    entries: &'a [T],
    name: &str,
    source: Option<&str>,
    parts: impl Fn(&T) -> (&str, &[String]),
) -> Option<&'a T> {
    let wanted = normalize(name);
    let mut named = entries
        .iter()
        .filter(|entry| normalize(parts(entry).0) == wanted);
    match source.map(str::trim).filter(|source| !source.is_empty()) {
        Some(source) => {
            let code = overlay.book_code(source)?;
            named.find(|entry| parts(entry).1.iter().any(|listed| listed == code))
        }
        None => named.next(),
    }
}

/// Lowercase letters and digits only, so "Player’s Handbook" and "Player's Handbook" agree.
fn normalize(text: &str) -> String {
    text.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

fn colour(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

/// A look name the Owlbear extension can draw: lowercase letters, such as "fire".
fn look_name(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.chars().all(|ch| ch.is_ascii_lowercase())
}

fn valid_area(area: &OverlayArea) -> bool {
    (1..=1000).contains(&area.size)
        && area
            .width
            .is_none_or(|width| area.shape == OverlayShape::Line && (1..=100).contains(&width))
}

impl Overlay {
    /// Reads an overlay file, dropping entries the sheet could not use.
    pub fn parse(json: &str) -> Result<Self, String> {
        let file: OverlayFile =
            serde_json::from_str(json).map_err(|err| format!("Mechanics overlay: {err}"))?;
        if file.schema != 1 {
            return Err(format!(
                "Mechanics overlay schema {} is not supported.",
                file.schema
            ));
        }
        let mut spells: HashMap<String, Vec<SpellMechanics>> = HashMap::new();
        for mut spell in file.spells {
            if spell.area.as_ref().is_some_and(|area| !valid_area(area)) {
                spell.area = None;
            }
            if spell.colour.as_deref().is_some_and(|value| !colour(value)) {
                spell.colour = None;
            }
            spells
                .entry(normalize(&spell.name))
                .or_default()
                .push(spell);
        }
        Ok(Self {
            damage_colours: file
                .damage_colours
                .into_iter()
                .filter(|(_, value)| colour(value))
                .collect(),
            spell_looks: file
                .spell_looks
                .into_iter()
                .filter(|(_, value)| look_name(value))
                .map(|(name, look)| (normalize(&name), look))
                .collect(),
            books: file
                .books
                .into_iter()
                .map(|(name, code)| (normalize(&name), code))
                .collect(),
            spells,
            features: file.features,
            summons: file.summons,
            companions: file.companions,
            buffs: file
                .buffs
                .into_iter()
                .filter(BuffMechanics::valid)
                .collect(),
            spell_summons: file
                .spell_summons
                .into_iter()
                .filter(SpellSummon::valid)
                .collect(),
        })
    }

    /// The 5etools code for a book name as Aurora or 5etools prints it.
    pub fn book_code(&self, source: &str) -> Option<&str> {
        let key = normalize(source);
        self.books
            .get(&key)
            .or_else(|| {
                // A 5etools record names its book by code already.
                self.books.values().find(|code| normalize(code) == key)
            })
            .map(String::as_str)
    }

    /// The overlay entry for an imported spell, or nothing when the import's book is not one
    /// the entry lists. A spell with no source falls back to its 2014 version, Aurora's
    /// default rules, then to any version.
    pub fn spell(&self, name: &str, source: Option<&str>) -> Option<&SpellMechanics> {
        let editions = self.spells.get(&normalize(name))?;
        match source.map(str::trim).filter(|source| !source.is_empty()) {
            Some(source) => {
                let code = self.book_code(source)?;
                editions
                    .iter()
                    .find(|entry| entry.sources.iter().any(|listed| listed == code))
            }
            None => editions
                .iter()
                .find(|entry| entry.edition == "2014")
                .or_else(|| editions.first()),
        }
    }

    /// The default template colour for a damage type, such as "fire".
    pub fn damage_colour(&self, damage_type: &str) -> Option<&str> {
        self.damage_colours
            .get(&damage_type.to_ascii_lowercase())
            .map(String::as_str)
    }

    /// The template colour for a spell: its own colour, then the colour of the damage type
    /// the player's description names, then of the first damage type the entry lists.
    pub fn template_colour(
        &self,
        entry: Option<&SpellMechanics>,
        damage_type: Option<&str>,
    ) -> Option<String> {
        entry
            .and_then(|entry| entry.colour.clone())
            .or_else(|| damage_type.and_then(|kind| self.damage_colour(kind).map(str::to_owned)))
            .or_else(|| {
                entry?
                    .damage_types
                    .iter()
                    .find_map(|kind| self.damage_colour(kind).map(str::to_owned))
            })
    }

    /// The map template look for a spell: the overlay's look for its name, then the damage
    /// type the player's description names, then the first damage type the entry lists. The
    /// Owlbear extension draws a texture for the looks it knows and a plain fade otherwise.
    pub fn template_look(
        &self,
        name: &str,
        entry: Option<&SpellMechanics>,
        damage_type: Option<&str>,
    ) -> Option<String> {
        self.spell_looks
            .get(&normalize(name))
            .cloned()
            .or_else(|| damage_type.map(str::to_ascii_lowercase))
            .or_else(|| {
                entry?
                    .damage_types
                    .first()
                    .map(|kind| kind.to_ascii_lowercase())
            })
            .filter(|look| look_name(look))
    }

    /// When a feature is used, if the overlay knows it for the import's book.
    pub fn feature(&self, name: &str, source: Option<&str>) -> Option<&FeatureMechanics> {
        by_book(self, &self.features, name, source, |entry| {
            (entry.name.as_str(), entry.sources.as_slice())
        })
    }

    /// A feature that creates companion variants, such as Eldritch Cannon.
    pub fn summon(&self, name: &str, source: Option<&str>) -> Option<&SummonMechanics> {
        by_book(self, &self.summons, name, source, |entry| {
            (entry.name.as_str(), entry.sources.as_slice())
        })
    }

    /// A companion whose hit points the overlay can work out.
    pub fn companion(&self, name: &str, source: Option<&str>) -> Option<&CompanionMechanics> {
        by_book(self, &self.companions, name, source, |entry| {
            (entry.name.as_str(), entry.sources.as_slice())
        })
    }

    /// The stat changes a buff spell makes, if the overlay knows it for the import's book.
    pub fn buff(&self, name: &str, source: Option<&str>) -> Option<&BuffMechanics> {
        by_book(self, &self.buffs, name, source, |entry| {
            (entry.name.as_str(), entry.sources.as_slice())
        })
    }

    /// The creature a summon spell calls, if the overlay knows it for the import's book.
    pub fn spell_summon(&self, name: &str, source: Option<&str>) -> Option<&SpellSummon> {
        by_book(self, &self.spell_summons, name, source, |entry| {
            (entry.name.as_str(), entry.sources.as_slice())
        })
    }

    pub fn spell_count(&self) -> usize {
        self.spells.values().map(Vec::len).sum()
    }
}

/// The overlay shipped with the tracker.
pub fn overlay() -> &'static Overlay {
    static OVERLAY: OnceLock<Overlay> = OnceLock::new();
    OVERLAY.get_or_init(|| {
        Overlay::parse(OVERLAY_JSON).expect("the bundled mechanics overlay is valid")
    })
}
