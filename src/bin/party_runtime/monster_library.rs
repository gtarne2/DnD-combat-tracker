use std::{path::Path as FilePath, time::Duration};

use aurora_combat_tracker::{
    aurora::import_monster_pack,
    fivetools::{import_fivetools_file, import_fivetools_pack},
    monsters::{Pack, PackInfo},
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use super::{Error, Local};

const PACK_LIMIT: usize = 16 * 1024 * 1024;
const DEFAULT_PACK_ID: &str = "srd-5.1-monsters";
const SRD_2024_PACK_ID: &str = "srd-5.2.1-monsters";
const BUNDLED_PACKS: [(&str, &[u8]); 2] = [
    (
        DEFAULT_PACK_ID,
        include_bytes!("../../../content/monster-packs/srd-5.1-monsters.json"),
    ),
    (
        SRD_2024_PACK_ID,
        include_bytes!("../../../content/monster-packs/srd-5.2.1-monsters.json"),
    ),
];

pub(super) fn routes() -> Router<Local> {
    Router::new()
        .route("/{cap}/monsters/{action}", post(request).options(request))
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
}

async fn request(
    State(local): State<Local>,
    Path((cap, action)): Path<(String, String)>,
    headers: HeaderMap,
    method: axum::http::Method,
    body: Bytes,
) -> Response {
    use std::sync::atomic::Ordering;
    let Some(path) = local.monster_library else {
        return StatusCode::FORBIDDEN.into_response();
    };
    if cap != local.cap
        || headers.get("origin").and_then(|v| v.to_str().ok()) != Some("null")
        || local.detached.load(Ordering::Relaxed)
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = if method == axum::http::Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else if action == "bestiary" {
        let report = local
            .bestiary
            .lock()
            .map(|report| report.clone())
            .unwrap_or(Value::Null);
        Json(report).into_response()
    } else {
        match tokio::task::spawn_blocking(move || dispatch(&path, &action, &body)).await {
            Ok(Ok(value)) => Json(value).into_response(),
            Ok(Err(error)) => (StatusCode::CONFLICT, error.to_string()).into_response(),
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Monster library unavailable.",
            )
                .into_response(),
        }
    };
    super::local_headers(&mut response);
    response
}

#[derive(Serialize)]
struct Summary {
    info: PackInfo,
    revision: Uuid,
    count: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    expected_revision: Option<Uuid>,
    pack: Pack,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FiveTools {
    /// Older dashboards sent pack details; without them the pack is named from the file.
    #[serde(default)]
    info: Option<PackInfo>,
    #[serde(default)]
    file_name: String,
    json: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Aurora {
    info: PackInfo,
    files: Vec<String>,
}

fn install_bundled_pack(db: &Connection, id: &str, json: &[u8]) -> Result<(), Error> {
    let installed: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM monster_packs_v1 WHERE id = ?1)",
        [id],
        |row| row.get(0),
    )?;
    if installed {
        return Ok(());
    }
    let pack = Pack::decode(json)?;
    if pack.info.id != id {
        return Err(format!("Bundled pack {id} has an invalid ID.").into());
    }
    let revision = Uuid::new_v4();
    let summary = serde_json::to_string(&Summary {
        info: pack.info.clone(),
        revision,
        count: pack.monsters.len(),
    })?;
    db.execute(
        "INSERT INTO monster_packs_v1 VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING",
        params![
            id,
            revision.to_string(),
            summary,
            serde_json::to_string(&pack)?
        ],
    )?;
    Ok(())
}

fn open(path: &FilePath) -> Result<Connection, Error> {
    let db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(5))?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS monster_packs_v1 (
            id TEXT PRIMARY KEY, revision TEXT NOT NULL, summary TEXT NOT NULL, pack TEXT NOT NULL
        );",
    )?;
    for (id, json) in BUNDLED_PACKS {
        install_bundled_pack(&db, id, json)?;
    }
    Ok(db)
}

fn store(db: &Connection, pack: &Pack, expected: Option<Uuid>) -> Result<Uuid, Error> {
    pack.validate()?;
    let revision = Uuid::new_v4();
    let packed = serde_json::to_string(pack)?;
    if packed.len() > PACK_LIMIT {
        return Err("Monster packs are limited to 16 MiB.".into());
    }
    let summary = serde_json::to_string(&Summary {
        info: pack.info.clone(),
        revision,
        count: pack.monsters.len(),
    })?;
    let id = &pack.info.id;
    let changes = match expected {
        Some(expected) => db.execute(
            "UPDATE monster_packs_v1 SET revision = ?2, summary = ?3, pack = ?4
             WHERE id = ?1 AND revision = ?5",
            params![
                id,
                revision.to_string(),
                summary,
                packed,
                expected.to_string()
            ],
        )?,
        None => db.execute(
            "INSERT INTO monster_packs_v1 VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING",
            params![id, revision.to_string(), summary, packed],
        )?,
    };
    if changes == 0 {
        return Err("This pack changed. Reopen the preview before replacing it.".into());
    }
    Ok(revision)
}

/// True for a JSON file in a 5etools data folder that can hold monsters. The folder also holds
/// lore (`fluff-*`), an index and other lists, which are passed over without a note.
fn bestiary_file(path: &FilePath) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let name = name.to_ascii_lowercase();
    name.ends_with(".json")
        && !name.starts_with("fluff")
        && !matches!(
            name.as_str(),
            "index.json" | "foundry.json" | "legendarygroups.json" | "template.json"
        )
}

fn collect(path: &FilePath, depth: usize, files: &mut Vec<std::path::PathBuf>) {
    if path.is_dir() {
        if depth == 0 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        let mut entries: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
        entries.sort();
        for entry in entries {
            collect(&entry, depth - 1, files);
        }
    } else if bestiary_file(path) {
        files.push(path.to_owned());
    }
}

/// Loads the bestiary files and folders the launcher lists into the DM's library, replacing
/// each book's earlier copy, and reports what happened for the dashboard to show.
pub(super) fn load_bestiary(path: &FilePath, sources: &[String]) -> Value {
    let mut files = vec![];
    let mut missing = vec![];
    for source in sources {
        let source = FilePath::new(source);
        if source.exists() {
            collect(source, 4, &mut files);
        } else {
            missing.push(source.display().to_string());
        }
    }
    files.sort();
    files.dedup();
    // A whole 5etools data folder also holds adventures and spell lists; its bestiary files
    // are the ones named bestiary-*.json.
    let named = |path: &std::path::PathBuf| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.to_ascii_lowercase().starts_with("bestiary"))
    };
    if files.iter().any(named) {
        files.retain(named);
    }
    let mut packs = vec![];
    let mut problems: Vec<String> = missing
        .into_iter()
        .map(|path| format!("{path} was not found."))
        .collect();
    let mut skipped = 0;
    let db = match open(path) {
        Ok(db) => db,
        Err(error) => return json!({"done":true,"packs":[],"problems":[error.to_string()]}),
    };
    for file in files {
        let name = file
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let result = (|| -> Result<Option<Value>, Error> {
            if std::fs::metadata(&file)?.len() > PACK_LIMIT as u64 {
                return Err("5etools files are limited to 16 MiB.".into());
            }
            let text = std::fs::read_to_string(&file)?;
            // Other 5etools lists (spells, items) have no monster list; pass them over.
            if !text.contains("\"monster\"") {
                return Ok(None);
            }
            let import = import_fivetools_file(&name, &text)?;
            let pack = import.pack;
            let existing: Option<(String, String)> = db
                .query_row(
                    "SELECT revision, pack FROM monster_packs_v1 WHERE id = ?1",
                    [&pack.info.id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let unchanged = existing.as_ref().is_some_and(|(_, stored)| {
                serde_json::to_string(&pack).ok().as_deref() == Some(stored)
            });
            if !unchanged {
                let expected = existing.map(|(revision, _)| revision.parse()).transpose()?;
                store(&db, &pack, expected)?;
            }
            Ok(Some(json!({
                "source": pack.info.source,
                "count": pack.monsters.len(),
                "skipped": import.warnings.len(),
            })))
        })();
        match result {
            Ok(Some(pack)) => packs.push(pack),
            Ok(None) => skipped += 1,
            Err(error) => problems.push(format!("{name}: {error}")),
        }
    }
    json!({"done":true,"packs":packs,"problems":problems,"other_files":skipped})
}

fn dispatch(path: &FilePath, action: &str, body: &[u8]) -> Result<Value, Error> {
    let db = open(path)?;
    match action {
        "list" => {
            let mut statement = db.prepare(
                "SELECT summary FROM monster_packs_v1 ORDER BY CASE id
                    WHEN ?1 THEN 0 WHEN ?2 THEN 1 ELSE 2 END, id",
            )?;
            let mut summaries = vec![];
            for row in statement.query_map([DEFAULT_PACK_ID, SRD_2024_PACK_ID], |row| {
                row.get::<_, String>(0)
            })? {
                summaries.push(serde_json::from_str::<Value>(&row?)?);
            }
            Ok(json!(summaries))
        }
        "get" => {
            let id: String = serde_json::from_slice(body)?;
            let (revision, pack): (String, String) = db
                .query_row(
                    "SELECT revision, pack FROM monster_packs_v1 WHERE id = ?1",
                    [id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?
                .ok_or("That pack is unavailable.")?;
            let pack: Pack = serde_json::from_str(&pack)?;
            Ok(json!({"revision":revision, "pack":pack}))
        }
        "validate" => {
            if body.len() > PACK_LIMIT {
                return Err("Monster packs are limited to 16 MiB.".into());
            }
            let pack = Pack::decode(body)?;
            let summary: Option<String> = db
                .query_row(
                    "SELECT summary FROM monster_packs_v1 WHERE id = ?1",
                    [&pack.info.id],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(summary
                .map(|value| serde_json::from_str(&value))
                .transpose()?
                .unwrap_or(Value::Null))
        }
        "aurora" => {
            let input: Aurora = serde_json::from_slice(body)?;
            let pack = import_monster_pack(input.info, &input.files)?;
            Ok(serde_json::to_value(pack)?)
        }
        "fivetools" => {
            let input: FiveTools = serde_json::from_slice(body)?;
            if input.json.len() > PACK_LIMIT {
                return Err("5etools files are limited to 16 MiB.".into());
            }
            let import = match input.info {
                Some(info) => import_fivetools_pack(info, &input.json)?,
                None => import_fivetools_file(&input.file_name, &input.json)?,
            };
            Ok(serde_json::to_value(import)?)
        }
        "save" => {
            let input: Save = serde_json::from_slice(body)?;
            let revision = store(&db, &input.pack, input.expected_revision)?;
            Ok(json!({"revision":revision}))
        }
        _ => Err("Monster library operation unavailable.".into()),
    }
}
