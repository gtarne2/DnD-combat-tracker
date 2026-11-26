use super::Principal;
use super::initiative::{Edit, FightEdit};
use super::monster_actions::DamageDecision;
use super::wire::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
pub(super) struct Member {
    principal: Principal,
    pub name: String,
    pub active: bool,
}

#[derive(Serialize, Deserialize)]
pub(super) struct Room {
    pub mode: HostMode,
    pub closed: bool,
    pub members: BTreeMap<Uuid, Member>,
    offers: BTreeMap<Uuid, Offer>,
    #[serde(default)]
    damage: BTreeMap<Uuid, DamageResolution>,
    #[serde(default)]
    ended_grants: std::collections::BTreeSet<(Uuid, Uuid)>,
    pub encounter: Option<SharedRound>,
    #[serde(default)]
    pub fight: super::initiative::Fight,
}

#[derive(Serialize, Deserialize)]
struct DamageResolution {
    action_id: Uuid,
    result: DamageResult,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", content = "offer_id", rename_all = "snake_case")]
enum DamageResult {
    Sent(Uuid),
    NoDamage,
    Handled,
}

#[derive(Default)]
pub(super) struct Presence {
    pub online: bool,
    pub inspection: Option<Publication>,
    pub publication_session: Uuid,
    pub publication_revision: u64,
}

// Indexed by (room, member). Ephemeral even when the SQLite database is durable.
pub(super) type Connections = HashMap<(Uuid, Uuid), Presence>;

pub(super) enum ConnectionChange {
    None,
    Online(Uuid),
    Offline(Uuid),
    Leave(Uuid),
    Close,
}

pub(super) struct Change {
    pub receipt: Receipt,
    pub connection: ConnectionChange,
    pub deliveries: Vec<(Uuid, Event)>,
}

impl Change {
    fn new(receipt: Receipt) -> Self {
        Self {
            receipt,
            connection: ConnectionChange::None,
            deliveries: Vec::new(),
        }
    }

    fn addressed(&mut self, offer: &Offer) {
        for id in [offer.sender, offer.recipient] {
            self.deliveries.push((
                id,
                Event::OfferChanged {
                    offer: offer.clone(),
                },
            ));
        }
    }
}

fn valid_label(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 120 && !value.chars().any(char::is_control)
}

impl Room {
    pub fn create(mode: HostMode, name: &str) -> Result<(Self, Change), Rejection> {
        let mut room = Self {
            mode,
            closed: false,
            members: BTreeMap::new(),
            offers: BTreeMap::new(),
            damage: BTreeMap::new(),
            encounter: None,
            fight: super::initiative::Fight::new(),
            ended_grants: Default::default(),
        };
        let change = room.admit(Principal::LocalHost, name)?;
        Ok((room, change))
    }

    pub fn identity(&self, principal: Principal) -> Result<Uuid, Rejection> {
        self.members
            .iter()
            .find(|(_, m)| m.principal == principal)
            .map(|(id, _)| *id)
            .ok_or(Rejection::Forbidden)
    }

    pub fn active(&self, principal: Principal) -> Result<Uuid, Rejection> {
        let id = self.identity(principal)?;
        if self.closed {
            return Err(Rejection::Closed);
        }
        if !self.members[&id].active {
            return Err(Rejection::Forbidden);
        }
        Ok(id)
    }

    pub fn addressed_offers(&self, id: Uuid) -> Vec<Offer> {
        self.offers
            .values()
            .filter(|o| o.sender == id || o.recipient == id)
            .cloned()
            .collect()
    }

    pub fn combat(&self, id: Uuid, dm: bool) -> serde_json::Value {
        let mut combat = self.fight.view(id, dm);
        if dm {
            combat["damage"] = serde_json::json!(&self.damage);
        }
        combat
    }

    fn broadcast(&self, change: &mut Change, event: Event) {
        change.deliveries.extend(
            self.members
                .iter()
                .filter(|(_, m)| m.active)
                .map(|(&id, _)| (id, event.clone())),
        );
    }

    fn admit(&mut self, principal: Principal, name: &str) -> Result<Change, Rejection> {
        if self.closed {
            return Err(Rejection::Closed);
        }
        if !valid_label(name) {
            return Err(Rejection::InvalidInput);
        }
        if self.identity(principal).is_ok() {
            return Err(Rejection::Forbidden);
        }
        let id = Uuid::new_v4();
        self.members.insert(
            id,
            Member {
                principal,
                name: name.to_owned(),
                active: true,
            },
        );
        let mut change = Change::new(Receipt::Membership { member_id: id });
        change.connection = ConnectionChange::Online(id);
        self.broadcast(&mut change, Event::RosterChanged);
        Ok(change)
    }

    pub fn apply(
        &mut self,
        principal: Principal,
        op: &Operation,
        room_id: Uuid,
        live: &Connections,
    ) -> Result<Change, Rejection> {
        use Operation::*;
        if let Join { name } = op {
            return self.admit(principal, name);
        }
        let id = self.identity(principal)?;
        // An authenticated recipient retains exactly the right to finish its own
        // claim after close/leave. Lost final acknowledgments are replayable too.
        if let Claim { offer_id } = op
            && self
                .offers
                .get(offer_id)
                .is_some_and(|offer| offer.recipient == id && offer.status == Status::Claimed)
        {
            return self.transition(id, *offer_id, op);
        }
        if let Accept { offer_id } | Decline { offer_id } = op
            && self.offers.get(offer_id).is_some_and(|o| {
                o.recipient == id
                    && matches!(
                        o.status,
                        Status::Claimed | Status::Accepted | Status::Declined
                    )
            })
        {
            return self.transition(id, *offer_id, op);
        }
        self.active(principal)?;
        let mut change = Change::new(Receipt::Done);
        if matches!(op, Resume) {
            change.connection = ConnectionChange::Online(id);
            change.receipt = Receipt::Membership { member_id: id };
            self.broadcast(&mut change, Event::RosterChanged);
            return Ok(change);
        }
        if !live.get(&(room_id, id)).is_some_and(|p| p.online) {
            return Err(Rejection::Disconnected);
        }
        match op {
            Disconnect => {
                change.connection = ConnectionChange::Offline(id);
                self.broadcast(&mut change, Event::RosterChanged);
            }
            Leave if principal != Principal::LocalHost => {
                change.deliveries.extend(self.fight.leave(id));
                self.members.get_mut(&id).unwrap().active = false;
                self.expire_pending(Some(id), &mut change);
                change.connection = ConnectionChange::Leave(id);
                self.broadcast(&mut change, Event::RosterChanged);
            }
            Close if principal == Principal::LocalHost => {
                change.deliveries.extend(self.fight.close());
                self.closed = true;
                self.expire_pending(None, &mut change);
                for member in self.members.values_mut() {
                    member.active = false;
                }
                change.connection = ConnectionChange::Close;
            }
            Send {
                recipient,
                action_id,
                source,
                effect,
            } => return self.send(id, *recipient, *action_id, source, *effect),
            RequestReversal { offer_id } => {
                let offer = self
                    .offers
                    .get_mut(offer_id)
                    .filter(|o| o.sender == id)
                    .ok_or(Rejection::Forbidden)?;
                if offer.status != Status::Accepted {
                    return Err(Rejection::InvalidTransition);
                }
                if !offer.reversal_requested {
                    offer.reversal_requested = true;
                    change.addressed(offer);
                }
            }
            EndGrant { grant_id } => {
                self.ended_grants.insert((id, *grant_id));
                for offer in self.offers.values_mut().filter(|o| {
                    o.sender == id
                        && matches!(o.effect, Effect::Grant(g) if g.grant_id == *grant_id)
                        && matches!(
                            o.status,
                            Status::Pending | Status::Claimed | Status::Accepted
                        )
                }) {
                    offer.status = Status::Ended;
                    change.addressed(offer);
                }
            }
            Claim { offer_id }
            | Withdraw { offer_id }
            | Accept { offer_id }
            | Decline { offer_id } => {
                return self.transition(id, *offer_id, op);
            }
            Expire { offer_id } if principal == Principal::LocalHost => {
                // A maintenance acknowledgment exposes no status to an unaddressed host.
                if let Some(o) = self
                    .offers
                    .get_mut(offer_id)
                    .filter(|o| o.status == Status::Pending)
                {
                    o.status = Status::Expired;
                    change.addressed(o);
                }
            }
            Initiative(cmd) if self.mode == HostMode::Dm => {
                let dm = principal == Principal::LocalHost;
                if let Edit::FinalizeDamage {
                    action_id,
                    strike_id,
                    decision,
                } = cmd.edit
                {
                    if !dm {
                        return Err(Rejection::Forbidden);
                    }
                    return self.finalize_damage(id, cmd, action_id, strike_id, decision);
                }
                let players = if dm && matches!(cmd.edit, Edit::MonsterAction { .. }) {
                    self.members
                        .iter()
                        .filter(|(_, member)| {
                            member.active && member.principal != Principal::LocalHost
                        })
                        .map(|(&id, _)| id)
                        .collect()
                } else {
                    Default::default()
                };
                change.deliveries.extend(self.fight.edit(
                    id,
                    &self.members[&id].name,
                    dm,
                    cmd,
                    &players,
                )?);
            }
            SetRound {
                encounter_id,
                expected_revision,
                round,
            } if principal == Principal::LocalHost && self.mode == HostMode::Dm => {
                return self.set_round(*encounter_id, *expected_revision, *round);
            }
            _ => return Err(Rejection::Forbidden),
        }
        Ok(change)
    }

    fn finalize_damage(
        &mut self,
        dm: Uuid,
        cmd: &FightEdit,
        action_id: Uuid,
        strike_id: Uuid,
        decision: DamageDecision,
    ) -> Result<Change, Rejection> {
        self.fight.check_revision(cmd)?;
        if self.damage.contains_key(&strike_id) {
            return Err(Rejection::InvalidTransition);
        }
        let recipient = self.fight.damage_recipient(action_id, strike_id)?;
        let mut change = Change::new(Receipt::Done);
        let result = match decision {
            DamageDecision::Handled => DamageResult::Handled,
            DamageDecision::Final(0) => DamageResult::NoDamage,
            DamageDecision::Final(amount) => {
                change = self.send(
                    dm,
                    recipient.ok_or(Rejection::InvalidInput)?,
                    strike_id,
                    "DM damage",
                    Effect::Damage(amount.try_into().map_err(|_| Rejection::InvalidInput)?),
                )?;
                let Receipt::Offer { offer_id, .. } = change.receipt else {
                    unreachable!()
                };
                DamageResult::Sent(offer_id)
            }
        };
        self.damage
            .insert(strike_id, DamageResolution { action_id, result });
        self.fight.damage_committed();
        Ok(change)
    }

    fn send(
        &mut self,
        sender: Uuid,
        recipient: Uuid,
        action_id: Uuid,
        source: &str,
        effect: Effect,
    ) -> Result<Change, Rejection> {
        if !valid_label(source)
            || recipient == sender
            || (self.mode == HostMode::Dm
                && self
                    .members
                    .get(&recipient)
                    .is_some_and(|m| m.principal == Principal::LocalHost))
            || !self.members.get(&recipient).is_some_and(|m| m.active)
        {
            return Err(Rejection::InvalidInput);
        }
        if self
            .offers
            .values()
            .any(|o| (o.sender, o.recipient, o.action_id) == (sender, recipient, action_id))
        {
            return Err(Rejection::InvalidTransition);
        }
        let offer_id = Uuid::new_v4();
        let status = if matches!(effect, Effect::Grant(g) if self.ended_grants.contains(&(sender, g.grant_id)))
        {
            Status::Ended
        } else {
            Status::Pending
        };
        let offer = Offer {
            sender,
            recipient,
            action_id,
            offer_id,
            source: source.into(),
            reversal_requested: false,
            effect,
            status,
        };
        let mut change = Change::new(Receipt::Offer { offer_id, status });
        change.addressed(&offer);
        self.offers.insert(offer_id, offer);
        Ok(change)
    }

    fn set_round(
        &mut self,
        encounter_id: Uuid,
        expected_revision: u64,
        round: std::num::NonZeroU32,
    ) -> Result<Change, Rejection> {
        let revision = match self.encounter {
            None => 0,
            Some(current) if current.encounter_id == encounter_id => current.revision,
            Some(_) => return Err(Rejection::RevisionConflict),
        };
        if revision != expected_revision {
            return Err(Rejection::RevisionConflict);
        }
        let encounter = SharedRound {
            encounter_id,
            revision: revision + 1,
            round,
        };
        self.encounter = Some(encounter);
        let mut change = Change::new(Receipt::Encounter { encounter });
        self.broadcast(&mut change, Event::EncounterChanged { encounter });
        Ok(change)
    }

    fn transition(
        &mut self,
        actor: Uuid,
        offer_id: Uuid,
        op: &Operation,
    ) -> Result<Change, Rejection> {
        let offer = self.offers.get_mut(&offer_id).ok_or(Rejection::Forbidden)?;
        let target = match op {
            Operation::Claim { .. } if actor == offer.recipient => Status::Claimed,
            Operation::Accept { .. } if actor == offer.recipient => Status::Accepted,
            Operation::Decline { .. } if actor == offer.recipient => Status::Declined,
            Operation::Withdraw { .. } if actor == offer.sender => Status::Withdrawn,
            _ => return Err(Rejection::Forbidden),
        };
        let mut change = Change::new(Receipt::Offer {
            offer_id,
            status: target,
        });
        if offer.status == target {
            return Ok(change);
        }
        match (offer.status, target) {
            (Status::Pending, Status::Claimed | Status::Declined | Status::Withdrawn)
            | (Status::Claimed, Status::Accepted | Status::Declined) => {
                offer.status = target;
                change.addressed(offer);
                Ok(change)
            }
            _ => Err(Rejection::InvalidTransition),
        }
    }

    fn expire_pending(&mut self, member: Option<Uuid>, change: &mut Change) {
        for o in self.offers.values_mut().filter(|o| {
            (o.status == Status::Pending
                || (matches!(o.effect, Effect::Grant(_))
                    && matches!(o.status, Status::Accepted | Status::Claimed)))
                && member.is_none_or(|id| o.sender == id || o.recipient == id)
        }) {
            o.status = if matches!(o.effect, Effect::Grant(_)) {
                Status::Ended
            } else {
                Status::Expired
            };
            change.addressed(o);
        }
    }
}
