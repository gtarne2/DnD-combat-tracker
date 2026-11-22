use std::{cmp::Reverse, collections::BTreeMap};

use crate::{
    companion::{CompanionRoster, CompanionTurn},
    effects::Effects,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum InitiativeId {
    Owner,
    Companion(u64),
    Combatant(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HitPoints {
    pub current: u32,
    pub maximum: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Combatant {
    pub id: u64,
    pub name: String,
    pub initiative: i32,
    pub hp: Option<HitPoints>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EncounterProgress {
    pub round: u32,
    pub current: Option<InitiativeId>,
    pub owner_hp: Option<HitPoints>,
    pub combatants: Vec<Combatant>,
    pub spent: BTreeMap<String, u32>,
    pub effects: Effects,
    next_id: u64,
}

impl Default for EncounterProgress {
    fn default() -> Self {
        Self {
            round: 1,
            current: None,
            owner_hp: None,
            combatants: Vec::new(),
            spent: BTreeMap::new(),
            effects: Effects::default(),
            next_id: 0,
        }
    }
}

impl EncounterProgress {
    pub(crate) fn keep_sequence(&mut self, newer: &Self) {
        self.next_id = self.next_id.max(newer.next_id);
        self.effects.keep_sequence(&newer.effects);
    }

    pub fn add_combatant(&mut self, name: String, initiative: i32, hp: Option<HitPoints>) -> u64 {
        self.next_id += 1;
        self.combatants.push(Combatant {
            id: self.next_id,
            name,
            initiative,
            hp,
        });
        self.next_id
    }

    pub fn ordered(&self, companions: &CompanionRoster) -> Vec<(InitiativeId, i32)> {
        let mut rows: Vec<_> = companions
            .owner_initiative
            .into_iter()
            .map(|score| (InitiativeId::Owner, score))
            .collect();
        rows.extend(companions.cards.iter().filter_map(|card| match card.turn {
            CompanionTurn::Separate(score) if card.remaining_rounds != Some(0) => {
                Some((InitiativeId::Companion(card.id), score))
            }
            _ => None,
        }));
        rows.extend(
            self.combatants
                .iter()
                .map(|actor| (InitiativeId::Combatant(actor.id), actor.initiative)),
        );
        rows.sort_by_key(|&(id, score)| (Reverse(score), id));
        rows
    }

    pub fn reconcile_turn(&mut self, companions: &CompanionRoster) {
        let rows = self.ordered(companions);
        if self
            .current
            .is_some_and(|current| !rows.iter().any(|&(id, _)| id == current))
        {
            self.current = rows.first().map(|&(id, _)| id);
        }
    }

    pub fn advance(&mut self, companions: &CompanionRoster) -> Option<InitiativeId> {
        let rows = self.ordered(companions);
        let first = rows.first()?.0;
        self.current = Some(
            match rows.iter().position(|&(id, _)| Some(id) == self.current) {
                Some(index) if index + 1 == rows.len() => {
                    self.round = self.round.saturating_add(1);
                    first
                }
                Some(index) => rows[index + 1].0,
                None => first,
            },
        );
        self.current
    }

    pub fn owner_hp(&self, imported_maximum: Option<u32>) -> Option<HitPoints> {
        self.owner_hp.or_else(|| {
            imported_maximum.map(|maximum| HitPoints {
                current: maximum,
                maximum: Some(maximum),
            })
        })
    }

    pub fn damage_owner(
        &mut self,
        damage: u32,
        imported_maximum: Option<u32>,
    ) -> Option<HitPoints> {
        let mut hp = self.owner_hp(imported_maximum)?;
        if damage > 0 {
            hp.current = hp.current.saturating_sub(damage);
            self.owner_hp = Some(hp);
        }
        Some(hp)
    }

    pub fn remaining(&self, key: &str, capacity: u32) -> u32 {
        capacity.saturating_sub(self.spent.get(key).copied().unwrap_or(0))
    }

    pub fn spend(&mut self, key: &str, capacity: u32) -> bool {
        if self.remaining(key, capacity) == 0 {
            return false;
        }
        *self.spent.entry(key.to_owned()).or_default() += 1;
        true
    }

    pub fn restore(&mut self, key: &str) -> bool {
        let Some(used) = self.spent.get_mut(key) else {
            return false;
        };
        *used = used.saturating_sub(1);
        if *used == 0 {
            self.spent.remove(key);
        }
        true
    }
}
