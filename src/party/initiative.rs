use super::interruptions::WindowEdit;
use super::monster_actions::{
    ActionEdit, Actions, DamageDecision, DamageRoll, Outcome, Reset, StrikeReview,
};
use super::wire::{Event, Rejection};
use crate::monsters::Snapshot;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Enemy {
    pub name: String,
    pub alias: String,
    pub revealed: bool,
    pub hp: Option<u32>,
    pub max_hp: Option<u32>,
    pub ac: Option<i32>,
    pub conditions: String,
    pub notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<Box<Snapshot>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Companion {
    pub local_id: u32,
    pub name: String,
    pub initiative: Option<i32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    Submit {
        score: i32,
        companions: Vec<Companion>,
    },
    Leave,
    Enemy {
        id: Option<Uuid>,
        score: i32,
        enemy: Enemy,
    },
    AddMonsters {
        template: Box<Snapshot>,
        count: u32,
        score: i32,
    },
    Duplicate {
        id: Uuid,
    },
    MonsterAction {
        id: Uuid,
        action: ActionEdit,
    },
    FinalizeDamage {
        action_id: Uuid,
        strike_id: Uuid,
        decision: DamageDecision,
    },
    StrikeWindow {
        action_id: Uuid,
        strike_id: Uuid,
        edit: WindowEdit,
    },
    ReviewStrike {
        action_id: Uuid,
        strike_id: Uuid,
        review: StrikeReview,
    },
    StoreDamageRoll {
        action_id: Uuid,
        strike_id: Uuid,
        roll: DamageRoll,
    },
    Remove {
        id: Uuid,
    },
    Reveal {
        id: Uuid,
        revealed: bool,
    },
    Group {
        id: Uuid,
    },
    MoveUp {
        id: Uuid,
    },
    Correct {
        id: Uuid,
    },
    Start,
    Next,
    End,
    Advance {
        amount: u32,
        rounds: bool,
    },
    Save {
        name: String,
    },
    Load {
        name: String,
    },
    New,
    /// Replace the stopped position with a portable export. Each exported player
    /// seat is kept only when the DM pairs it with a current member of this room.
    Import {
        encounter: Box<PortableEncounter>,
        seats: BTreeMap<Uuid, Uuid>,
    },
}

pub const ENCOUNTER_FORMAT: &str = "aurora-encounter";
pub const ENCOUNTER_VERSION: u32 = 1;
const MAX_IMPORT_ROWS: usize = 500;

/// Host-owned encounter file. It carries enemy snapshots and counters, the
/// roster shape and the turn pointer. It omits member identities, inspections,
/// credentials, recorded strikes, delivery ledgers and pending exchanges.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableEncounter {
    format: String,
    version: u32,
    running: bool,
    round: u32,
    current: Option<Uuid>,
    rows: Vec<PortableRow>,
}

#[derive(Clone, Serialize, Deserialize)]
struct PortableRow {
    id: Uuid,
    score: i32,
    actor: PortableActor,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum PortableActor {
    Enemy {
        enemy: Enemy,
        #[serde(default)]
        actions: Actions,
    },
    /// A player seat. Its row ID is the seat ID the DM pairs on import.
    Player {
        name: String,
        companions: Vec<Companion>,
    },
    Companion {
        seat: Uuid,
        local_id: u32,
        name: String,
    },
}

fn valid_enemy(enemy: &Enemy) -> bool {
    label(&enemy.name)
        && (enemy.alias.is_empty() || label(&enemy.alias))
        && (!enemy.revealed || label(&enemy.alias))
        && enemy.notes.len() <= 16000
        && enemy.conditions.len() <= 2000
        && !enemy.hp.zip(enemy.max_hp).is_some_and(|(hp, max)| hp > max)
}

fn valid_companions(companions: &[Companion]) -> bool {
    let ids: BTreeSet<_> = companions.iter().map(|c| c.local_id).collect();
    ids.len() == companions.len()
        && companions.len() <= 100
        && companions.iter().all(|c| label(&c.name))
}

impl PortableEncounter {
    fn position(
        &self,
        seats: &BTreeMap<Uuid, Uuid>,
        players: &BTreeMap<Uuid, String>,
    ) -> Result<Position, Rejection> {
        let invalid = Rejection::InvalidInput;
        if self.format != ENCOUNTER_FORMAT {
            return Err(invalid);
        }
        if self.version != ENCOUNTER_VERSION {
            return Err(Rejection::UnsupportedVersion);
        }
        let ids: BTreeSet<_> = self.rows.iter().map(|r| r.id).collect();
        if self.round == 0
            || self.rows.len() > MAX_IMPORT_ROWS
            || ids.len() != self.rows.len()
            || ids.contains(&Uuid::nil())
            || self.current.is_some_and(|id| !ids.contains(&id))
        {
            return Err(invalid);
        }
        let seat_companions: BTreeMap<Uuid, &Vec<Companion>> = self
            .rows
            .iter()
            .filter_map(|r| match &r.actor {
                PortableActor::Player { companions, .. } => Some((r.id, companions)),
                _ => None,
            })
            .collect();
        let paired: BTreeSet<_> = seats.values().collect();
        if paired.len() != seats.len()
            || seats.keys().any(|seat| !seat_companions.contains_key(seat))
            || seats.values().any(|member| !players.contains_key(member))
        {
            return Err(invalid);
        }
        let mut separate = BTreeSet::new();
        let mut rows = vec![];
        for row in &self.rows {
            let actor = match &row.actor {
                PortableActor::Enemy { enemy, actions } => {
                    if !valid_enemy(enemy)
                        || enemy
                            .template
                            .as_ref()
                            .is_some_and(|t| t.validate().is_err())
                    {
                        return Err(invalid);
                    }
                    actions.check_import(enemy.template.as_deref())?;
                    Some((Participant::Enemy(enemy.clone()), actions.clone()))
                }
                PortableActor::Player { name, companions } => {
                    if !label(name) || !valid_companions(companions) {
                        return Err(invalid);
                    }
                    seats.get(&row.id).map(|&member| {
                        (
                            Participant::Player {
                                member,
                                name: players[&member].clone(),
                                companions: companions.clone(),
                            },
                            Actions::default(),
                        )
                    })
                }
                PortableActor::Companion {
                    seat,
                    local_id,
                    name,
                } => {
                    let owner = seat_companions.get(seat).ok_or(invalid)?;
                    if !label(name)
                        || !separate.insert((*seat, *local_id))
                        || !owner
                            .iter()
                            .any(|c| c.local_id == *local_id && c.initiative.is_some())
                    {
                        return Err(invalid);
                    }
                    seats.get(seat).map(|&member| {
                        (
                            Participant::Companion {
                                member,
                                local_id: *local_id,
                                name: name.clone(),
                            },
                            Actions::default(),
                        )
                    })
                }
            };
            rows.push(actor.map(|(actor, actions)| Row {
                id: row.id,
                score: row.score,
                actor,
                actions,
            }));
        }
        // An unpaired seat leaves the order. A pointer on it moves to the next kept row.
        let current = self.current.and_then(|id| {
            let start = self.rows.iter().position(|r| r.id == id)?;
            (0..rows.len())
                .map(|offset| (start + offset) % rows.len())
                .find_map(|i| rows[i].as_ref().map(|r| r.id))
        });
        Ok(Position {
            rows: rows.into_iter().flatten().collect(),
            round: self.round,
            current,
        })
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct FightEdit {
    pub encounter_id: Uuid,
    pub expected_revision: u64,
    pub edit: Edit,
}

#[derive(Clone, Serialize, Deserialize)]
enum Participant {
    Enemy(Enemy),
    Player {
        member: Uuid,
        name: String,
        companions: Vec<Companion>,
    },
    Companion {
        member: Uuid,
        local_id: u32,
        name: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
struct Row {
    id: Uuid,
    score: i32,
    actor: Participant,
    #[serde(default)]
    actions: Actions,
}

impl Row {
    fn player(&self) -> Option<Uuid> {
        match self.actor {
            Participant::Player { member, .. } => Some(member),
            _ => None,
        }
    }
    fn member(&self) -> Option<Uuid> {
        match self.actor {
            Participant::Player { member, .. } | Participant::Companion { member, .. } => {
                Some(member)
            }
            _ => None,
        }
    }
    fn key(&self, viewer: Uuid) -> String {
        match self.actor {
            Participant::Player { member, .. } if member == viewer => "owner".into(),
            Participant::Companion {
                member, local_id, ..
            } if member == viewer => format!("companion:{local_id}"),
            _ => format!("party:{}", self.id),
        }
    }
    fn view(&self, viewer: Uuid, dm: bool) -> Value {
        let mut row = json!({"id":self.id,"key":self.key(viewer),"score":self.score});
        match &self.actor {
            Participant::Enemy(enemy) => {
                row["name"] = json!(if dm {
                    &enemy.name
                } else if enemy.revealed {
                    &enemy.alias
                } else {
                    "DM turn"
                });
                if dm {
                    row["enemy"] = json!(enemy);
                    row["actions"] = self.actions.view(enemy.template.as_deref());
                }
                if !dm && !enemy.revealed {
                    row["score"] = Value::Null;
                }
            }
            Participant::Player {
                name, companions, ..
            } => {
                row["name"] = json!(name);
                if self.member() == Some(viewer) {
                    row["companions"] = json!(companions);
                }
                if dm {
                    row["damage_recipient"] = json!(self.player());
                }
                row["shared"] = json!(
                    companions
                        .iter()
                        .filter(|c| c.initiative.is_none())
                        .map(|c| &c.name)
                        .collect::<Vec<_>>()
                );
            }
            Participant::Companion { name, .. } => row["name"] = json!(name),
        }
        row
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Position {
    rows: Vec<Row>,
    round: u32,
    current: Option<Uuid>,
}

#[derive(Serialize, Deserialize)]
pub struct Fight {
    id: Uuid,
    revision: u64,
    running: bool,
    position: Position,
    saves: BTreeMap<String, Position>,
}

impl Default for Fight {
    fn default() -> Self {
        Self {
            id: Uuid::nil(),
            revision: 0,
            running: false,
            position: Position {
                rows: vec![],
                round: 1,
                current: None,
            },
            saves: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Enter,
    Step,
    Position,
    Time,
    Exit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Clock {
    pub encounter_id: Uuid,
    pub phase: Phase,
    pub separate: Vec<u32>,
    pub round: u32,
    pub from: Option<String>,
    pub to: Option<String>,
    pub wrap: bool,
    pub seconds: u32,
    pub rounds: u32,
}

pub(super) fn label(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 120 && !value.chars().any(char::is_control)
}

impl Fight {
    pub(super) fn initialize_legacy(&mut self, room_id: Uuid) {
        if self.id.is_nil() {
            self.id = room_id;
        }
    }
    pub fn new() -> Self {
        Self {
            id: Uuid::new_v4(),
            ..Self::default()
        }
    }
    pub fn close(&mut self) -> Vec<(Uuid, Event)> {
        if !self.running {
            return vec![];
        }
        self.edit(
            Uuid::nil(),
            "",
            true,
            &FightEdit {
                encounter_id: self.id,
                expected_revision: self.revision,
                edit: Edit::End,
            },
            &BTreeMap::new(),
        )
        .unwrap_or_default()
    }
    pub fn export(&self) -> PortableEncounter {
        let seat = |member: Uuid| {
            self.position
                .rows
                .iter()
                .find(|r| r.player() == Some(member))
                .map(|r| r.id)
        };
        PortableEncounter {
            format: ENCOUNTER_FORMAT.into(),
            version: ENCOUNTER_VERSION,
            running: self.running,
            round: self.position.round,
            current: self.position.current,
            rows: self
                .position
                .rows
                .iter()
                .filter_map(|row| {
                    let actor = match &row.actor {
                        Participant::Enemy(enemy) => PortableActor::Enemy {
                            enemy: enemy.clone(),
                            actions: row.actions.portable(),
                        },
                        Participant::Player {
                            name, companions, ..
                        } => PortableActor::Player {
                            name: name.clone(),
                            companions: companions.clone(),
                        },
                        Participant::Companion {
                            member,
                            local_id,
                            name,
                        } => PortableActor::Companion {
                            seat: seat(*member)?,
                            local_id: *local_id,
                            name: name.clone(),
                        },
                    };
                    Some(PortableRow {
                        id: row.id,
                        score: row.score,
                        actor,
                    })
                })
                .collect(),
        }
    }

    pub fn view(&self, viewer: Uuid, dm: bool) -> Value {
        let mut view = json!({"id":self.id,"revision":self.revision,"running":self.running,"round":self.position.round,
            "current":self.position.current,"joined":self.members().contains(&viewer),
            "rows":self.position.rows.iter().map(|r| r.view(viewer,dm)).collect::<Vec<_>>()});
        if dm {
            view["saves"] = json!(self.saves.keys().collect::<Vec<_>>());
        }
        view
    }

    fn members(&self) -> BTreeSet<Uuid> {
        self.position.rows.iter().filter_map(Row::member).collect()
    }
    fn separate(&self, member: Uuid) -> Vec<u32> {
        self.position
            .rows
            .iter()
            .filter_map(|r| match r.actor {
                Participant::Companion {
                    member: m,
                    local_id,
                    ..
                } if m == member => Some(local_id),
                _ => None,
            })
            .collect()
    }
    fn current(&self) -> Option<&Row> {
        self.position
            .rows
            .iter()
            .find(|r| Some(r.id) == self.position.current)
    }

    pub fn leave(&mut self, member: Uuid) -> Vec<(Uuid, Event)> {
        if !self.members().contains(&member)
            && !self
                .saves
                .values()
                .any(|s| s.rows.iter().any(|r| r.member() == Some(member)))
        {
            return vec![];
        }
        self.edit(
            member,
            "",
            false,
            &FightEdit {
                encounter_id: self.id,
                expected_revision: self.revision,
                edit: Edit::Leave,
            },
            &BTreeMap::new(),
        )
        .unwrap_or_default()
    }

    pub(super) fn check_revision(&self, cmd: &FightEdit) -> Result<(), Rejection> {
        if self.id != cmd.encounter_id || self.revision != cmd.expected_revision {
            return Err(Rejection::RevisionConflict);
        }
        Ok(())
    }

    pub(super) fn recorded_strike(
        &self,
        action: Uuid,
        strike: Uuid,
    ) -> Result<(Outcome, Option<Uuid>, Option<Uuid>), Rejection> {
        let (strike, recorded) = self
            .position
            .rows
            .iter()
            .find_map(|row| row.actions.strike(action, strike))
            .ok_or(Rejection::InvalidInput)?;
        let recipient = match recorded {
            Some(recipients) => recipients.get(&strike.id).copied(),
            None => strike
                .target
                .and_then(|id| self.position.rows.iter().find(|r| r.id == id)?.player()),
        };
        Ok((strike.outcome, recipient, strike.target))
    }

    pub(super) fn revised(&mut self) {
        self.revision += 1;
    }

    pub(super) fn review_strike(
        &mut self,
        action: Uuid,
        strike: Uuid,
        review: &StrikeReview,
    ) -> Result<(), Rejection> {
        for row in &mut self.position.rows {
            if row.actions.review(action, strike, review)? {
                self.revised();
                return Ok(());
            }
        }
        Err(Rejection::InvalidInput)
    }

    pub(super) fn has_row(&self, id: Uuid) -> bool {
        self.position.rows.iter().any(|row| row.id == id)
    }

    pub fn edit(
        &mut self,
        actor: Uuid,
        name: &str,
        dm: bool,
        cmd: &FightEdit,
        players: &BTreeMap<Uuid, String>,
    ) -> Result<Vec<(Uuid, Event)>, Rejection> {
        self.check_revision(cmd)?;
        if dm == matches!(cmd.edit, Edit::Submit { .. } | Edit::Leave) {
            return Err(Rejection::Forbidden);
        }
        let before = self.members();
        let old_separate = self.separate(actor);
        let was_running = self.running;
        let previous = self.current().cloned();
        let mut phase = Phase::Position;
        let mut wrap = false;
        let mut seconds = 0;
        let mut rounds = 0;
        let rows = &mut self.position.rows;
        match &cmd.edit {
            Edit::Submit { score, companions } => {
                if !valid_companions(companions) {
                    return Err(Rejection::InvalidInput);
                }
                // Reuse row IDs across resubmission, including an active companion.
                let mut submitted = vec![(
                    None,
                    *score,
                    Participant::Player {
                        member: actor,
                        name: name.into(),
                        companions: companions.clone(),
                    },
                )];
                for c in companions {
                    if let Some(score) = c.initiative {
                        submitted.push((
                            Some(c.local_id),
                            score,
                            Participant::Companion {
                                member: actor,
                                local_id: c.local_id,
                                name: c.name.clone(),
                            },
                        ));
                    }
                }
                let mut retained = BTreeSet::new();
                for (local, score, participant) in submitted {
                    let row = rows.iter_mut().find(|r| {
                        r.member() == Some(actor)
                            && match r.actor {
                                Participant::Player { .. } => local.is_none(),
                                Participant::Companion { local_id, .. } => local == Some(local_id),
                                _ => false,
                            }
                    });
                    if let Some(row) = row {
                        row.score = score;
                        row.actor = participant;
                        retained.insert(row.id);
                    } else {
                        let id = Uuid::new_v4();
                        rows.push(Row {
                            id,
                            score,
                            actor: participant,
                            actions: Actions::default(),
                        });
                        retained.insert(id);
                    }
                }
                rows.retain(|r| r.member() != Some(actor) || retained.contains(&r.id));
            }
            Edit::Leave => {
                rows.retain(|r| r.member() != Some(actor));
                for save in self.saves.values_mut() {
                    save.rows.retain(|r| r.member() != Some(actor));
                    if !save.rows.iter().any(|r| Some(r.id) == save.current) {
                        save.current = None;
                    }
                }
            }
            Edit::Enemy { id, score, enemy } => {
                if !valid_enemy(enemy) {
                    return Err(Rejection::InvalidInput);
                }
                if let Some(id) = id {
                    let row = rows
                        .iter_mut()
                        .find(|r| r.id == *id && r.member().is_none())
                        .ok_or(Rejection::InvalidInput)?;
                    row.score = *score;
                    let Participant::Enemy(previous) = &row.actor else {
                        return Err(Rejection::InvalidInput);
                    };
                    let mut updated = enemy.clone();
                    updated.template = previous.template.clone();
                    row.actor = Participant::Enemy(updated);
                } else {
                    rows.push(Row {
                        id: Uuid::new_v4(),
                        score: *score,
                        actor: Participant::Enemy(Enemy {
                            template: None,
                            ..enemy.clone()
                        }),
                        actions: Actions::default(),
                    });
                }
            }
            Edit::AddMonsters {
                template,
                count,
                score,
            } => {
                if !(1..=100).contains(count) || template.validate().is_err() {
                    return Err(Rejection::InvalidInput);
                }
                let stats = &template.monster.stats;
                for _ in 0..*count {
                    rows.push(Row {
                        id: Uuid::new_v4(),
                        score: *score,
                        actor: Participant::Enemy(Enemy {
                            name: template.monster.name.clone(),
                            alias: template.monster.name.clone(),
                            revealed: false,
                            hp: stats.hp,
                            max_hp: stats.hp,
                            ac: stats.defenses.ac,
                            conditions: String::new(),
                            notes: String::new(),
                            template: Some(template.clone()),
                        }),
                        actions: Actions::default(),
                    });
                }
            }
            Edit::Duplicate { id } => {
                let mut row = rows
                    .iter()
                    .find(|r| r.id == *id && r.member().is_none())
                    .cloned()
                    .ok_or(Rejection::InvalidInput)?;
                row.id = Uuid::new_v4();
                row.actions.duplicate();
                rows.push(row);
            }
            Edit::MonsterAction { id, action } => {
                let targets = rows
                    .iter()
                    .map(|row| (row.id, row.player()))
                    .chain(players.keys().map(|&member| (member, Some(member))))
                    .collect();
                let row = rows
                    .iter_mut()
                    .find(|row| row.id == *id)
                    .ok_or(Rejection::InvalidInput)?;
                let Participant::Enemy(enemy) = &row.actor else {
                    return Err(Rejection::InvalidInput);
                };
                row.actions.edit(
                    enemy.template.as_deref(),
                    action,
                    self.position.round,
                    self.running && self.position.current == Some(*id),
                    &targets,
                )?;
            }
            Edit::Remove { id } => {
                let i = rows
                    .iter()
                    .position(|r| r.id == *id && r.member().is_none())
                    .ok_or(Rejection::InvalidInput)?;
                rows.remove(i);
            }
            Edit::Reveal { id, revealed } => {
                let row = rows
                    .iter_mut()
                    .find(|r| r.id == *id)
                    .ok_or(Rejection::InvalidInput)?;
                let Participant::Enemy(e) = &mut row.actor else {
                    return Err(Rejection::InvalidInput);
                };
                if *revealed && !label(&e.alias) {
                    return Err(Rejection::InvalidInput);
                }
                e.revealed = *revealed;
            }
            Edit::Group { id } => {
                let row = rows
                    .iter()
                    .find(|r| r.id == *id)
                    .ok_or(Rejection::InvalidInput)?;
                let Participant::Enemy(e) = &row.actor else {
                    return Err(Rejection::InvalidInput);
                };
                let (enemy, score) = (e.clone(), row.score);
                for r in rows {
                    if let Participant::Enemy(other) = &r.actor {
                        let matches = match (&enemy.template, &other.template) {
                            (Some(a), Some(b)) => a.same_template(b),
                            (None, None) => enemy.name == other.name,
                            _ => false,
                        };
                        if matches {
                            r.score = score;
                        }
                    }
                }
            }
            Edit::MoveUp { id } => {
                let i = rows
                    .iter()
                    .position(|r| r.id == *id)
                    .ok_or(Rejection::InvalidInput)?;
                if i == 0 || rows[i - 1].score != rows[i].score {
                    return Err(Rejection::InvalidInput);
                }
                rows.swap(i - 1, i);
            }
            Edit::Correct { id } if self.running && rows.iter().any(|r| r.id == *id) => {
                self.position.current = Some(*id)
            }
            Edit::Start if !self.running && !rows.is_empty() => {
                self.running = true;
                phase = if self.position.current.is_some() {
                    Phase::Position
                } else {
                    Phase::Enter
                };
            }
            Edit::End if self.running => {
                self.running = false;
                phase = Phase::Exit;
            }
            Edit::Next if self.running && !rows.is_empty() => {
                let i = rows
                    .iter()
                    .position(|r| Some(r.id) == self.position.current)
                    .ok_or(Rejection::InvalidTransition)?;
                wrap = i + 1 == rows.len();
                if wrap {
                    self.position.round = self
                        .position
                        .round
                        .checked_add(1)
                        .ok_or(Rejection::InvalidInput)?;
                }
                self.position.current = Some(rows[(i + 1) % rows.len()].id);
                phase = Phase::Step;
            }
            Edit::Advance {
                amount,
                rounds: as_rounds,
            } if self.running && *amount > 0 => {
                phase = Phase::Time;
                if *as_rounds {
                    rounds = *amount;
                    seconds = rounds.checked_mul(6).ok_or(Rejection::InvalidInput)?;
                } else {
                    seconds = *amount;
                }
            }
            Edit::Save { name } if label(name) => {
                self.saves.insert(name.clone(), self.position.clone());
            }
            Edit::Load { name } if !self.running => {
                self.position = self
                    .saves
                    .get(name)
                    .cloned()
                    .ok_or(Rejection::InvalidInput)?;
            }
            Edit::Import { encounter, seats } if !self.running => {
                self.position = encounter.position(seats, players)?;
                self.id = Uuid::new_v4();
            }
            Edit::New if !self.running => {
                self.id = Uuid::new_v4();
                self.position = Position {
                    rows: vec![],
                    round: 1,
                    current: None,
                };
            }
            _ => return Err(Rejection::InvalidTransition),
        }
        self.position.rows.sort_by(|a, b| b.score.cmp(&a.score));
        if self.current().is_none() {
            self.position.current = if self.running {
                self.position.rows.first().map(|r| r.id)
            } else {
                None
            };
        }
        if self.position.rows.is_empty() {
            self.running = false;
        }
        for row in &mut self.position.rows {
            if let Participant::Enemy(enemy) = &row.actor {
                let template = enemy.template.as_deref();
                if phase == Phase::Step && previous.as_ref().is_some_and(|old| old.id == row.id) {
                    row.actions.boundary(template, Reset::End);
                }
                if wrap || rounds > 0 {
                    row.actions.boundary(template, Reset::Round);
                }
                if matches!(phase, Phase::Enter | Phase::Step)
                    && self.position.current == Some(row.id)
                {
                    row.actions.boundary(template, Reset::Start);
                }
            }
        }
        self.revision += 1;
        let after = self.members();
        let mut deliveries = vec![];
        for member in before.union(&after).copied() {
            let old = was_running && before.contains(&member);
            let new = self.running && after.contains(&member);
            if !old && !new {
                continue;
            }
            let event_phase = if !new {
                Phase::Exit
            } else if !old && (phase != Phase::Position || was_running) {
                Phase::Enter
            } else {
                phase.clone()
            };
            let to = self.current().map(|r| r.key(member));
            let from = previous.as_ref().map(|r| r.key(member));
            let separate = self.separate(member);
            if old
                && new
                && event_phase == Phase::Position
                && to == from
                && (member != actor || separate == old_separate)
            {
                continue;
            }
            deliveries.push((
                member,
                Event::Clock {
                    tick: Clock {
                        encounter_id: self.id,
                        phase: event_phase,
                        round: self.position.round,
                        from,
                        to,
                        wrap,
                        seconds,
                        rounds,
                        separate,
                    },
                },
            ));
        }
        Ok(deliveries)
    }
}
