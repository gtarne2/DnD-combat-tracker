use crate::encounter::InitiativeId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnBoundary {
    Start,
    End,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectDuration {
    Manual,
    Rounds(u32),
    Seconds(u32),
    Turn {
        /// None follows the effect target's own initiative entry.
        anchor: Option<InitiativeId>,
        boundary: TurnBoundary,
        remaining: u32,
    },
}

impl EffectDuration {
    pub fn expired(self) -> bool {
        matches!(
            self,
            Self::Rounds(0) | Self::Seconds(0) | Self::Turn { remaining: 0, .. }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectDetails {
    pub name: String,
    pub notes: String,
    pub target: InitiativeId,
    pub duration: EffectDuration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OngoingEffect {
    pub id: u64,
    pub details: EffectDetails,
    pub ended: bool,
}

impl OngoingEffect {
    pub fn active(&self) -> bool {
        !self.ended && !self.details.duration.expired()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Effects {
    entries: Vec<OngoingEffect>,
    next_id: u64,
}

impl Effects {
    pub fn entries(&self) -> &[OngoingEffect] {
        &self.entries
    }

    pub fn add(&mut self, details: EffectDetails) -> Option<u64> {
        if details.name.trim().is_empty() {
            return None;
        }
        self.next_id += 1;
        let id = self.next_id;
        self.entries.push(OngoingEffect {
            id,
            details,
            ended: false,
        });
        Some(id)
    }

    pub fn edit(&mut self, id: u64, details: EffectDetails) -> bool {
        if details.name.trim().is_empty() {
            return false;
        }
        let Some(effect) = self.entries.iter_mut().find(|effect| effect.id == id) else {
            return false;
        };
        effect.details = details;
        effect.ended = false;
        true
    }

    pub fn end(&mut self, id: u64) -> bool {
        let Some(effect) = self
            .entries
            .iter_mut()
            .find(|effect| effect.id == id && effect.active())
        else {
            return false;
        };
        effect.ended = true;
        true
    }

    pub fn remove(&mut self, id: u64) -> bool {
        let Some(index) = self.entries.iter().position(|effect| effect.id == id) else {
            return false;
        };
        self.entries.remove(index);
        true
    }

    pub(crate) fn advance_round(&mut self) {
        for effect in self.entries.iter_mut().filter(|effect| effect.active()) {
            if let EffectDuration::Rounds(remaining) = &mut effect.details.duration {
                *remaining -= 1;
            }
        }
    }

    pub(crate) fn elapse(&mut self, seconds: u32) {
        for effect in self.entries.iter_mut().filter(|effect| effect.active()) {
            if let EffectDuration::Seconds(remaining) = &mut effect.details.duration {
                *remaining = remaining.saturating_sub(seconds);
            }
        }
    }

    pub(crate) fn boundary(
        &mut self,
        phase: TurnBoundary,
        current: InitiativeId,
        initiative_entry: impl Fn(InitiativeId) -> Option<InitiativeId>,
    ) {
        for effect in self.entries.iter_mut().filter(|effect| effect.active()) {
            if let EffectDuration::Turn {
                anchor,
                boundary,
                remaining,
            } = &mut effect.details.duration
            {
                if *boundary == phase
                    && initiative_entry(anchor.unwrap_or(effect.details.target)) == Some(current)
                {
                    *remaining -= 1;
                }
            }
        }
    }

    pub(crate) fn keep_sequence(&mut self, newer: &Self) {
        self.next_id = self.next_id.max(newer.next_id);
    }
}
