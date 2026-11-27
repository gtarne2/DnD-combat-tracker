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

use serde::Deserialize;

use crate::combat::{AreaShape, SpellArea};

const OVERLAY_JSON: &str = include_str!("../content/mechanics/overlay.json");

#[derive(Debug, Deserialize)]
struct OverlayFile {
    schema: u32,
    #[serde(default)]
    damage_colours: HashMap<String, String>,
    #[serde(default)]
    books: HashMap<String, String>,
    #[serde(default)]
    spells: Vec<SpellMechanics>,
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
    /// Normalized book name to 5etools code.
    books: HashMap<String, String>,
    /// Normalized spell name to its editions.
    spells: HashMap<String, Vec<SpellMechanics>>,
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
            books: file
                .books
                .into_iter()
                .map(|(name, code)| (normalize(&name), code))
                .collect(),
            spells,
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
