use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
};

use crate::{
    aurora::{ImportError, ImportedCharacter, import_character_with_content},
    combat::CombatSheet,
    companion::CompanionRoster,
    companion::CompanionTurn,
    concentration::{
        Concentration, ConcentrationCast, ConcentrationRules, ConcentrationSave,
        ConcentrationStart, RecordedSave, Replacement, SaveResult, StartError,
    },
    effects::TurnBoundary,
    encounter::{EncounterProgress, InitiativeId},
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
    pub concentration: Concentration,
    pub companions: CompanionRoster,
    progress: EncounterProgress,
    undo: VecDeque<CombatSnapshot>,
    pub encounter: Encounter,
    pub layout: Layout,
    pub pins: Vec<Pin>,
}

#[derive(PartialEq, Eq)]
struct CombatSnapshot {
    progress: EncounterProgress,
    consumable_uses: ConsumableUses,
    concentration: Concentration,
    companions: CompanionRoster,
}

impl<Encounter, Layout> CharacterSession<Encounter, Layout> {
    pub fn open(
        save_path: PathBuf,
        content_paths: Vec<PathBuf>,
        encounter: Encounter,
        layout: Layout,
    ) -> Result<Self, ImportError> {
        let character = load_character(&save_path, &content_paths)?;
        let mut companions = CompanionRoster::default();
        companions.sync_imported(&character);
        Ok(Self {
            save_path,
            content_paths,
            character,
            consumable_uses: ConsumableUses::default(),
            concentration: Concentration::default(),
            companions,
            progress: EncounterProgress::default(),
            undo: VecDeque::new(),
            encounter,
            layout,
            pins: Vec::new(),
        })
    }

    pub fn character(&self) -> &ImportedCharacter {
        &self.character
    }

    pub fn combat_sheet(&self) -> CombatSheet {
        let mut sheet = CombatSheet::with_consumable_uses(&self.character, &self.consumable_uses);
        sheet.companions = self.companions.clone();
        sheet.progress = self.progress.clone();
        sheet
    }

    /// Records one unit spent and returns the updated quantity.
    pub fn use_consumable(&mut self, key: &str) -> Result<u32, ConsumableUseError> {
        let before = self.snapshot();
        let remaining = self.consumable_uses.use_one(&self.character, key)?;
        self.remember(before);
        Ok(remaining)
    }

    /// Starts concentrating, or returns the proposal before changing the active spell or inventory.
    pub fn start_concentration(
        &mut self,
        cast: ConcentrationCast,
    ) -> Result<ConcentrationStart, StartError> {
        if let Some(active) = self.concentration.active() {
            return Ok(ConcentrationStart::ConfirmReplacement(Replacement {
                current_spell: active.spell.name.clone(),
                active_id: active.id,
                cast,
            }));
        }
        self.apply_concentration(cast)?;
        Ok(ConcentrationStart::Started)
    }

    pub fn confirm_concentration(&mut self, replacement: Replacement) -> Result<(), StartError> {
        if !self
            .concentration
            .active()
            .is_some_and(|active| active.id == replacement.active_id)
        {
            return Err(StartError::StaleReplacement);
        }
        self.apply_concentration(replacement.cast)
    }

    fn apply_concentration(&mut self, cast: ConcentrationCast) -> Result<(), StartError> {
        let before = self.snapshot();
        if let Some(key) = &cast.scroll_key {
            self.consumable_uses
                .use_one(&self.character, key)
                .map_err(StartError::Consumable)?;
        }
        self.concentration.begin(cast.spell);
        self.remember(before);
        Ok(())
    }

    pub fn progress(&self) -> &EncounterProgress {
        &self.progress
    }

    pub fn edit_combat(&mut self, edit: impl FnOnce(&mut EncounterProgress, &mut CompanionRoster)) {
        let before = self.snapshot();
        edit(&mut self.progress, &mut self.companions);
        self.progress.reconcile_turn(&self.companions);
        self.remember(before);
    }

    pub fn next_turn(&mut self) -> Option<InitiativeId> {
        let before = self.snapshot();
        let previous = before.progress.current.filter(|current| {
            before
                .progress
                .ordered(&self.companions)
                .iter()
                .any(|(id, _)| id == current)
        });
        self.progress.advance(&self.companions)?;
        if let Some(previous) = previous {
            self.effect_boundary(TurnBoundary::End, previous);
        }
        if before.progress.round != self.progress.round {
            self.concentration.elapse(6);
            self.progress.effects.advance_round();
            self.progress.effects.elapse(6);
            for card in &mut self.companions.cards {
                if let Some(rounds) = &mut card.remaining_rounds {
                    *rounds = rounds.saturating_sub(1);
                }
            }
            self.progress.reconcile_turn(&self.companions);
        }
        if let Some(current) = self.progress.current {
            self.effect_boundary(TurnBoundary::Start, current);
        }
        self.remember(before);
        self.progress.current
    }

    pub fn end_encounter(&mut self) -> bool {
        if !self.progress.active {
            return false;
        }
        self.edit_combat(|progress, _| progress.active = false);
        true
    }

    pub fn start_encounter(&mut self) -> bool {
        if self.progress.active {
            return false;
        }
        self.edit_combat(|progress, companions| {
            progress.active = true;
            progress.round = 1;
            progress.current = progress.ordered(companions).first().map(|&(id, _)| id);
        });
        true
    }

    fn effect_boundary(&mut self, boundary: TurnBoundary, current: InitiativeId) {
        let companions = &self.companions.cards;
        self.progress
            .effects
            .boundary(boundary, current, |target| match target {
                InitiativeId::Companion(id) => companions
                    .iter()
                    .find(|card| card.id == id && card.remaining_rounds != Some(0))
                    .map(|card| match card.turn {
                        CompanionTurn::WithOwner => InitiativeId::Owner,
                        CompanionTurn::Separate(_) => target,
                    }),
                _ => Some(target),
            });
    }

    pub fn record_damage(
        &mut self,
        amount: u32,
        rules: ConcentrationRules,
    ) -> Option<ConcentrationSave> {
        if amount == 0 {
            return None;
        }
        let before = self.snapshot();
        let imported_hp = self
            .character
            .profile
            .stats
            .max_hp
            .and_then(|hp| u32::try_from(hp).ok());
        let remaining = self.progress.damage_owner(amount, imported_hp);
        let prompt = if remaining.is_some_and(|hp| hp.current == 0) {
            self.concentration.end();
            None
        } else {
            self.concentration.record_damage(amount, rules)
        };
        self.remember(before);
        prompt
    }

    pub fn resolve_concentration_save(
        &mut self,
        id: u64,
        result: SaveResult,
    ) -> Option<RecordedSave> {
        let before = self.snapshot();
        let recorded = self.concentration.record_save(id, result)?;
        self.remember(before);
        Some(recorded)
    }

    pub fn advance_concentration_time(&mut self, seconds: u32) -> bool {
        let before = self.snapshot();
        let expired = self.concentration.elapse(seconds);
        self.progress.effects.elapse(seconds);
        self.remember(before);
        expired
    }

    pub fn end_concentration(&mut self) {
        let before = self.snapshot();
        self.concentration.end();
        self.remember(before);
    }

    pub fn undo_combat(&mut self) -> bool {
        let Some(mut before) = self.undo.pop_back() else {
            return false;
        };
        before.concentration.keep_sequence(&self.concentration);
        before.progress.keep_sequence(&self.progress);
        before.companions.keep_sequence(&self.companions);
        self.progress = before.progress;
        self.consumable_uses = before.consumable_uses;
        self.concentration = before.concentration;
        self.companions = before.companions;
        self.companions.sync_imported(&self.character);
        true
    }

    fn snapshot(&self) -> CombatSnapshot {
        CombatSnapshot {
            progress: self.progress.clone(),
            consumable_uses: self.consumable_uses.clone(),
            concentration: self.concentration.clone(),
            companions: self.companions.clone(),
        }
    }

    fn remember(&mut self, before: CombatSnapshot) {
        if before != self.snapshot() {
            if self.undo.len() == 32 {
                self.undo.pop_front();
            }
            self.undo.push_back(before);
        }
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
        self.companions.sync_imported(&character);
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
