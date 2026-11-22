use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcentrationSpell {
    pub id: String,
    pub name: String,
    pub duration: Option<String>,
    pub duration_seconds: Option<u32>,
}

impl ConcentrationSpell {
    pub fn new(id: String, name: String, duration: Option<String>) -> Self {
        let duration_seconds = duration.as_deref().and_then(parse_duration);
        Self {
            id,
            name,
            duration,
            duration_seconds,
        }
    }
}

pub(crate) fn parse_duration(label: &str) -> Option<u32> {
    let label = label.trim().to_ascii_lowercase();
    let label = label.strip_prefix("concentration").unwrap_or(&label);
    let label = label.trim_start_matches([',', ':', ' ']);
    let mut parts = label
        .strip_prefix("up to ")
        .unwrap_or(label)
        .split_whitespace();
    let amount: u32 = parts.next()?.parse().ok()?;
    let multiplier = match parts
        .next()?
        .trim_end_matches(['s', '.'])
        .trim_end_matches('s')
    {
        "round" => 6,
        "second" => 1,
        "minute" => 60,
        "hour" => 3600,
        "day" => 86400,
        _ => return None,
    };
    (amount > 0 && parts.next().is_none())
        .then(|| amount.checked_mul(multiplier))
        .flatten()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcentrationCast {
    pub spell: ConcentrationSpell,
    pub scroll_key: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConcentrationStart {
    Started,
    ConfirmReplacement(Replacement),
}

#[derive(Debug, PartialEq, Eq)]
pub struct Replacement {
    pub current_spell: String,
    pub(crate) active_id: u64,
    pub(crate) cast: ConcentrationCast,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StartError {
    StaleReplacement,
    Consumable(crate::inventory::ConsumableUseError),
}

impl std::fmt::Display for StartError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::StaleReplacement => {
                formatter.write_str("active concentration changed before confirmation")
            }
            Self::Consumable(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for StartError {}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum ConcentrationRules {
    #[default]
    Rules2014,
    Rules2024,
}

impl ConcentrationRules {
    pub fn save_dc(self, damage: u32) -> Option<u32> {
        if damage == 0 {
            return None;
        }
        let dc = (damage / 2).max(10);
        Some(match self {
            Self::Rules2014 => dc,
            Self::Rules2024 => dc.min(30),
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ActiveConcentration {
    pub spell: ConcentrationSpell,
    pub remaining_seconds: Option<u32>,
    pub(crate) id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConcentrationSave {
    pub id: u64,
    pub damage: u32,
    pub dc: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveResult {
    Success,
    Failure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordedSave {
    pub prompt: ConcentrationSave,
    pub result: SaveResult,
}

#[derive(Debug, Default)]
pub struct Concentration {
    active: Option<ActiveConcentration>,
    pending: VecDeque<ConcentrationSave>,
    last_result: Option<RecordedSave>,
    sequence: u64,
}

impl Concentration {
    pub fn active(&self) -> Option<&ActiveConcentration> {
        self.active.as_ref()
    }

    pub fn next_save(&self) -> Option<ConcentrationSave> {
        self.pending.front().copied()
    }

    pub fn last_result(&self) -> Option<RecordedSave> {
        self.last_result
    }

    pub(crate) fn begin(&mut self, spell: ConcentrationSpell) {
        self.sequence += 1;
        self.pending.clear();
        self.last_result = None;
        self.active = Some(ActiveConcentration {
            id: self.sequence,
            remaining_seconds: spell.duration_seconds,
            spell,
        });
    }

    /// Records one damaging hit after resistance and other reductions have been applied.
    pub fn record_damage(
        &mut self,
        damage: u32,
        rules: ConcentrationRules,
    ) -> Option<ConcentrationSave> {
        self.active.as_ref()?;
        let dc = rules.save_dc(damage)?;
        self.sequence += 1;
        let prompt = ConcentrationSave {
            id: self.sequence,
            damage,
            dc,
        };
        self.pending.push_back(prompt);
        Some(prompt)
    }

    /// Accepts only the currently displayed save. An old response cannot resolve a later hit.
    pub fn record_save(&mut self, id: u64, result: SaveResult) -> Option<RecordedSave> {
        let prompt = self.next_save().filter(|prompt| prompt.id == id)?;
        self.pending.pop_front();
        let recorded = RecordedSave { prompt, result };
        self.last_result = Some(recorded);
        if result == SaveResult::Failure {
            self.end();
        }
        Some(recorded)
    }

    /// Advances in-game time and returns whether concentration expired.
    pub fn elapse(&mut self, seconds: u32) -> bool {
        let Some(remaining) = self
            .active
            .as_mut()
            .and_then(|active| active.remaining_seconds.as_mut())
        else {
            return false;
        };
        *remaining = remaining.saturating_sub(seconds);
        if *remaining != 0 {
            return false;
        }
        self.end();
        true
    }

    pub fn end(&mut self) {
        self.active = None;
        self.pending.clear();
    }
}
