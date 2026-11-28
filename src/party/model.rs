use super::Principal;
use super::initiative::{Edit, FightEdit};
use super::interruptions::{
    Answer, Question, QuestionView, Resolution, Window, WindowEdit, WindowRef,
};
use super::monster_actions::{DamageDecision, DamageRoll, Outcome};
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
    damage_rolls: BTreeMap<Uuid, DamageRoll>,
    #[serde(default)]
    windows: BTreeMap<Uuid, Window>,
    #[serde(default)]
    pub announcements: Vec<String>,
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
    /// The player's map token look, while they are connected.
    pub token: Option<TokenLook>,
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

    fn window_changed(&mut self, dm: Uuid, recipient: Uuid) {
        self.deliveries
            .extend([dm, recipient].map(|id| (id, Event::WindowsChanged)));
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
            damage_rolls: BTreeMap::new(),
            windows: BTreeMap::new(),
            announcements: vec![],
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
            combat["damage_rolls"] = serde_json::json!(&self.damage_rolls);
            combat["windows"] = serde_json::json!(&self.windows);
        }
        combat
    }

    pub(super) fn questions(&self, player: Uuid) -> Vec<QuestionView> {
        self.windows
            .values()
            .filter(|w| w.recipient == player && matches!(w.resolution, Resolution::Pending))
            .map(Window::question_view)
            .collect()
    }

    pub(super) fn check_window(
        &self,
        actor: Uuid,
        reference: WindowRef,
    ) -> Result<QuestionView, Rejection> {
        self.windows
            .values()
            .find(|w| {
                w.reference == reference
                    && w.recipient == actor
                    && matches!(w.resolution, Resolution::Pending)
            })
            .map(Window::question_view)
            .ok_or(Rejection::StaleWindow)
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
        if let WindowReply { window, .. } = op {
            self.check_window(id, *window)?;
        }
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
                self.stale_windows(false, false, Some(id), &mut change)?;
                change.connection = ConnectionChange::Leave(id);
                self.broadcast(&mut change, Event::RosterChanged);
            }
            Close if principal == Principal::LocalHost => {
                change.deliveries.extend(self.fight.close());
                self.closed = true;
                self.expire_pending(None, &mut change);
                self.stale_windows(true, false, None, &mut change)?;
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
                        && o.effect.grant_id() == Some(*grant_id)
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
                match &cmd.edit {
                    Edit::ReviewStrike {
                        action_id,
                        strike_id,
                        review,
                    } => {
                        if !dm {
                            return Err(Rejection::Forbidden);
                        }
                        self.fight.check_revision(cmd)?;
                        if self.damage.contains_key(strike_id)
                            || self.windows.contains_key(strike_id)
                            || self.damage_rolls.contains_key(strike_id)
                        {
                            return Err(Rejection::InvalidTransition);
                        }
                        self.fight.review_strike(*action_id, *strike_id, review)?;
                        return Ok(change);
                    }
                    Edit::StoreDamageRoll {
                        action_id,
                        strike_id,
                        roll,
                    } => {
                        if !dm {
                            return Err(Rejection::Forbidden);
                        }
                        self.fight.check_revision(cmd)?;
                        self.damage_target(*action_id, *strike_id)?;
                        if !roll.valid() || self.damage_rolls.contains_key(strike_id) {
                            return Err(Rejection::InvalidInput);
                        }
                        self.damage_rolls.insert(*strike_id, *roll);
                        self.fight.revised();
                        return Ok(change);
                    }
                    _ => {}
                }
                if let Edit::StrikeWindow {
                    action_id,
                    strike_id,
                    ref edit,
                } = cmd.edit
                {
                    if !dm {
                        return Err(Rejection::Forbidden);
                    }
                    return self.edit_window(id, cmd, action_id, strike_id, edit);
                }
                if let Edit::ApplyArea {
                    id: area,
                    ref results,
                } = cmd.edit
                {
                    if !dm {
                        return Err(Rejection::Forbidden);
                    }
                    let (spell, offers) = self.fight.apply_area(cmd, area, results)?;
                    let source: String = spell.chars().take(120).collect();
                    for (member, amount) in offers {
                        // One offer per area and player, so a replay cannot send it twice.
                        let action_id = Uuid::from_u128(area.as_u128() ^ member.as_u128());
                        let Ok(amount) = amount.try_into() else {
                            continue;
                        };
                        // A player who left still has a row until the DM removes it; skip them.
                        if let Ok(sent) =
                            self.send(id, member, action_id, &source, Effect::Damage(amount))
                        {
                            change.deliveries.extend(sent.deliveries);
                        }
                    }
                    return Ok(change);
                }
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
                let players = if dm
                    && matches!(
                        cmd.edit,
                        Edit::MonsterAction { .. } | Edit::Import { .. } | Edit::Seat { .. }
                    ) {
                    self.members
                        .iter()
                        .filter(|(_, member)| {
                            member.active && member.principal != Principal::LocalHost
                        })
                        .map(|(&id, member)| (id, member.name.clone()))
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
                self.stale_windows(
                    matches!(
                        cmd.edit,
                        Edit::End | Edit::Load { .. } | Edit::New | Edit::Import { .. }
                    ),
                    matches!(cmd.edit, Edit::Next | Edit::EndTurn { .. } | Edit::Start),
                    None,
                    &mut change,
                )?;
            }
            WindowReply { window, reply } => {
                let dm = self.identity(Principal::LocalHost)?;
                let current = self
                    .windows
                    .values_mut()
                    .find(|w| w.reference == *window && w.recipient == id)
                    .ok_or(Rejection::StaleWindow)?;
                if !current.question.accepts(reply.answer, reply.reacted) {
                    return Err(Rejection::InvalidInput);
                }
                current.reply = Some(*reply);
                current.resolution = Resolution::Answered;
                change.window_changed(dm, id);
                self.fight.revised();
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

    fn stale_windows(
        &mut self,
        all: bool,
        boundary: bool,
        leaving: Option<Uuid>,
        change: &mut Change,
    ) -> Result<(), Rejection> {
        if self.windows.is_empty() {
            return Ok(());
        }
        let dm = self.identity(Principal::LocalHost)?;
        for (&strike, window) in &mut self.windows {
            if !matches!(
                window.resolution,
                Resolution::Pending | Resolution::Answered
            ) {
                continue;
            }
            let loses_trigger = boundary
                && window.question != Question::Save
                && matches!(window.resolution, Resolution::Pending);
            if all
                || loses_trigger
                || leaving == Some(window.recipient)
                || self.fight.recorded_strike(window.action, strike).is_err()
                || window.target != window.recipient && !self.fight.has_row(window.target)
            {
                window.resolution = Resolution::Stale;
                change.window_changed(dm, window.recipient);
            }
        }
        Ok(())
    }

    fn edit_window(
        &mut self,
        dm: Uuid,
        cmd: &FightEdit,
        action: Uuid,
        strike: Uuid,
        edit: &WindowEdit,
    ) -> Result<Change, Rejection> {
        self.fight.check_revision(cmd)?;
        if self.damage.contains_key(&strike) {
            return Err(Rejection::InvalidTransition);
        }
        let (_, recipient, target) = self.fight.recorded_strike(action, strike)?;
        let mut change = Change::new(Receipt::Done);
        if let WindowEdit::Open {
            id,
            question,
            announcement,
        } = edit
        {
            let recipient = recipient
                .filter(|r| self.members.get(r).is_some_and(|member| member.active))
                .ok_or(Rejection::InvalidInput)?;
            let target = target
                .filter(|&id| id == recipient || self.fight.has_row(id))
                .ok_or(Rejection::InvalidInput)?;
            if id.is_nil()
                || self.windows.values().any(|w| w.reference.id == *id)
                || !announcement.is_empty() && !valid_label(announcement)
            {
                return Err(Rejection::InvalidInput);
            }
            let prior = self.windows.get(&strike);
            if prior.is_some_and(|w| {
                w.action != action
                    || !matches!(w.resolution, Resolution::Canceled | Resolution::Stale)
            }) {
                return Err(Rejection::InvalidTransition);
            }
            let version = prior
                .map_or(Some(1), |w| w.reference.version.checked_add(1))
                .ok_or(Rejection::InvalidInput)?;
            self.windows.insert(
                strike,
                Window {
                    reference: WindowRef { id: *id, version },
                    question: *question,
                    action,
                    recipient,
                    target,
                    resolution: Resolution::Pending,
                    reply: None,
                },
            );
            change.window_changed(dm, recipient);
            if !announcement.is_empty() {
                self.announcements.push(announcement.clone());
                if self.announcements.len() > 20 {
                    self.announcements.remove(0);
                }
                self.broadcast(&mut change, Event::WindowsChanged);
            }
        } else {
            let current = self
                .windows
                .get_mut(&strike)
                .filter(|w| w.action == action)
                .ok_or(Rejection::StaleWindow)?;
            let (reference, resolution) = match edit {
                WindowEdit::Cancel { window }
                    if matches!(
                        current.resolution,
                        Resolution::Pending | Resolution::Answered
                    ) =>
                {
                    (*window, Resolution::Canceled)
                }
                WindowEdit::Resume { window }
                    if matches!(current.resolution, Resolution::Answered) =>
                {
                    let outcome = match current.reply.map(|reply| reply.answer) {
                        Some(Answer::Hit) => Outcome::Hit,
                        Some(Answer::Miss) => Outcome::Miss,
                        Some(Answer::SaveSuccess) => Outcome::SaveSuccess,
                        Some(Answer::SaveFailure) => Outcome::SaveFailure,
                        _ => return Err(Rejection::InvalidTransition),
                    };
                    (
                        *window,
                        Resolution::Final {
                            outcome,
                            override_note: None,
                        },
                    )
                }
                WindowEdit::Override {
                    window,
                    outcome,
                    note,
                } if !matches!(current.resolution, Resolution::Final { .. })
                    && !note.trim().is_empty()
                    && note.len() <= 4000 =>
                {
                    (
                        *window,
                        Resolution::Final {
                            outcome: *outcome,
                            override_note: Some(note.clone()),
                        },
                    )
                }
                _ => return Err(Rejection::InvalidTransition),
            };
            if current.reference != reference {
                return Err(Rejection::StaleWindow);
            }
            current.resolution = resolution;
            change.window_changed(dm, current.recipient);
        }
        self.fight.revised();
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
        let recipient = self.damage_target(action_id, strike_id)?;
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
                self.fight.log_strike_damage(action_id, strike_id, amount);
                DamageResult::Sent(offer_id)
            }
        };
        self.damage
            .insert(strike_id, DamageResolution { action_id, result });
        self.fight.revised();
        Ok(change)
    }

    fn damage_target(&self, action_id: Uuid, strike_id: Uuid) -> Result<Option<Uuid>, Rejection> {
        if self.damage.contains_key(&strike_id) {
            return Err(Rejection::InvalidTransition);
        }
        let (mut outcome, recipient, _) = self.fight.recorded_strike(action_id, strike_id)?;
        if let Some(window) = self.windows.get(&strike_id) {
            match window.resolution {
                Resolution::Final {
                    outcome: ruling, ..
                } if window.action == action_id => outcome = ruling,
                _ => return Err(Rejection::InvalidTransition),
            }
        }
        if matches!(outcome, Outcome::Miss) {
            return Err(Rejection::InvalidTransition);
        }
        Ok(recipient)
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
            || matches!(effect, Effect::Buff(buff) if !buff.valid())
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
        let status = if effect
            .grant_id()
            .is_some_and(|grant| self.ended_grants.contains(&(sender, grant)))
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
                || (o.effect.grant_id().is_some()
                    && matches!(o.status, Status::Accepted | Status::Claimed)))
                && member.is_none_or(|id| o.sender == id || o.recipient == id)
        }) {
            o.status = if o.effect.grant_id().is_some() {
                Status::Ended
            } else {
                Status::Expired
            };
            change.addressed(o);
        }
    }
}
