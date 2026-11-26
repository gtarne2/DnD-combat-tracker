mod lan;
mod monster_library;
mod vault;
use aurora_combat_tracker::party::initiative::FightEdit;
use aurora_combat_tracker::party::{PartyError, Principal, RoomService, wire::*};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, Write},
    net::{Ipv4Addr, SocketAddr},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use uuid::Uuid;
use vault::Vault;
type Error = Box<dyn std::error::Error + Send + Sync>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Invite {
    version: u16,
    room: Uuid,
    endpoint: SocketAddr,
    secret: Uuid,
    certificate: String,
    fingerprint: String,
}
impl Invite {
    fn der(&self) -> Result<Vec<u8>, Error> {
        let der = B64.decode(&self.certificate)?;
        if B64.encode(Sha256::digest(&der)) != self.fingerprint {
            return Err("Host identity changed".into());
        }
        Ok(der)
    }
    fn encode(&self) -> String {
        format!(
            "aurora-party.{}",
            B64.encode(serde_json::to_vec(self).unwrap())
        )
    }
    fn decode(text: &str) -> Result<Self, Error> {
        if text.len() > 8192 {
            return Err("Invalid invitation".into());
        }
        let bytes = B64.decode(
            text.trim()
                .strip_prefix("aurora-party.")
                .ok_or("Invalid invitation")?,
        )?;
        let invite: Self = serde_json::from_slice(&bytes)?;
        if invite.version != VERSION {
            return Err("Incompatible party version".into());
        }
        invite.der()?;
        Ok(invite)
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    role: String,
    name: String,
    invite: Invite,
    key: Option<String>,
    credential: Uuid,
    join_id: Uuid,
    invites_open: bool,
}
#[derive(Deserialize)]
struct Launch {
    mode: String,
    profile: String,
    name: String,
    #[serde(default)]
    invite: String,
    bind: Option<Ipv4Addr>,
}
#[derive(Clone)]
enum Side {
    Host(lan::Shared),
    Guest(Arc<lan::Peer>),
}
#[derive(Clone)]
struct Local {
    cap: String,
    side: Side,
    status: Arc<tokio::sync::Mutex<Value>>,
    room: Uuid,
    binding: Uuid,
    monster_library: Option<std::path::PathBuf>,
    vault: Vault,
    detached: Arc<AtomicBool>,
    publication_revision: Arc<AtomicU64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalOffer {
    room_id: Uuid,
    command_id: Uuid,
    command: lan::OfferCommand,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalInitiative {
    room_id: Uuid,
    command_id: Uuid,
    command: FightEdit,
}

async fn local(
    State(s): State<Local>,
    Path((cap, action)): Path<(String, String)>,
    headers: HeaderMap,
    method: axum::http::Method,
    body: Bytes,
) -> Response {
    if cap != s.cap || headers.get("origin").and_then(|v| v.to_str().ok()) != Some("null") {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = if method == axum::http::Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        match local_action(&s, &action, &body).await {
            Ok(value) => Json(value).into_response(),
            Err(error) => (StatusCode::CONFLICT, error.to_string()).into_response(),
        }
    };
    local_headers(&mut response);
    response
}

fn local_headers(response: &mut Response) {
    for (key, value) in [
        ("access-control-allow-origin", "null"),
        ("access-control-allow-methods", "POST, OPTIONS"),
        ("access-control-allow-headers", "content-type"),
        ("access-control-allow-private-network", "true"),
        ("cache-control", "no-store"),
    ] {
        response.headers_mut().insert(key, value.parse().unwrap());
    }
}

async fn local_action(s: &Local, action: &str, body: &[u8]) -> Result<Value, Error> {
    let mut status = s.status.lock().await;
    if action == "detach" {
        s.detached.store(true, Ordering::Relaxed);
        return Ok(json!({"detached":true}));
    }
    if s.detached.load(Ordering::Relaxed) {
        return if action == "state" {
            Ok(json!({"state":"Party detached. Resume from the launcher.","ended":true}))
        } else {
            Err("Resume the party from the launcher".into())
        };
    }
    if action == "clock" {
        let after: u64 = serde_json::from_slice(body)?;
        return match &s.side {
            Side::Guest(peer) => Ok(peer
                .call(Uuid::new_v4(), lan::Request::Clock { after })
                .await?),
            Side::Host(_) => Err("Player operation unavailable".into()),
        };
    }
    if action == "initiative" {
        let edit: LocalInitiative = serde_json::from_slice(body)?;
        if edit.room_id != s.room {
            return Err("Party room changed".into());
        }
        return match &s.side {
            Side::Guest(peer) => Ok(peer
                .call(
                    edit.command_id,
                    lan::Request::Initiative {
                        command: edit.command,
                    },
                )
                .await?),
            Side::Host(host) => Ok(json!(host.lock().await.command(
                Principal::LocalHost,
                edit.command_id,
                Operation::Initiative(edit.command)
            )?)),
        };
    }
    if action == "offer" {
        let offer: LocalOffer = serde_json::from_slice(body)?;
        if offer.room_id != s.room {
            return Err("Party room changed".into());
        }
        return match &s.side {
            Side::Guest(peer) => Ok(peer
                .call(
                    offer.command_id,
                    lan::Request::Offer {
                        command: offer.command,
                    },
                )
                .await?),
            Side::Host(host) => {
                let op = offer.command.operation(offer.command_id)?;
                Ok(json!(host.lock().await.command(
                    Principal::LocalHost,
                    offer.command_id,
                    op
                )?))
            }
        };
    }
    if status["ended"] == true {
        if action == "state" {
            let mut view = status.clone();
            if let Side::Guest(peer) = &s.side {
                let reconciliation = peer.call(Uuid::new_v4(), lan::Request::Reconcile).await?;
                view["offers"] = reconciliation["offers"].clone();
                view["self_id"] = reconciliation["self_id"].clone();
            }
            return Ok(view);
        }
        return Err("Membership ended".into());
    }
    match &s.side {
        Side::Guest(peer) => match action {
            "state" => return Ok(status.clone()),
            "publish" => {
                let session = serde_json::from_value(status["publication_session"].clone())
                    .map_err(|_| "Connect to a DM room before sharing")?;
                let publication =
                    serde_json::from_slice(body).map_err(|_| "Invalid character publication")?;
                let revision = s.publication_revision.fetch_add(1, Ordering::Relaxed) + 1;
                return Ok(peer
                    .call(
                        Uuid::new_v4(),
                        lan::Request::Publish {
                            session,
                            revision,
                            publication,
                        },
                    )
                    .await?);
            }
            "leave" => {
                peer.call(Uuid::new_v4(), lan::Request::Leave).await?;
            }
            _ => return Err("Player operation unavailable".into()),
        },
        Side::Host(host) => {
            let mut h = host.lock().await;
            match action {
                "state" => {
                    let view = match h.service.poll(Principal::LocalHost, s.room, 0) {
                        Ok(view) => view,
                        Err(PartyError::Rejected(Rejection::Closed)) => {
                            return Ok(json!({
                                "state":"Room closed","ended":true,"role":h.saved.role,"room_id":s.room,
                                "self_id":h.service.member_id(Principal::LocalHost,s.room)?,
                                "offers":h.service.reconcile(Principal::LocalHost,s.room)?
                            }));
                        }
                        Err(err) => return Err(err.into()),
                    };
                    return Ok(
                        json!({"role":h.saved.role,"state":"Hosting","members":view.members,"self_id":view.self_id,"open":h.saved.invites_open,"room_id":s.room,"combat":view.combat,"offers":view.offers}),
                    );
                }
                "invite" if h.saved.invites_open => {
                    return Ok(json!({"invite":h.saved.invite.encode()}));
                }
                "rotate" | "seal" => {
                    let mut next = h.saved.clone();
                    next.invites_open = action == "rotate";
                    next.invite.secret = Uuid::new_v4();
                    h.vault.save(&next)?;
                    h.saved = next;
                    return Ok(json!({"ok":true}));
                }
                "end" => {
                    h.command(Principal::LocalHost, Uuid::new_v4(), Operation::Close)?;
                }
                _ => return Err("Host operation unavailable".into()),
            }
        }
    }
    if action == "leave" {
        *status = json!({"state":"Left party","ended":true,"room_id":s.room});
        s.vault.retire(s.room, s.binding)?;
    }
    Ok(status.clone())
}

async fn guest(
    saved: Saved,
    vault: &Vault,
    new: bool,
    status: Arc<tokio::sync::Mutex<Value>>,
) -> Result<Side, Error> {
    let peer = Arc::new(lan::Peer::new(saved.clone())?);
    // Persist the identity before admission so a lost first acknowledgment is retryable.
    if new {
        vault.pending(&saved)?;
        peer.call(
            saved.join_id,
            lan::Request::Join {
                invite: saved.invite.secret.to_string(),
                name: saved.name.clone(),
            },
        )
        .await?;
    } else if let Err(e) = peer.call(Uuid::new_v4(), lan::Request::Resume).await {
        if e == "Room closed" {
            *status.lock().await = json!({"state":e,"ended":true,"room_id":saved.invite.room});
            return Ok(Side::Guest(peer));
        }
        if e != "Membership unavailable" {
            return Err(e.into());
        }
        peer.call(
            saved.join_id,
            lan::Request::Join {
                invite: saved.invite.secret.to_string(),
                name: saved.name.clone(),
            },
        )
        .await?;
    }
    vault.save(&saved)?;
    let binding_vault = vault.clone();
    let client = peer.clone();
    tokio::spawn(async move {
        let mut cursor = 0;
        loop {
            let result = client
                .call(Uuid::new_v4(), lan::Request::Poll { cursor })
                .await
                .and_then(|value| {
                    let view: RoomView = serde_json::from_value(value)
                        .map_err(|_| "Invalid room projection".to_owned())?;
                    if view.version != VERSION || view.room_id != saved.invite.room {
                        return Err("Incompatible room projection".to_owned());
                    }
                    Ok(view)
                });
            let mut state = status.lock().await;
            if state["ended"] == true {
                return;
            }
            match result {
                Ok(view) => {
                    cursor = view.cursor;
                    let members: Vec<_> = view.members.into_iter().map(|member| json!({
                        "member_id": member.member_id, "name": member.name, "online": member.online
                    })).collect();
                    *state = json!({"role":"guest","state":"Joined","members":members,"self_id":view.self_id,"dm_id":view.dm_id,"publication_session":view.publication_session,"combat":view.combat,"room_id":view.room_id,"offers":view.offers});
                }
                Err(e) => {
                    if e == "Room closed" || e == "Membership unavailable" {
                        if e != "Room closed" {
                            let _ = binding_vault.retire(saved.invite.room, saved.join_id);
                        }
                        *state = json!({"state":e,"ended":true,"room_id":saved.invite.room,"self_id":state["self_id"]});
                        return;
                    }
                    *state = json!({"state":format!("Reconnecting · {e}"),"role":"guest"});
                    drop(state);
                    if e == "Resume required" {
                        let _ = client.call(Uuid::new_v4(), lan::Request::Resume).await;
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        }
    });
    Ok(Side::Guest(peer))
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
pub async fn serve() -> Result<(), Error> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line)?;
    let cfg: Launch = serde_json::from_str(&line)?;
    if cfg.mode != "resume"
        && (cfg.name.trim().is_empty()
            || cfg.name.chars().count() > 120
            || cfg.name.chars().any(char::is_control))
    {
        return Err("Enter a display name of 1 to 120 characters".into());
    }
    let directory =
        std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("Missing app data")?)
            .join("Aurora Combat Tracker");
    std::fs::create_dir_all(&directory)?;
    let vault = Vault::new(&directory, cfg.profile)?;
    let (saved, new) = match cfg.mode.as_str() {
        "resume" => (
            vault
                .load(None)?
                .ok_or("No saved party for this character")?,
            false,
        ),
        "join" => {
            let invite = Invite::decode(&cfg.invite)?;
            if let Some(mut old) = vault.load(Some(invite.room))? {
                if old.invite.fingerprint != invite.fingerprint {
                    return Err("Host identity changed".into());
                }
                if old.key.is_some() {
                    return Err("This profile owns the room".into());
                }
                old.invite = invite;
                (old, false)
            } else {
                (
                    Saved {
                        role: "guest".into(),
                        name: cfg.name,
                        key: None,
                        invite,
                        credential: Uuid::new_v4(),
                        join_id: Uuid::new_v4(),
                        invites_open: false,
                    },
                    true,
                )
            }
        }
        "host" | "dm" => {
            let bind = cfg.bind.ok_or("Select a network adapter")?;
            let pair = rcgen::generate_simple_self_signed(vec!["aurora-party.invalid".into()])?;
            let cert = pair.cert.der();
            let invite = Invite {
                version: VERSION,
                room: Uuid::new_v4(),
                endpoint: (bind, 0).into(),
                secret: Uuid::new_v4(),
                certificate: B64.encode(cert),
                fingerprint: B64.encode(Sha256::digest(cert)),
            };
            (
                Saved {
                    role: cfg.mode,
                    name: cfg.name,
                    invite,
                    key: Some(B64.encode(pair.key_pair.serialize_der())),
                    credential: Uuid::new_v4(),
                    join_id: Uuid::new_v4(),
                    invites_open: true,
                },
                true,
            )
        }
        _ => return Err("Unknown party mode".into()),
    };
    let room = saved.invite.room;
    let binding = saved.join_id;
    let role = saved.role.clone();
    let status = Arc::new(tokio::sync::Mutex::new(
        json!({"role":role,"state":"Connecting"}),
    ));
    let side = if saved.key.is_some() {
        let SocketAddr::V4(endpoint) = saved.invite.endpoint else {
            return Err("Select an IPv4 adapter".into());
        };
        let bind = cfg.bind.unwrap_or(*endpoint.ip());
        if bind.is_unspecified() || bind.is_multicast() {
            return Err("Select one adapter address".into());
        }
        Side::Host(
            lan::start(
                saved,
                vault.clone(),
                RoomService::open(directory.join("party.sqlite3"))?,
                new,
                bind,
            )
            .await?,
        )
    } else {
        guest(saved, &vault, new, status.clone()).await?
    };
    let cap = Uuid::new_v4().to_string();
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let url = format!("http://{}/{cap}", listener.local_addr()?);
    let app = Router::new()
        .route("/{cap}/{action}", post(local).options(local))
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
        .merge(monster_library::routes())
        .with_state(Local {
            cap,
            side,
            status,
            room,
            binding,
            monster_library: (role == "dm").then(|| directory.join("monster-library.sqlite3")),
            vault,
            detached: Arc::new(AtomicBool::new(false)),
            publication_revision: Arc::new(AtomicU64::new(0)),
        });
    println!("{}", json!({"url":url,"role":role}));
    std::io::stdout().flush()?;
    // A closed launcher pipe (including a launcher crash) releases both listeners.
    std::thread::spawn(|| {
        let mut stop = String::new();
        let _ = std::io::stdin().read_line(&mut stop);
        std::process::exit(0);
    });
    axum::serve(listener, app).await?;
    Ok(())
}
