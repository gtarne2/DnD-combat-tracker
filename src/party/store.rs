use super::{
    PartyError, Principal,
    model::{Change, Room},
    wire::*,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use std::path::Path;
use uuid::Uuid;

const SCHEMA: &str = "
    CREATE TABLE rooms (id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE commands (
        room TEXT NOT NULL, id TEXT NOT NULL, principal TEXT NOT NULL,
        request TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (room, id)
    ) WITHOUT ROWID;
    CREATE TABLE deliveries (
        room TEXT NOT NULL REFERENCES rooms(id), member TEXT NOT NULL, cursor INTEGER NOT NULL,
        event TEXT NOT NULL, PRIMARY KEY (room, member, cursor)
    ) WITHOUT ROWID;
    PRAGMA user_version = 1;
";

pub(super) fn open(path: &Path) -> Result<Connection, PartyError> {
    let mut db = Connection::open(path)?;
    db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;")?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    match tx.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))? {
        0 => tx.execute_batch(SCHEMA)?,
        1 => (),
        v => return Err(PartyError::Schema(v)),
    }
    tx.commit()?;
    Ok(db)
}

pub(super) fn load(db: &Connection, id: Uuid) -> Result<Option<Room>, PartyError> {
    let json: Option<String> = db
        .query_row(
            "SELECT state FROM rooms WHERE id = ?",
            [id.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    Ok(json.map(|value| serde_json::from_str(&value)).transpose()?)
}

pub(super) type Outcome = Result<Receipt, Rejection>;

pub(super) fn replay(
    db: &Connection,
    command: &Command,
    principal: Principal,
    request: &str,
) -> Result<Option<Outcome>, PartyError> {
    let saved = db
        .query_row(
            "SELECT principal, request, result FROM commands WHERE room = ? AND id = ?",
            params![command.room_id.to_string(), command.command_id.to_string()],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((owner, original, result)) = saved else {
        return Ok(None);
    };
    if owner != serde_json::to_string(&principal)? {
        return Ok(Some(Err(Rejection::Forbidden)));
    }
    if original != request {
        return Ok(Some(Err(Rejection::CommandConflict)));
    }
    Ok(Some(serde_json::from_str(&result)?))
}

pub(super) fn remember(
    db: &Connection,
    command: &Command,
    principal: Principal,
    request: &str,
    outcome: &Outcome,
) -> Result<(), PartyError> {
    db.execute(
        "INSERT INTO commands (room, id, principal, request, result) VALUES (?, ?, ?, ?, ?)",
        params![
            command.room_id.to_string(),
            command.command_id.to_string(),
            serde_json::to_string(&principal)?,
            request,
            serde_json::to_string(outcome)?
        ],
    )?;
    Ok(())
}

pub(super) fn save(
    db: &Connection,
    room_id: Uuid,
    room: &Room,
    change: &Change,
) -> Result<(), PartyError> {
    let key = room_id.to_string();
    db.execute("INSERT INTO rooms (id, state) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state",
        params![key, serde_json::to_string(room)?])?;
    let mut insert = db.prepare_cached("INSERT INTO deliveries (room, member, cursor, event)
        SELECT ?1, ?2, COALESCE(MAX(cursor), 0) + 1, ?3 FROM deliveries WHERE room = ?1 AND member = ?2")?;
    for (member, event) in &change.deliveries {
        insert.execute(params![
            key,
            member.to_string(),
            serde_json::to_string(event)?
        ])?;
    }
    Ok(())
}

pub(super) fn events(
    db: &Connection,
    room_id: Uuid,
    member: Uuid,
    after: u64,
) -> Result<Vec<Delivery>, PartyError> {
    let after = i64::try_from(after).map_err(|_| Rejection::InvalidInput)?;
    let mut query = db.prepare_cached(
        "SELECT cursor, event FROM deliveries WHERE room = ? AND member = ?
        AND cursor > ? ORDER BY cursor LIMIT 128",
    )?;
    let mut rows = query.query(params![room_id.to_string(), member.to_string(), after])?;
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        let json: String = row.get(1)?;
        result.push(Delivery {
            cursor: row.get(0)?,
            event: serde_json::from_str(&json)?,
        });
    }
    Ok(result)
}
