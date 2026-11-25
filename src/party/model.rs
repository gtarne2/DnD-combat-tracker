use super::Principal;
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
    pub encounter: Option<SharedRound>,
}

#[derive(Default)]
pub(super) struct Presence {
    pub online: bool,
    pub inspection: Option<Publication>,
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
            encounter: None,
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
                self.members.get_mut(&id).unwrap().active = false;
                self.expire_pending(Some(id), &mut change);
                change.connection = ConnectionChange::Leave(id);
                self.broadcast(&mut change, Event::RosterChanged);
            }
            Close if principal == Principal::LocalHost => {
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
        let status = Status::Pending;
        let offer = Offer {
            sender,
            recipient,
            action_id,
            offer_id,
            source: source.into(),
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
            o.status == Status::Pending
                && member.is_none_or(|id| o.sender == id || o.recipient == id)
        }) {
            o.status = Status::Expired;
            change.addressed(o);
        }
    }
}
