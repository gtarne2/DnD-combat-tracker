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
    /// Conditions that count down by turns, kept apart from the free-text conditions.
    /// The DM adds and removes them with their own edits, so Edit::Enemy keeps them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub timers: Vec<ConditionTimer>,
}

impl Enemy {
    /// Condition names for map markers: the free-text list (split on commas, semicolons and
    /// new lines) and the timers still running, without duplicates, in that order.
    pub fn marker_conditions(&self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        let free = self.conditions.split([',', ';', '\n']).map(str::trim);
        let timed = self
            .timers
            .iter()
            .filter(|timer| timer.remaining > 0)
            .map(|timer| timer.name.trim());
        for name in free.chain(timed) {
            if !name.is_empty() && !names.iter().any(|n| n.eq_ignore_ascii_case(name)) {
                names.push(name.to_string());
            }
        }
        names
    }
}

/// A condition on an enemy that ends after a number of turn starts or ends, like the
/// player sheet's turn-start and turn-end effects.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConditionTimer {
    /// Chosen by the dashboard, so a retried request replaces rather than repeats.
    pub id: Uuid,
    pub name: String,
    /// Matching turn boundaries left. Zero means it has ended and waits for the DM to clear it.
    pub remaining: u32,
    pub ends: TurnEdge,
    /// Row whose turn counts. None counts the enemy's own turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<Uuid>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnEdge {
    Start,
    End,
}

/// Timed conditions one enemy may carry.
const MAX_TIMERS: usize = 20;

fn valid_timer(timer: &ConditionTimer) -> bool {
    label(&timer.name) && timer.name.chars().count() <= 60 && timer.remaining <= 1000
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Companion {
    pub local_id: u32,
    pub name: String,
    pub initiative: Option<i32>,
}

/// A spell area a player asked to draw on the virtual tabletop (Owlbear Rodeo).
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AreaTemplate {
    /// Chosen by the sheet for this cast, so a retried request replaces rather than repeats.
    pub id: Uuid,
    pub spell: String,
    pub shape: TemplateShape,
    /// Feet: radius for spheres, cylinders and emanations, length for cones and lines, side
    /// for cubes.
    pub size: u32,
    /// Feet across, for lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    pub lasts: Lasting,
    /// Row the cone or line points at. None points north.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aim: Option<Uuid>,
    /// The sheet's concentration ID, so the sheet can clear the template when it ends.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<u32>,
    /// The spell's damage roll as the sheet shows it, such as "8d6".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save: Option<AreaSave>,
    /// Fill colour as `#rrggbb`, from the sheet's mechanics overlay. The outline keeps the
    /// caster's colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
    /// Map look, such as "fire" or "mist", which picks the texture and outline style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub look: Option<String>,
    /// The caster's companion the template is centred on, by its sheet ID, such as a
    /// Protector cannon's aura. None centres it on the caster.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<u32>,
}

/// A stable map ID for a companion that acts on its owner's turn and so has no row of its
/// own. Owlbear tokens and inside reports use it like a row ID.
pub fn companion_map_id(owner_row: Uuid, local_id: u32) -> Uuid {
    let salt = (u128::from(local_id) + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15_f39c_c060_5ced_c835);
    Uuid::from_u128(owner_row.as_u128() ^ salt)
}

/// The saving throw an area spell asks for.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AreaSave {
    /// Lowercase ability name, such as "dexterity".
    pub ability: String,
    pub dc: u32,
    /// Damage on a successful save.
    pub on_success: SaveBranch,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SaveBranch {
    Half,
    None,
}

/// A caster's request to apply an area spell's damage to the targets they confirmed.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AreaRequest {
    /// Chosen by the sheet for this application. A zone spell sends a new one each time.
    pub id: Uuid,
    pub template: Uuid,
    /// Damage rolled on the caster's sheet, before saves and defenses.
    pub amount: u32,
    pub targets: Vec<Uuid>,
}

/// A caster's request to resolve a save spell without a map template: the sheet names the
/// targets itself. It joins the same DM queue as area spells.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpellRequest {
    pub id: Uuid,
    pub spell: String,
    /// Damage rolled on the caster's sheet, before saves and defenses.
    pub amount: u32,
    pub targets: Vec<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save: Option<AreaSave>,
}

/// One target's final damage, decided on the DM dashboard.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AreaResult {
    pub row: Uuid,
    pub amount: u32,
    /// What the dashboard decided, for the record: "failed", "succeeded" or "table".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save: Option<String>,
}

/// An area application waiting for, or resolved by, the DM.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct QueuedArea {
    member: Uuid,
    spell: String,
    request: AreaRequest,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    damage_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    save: Option<AreaSave>,
    round: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    results: Option<Vec<AreaResult>>,
}

/// Resolved applications kept for the record. Pending ones are always kept.
const KEEP_RESOLVED_AREAS: usize = 10;
const ABILITY_NAMES: [&str; 6] = [
    "strength",
    "dexterity",
    "constitution",
    "intelligence",
    "wisdom",
    "charisma",
];

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateShape {
    Sphere,
    Cylinder,
    Cone,
    Cube,
    Line,
    Emanation,
}

/// How long a template stays on the map.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Lasting {
    /// Until the caster's turn ends, for instantaneous spells.
    Turn,
    /// Until the caster's sheet reports that concentration ended.
    Concentration,
    /// Until the caster removes it.
    Removed,
}

#[derive(Clone, Serialize, Deserialize)]
struct PlacedTemplate {
    member: Uuid,
    template: AreaTemplate,
    /// Rows the caster confirmed, for applying the effect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    confirmed: Option<Vec<Uuid>>,
}

/// Most rows one template can name.
const MAX_TEMPLATE_TARGETS: usize = 100;

/// Templates one player may have on the map at once. Placing another drops the oldest.
pub const MAX_TEMPLATES: usize = 6;

fn valid_template(template: &AreaTemplate) -> bool {
    label(&template.spell)
        && template.spell.chars().count() <= 80
        && (1..=1000).contains(&template.size)
        && template
            .width
            .is_none_or(|width| template.shape == TemplateShape::Line && (1..=100).contains(&width))
        && template.damage.as_deref().is_none_or(|dice| {
            !dice.is_empty()
                && dice.len() <= 40
                && dice
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || " +-".contains(c))
        })
        && template.damage_type.as_deref().is_none_or(|kind| {
            !kind.is_empty() && kind.len() <= 20 && kind.chars().all(|c| c.is_ascii_lowercase())
        })
        && template.look.as_deref().is_none_or(|look| {
            !look.is_empty() && look.len() <= 20 && look.chars().all(|c| c.is_ascii_lowercase())
        })
        && template.colour.as_deref().is_none_or(|colour| {
            colour.len() == 7
                && colour.starts_with('#')
                && colour[1..].chars().all(|c| c.is_ascii_hexdigit())
        })
        && template.save.as_ref().is_none_or(|save| {
            ABILITY_NAMES.contains(&save.ability.as_str()) && (1..=40).contains(&save.dc)
        })
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Edit {
    Submit {
        score: i32,
        companions: Vec<Companion>,
    },
    Leave,
    /// A player asks for a spell template on the map at their token.
    PlaceTemplate {
        template: AreaTemplate,
    },
    /// A player removes one of their templates.
    ClearTemplate {
        id: Uuid,
    },
    /// A player confirms which rows a template affects, after checking the map's suggestion.
    ConfirmTemplate {
        id: Uuid,
        targets: Vec<Uuid>,
    },
    /// A player sends rolled damage for their confirmed targets to the DM's queue.
    SendArea {
        request: AreaRequest,
    },
    /// A player sends a save spell's rolled damage for targets they picked on the sheet,
    /// with no map template.
    SendSpell {
        request: SpellRequest,
    },
    /// The DM applies an area: enemies lose HP, players get damage offers.
    ApplyArea {
        id: Uuid,
        results: Vec<AreaResult>,
    },
    /// The DM drops an area from the queue without applying it.
    DismissArea {
        id: Uuid,
    },
    /// The owner of the current row ends that turn. Same effect as the DM's Next.
    EndTurn {
        id: Uuid,
    },
    /// The DM places a connected player in the order with a score they rolled
    /// at the table. The player can still resubmit their own score.
    Seat {
        member: Uuid,
        score: i32,
    },
    Enemy {
        id: Option<Uuid>,
        score: i32,
        enemy: Enemy,
    },
    AddMonsters {
        template: Box<Snapshot>,
        count: u32,
        score: i32,
        /// The name players see once revealed. Empty or absent means the monster's name.
        #[serde(default)]
        alias: Option<String>,
    },
    Duplicate {
        id: Uuid,
    },
    /// The DM adds or replaces a timed condition on an enemy.
    AddTimer {
        id: Uuid,
        timer: ConditionTimer,
    },
    /// The DM clears a timed condition, ended or not.
    RemoveTimer {
        id: Uuid,
        timer: Uuid,
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
        && enemy.timers.len() <= MAX_TIMERS
        && enemy.timers.iter().all(valid_timer)
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
                row["member_id"] = json!(self.player());
                if self.member() == Some(viewer) {
                    row["companions"] = json!(companions);
                    row["companion_rows"] = json!(
                        companions
                            .iter()
                            .filter(|c| c.initiative.is_none())
                            .map(|c| (
                                c.local_id.to_string(),
                                companion_map_id(self.id, c.local_id)
                            ))
                            .collect::<BTreeMap<_, _>>()
                    );
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
    #[serde(default)]
    templates: Vec<PlacedTemplate>,
    #[serde(default)]
    areas: Vec<QueuedArea>,
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
            templates: Vec::new(),
            areas: Vec::new(),
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

/// "Bandit 2" is ("Bandit", Some(2)); a name without a trailing number is itself.
fn name_stem(value: &str) -> (&str, Option<u32>) {
    match value.rsplit_once(' ') {
        Some((stem, digits))
            if !stem.trim().is_empty()
                && !digits.starts_with('0')
                && digits.bytes().all(|b| b.is_ascii_digit()) =>
        {
            match digits.parse::<u32>() {
                Ok(n) if n > 0 && n < 1000 => (stem, Some(n)),
                _ => (value, None),
            }
        }
        _ => (value, None),
    }
}
/// Give enemies added from index `added` onward a number when another enemy already uses
/// the same name, so "Bandit" becomes "Bandit 1" and the newcomers "Bandit 2", "Bandit 3".
/// Names (the DM's) and aliases (the players') are numbered separately. Existing numbers stay.
fn number_duplicates(rows: &mut [Row], added: usize) {
    for field in [0, 1] {
        for index in added..rows.len() {
            let pick = |row: &Row| match &row.actor {
                Participant::Enemy(enemy) => Some(if field == 0 {
                    enemy.name.clone()
                } else {
                    enemy.alias.clone()
                }),
                _ => None,
            };
            let Some(mine) = pick(&rows[index]) else {
                continue;
            };
            let stem = name_stem(&mine).0.to_string();
            if stem.trim().is_empty() {
                continue;
            }
            let others: Vec<usize> = (0..rows.len())
                .filter(|&i| i < index && pick(&rows[i]).is_some_and(|v| name_stem(&v).0 == stem))
                .collect();
            if others.is_empty() {
                continue;
            }
            let mut highest = 0;
            for &i in &others {
                let value = pick(&rows[i]).unwrap_or_default();
                match name_stem(&value).1 {
                    Some(n) => highest = highest.max(n),
                    None => {
                        highest = highest.max(1);
                        set(&mut rows[i], field, format!("{stem} 1"));
                    }
                }
            }
            set(&mut rows[index], field, format!("{stem} {}", highest + 1));
        }
    }
    fn set(row: &mut Row, field: u8, value: String) {
        if let Participant::Enemy(enemy) = &mut row.actor {
            if label(&value) {
                if field == 0 {
                    enemy.name = value;
                } else {
                    enemy.alias = value;
                }
            }
        }
    }
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
        view["templates"] = json!(
            self.templates
                .iter()
                .filter(|t| dm || t.member == viewer)
                .map(|t| {
                    let mut view = json!(&t.template);
                    if let Some(confirmed) = &t.confirmed {
                        view["confirmed"] = json!(confirmed);
                    }
                    if dm {
                        view["member_id"] = json!(t.member);
                    }
                    view
                })
                .collect::<Vec<_>>()
        );
        // The DM sees the whole queue; a caster sees their own applications and outcomes.
        view["areas"] = json!(
            self.areas
                .iter()
                .filter(|a| dm || a.member == viewer)
                .map(|a| {
                    let mut view = json!({
                        "id": a.request.id, "template": a.request.template, "spell": a.spell,
                        "amount": a.request.amount, "targets": a.request.targets,
                        "damage_type": a.damage_type, "save": a.save, "round": a.round,
                        "results": a.results,
                    });
                    if dm {
                        view["member_id"] = json!(a.member);
                    }
                    view
                })
                .collect::<Vec<_>>()
        );
        view
    }

    /// Map-facing projection for the DM's virtual tabletop link (Owlbear Rodeo): row IDs,
    /// kinds, revealed names, the turn pointer, and for enemies whether they are down plus the
    /// monster template's key, name and size for token art. No HP, AC, conditions, scores,
    /// notes or stat blocks. Enemies carry their player-facing alias, never the DM's name.
    pub fn table_view(&self) -> Value {
        let rows: Vec<Value> = self
            .position
            .rows
            .iter()
            .map(|row| match &row.actor {
                Participant::Enemy(enemy) => {
                    let mut view = json!({
                        "id": row.id,
                        "kind": "enemy",
                        "revealed": enemy.revealed,
                        // Hidden tokens keep the name players will see on reveal; Owlbear does not
                        // show hidden items to players.
                        "name": &enemy.alias,
                        "down": enemy.hp == Some(0),
                        // Markers on the token, for conditions applied during the fight.
                        "conditions": enemy.marker_conditions(),
                    });
                    // For the DM's own extension only: which art to use and how big the token is.
                    if let Some(template) = &enemy.template {
                        view["template"] = json!({
                            "key": format!("{}/{}", template.pack.id, template.monster.id),
                            "name": template.monster.name,
                            "size": template.monster.stats.size,
                            "type": template.monster.stats.creature_type,
                        });
                    }
                    view
                }
                Participant::Player { member, name, .. } => json!({
                    "id": row.id, "kind": "player", "member_id": member, "name": name,
                }),
                Participant::Companion {
                    member,
                    local_id,
                    name,
                } => json!({
                    "id": row.id, "kind": "companion", "member_id": member,
                    "local_id": local_id, "name": name,
                }),
            })
            .chain(
                self.shared_companions()
                    .map(|(id, member, local_id, name)| {
                        json!({
                            "id": id, "kind": "companion", "member_id": member,
                            "local_id": local_id, "name": name, "shared": true,
                        })
                    }),
            )
            .collect();
        // Templates name their caster's row so the extension can place them at its token.
        let templates: Vec<Value> = self
            .templates
            .iter()
            .filter_map(|t| {
                let template = &t.template;
                let caster = match template.anchor {
                    Some(local) => self.companion_spot(t.member, local)?,
                    None => {
                        self.position
                            .rows
                            .iter()
                            .find(|r| r.player() == Some(t.member))?
                            .id
                    }
                };
                let mut view = json!({
                    "id": template.id, "caster": caster, "member_id": t.member,
                    "spell": template.spell, "shape": template.shape, "size": template.size,
                    "width": template.width, "lasts": template.lasts, "aim": template.aim,
                });
                if let Some(colour) = &template.colour {
                    view["colour"] = json!(colour);
                }
                if let Some(look) = &template.look {
                    view["look"] = json!(look);
                }
                Some(view)
            })
            .collect();
        json!({"id":self.id,"revision":self.revision,"running":self.running,
            "round":self.position.round,"current":self.position.current,"rows":rows,
            "templates":templates})
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

    /// Record the DM's decision on a queued area and lower each enemy's HP. Returns the players
    /// to send damage offers to, as (member, amount), and the spell name for the offer source.
    pub(super) fn apply_area(
        &mut self,
        cmd: &FightEdit,
        id: Uuid,
        results: &[AreaResult],
    ) -> Result<(String, Vec<(Uuid, u32)>), Rejection> {
        self.check_revision(cmd)?;
        let area = self
            .areas
            .iter()
            .find(|a| a.request.id == id)
            .ok_or(Rejection::InvalidInput)?;
        if area.results.is_some() {
            return Err(Rejection::InvalidTransition);
        }
        let unique: BTreeSet<Uuid> = results.iter().map(|r| r.row).collect();
        if unique.len() != results.len()
            || results.iter().any(|r| {
                !area.request.targets.contains(&r.row)
                    || r.amount > 100_000
                    || r.save
                        .as_deref()
                        .is_some_and(|s| !matches!(s, "failed" | "succeeded" | "table"))
            })
        {
            return Err(Rejection::InvalidInput);
        }
        // The offer's source on the player's sheet: an area from the map, or a spell aimed
        // from the sheet.
        let spell = if area.request.template.is_nil() {
            format!("{} (spell)", area.spell)
        } else {
            format!("{} (area)", area.spell)
        };
        let mut offers = Vec::new();
        for result in results {
            let Some(row) = self.position.rows.iter_mut().find(|r| r.id == result.row) else {
                continue;
            };
            match &mut row.actor {
                Participant::Enemy(enemy) => {
                    if let Some(hp) = &mut enemy.hp {
                        *hp = hp.saturating_sub(result.amount);
                    }
                }
                Participant::Player { member, .. } if result.amount > 0 => {
                    offers.push((*member, result.amount));
                }
                // Companions and zero damage are settled at the table.
                _ => {}
            }
        }
        let area = self
            .areas
            .iter_mut()
            .find(|a| a.request.id == id)
            .expect("found above");
        area.results = Some(results.to_vec());
        let resolved: Vec<usize> = self
            .areas
            .iter()
            .enumerate()
            .filter(|(_, a)| a.results.is_some())
            .map(|(i, _)| i)
            .collect();
        if resolved.len() > KEEP_RESOLVED_AREAS {
            let drop: BTreeSet<usize> = resolved[..resolved.len() - KEEP_RESOLVED_AREAS]
                .iter()
                .copied()
                .collect();
            let mut index = 0;
            self.areas.retain(|_| {
                let keep = !drop.contains(&index);
                index += 1;
                keep
            });
        }
        self.revised();
        Ok((spell, offers))
    }

    /// IDs of the templates on the map.
    pub(super) fn template_ids(&self) -> BTreeSet<Uuid> {
        self.templates.iter().map(|t| t.template.id).collect()
    }

    /// False for an enemy the DM has not revealed. Players never learn such a row is in an area.
    pub(super) fn shown_to_players(&self, id: Uuid) -> bool {
        self.position.rows.iter().any(|row| {
            row.id == id && !matches!(&row.actor, Participant::Enemy(enemy) if !enemy.revealed)
        }) || self.shared_companions().any(|(map_id, ..)| map_id == id)
    }

    pub(super) fn has_row(&self, id: Uuid) -> bool {
        self.position.rows.iter().any(|row| row.id == id)
            || self.shared_companions().any(|(map_id, ..)| map_id == id)
    }

    /// Companions that act on their owner's turn: (map ID, owner member, local ID, name).
    fn shared_companions(&self) -> impl Iterator<Item = (Uuid, Uuid, u32, &str)> {
        self.position.rows.iter().flat_map(|row| {
            let (member, companions) = match &row.actor {
                Participant::Player {
                    member, companions, ..
                } => (Some(*member), companions.as_slice()),
                _ => (None, &[][..]),
            };
            companions
                .iter()
                .filter(|c| c.initiative.is_none())
                .filter_map(move |c| {
                    Some((
                        companion_map_id(row.id, c.local_id),
                        member?,
                        c.local_id,
                        c.name.as_str(),
                    ))
                })
        })
    }

    /// The row or map ID a companion is drawn at.
    fn companion_spot(&self, member: Uuid, local: u32) -> Option<Uuid> {
        self.position
            .rows
            .iter()
            .find(|r| {
                matches!(&r.actor, Participant::Companion { member: m, local_id, .. }
                    if *m == member && *local_id == local)
            })
            .map(|r| r.id)
            .or_else(|| {
                self.shared_companions()
                    .find(|(_, m, l, _)| *m == member && *l == local)
                    .map(|(id, ..)| id)
            })
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
        if dm
            == matches!(
                cmd.edit,
                Edit::Submit { .. }
                    | Edit::Leave
                    | Edit::EndTurn { .. }
                    | Edit::PlaceTemplate { .. }
                    | Edit::ClearTemplate { .. }
                    | Edit::ConfirmTemplate { .. }
                    | Edit::SendArea { .. }
                    | Edit::SendSpell { .. }
            )
        {
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
            Edit::PlaceTemplate { template } => {
                let anchored = template.anchor.is_none_or(|local| {
                    rows.iter().any(|r| match &r.actor {
                        Participant::Player {
                            member, companions, ..
                        } => *member == actor && companions.iter().any(|c| c.local_id == local),
                        _ => false,
                    })
                });
                if !valid_template(template)
                    || !anchored
                    || !rows.iter().any(|r| r.player() == Some(actor))
                    || template
                        .aim
                        .is_some_and(|aim| !rows.iter().any(|r| r.id == aim))
                {
                    return Err(Rejection::InvalidInput);
                }
                self.templates.retain(|t| t.template.id != template.id);
                let mine = self.templates.iter().filter(|t| t.member == actor).count();
                if mine >= MAX_TEMPLATES
                    && let Some(oldest) = self.templates.iter().position(|t| t.member == actor)
                {
                    self.templates.remove(oldest);
                }
                self.templates.push(PlacedTemplate {
                    member: actor,
                    template: template.clone(),
                    confirmed: None,
                });
            }
            Edit::SendArea { request } => {
                let unique: BTreeSet<Uuid> = request.targets.iter().copied().collect();
                if request.targets.is_empty()
                    || unique.len() != request.targets.len()
                    || request.targets.len() > MAX_TEMPLATE_TARGETS
                    || request.amount > 100_000
                    || !request
                        .targets
                        .iter()
                        .all(|t| rows.iter().any(|r| r.id == *t))
                    || self.areas.iter().any(|a| a.request.id == request.id)
                {
                    return Err(Rejection::InvalidInput);
                }
                let placed = self
                    .templates
                    .iter_mut()
                    .find(|t| t.member == actor && t.template.id == request.template)
                    .ok_or(Rejection::InvalidInput)?;
                if placed.template.damage.is_none() {
                    return Err(Rejection::InvalidInput);
                }
                placed.confirmed = Some(request.targets.clone());
                self.areas.push(QueuedArea {
                    member: actor,
                    spell: placed.template.spell.clone(),
                    request: request.clone(),
                    damage_type: placed.template.damage_type.clone(),
                    save: placed.template.save.clone(),
                    round: self.position.round,
                    results: None,
                });
            }
            Edit::SendSpell { request } => {
                let unique: BTreeSet<Uuid> = request.targets.iter().copied().collect();
                if request.targets.is_empty()
                    || unique.len() != request.targets.len()
                    || request.targets.len() > MAX_TEMPLATE_TARGETS
                    || request.amount > 100_000
                    || !label(&request.spell)
                    || request.spell.chars().count() > 80
                    || request.damage_type.as_deref().is_some_and(|kind| {
                        kind.is_empty()
                            || kind.len() > 20
                            || !kind.chars().all(|c| c.is_ascii_lowercase())
                    })
                    || request.save.as_ref().is_some_and(|save| {
                        !ABILITY_NAMES.contains(&save.ability.as_str())
                            || !(1..=40).contains(&save.dc)
                    })
                    || !rows.iter().any(|r| r.player() == Some(actor))
                    || !request
                        .targets
                        .iter()
                        .all(|t| rows.iter().any(|r| r.id == *t))
                    || self.areas.iter().any(|a| a.request.id == request.id)
                {
                    return Err(Rejection::InvalidInput);
                }
                self.areas.push(QueuedArea {
                    member: actor,
                    spell: request.spell.clone(),
                    request: AreaRequest {
                        id: request.id,
                        template: Uuid::nil(),
                        amount: request.amount,
                        targets: request.targets.clone(),
                    },
                    damage_type: request.damage_type.clone(),
                    save: request.save.clone(),
                    round: self.position.round,
                    results: None,
                });
            }
            Edit::AddTimer { id, timer } => {
                if !valid_timer(timer)
                    || timer.remaining == 0
                    || timer
                        .anchor
                        .is_some_and(|a| !rows.iter().any(|r| r.id == a))
                {
                    return Err(Rejection::InvalidInput);
                }
                let row = rows
                    .iter_mut()
                    .find(|r| r.id == *id)
                    .ok_or(Rejection::InvalidInput)?;
                let Participant::Enemy(enemy) = &mut row.actor else {
                    return Err(Rejection::InvalidInput);
                };
                let mut timer = timer.clone();
                timer.name = timer.name.trim().to_string();
                if timer.anchor == Some(*id) {
                    timer.anchor = None;
                }
                if let Some(old) = enemy.timers.iter_mut().find(|t| t.id == timer.id) {
                    *old = timer;
                } else if enemy.timers.len() >= MAX_TIMERS {
                    return Err(Rejection::InvalidInput);
                } else {
                    enemy.timers.push(timer);
                }
            }
            Edit::RemoveTimer { id, timer } => {
                let row = rows
                    .iter_mut()
                    .find(|r| r.id == *id)
                    .ok_or(Rejection::InvalidInput)?;
                let Participant::Enemy(enemy) = &mut row.actor else {
                    return Err(Rejection::InvalidInput);
                };
                let before = enemy.timers.len();
                enemy.timers.retain(|t| t.id != *timer);
                if enemy.timers.len() == before {
                    return Err(Rejection::InvalidInput);
                }
            }
            Edit::DismissArea { id } => {
                let before = self.areas.len();
                self.areas
                    .retain(|a| a.request.id != *id || a.results.is_some());
                if self.areas.len() == before {
                    return Err(Rejection::InvalidInput);
                }
            }
            Edit::ConfirmTemplate { id, targets } => {
                let unique: BTreeSet<Uuid> = targets.iter().copied().collect();
                if unique.len() != targets.len()
                    || targets.len() > MAX_TEMPLATE_TARGETS
                    || !targets.iter().all(|t| rows.iter().any(|r| r.id == *t))
                {
                    return Err(Rejection::InvalidInput);
                }
                let placed = self
                    .templates
                    .iter_mut()
                    .find(|t| t.member == actor && t.template.id == *id)
                    .ok_or(Rejection::InvalidInput)?;
                placed.confirmed = Some(targets.clone());
            }
            Edit::ClearTemplate { id } => {
                self.templates
                    .retain(|t| !(t.member == actor && t.template.id == *id));
            }
            Edit::Enemy { id, score, enemy } => {
                if !valid_enemy(enemy) {
                    return Err(Rejection::InvalidInput);
                }
                let added = rows.len();
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
                    updated.timers = previous.timers.clone();
                    row.actor = Participant::Enemy(updated);
                } else {
                    rows.push(Row {
                        id: Uuid::new_v4(),
                        score: *score,
                        actor: Participant::Enemy(Enemy {
                            template: None,
                            timers: vec![],
                            ..enemy.clone()
                        }),
                        actions: Actions::default(),
                    });
                    number_duplicates(rows, added);
                }
            }
            Edit::AddMonsters {
                template,
                count,
                score,
                alias,
            } => {
                let alias = alias
                    .as_deref()
                    .map(str::trim)
                    .filter(|a| !a.is_empty())
                    .unwrap_or(&template.monster.name)
                    .to_string();
                if !(1..=100).contains(count) || template.validate().is_err() || !label(&alias) {
                    return Err(Rejection::InvalidInput);
                }
                let stats = &template.monster.stats;
                let added = rows.len();
                for _ in 0..*count {
                    rows.push(Row {
                        id: Uuid::new_v4(),
                        score: *score,
                        actor: Participant::Enemy(Enemy {
                            name: template.monster.name.clone(),
                            alias: alias.clone(),
                            revealed: false,
                            hp: stats.hp,
                            max_hp: stats.hp,
                            ac: stats.defenses.ac,
                            conditions: String::new(),
                            notes: String::new(),
                            template: Some(template.clone()),
                            timers: vec![],
                        }),
                        actions: Actions::default(),
                    });
                }
                number_duplicates(rows, added);
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
                let added = rows.len() - 1;
                number_duplicates(rows, added);
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
                            // Numbered copies (Bandit 1, Bandit 2) group together.
                            (None, None) => name_stem(&enemy.name).0 == name_stem(&other.name).0,
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
            Edit::Seat { member, score } => {
                let name = players.get(member).ok_or(Rejection::InvalidInput)?;
                if let Some(row) = rows.iter_mut().find(|r| r.player() == Some(*member)) {
                    row.score = *score;
                } else {
                    rows.push(Row {
                        id: Uuid::new_v4(),
                        score: *score,
                        actor: Participant::Player {
                            member: *member,
                            name: name.clone(),
                            companions: vec![],
                        },
                        actions: Actions::default(),
                    });
                }
            }
            Edit::Next | Edit::EndTurn { .. } if self.running && !rows.is_empty() => {
                if let Edit::EndTurn { id } = &cmd.edit {
                    let own = rows
                        .iter()
                        .find(|r| Some(r.id) == self.position.current)
                        .is_some_and(|r| r.id == *id && r.member() == Some(actor));
                    if !own {
                        return Err(Rejection::Forbidden);
                    }
                }
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
        // Timed enemy conditions count the turn boundaries of their anchor row (the enemy itself
        // unless the DM picked another), and every round of advanced time.
        let ended = (phase == Phase::Step)
            .then(|| previous.as_ref().map(|r| r.id))
            .flatten();
        let started = matches!(phase, Phase::Enter | Phase::Step)
            .then_some(self.position.current)
            .flatten();
        let ids: BTreeSet<Uuid> = self.position.rows.iter().map(|r| r.id).collect();
        for row in &mut self.position.rows {
            let own = row.id;
            if let Participant::Enemy(enemy) = &mut row.actor {
                for timer in &mut enemy.timers {
                    let anchor = timer.anchor.filter(|a| ids.contains(a)).unwrap_or(own);
                    let edge = match timer.ends {
                        TurnEdge::Start => started,
                        TurnEdge::End => ended,
                    };
                    let mut spent = rounds;
                    if edge == Some(anchor) {
                        spent = spent.saturating_add(1);
                    }
                    timer.remaining = timer.remaining.saturating_sub(spent);
                }
            }
        }
        // Templates follow their caster: they go when the caster's row goes, when the
        // encounter ends, and, for instantaneous spells, when the caster's turn ends.
        let casters: BTreeSet<Uuid> = self.position.rows.iter().filter_map(Row::player).collect();
        let ended_turn = (phase == Phase::Step)
            .then(|| previous.as_ref().and_then(Row::player))
            .flatten();
        let stopped = was_running && !self.running;
        if matches!(
            cmd.edit,
            Edit::New | Edit::Load { .. } | Edit::Import { .. }
        ) {
            self.areas.clear();
        }
        self.templates.retain(|t| {
            casters.contains(&t.member)
                && !stopped
                && !(t.template.lasts == Lasting::Turn && ended_turn == Some(t.member))
        });
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
