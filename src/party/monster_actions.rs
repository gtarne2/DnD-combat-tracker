use super::wire::Rejection;
use crate::monsters::{Action, Recharge, Snapshot, Uses};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cost {
    Action,
    Bonus,
    Reaction,
    Legendary,
    Manual,
}

#[derive(Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reset {
    #[default]
    Manual,
    Start,
    End,
    Round,
}

impl Reset {
    fn printed(reset: Option<&str>) -> Self {
        match reset
            .map(|text| text.trim().to_ascii_lowercase())
            .as_deref()
        {
            Some("start" | "start of turn" | "start of its turn" | "turn_start") => Self::Start,
            Some("end" | "end of turn" | "end of its turn" | "turn_end") => Self::End,
            Some("round" | "round start" | "round_start") => Self::Round,
            _ => Self::Manual,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub cost: Cost,
    pub legendary: u32,
    pub uses: Option<u32>,
    pub reset: Reset,
    pub recharge: Option<Recharge>,
}

impl Policy {
    fn printed(action: &Action, cost: Cost) -> Self {
        let uses = action.uses.as_ref();
        Self {
            cost,
            legendary: if cost == Cost::Legendary {
                action
                    .resolution
                    .as_ref()
                    .and_then(|r| r.legendary_cost)
                    .unwrap_or(1)
            } else {
                0
            },
            uses: uses.map(|Uses { count, .. }| *count),
            reset: Reset::printed(uses.and_then(|u| u.reset.as_deref())),
            recharge: action.recharge.clone(),
        }
    }

    fn valid(&self) -> bool {
        (self.legendary > 0) == (self.cost == Cost::Legendary)
            && self.recharge.as_ref().is_none_or(valid_die)
    }
}

fn valid_die(recharge: &Recharge) -> bool {
    recharge.minimum > 0 && recharge.minimum <= recharge.die && recharge.die <= 1000
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManualRule {
    pub id: Uuid,
    pub name: String,
    pub text: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Counter {
    remaining: Option<u32>,
    spent: bool,
    queued: Option<u32>,
    last_roll: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ActionEdit {
    AddRule {
        rule: ManualRule,
    },
    CorrectRule {
        rule: String,
        policy: Policy,
        remaining: Option<u32>,
        ready: bool,
    },
    QueueRoll {
        rule: String,
        roll: Option<u32>,
    },
    CorrectBudget {
        action: bool,
        bonus: bool,
        reaction: bool,
        legendary_max: u32,
        legendary_left: u32,
        legendary_reset: Reset,
    },
    Record {
        action: ActionInput,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionInput {
    pub id: Uuid,
    pub rule: String,
    pub strikes: Vec<Strike>,
    pub note: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Strike {
    pub id: Uuid,
    pub rule: String,
    pub target: Option<Uuid>,
    pub target_note: String,
    pub total: Option<i32>,
    pub outcome: Outcome,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Hit,
    Miss,
    SaveSuccess,
    SaveFailure,
    Table,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "amount",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum DamageDecision {
    Final(u32),
    Handled,
}

#[derive(Clone, Serialize, Deserialize)]
struct Recorded {
    input: ActionInput,
    source: Policy,
    name: String,
    round: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recipients: Option<BTreeMap<Uuid, Uuid>>,
}

struct Rule<'a> {
    id: String,
    name: &'a str,
    text: &'a str,
    policy: Policy,
    strikes: &'a [String],
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Actions {
    manual: Vec<ManualRule>,
    policies: BTreeMap<String, Policy>,
    counters: BTreeMap<String, Counter>,
    action: bool,
    bonus: bool,
    reaction: bool,
    legendary_max: u32,
    legendary_left: u32,
    legendary_reset: Reset,
    history: Vec<Recorded>,
}

impl Default for Actions {
    fn default() -> Self {
        Self {
            manual: vec![],
            policies: BTreeMap::new(),
            counters: BTreeMap::new(),
            action: true,
            bonus: true,
            reaction: true,
            legendary_max: 0,
            legendary_left: 0,
            legendary_reset: Reset::Start,
            history: vec![],
        }
    }
}

impl Actions {
    pub(super) fn strike(
        &self,
        action: Uuid,
        strike: Uuid,
    ) -> Option<(&Strike, Option<&BTreeMap<Uuid, Uuid>>)> {
        let entry = self.history.iter().find(|entry| entry.input.id == action)?;
        let strike = entry.input.strikes.iter().find(|s| s.id == strike)?;
        Some((strike, entry.recipients.as_ref()))
    }
    fn rules<'a>(&self, snapshot: Option<&'a Snapshot>, manual: &'a [ManualRule]) -> Vec<Rule<'a>> {
        let mut rules = vec![];
        if let Some(snapshot) = snapshot {
            let stats = &snapshot.monster.stats;
            for (list, cost) in [
                (&stats.actions, Cost::Action),
                (&stats.bonus_actions, Cost::Bonus),
                (&stats.reactions, Cost::Reaction),
                (&stats.legendary_actions, Cost::Legendary),
            ] {
                rules.extend(list.iter().map(|a| {
                    let id = format!("pack:{}", a.id);
                    Rule {
                        policy: self
                            .policies
                            .get(&id)
                            .cloned()
                            .unwrap_or_else(|| Policy::printed(a, cost)),
                        id,
                        name: &a.name,
                        text: &a.text,
                        strikes: &a.multiattack,
                    }
                }));
            }
        }
        rules.extend(manual.iter().map(|a| {
            let id = format!("manual:{}", a.id);
            Rule {
                policy: self.policies.get(&id).cloned().unwrap_or(Policy {
                    cost: Cost::Action,
                    legendary: 0,
                    uses: None,
                    reset: Reset::Manual,
                    recharge: None,
                }),
                id,
                name: &a.name,
                text: &a.text,
                strikes: &[],
            }
        }));
        rules
    }

    fn counter(&self, rule: &Rule<'_>) -> Counter {
        let mut counter = self.counters.get(&rule.id).cloned().unwrap_or_default();
        counter.remaining = counter.remaining.or(rule.policy.uses);
        counter
    }

    // V1 packs could contain nested references. Use one table-resolved strike for those.
    fn strikes(rule: &Rule<'_>, rules: &[Rule<'_>]) -> Vec<String> {
        let ids: Vec<_> = rule.strikes.iter().map(|id| format!("pack:{id}")).collect();
        if ids.is_empty()
            || ids.len() > 32
            || ids
                .iter()
                .any(|id| !rules.iter().any(|r| r.id == *id && r.strikes.is_empty()))
        {
            vec![rule.id.clone()]
        } else {
            ids
        }
    }

    pub(super) fn view(&self, snapshot: Option<&Snapshot>) -> Value {
        let rules = self.rules(snapshot, &self.manual);
        json!({
            "rules": rules.iter().map(|rule| json!({
                "id":rule.id, "name":rule.name, "text":rule.text, "policy":rule.policy,
                "counter":self.counter(rule), "strikes":Self::strikes(rule, &rules),
            })).collect::<Vec<_>>(),
            "action":self.action, "bonus":self.bonus, "reaction":self.reaction,
            "legendary_max":self.legendary_max, "legendary_left":self.legendary_left,
            "legendary_reset":self.legendary_reset,
            "history":self.history.iter().rev().take(20).collect::<Vec<_>>(),
        })
    }

    pub(super) fn duplicate(&mut self) {
        self.history.clear();
        for counter in self.counters.values_mut() {
            counter.queued = None;
        }
    }

    pub(super) fn boundary(&mut self, snapshot: Option<&Snapshot>, boundary: Reset) {
        if boundary == Reset::Start {
            self.action = true;
            self.bonus = true;
            self.reaction = true;
        }
        if self.legendary_reset == boundary {
            self.legendary_left = self.legendary_max;
        }
        let rules = self.rules(snapshot, &self.manual);
        for rule in rules {
            let Some(counter) = self.counters.get_mut(&rule.id) else {
                continue;
            };
            if rule.policy.reset == boundary {
                counter.remaining = rule.policy.uses;
            }
            if boundary == Reset::Start {
                if let Some((roll, recharge)) = counter.queued.take().zip(rule.policy.recharge) {
                    counter.last_roll = Some(roll);
                    counter.spent = roll < recharge.minimum;
                }
            }
        }
    }

    pub(super) fn edit(
        &mut self,
        snapshot: Option<&Snapshot>,
        edit: &ActionEdit,
        round: u32,
        current: bool,
        targets: &BTreeMap<Uuid, Option<Uuid>>,
    ) -> Result<(), Rejection> {
        let invalid = Rejection::InvalidInput;
        match edit {
            ActionEdit::AddRule { rule } => {
                if rule.id.is_nil()
                    || self.manual.len() >= 100
                    || !super::initiative::label(&rule.name)
                    || rule.text.trim().is_empty()
                    || rule.text.len() > 16000
                    || self.manual.iter().any(|existing| existing.id == rule.id)
                {
                    return Err(invalid);
                }
                self.manual.push(rule.clone());
            }
            ActionEdit::CorrectBudget {
                action,
                bonus,
                reaction,
                legendary_max,
                legendary_left,
                legendary_reset,
            } => {
                if legendary_left > legendary_max {
                    return Err(invalid);
                }
                (self.action, self.bonus, self.reaction) = (*action, *bonus, *reaction);
                (
                    self.legendary_max,
                    self.legendary_left,
                    self.legendary_reset,
                ) = (*legendary_max, *legendary_left, *legendary_reset);
            }
            ActionEdit::CorrectRule {
                rule,
                policy,
                remaining,
                ready,
            } => {
                if !policy.valid()
                    || remaining.is_some() != policy.uses.is_some()
                    || remaining
                        .zip(policy.uses)
                        .is_some_and(|(left, max)| left > max)
                    || !ready && policy.recharge.is_none()
                    || !self
                        .rules(snapshot, &self.manual)
                        .iter()
                        .any(|r| r.id == *rule)
                {
                    return Err(invalid);
                }
                self.policies.insert(rule.clone(), policy.clone());
                let counter = self.counters.entry(rule.clone()).or_default();
                counter.remaining = *remaining;
                counter.spent = !ready;
                counter.queued = counter.queued.filter(|roll| {
                    counter.spent && policy.recharge.as_ref().is_some_and(|r| *roll <= r.die)
                });
            }
            ActionEdit::QueueRoll { rule, roll } => {
                let rules = self.rules(snapshot, &self.manual);
                let charge = rules
                    .iter()
                    .find(|r| r.id == *rule)
                    .and_then(|r| r.policy.recharge.as_ref())
                    .filter(|r| valid_die(r))
                    .ok_or(invalid)?;
                let counter = self
                    .counters
                    .get_mut(rule)
                    .filter(|c| c.spent)
                    .ok_or(invalid)?;
                if roll.is_some_and(|value| !(1..=charge.die).contains(&value)) {
                    return Err(invalid);
                }
                counter.queued = *roll;
            }
            ActionEdit::Record { action } => {
                self.record(snapshot, action, round, current, targets)?
            }
        }
        Ok(())
    }

    fn record(
        &mut self,
        snapshot: Option<&Snapshot>,
        action: &ActionInput,
        round: u32,
        current: bool,
        targets: &BTreeMap<Uuid, Option<Uuid>>,
    ) -> Result<(), Rejection> {
        let invalid = Rejection::InvalidInput;
        let rules = self.rules(snapshot, &self.manual);
        let rule = rules.iter().find(|r| r.id == action.rule).ok_or(invalid)?;
        let mut ids = BTreeSet::from([action.id]);
        let strikes = Self::strikes(rule, &rules);
        let manual = strikes == [rule.id.clone()];
        if action.note.len() > 4000
            || action.id.is_nil()
            || !(1..=32).contains(&action.strikes.len())
            || !manual && strikes.len() != action.strikes.len()
            || action.strikes.iter().enumerate().any(|(i, strike)| {
                (if manual { &rule.id } else { &strikes[i] }) != &strike.rule
                    || strike.id.is_nil()
                    || !ids.insert(strike.id)
                    || strike.target_note.len() > 480
                    || strike.target.is_some_and(|id| !targets.contains_key(&id))
            })
            || self.history.iter().any(|prior| {
                ids.contains(&prior.input.id)
                    || prior.input.strikes.iter().any(|s| ids.contains(&s.id))
            })
        {
            return Err(invalid);
        }
        let mut counter = self.counter(rule);
        let policy = &rule.policy;
        if counter.remaining == Some(0) || counter.spent {
            return Err(Rejection::InvalidTransition);
        }
        match policy.cost {
            Cost::Action if current && self.action => self.action = false,
            Cost::Bonus if current && self.bonus => self.bonus = false,
            Cost::Reaction if self.reaction => self.reaction = false,
            Cost::Legendary if self.legendary_left >= policy.legendary => {
                self.legendary_left -= policy.legendary
            }
            Cost::Manual => {}
            _ => return Err(Rejection::InvalidTransition),
        }
        counter.remaining = counter.remaining.map(|n| n - 1);
        counter.spent = policy.recharge.is_some();
        self.counters.insert(rule.id.clone(), counter);
        self.history.push(Recorded {
            input: action.clone(),
            source: policy.clone(),
            name: rule.name.into(),
            round,
            recipients: Some(
                action
                    .strikes
                    .iter()
                    .filter_map(|strike| {
                        let member = targets.get(&strike.target?)?.as_ref()?;
                        Some((strike.id, *member))
                    })
                    .collect(),
            ),
        });
        Ok(())
    }
}
