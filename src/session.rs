use std::path::{Path, PathBuf};

use crate::{
    aurora::{ImportError, ImportedCharacter, import_character_with_content},
    combat::CombatSheet,
    inventory::{ConsumableUseError, ConsumableUses},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pin {
    Equipment(String),
    Spell(String),
    BuildElement(String),
    Companion(String),
    LinkedOption(String),
    /// A tracker-owned target, such as a sheet stat.
    Local(String),
}

impl Pin {
    fn applies_to(&self, character: &ImportedCharacter) -> bool {
        let (id, entries) = match self {
            Self::Equipment(id) => (id, &character.equipment),
            Self::Spell(id) => (id, &character.spells),
            Self::BuildElement(id) => (id, &character.build_elements),
            Self::Companion(id) => (id, &character.companions),
            Self::LinkedOption(id) => return character.definitions.contains_key(id),
            Self::Local(_) => return true,
        };
        entries.iter().any(|entry| &entry.content_id == id)
    }
}

/// Couples an Aurora snapshot with the tracker state that belongs to this character.
pub struct CharacterSession<Encounter, Layout> {
    save_path: PathBuf,
    content_paths: Vec<PathBuf>,
    character: ImportedCharacter,
    consumable_uses: ConsumableUses,
    pub encounter: Encounter,
    pub layout: Layout,
    pub pins: Vec<Pin>,
}

impl<Encounter, Layout> CharacterSession<Encounter, Layout> {
    pub fn open(
        save_path: PathBuf,
        content_paths: Vec<PathBuf>,
        encounter: Encounter,
        layout: Layout,
    ) -> Result<Self, ImportError> {
        let character = load_character(&save_path, &content_paths)?;
        Ok(Self {
            save_path,
            content_paths,
            character,
            consumable_uses: ConsumableUses::default(),
            encounter,
            layout,
            pins: Vec::new(),
        })
    }

    pub fn character(&self) -> &ImportedCharacter {
        &self.character
    }

    pub fn combat_sheet(&self) -> CombatSheet {
        CombatSheet::with_consumable_uses(&self.character, &self.consumable_uses)
    }

    /// Records one unit spent and returns the updated quantity.
    pub fn use_consumable(&mut self, key: &str) -> Result<u32, ConsumableUseError> {
        self.consumable_uses.use_one(&self.character, key)
    }

    /// Rereads the saved character and content files. Returns the pins whose targets disappeared.
    pub fn reimport(&mut self) -> Result<Vec<Pin>, ImportError> {
        let character = load_character(&self.save_path, &self.content_paths)?;
        Ok(self.replace_character(character))
    }

    /// Refreshes using a new content file list in Aurora load order.
    /// The list becomes the source for later refreshes after this import succeeds.
    pub fn reimport_with_content(
        &mut self,
        content_paths: Vec<PathBuf>,
    ) -> Result<Vec<Pin>, ImportError> {
        let character = load_character(&self.save_path, &content_paths)?;
        self.content_paths = content_paths;
        Ok(self.replace_character(character))
    }

    fn replace_character(&mut self, character: ImportedCharacter) -> Vec<Pin> {
        let mut removed = Vec::new();
        self.pins.retain(|pin| {
            let applies = pin.applies_to(&character);
            if !applies {
                removed.push(pin.clone());
            }
            applies
        });
        self.character = character;
        removed
    }
}

fn load_character(
    save_path: &Path,
    content_paths: &[PathBuf],
) -> Result<ImportedCharacter, ImportError> {
    let paths: Vec<_> = content_paths.iter().map(PathBuf::as_path).collect();
    import_character_with_content(save_path, &paths)
}
