//! Party protocol. Only explicitly shareable fields belong here.
use super::interruptions::{QuestionView, Reply, WindowRef};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, num::NonZeroU32};
use uuid::Uuid;

pub const VERSION: u16 = 2;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub version: u16,
    pub room_id: Uuid,
    pub command_id: Uuid,
    pub command: Operation,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "payload",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Operation {
    Create {
        mode: HostMode,
        name: String,
    },
    Join {
        name: String,
    },
    Disconnect,
    Resume,
    Leave,
    Close,
    Send {
        action_id: Uuid,
        recipient: Uuid,
        source: String,
        effect: Effect,
    },
    Claim {
        offer_id: Uuid,
    },
    Accept {
        offer_id: Uuid,
    },
    Decline {
        offer_id: Uuid,
    },
    Withdraw {
        offer_id: Uuid,
    },
    RequestReversal {
        offer_id: Uuid,
    },
    EndGrant {
        grant_id: Uuid,
    },
    Expire {
        offer_id: Uuid,
    },
    Initiative(super::initiative::FightEdit),
    WindowReply {
        window: WindowRef,
        reply: Reply,
    },
    SetRound {
        encounter_id: Uuid,
        expected_revision: u64,
        round: NonZeroU32,
    },
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostMode {
    Party,
    Dm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "amount",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum Effect {
    Healing(NonZeroU32),
    TemporaryHp(NonZeroU32),
    Damage(NonZeroU32),
    Grant(AttackGrant),
    /// A spell or effect another player puts on this player, such as Longstrider or Bless,
    /// with the stat changes the recipient's sheet applies while it lasts (R79).
    Buff(StatBuff),
}

impl Effect {
    /// The lasting grant this offer belongs to, which its sender can end later.
    pub fn grant_id(&self) -> Option<Uuid> {
        match self {
            Self::Grant(grant) => Some(grant.grant_id),
            Self::Buff(buff) => Some(buff.grant_id),
            _ => None,
        }
    }
}

/// Stat changes a buff makes. Dice are a die size added once, such as 4 for +1d4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatBuff {
    pub grant_id: Uuid,
    #[serde(default)]
    pub speed: i16,
    #[serde(default)]
    pub ac: i16,
    #[serde(default)]
    pub attack: i16,
    #[serde(default)]
    pub attack_die: u8,
    #[serde(default)]
    pub damage: i16,
    #[serde(default)]
    pub save: i16,
    #[serde(default)]
    pub save_die: u8,
    /// Game seconds the buff lasts on its own; none while its source lasts.
    #[serde(default)]
    pub seconds: Option<NonZeroU32>,
}

impl StatBuff {
    pub fn valid(&self) -> bool {
        let dice = |die: u8| matches!(die, 0 | 4 | 6 | 8 | 10 | 12);
        [self.speed, self.ac, self.attack, self.damage, self.save]
            .iter()
            .all(|value| (-100..=100).contains(value))
            && dice(self.attack_die)
            && dice(self.save_die)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttackGrant {
    pub grant_id: Uuid,
    pub category: AttackCategory,
    pub stacking: BonusStacking,
    pub attack: i16,
    pub damage: i16,
    pub end_rule: GrantEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttackCategory {
    Weapon,
    Spell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BonusStacking {
    Infusion,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantEnd {
    SourceEnds,
    ShortRest,
    LongRest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Pending,
    Claimed,
    Accepted,
    Declined,
    Withdrawn,
    Expired,
    Ended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Offer {
    pub offer_id: Uuid,
    pub action_id: Uuid,
    pub sender: Uuid,
    pub recipient: Uuid,
    pub source: String,
    pub effect: Effect,
    pub status: Status,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reversal_requested: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SharedRound {
    pub encounter_id: Uuid,
    pub revision: u64,
    pub round: NonZeroU32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Receipt {
    Membership { member_id: Uuid },
    Offer { offer_id: Uuid, status: Status },
    Encounter { encounter: SharedRound },
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rejection {
    UnsupportedVersion,
    UnknownRoom,
    Closed,
    Forbidden,
    Disconnected,
    CommandConflict,
    RevisionConflict,
    InvalidTransition,
    InvalidInput,
    StaleWindow,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    Clock { tick: super::initiative::Clock },
    RosterChanged,
    WindowsChanged,
    OfferChanged { offer: Offer },
    EncounterChanged { encounter: SharedRound },
}

#[derive(Serialize, Deserialize)]
pub struct Delivery {
    pub cursor: u64,
    pub event: Event,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Vitals {
    pub current_hp: Option<u32>,
    pub max_hp: Option<u32>,
    pub temporary_hp: Option<u32>,
    pub effective_ac: Option<i32>,
    pub initiative: Option<i32>,
    pub conditions: Vec<String>,
    pub concentration: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleEntry {
    pub name: String,
    pub rules: String,
}

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CharacterDetails {
    pub ability_scores: BTreeMap<String, i32>,
    pub saves: BTreeMap<String, i32>,
    pub skills: BTreeMap<String, i32>,
    pub attacks: Vec<RuleEntry>,
    pub spells: Vec<RuleEntry>,
    pub features: Vec<RuleEntry>,
    pub inventory: Vec<RuleEntry>,
    pub resources: BTreeMap<String, u32>,
}

/// Each publication replaces the whole previous value, including on downgrade.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "sharing", rename_all = "snake_case", deny_unknown_fields)]
pub enum Publication {
    PartyNameOnly,
    Vitals {
        vitals: Vitals,
    },
    CharacterDetails {
        vitals: Vitals,
        details: Box<CharacterDetails>,
    },
}

#[derive(Serialize, Deserialize)]
pub struct MemberView {
    pub member_id: Uuid,
    pub name: String,
    pub online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inspection: Option<Publication>,
}

#[derive(Serialize, Deserialize)]
pub struct RoomView {
    pub version: u16,
    pub room_id: Uuid,
    pub self_id: Uuid,
    pub mode: HostMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combat: Option<serde_json::Value>,
    pub members: Vec<MemberView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dm_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publication_session: Option<Uuid>,
    pub encounter: Option<SharedRound>,
    pub offers: Vec<Offer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub questions: Vec<QuestionView>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub announcements: Vec<String>,
    pub events: Vec<Delivery>,
    /// Pass this cursor back after processing the returned events in order.
    pub cursor: u64,
}
