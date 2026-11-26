//! Host-side room authority shared by the native party helper and protocol tests.
pub mod initiative;
pub mod interruptions;
mod model;
mod monster_actions;
mod store;
pub mod wire;

use model::{ConnectionChange, Connections, Presence, Room};
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{fmt, path::Path};
use uuid::Uuid;
use wire::*;

/// Supplied by trusted native dispatch, never decoded from a peer's command.
/// Paired identifies a verified room/character binding; the ID is not a credential.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Principal {
    LocalHost,
    Paired(Uuid),
}

#[derive(Debug)]
pub enum PartyError {
    Rejected(Rejection),
    Schema(u32),
    Storage(rusqlite::Error),
    Encoding(serde_json::Error),
}

impl fmt::Display for PartyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(reason) => write!(f, "Party command rejected ({reason:?})"),
            Self::Schema(version) => write!(f, "Unsupported party database version {version}"),
            Self::Storage(error) => write!(f, "Party database error: {error}"),
            Self::Encoding(error) => write!(f, "Party record encoding error: {error}"),
        }
    }
}
impl std::error::Error for PartyError {}
impl From<Rejection> for PartyError {
    fn from(e: Rejection) -> Self {
        Self::Rejected(e)
    }
}
impl From<rusqlite::Error> for PartyError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Storage(e)
    }
}
impl From<serde_json::Error> for PartyError {
    fn from(e: serde_json::Error) -> Self {
        Self::Encoding(e)
    }
}

/// One service per host helper. Opening an existing DB starts with everyone offline.
pub struct RoomService {
    db: Connection,
    live: Connections,
}

impl RoomService {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, PartyError> {
        Ok(Self {
            db: store::open(path.as_ref())?,
            live: Connections::new(),
        })
    }

    pub fn execute(&mut self, principal: Principal, cmd: &Command) -> Result<Receipt, PartyError> {
        if cmd.version != VERSION {
            return Err(Rejection::UnsupportedVersion.into());
        }
        let request = serde_json::to_string(&cmd.command)?;
        let tx = self
            .db
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(result) = store::replay(&tx, cmd, principal, &request)? {
            return Ok(result?);
        }
        let result = match (&cmd.command, store::load(&tx, cmd.room_id)?) {
            (Operation::Create { .. }, _) if principal != Principal::LocalHost => {
                Err(Rejection::Forbidden)
            }
            (Operation::Create { .. }, Some(_)) => Err(Rejection::InvalidTransition),
            (Operation::Create { mode, name }, None) => Room::create(*mode, name),
            (_, Some(mut room)) => room
                .apply(principal, &cmd.command, cmd.room_id, &self.live)
                .map(|change| (room, change)),
            (_, None) => Err(Rejection::UnknownRoom),
        };
        let (outcome, connection) = match result {
            Ok((room, change)) => {
                store::save(&tx, cmd.room_id, &room, &change)?;
                (Ok(change.receipt), change.connection)
            }
            // A lease may lapse between a guest's last roster poll and its next
            // outbox send. Resume must be able to retry the same delivery ID.
            Err(Rejection::Disconnected)
                if matches!(
                    cmd.command,
                    Operation::Send { .. }
                        | Operation::EndGrant { .. }
                        | Operation::Initiative(_)
                        | Operation::WindowReply { .. }
                ) =>
            {
                return Err(Rejection::Disconnected.into());
            }
            Err(reason) => (Err(reason), ConnectionChange::None),
        };
        store::remember(&tx, cmd, principal, &request, &outcome)?;
        tx.commit()?;
        match connection {
            ConnectionChange::None => (),
            ConnectionChange::Online(id) => {
                self.live.insert(
                    (cmd.room_id, id),
                    Presence {
                        online: true,
                        inspection: None,
                        publication_session: Uuid::new_v4(),
                        publication_revision: 0,
                    },
                );
            }
            ConnectionChange::Offline(id) => {
                self.live.entry((cmd.room_id, id)).or_default().online = false
            }
            ConnectionChange::Leave(id) => {
                self.live.remove(&(cmd.room_id, id));
            }
            ConnectionChange::Close => self.live.retain(|(room, _), _| room != &cmd.room_id),
        }
        Ok(outcome?)
    }

    /// Replace the owner's DM projection. Never enters the command journal or event stream.
    pub fn publish(
        &mut self,
        principal: Principal,
        room_id: Uuid,
        publication: Publication,
    ) -> Result<(), PartyError> {
        self.publish_ordered(principal, room_id, publication, None)
    }

    pub fn publish_ordered(
        &mut self,
        principal: Principal,
        room_id: Uuid,
        publication: Publication,
        order: Option<(Uuid, u64)>,
    ) -> Result<(), PartyError> {
        let room = store::load(&self.db, room_id)?.ok_or(Rejection::UnknownRoom)?;
        let id = room.active(principal)?;
        if room.mode != HostMode::Dm {
            return Err(Rejection::Forbidden.into());
        }
        let presence = self
            .live
            .get_mut(&(room_id, id))
            .filter(|p| p.online)
            .ok_or(Rejection::Disconnected)?;
        if let Some((session, revision)) = order {
            if session != presence.publication_session {
                return Err(Rejection::Disconnected.into());
            }
            if revision <= presence.publication_revision {
                return Ok(());
            }
            presence.publication_revision = revision;
        }
        presence.inspection = match publication {
            Publication::PartyNameOnly => None,
            other => Some(other),
        };
        Ok(())
    }

    /// Current display projection and one page of authorized events from the same DB snapshot.
    pub fn poll(
        &self,
        principal: Principal,
        room_id: Uuid,
        after: u64,
    ) -> Result<RoomView, PartyError> {
        let tx = self.db.unchecked_transaction()?;
        let room = store::load(&tx, room_id)?.ok_or(Rejection::UnknownRoom)?;
        let id = room.active(principal)?;
        if !self.live.get(&(room_id, id)).is_some_and(|p| p.online) {
            return Err(Rejection::Disconnected.into());
        }
        let dm = principal == Principal::LocalHost && room.mode == HostMode::Dm;
        let members = room
            .members
            .iter()
            .filter(|(_, m)| m.active)
            .map(|(&member_id, m)| {
                let presence = self.live.get(&(room_id, member_id));
                MemberView {
                    member_id,
                    name: m.name.clone(),
                    online: presence.is_some_and(|p| p.online),
                    inspection: if dm {
                        presence.and_then(|p| p.inspection.clone())
                    } else {
                        None
                    },
                }
            })
            .collect();
        let events = store::events(&tx, room_id, id, after)?;
        let cursor = events.last().map_or(after, |d| d.cursor);
        Ok(RoomView {
            version: VERSION,
            room_id,
            self_id: id,
            mode: room.mode,
            dm_id: if room.mode == HostMode::Dm {
                Some(room.identity(Principal::LocalHost)?)
            } else {
                None
            },
            members,
            publication_session: (room.mode == HostMode::Dm && !dm)
                .then(|| self.live[&(room_id, id)].publication_session),
            combat: (room.mode == HostMode::Dm).then(|| room.combat(id, dm)),
            encounter: room.encounter,
            offers: room.addressed_offers(id),
            questions: room.questions(id),
            announcements: room.announcements,
            events,
            cursor,
        })
    }

    /// DM-only, player-safe projection of the current encounter for a virtual tabletop link.
    /// See `initiative::Fight::table_view`.
    pub fn table_view(
        &self,
        principal: Principal,
        room_id: Uuid,
    ) -> Result<serde_json::Value, PartyError> {
        let room = store::load(&self.db, room_id)?.ok_or(Rejection::UnknownRoom)?;
        room.active(principal)?;
        if principal != Principal::LocalHost || room.mode != HostMode::Dm {
            return Err(Rejection::Forbidden.into());
        }
        Ok(serde_json::json!({"room_id": room_id, "encounter": room.fight.table_view()}))
    }

    /// DM-only portable copy of the current encounter position. See `initiative::PortableEncounter`.
    pub fn export_encounter(
        &self,
        principal: Principal,
        room_id: Uuid,
    ) -> Result<initiative::PortableEncounter, PartyError> {
        let room = store::load(&self.db, room_id)?.ok_or(Rejection::UnknownRoom)?;
        room.active(principal)?;
        if principal != Principal::LocalHost || room.mode != HostMode::Dm {
            return Err(Rejection::Forbidden.into());
        }
        Ok(room.fight.export())
    }

    pub fn check_window(
        &self,
        principal: Principal,
        room_id: Uuid,
        window: interruptions::WindowRef,
    ) -> Result<interruptions::QuestionView, PartyError> {
        let room = store::load(&self.db, room_id)?.ok_or(Rejection::UnknownRoom)?;
        Ok(room.check_window(room.identity(principal)?, window)?)
    }

    pub fn clock_page(
        &self,
        principal: Principal,
        room_id: Uuid,
        after: u64,
    ) -> Result<Vec<Delivery>, PartyError> {
        let id = self.member_id(principal, room_id)?;
        store::read_events(&self.db, room_id, id, after, true)
    }

    /// Restricted receipt recovery also works after leave or close, without restoring membership.
    pub fn reconcile(&self, principal: Principal, room_id: Uuid) -> Result<Vec<Offer>, PartyError> {
        let room = store::load(&self.db, room_id)?.ok_or(Rejection::UnknownRoom)?;
        Ok(room.addressed_offers(room.identity(principal)?))
    }

    pub fn member_id(&self, principal: Principal, room_id: Uuid) -> Result<Uuid, PartyError> {
        let room = store::load(&self.db, room_id)?.ok_or(Rejection::UnknownRoom)?;
        Ok(room.identity(principal)?)
    }
}
