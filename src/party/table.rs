//! Table helpers beside shared initiative: reaction calls the DM sends to players (R82) and the
//! fight log behind the end-of-fight recap (R86).
//!
//! Both live on the `Fight`, so they share its revision, storage and privacy rules. Players see
//! only calls addressed to them, and the log names hidden enemies as "A hidden creature".

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;

/// What a creature is doing that a player may react to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallTrigger {
    /// An opportunity attack chance.
    LeavesReach,
    /// A chance for Counterspell or a similar spell.
    CastsSpell,
    /// An attack against someone, for Shield, Protection and similar reactions.
    Attacks,
    Other,
}

/// The DM's question to one or more players: "Goblin 2 is leaving your reach".
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewCall {
    /// Chosen by the dashboard, so a retried request is refused rather than repeated.
    pub id: Uuid,
    /// The row doing it.
    pub source: Uuid,
    pub trigger: CallTrigger,
    /// A short detail such as the spell's name and level. Shown to the recipients.
    #[serde(default)]
    pub detail: String,
    /// Members asked.
    pub recipients: Vec<Uuid>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CallAnswer {
    pub reacted: bool,
    /// What the player uses, such as "Counterspell (3rd level)".
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct ReactionCall {
    pub call: NewCall,
    pub round: u32,
    #[serde(default)]
    pub answers: BTreeMap<Uuid, CallAnswer>,
}

/// Calls kept at once. The oldest goes first.
pub(super) const MAX_CALLS: usize = 8;
/// Players one call may ask.
pub(super) const MAX_CALL_RECIPIENTS: usize = 12;
/// Characters in a call detail or an answer note.
pub(super) const MAX_NOTE: usize = 80;

pub(super) fn short_text(value: &str) -> bool {
    value.chars().count() <= MAX_NOTE && !value.chars().any(char::is_control)
}

/// A creature as the log saw it. Enemies keep both names, so the DM's recap can name them and a
/// player's can use the alias they knew, or none for a creature that was hidden.
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Named {
    pub id: Uuid,
    pub name: String,
    /// The players' name for an enemy that was revealed at the time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(default)]
    pub enemy: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member: Option<Uuid>,
}

impl Named {
    fn view(&self, dm: bool, revealed: &dyn Fn(Uuid) -> Option<String>) -> Value {
        let name = if dm || !self.enemy {
            self.name.clone()
        } else {
            revealed(self.id)
                .or_else(|| self.alias.clone())
                .unwrap_or_else(|| "A hidden creature".into())
        };
        let mut view = json!({"id": self.id, "name": name, "enemy": self.enemy});
        if let Some(member) = self.member {
            view["member_id"] = json!(member);
        }
        view
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(super) enum LogEvent {
    /// HP lost by an enemy, or damage offered to a player.
    Damage {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<Named>,
        to: Named,
        amount: u32,
        /// The spell or monster action, when known.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        what: Option<String>,
    },
    /// An enemy dropped to 0 HP.
    Down {
        who: Named,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        by: Option<Named>,
    },
    /// A player cast a spell during the fight.
    Spell { by: Named, spell: String },
    /// A player answered a reaction call by reacting.
    Reaction { by: Named, note: String },
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct LogEntry {
    pub round: u32,
    #[serde(flatten)]
    pub event: LogEvent,
}

/// Entries kept for one fight.
pub(super) const MAX_LOG: usize = 600;

impl LogEntry {
    pub(super) fn view(&self, dm: bool, revealed: &dyn Fn(Uuid) -> Option<String>) -> Value {
        let named = |n: &Named| n.view(dm, revealed);
        let mut view = match &self.event {
            LogEvent::Damage {
                by,
                to,
                amount,
                what,
            } => json!({"kind": "damage", "by": by.as_ref().map(named), "to": named(to),
                "amount": amount, "what": what}),
            LogEvent::Down { who, by } => {
                json!({"kind": "down", "who": named(who), "by": by.as_ref().map(named)})
            }
            LogEvent::Spell { by, spell } => {
                json!({"kind": "spell", "by": named(by), "spell": spell})
            }
            LogEvent::Reaction { by, note } => {
                json!({"kind": "reaction", "by": named(by), "note": note})
            }
        };
        view["round"] = json!(self.round);
        view
    }
}

impl ReactionCall {
    /// The DM sees every answer; a player sees the call and their own answer.
    pub(super) fn view(&self, viewer: Uuid, dm: bool, source: String) -> Value {
        let call = &self.call;
        let mut view = json!({"id": call.id, "trigger": call.trigger, "detail": call.detail,
            "source": source, "round": self.round});
        if dm {
            view["source_id"] = json!(call.source);
            view["recipients"] = json!(call.recipients);
            view["answers"] = json!(self.answers);
        } else {
            view["answer"] = json!(self.answers.get(&viewer));
        }
        view
    }
}
