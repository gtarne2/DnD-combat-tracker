use super::*;
use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use std::{collections::HashMap, time::Instant};
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Join { invite: String, name: String },
    Resume,
    Poll { cursor: u64 },
    Leave,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Packet {
    version: u16,
    room: Uuid,
    command_id: Uuid,
    credential: Uuid,
    request: Request,
}

pub struct Host {
    pub service: RoomService,
    pub saved: Saved,
    pub vault: Vault,
    leases: HashMap<Uuid, Instant>,
}
pub type Shared = Arc<Mutex<Host>>;

impl Host {
    pub fn command(&mut self, who: Principal, id: Uuid, op: Operation) -> Result<(), PartyError> {
        self.service.execute(
            who,
            &Command {
                version: VERSION,
                room_id: self.saved.invite.room,
                command_id: id,
                command: op,
            },
        )?;
        Ok(())
    }
    pub fn expire_connections(&mut self) {
        let stale: Vec<_> = self
            .leases
            .iter()
            .filter(|(_, t)| t.elapsed() > Duration::from_secs(10))
            .map(|(id, _)| *id)
            .collect();
        for id in stale {
            let result = self.command(Principal::Paired(id), Uuid::new_v4(), Operation::Disconnect);
            if matches!(result, Ok(()) | Err(PartyError::Rejected(_))) {
                self.leases.remove(&id);
            }
        }
    }
}

fn message(err: PartyError) -> &'static str {
    match err {
        PartyError::Rejected(Rejection::Closed) => "Room closed",
        PartyError::Rejected(Rejection::Disconnected) => "Resume required",
        PartyError::Rejected(Rejection::Forbidden) => "Membership unavailable",
        PartyError::Rejected(_) => "Party request rejected",
        _ => "Room storage unavailable",
    }
}
type Failure = (StatusCode, &'static str);
async fn party(State(state): State<Shared>, Json(p): Json<Packet>) -> Result<Json<Value>, Failure> {
    let mut host = state.lock().await;
    if p.version != VERSION {
        return Err((StatusCode::BAD_REQUEST, "Incompatible party version"));
    }
    if p.room != host.saved.invite.room {
        return Err((StatusCode::NOT_FOUND, "Room unavailable"));
    }
    let digest = Sha256::digest(p.credential.as_bytes());
    let id = Uuid::from_slice(&digest[..16]).unwrap();
    let who = Principal::Paired(id);
    let failed = |e| (StatusCode::CONFLICT, message(e));
    if matches!(p.request, Request::Resume | Request::Leave) {
        // Authenticate before reserving command IDs or writing the journal.
        host.service.reconcile(who, p.room).map_err(failed)?;
    }
    match p.request {
        Request::Join { invite, name } => {
            if !host.saved.invites_open || invite != host.saved.invite.secret.to_string() {
                return Err((StatusCode::FORBIDDEN, "Invitation closed or replaced"));
            }
            host.command(who, p.command_id, Operation::Join { name })
                .map_err(failed)?;
        }
        Request::Resume => host
            .command(who, p.command_id, Operation::Resume)
            .map_err(failed)?,
        Request::Leave => {
            host.command(who, p.command_id, Operation::Leave)
                .map_err(failed)?;
            host.leases.remove(&id);
            return Ok(Json(json!({"left":true})));
        }
        Request::Poll { cursor } => {
            // Re-read the authorized projection after every wait. No database lock is held while idle.
            for attempt in 0..=8 {
                let view = host.service.poll(who, p.room, cursor).map_err(failed)?;
                host.leases.insert(id, Instant::now());
                if !view.events.is_empty() || attempt == 8 {
                    return Ok(Json(json!(view)));
                }
                drop(host);
                tokio::time::sleep(Duration::from_millis(250)).await;
                host = state.lock().await;
            }
        }
    }
    host.leases.insert(id, Instant::now());
    Ok(Json(json!({"ok":true})))
}

pub async fn start(
    mut saved: Saved,
    vault: Vault,
    mut service: RoomService,
    new: bool,
    bind: std::net::Ipv4Addr,
) -> Result<Shared, Error> {
    let listener = std::net::TcpListener::bind((bind, saved.invite.endpoint.port()))?;
    listener.set_nonblocking(true)?;
    saved.invite.endpoint = listener.local_addr()?;
    let tls = axum_server::tls_rustls::RustlsConfig::from_der(
        vec![saved.invite.der()?],
        B64.decode(saved.key.as_ref().ok_or("Missing host key")?)?,
    )
    .await?;
    // Save the host key and endpoint first. A crash between these two stores
    // replays the identical create command on the next explicit resume.
    if new {
        vault.save(&saved)?;
    }
    service.execute(
        Principal::LocalHost,
        &Command {
            version: VERSION,
            room_id: saved.invite.room,
            command_id: saved.join_id,
            command: Operation::Create {
                mode: if saved.role == "dm" {
                    HostMode::Dm
                } else {
                    HostMode::Party
                },
                name: saved.name.clone(),
            },
        },
    )?;
    if !new {
        service.execute(
            Principal::LocalHost,
            &Command {
                version: VERSION,
                room_id: saved.invite.room,
                command_id: Uuid::new_v4(),
                command: Operation::Resume,
            },
        )?;
    }
    vault.save(&saved)?;
    let host = Arc::new(Mutex::new(Host {
        service,
        saved,
        vault,
        leases: HashMap::new(),
    }));
    let app = Router::new()
        .route("/v1/party", post(party))
        .layer(axum::extract::DefaultBodyLimit::max(8192))
        .with_state(host.clone());
    let server = axum_server::from_tcp_rustls(listener, tls)?;
    tokio::spawn(async move {
        if server.serve(app.into_make_service()).await.is_err() {
            std::process::exit(1);
        }
    });
    let lease_host = host.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            lease_host.lock().await.expire_connections();
        }
    });
    Ok(host)
}

#[derive(Clone)]
pub struct Peer {
    client: reqwest::Client,
    url: String,
    saved: Saved,
}
impl Peer {
    pub fn new(saved: Saved) -> Result<Self, Error> {
        let endpoint = saved.invite.endpoint;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .tls_built_in_root_certs(false)
            .add_root_certificate(reqwest::Certificate::from_der(&saved.invite.der()?)?)
            .resolve("aurora-party.invalid", endpoint)
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(6))
            .build()?;
        Ok(Self {
            client,
            url: format!("https://aurora-party.invalid:{}/v1/party", endpoint.port()),
            saved,
        })
    }
    pub async fn call(&self, id: Uuid, request: Request) -> Result<Value, String> {
        let packet = Packet {
            version: VERSION,
            room: self.saved.invite.room,
            command_id: id,
            credential: self.saved.credential,
            request,
        };
        let response = self
            .client
            .post(&self.url)
            .json(&packet)
            .send()
            .await
            .map_err(|e| {
                let mut cause = std::error::Error::source(&e);
                while let Some(err) = cause {
                    if err.downcast_ref::<rustls::Error>().is_some()
                        || err.to_string().contains("certificate")
                    {
                        return "Host identity could not be verified".to_string();
                    }
                    cause = err.source();
                }
                "Host unreachable".to_string()
            })?;
        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(match text.as_str() {
                "Room closed"
                | "Room unavailable"
                | "Membership unavailable"
                | "Incompatible party version"
                | "Invitation closed or replaced"
                | "Resume required" => text,
                _ => "Party request failed".into(),
            });
        }
        response
            .json()
            .await
            .map_err(|_| "Invalid host response".into())
    }
}
