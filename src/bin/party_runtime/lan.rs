use super::*;
use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use std::{collections::HashMap, time::Instant};
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Join {
        invite: String,
        name: String,
    },
    Resume,
    Poll {
        cursor: u64,
    },
    Leave,
    Offer {
        command: OfferCommand,
    },
    Reconcile,
    Clock {
        after: u64,
    },
    Initiative {
        command: FightEdit,
    },
    Window {
        command: WindowCommand,
    },
    Publish {
        session: Uuid,
        revision: u64,
        publication: Publication,
    },
    Token {
        look: TokenLook,
    },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum WindowCommand {
    Check { window: WindowRef },
    Reply { window: WindowRef, reply: Reply },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum OfferCommand {
    RequestReversal {
        offer_id: Uuid,
    },
    EndGrant {
        grant_id: Uuid,
    },
    Send {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        action_id: Option<Uuid>,
        recipient: Uuid,
        source: String,
        effect: Effect,
    },
    Claim {
        offer_id: Uuid,
    },
    Accept {
        offer_id: Uuid,
    },
    Decline {
        offer_id: Uuid,
    },
    Withdraw {
        offer_id: Uuid,
    },
}

impl OfferCommand {
    pub fn operation(self, command_id: Uuid) -> Result<Operation, &'static str> {
        Ok(match self {
            Self::RequestReversal { offer_id } => Operation::RequestReversal { offer_id },
            Self::EndGrant { grant_id } => Operation::EndGrant { grant_id },
            Self::Send {
                action_id,
                recipient,
                source,
                effect,
            } => {
                if matches!(effect, Effect::Damage(_)) {
                    return Err("Damage offers are unavailable");
                }
                Operation::Send {
                    action_id: action_id.unwrap_or(command_id),
                    recipient,
                    source,
                    effect,
                }
            }
            Self::Claim { offer_id } => Operation::Claim { offer_id },
            Self::Accept { offer_id } => Operation::Accept { offer_id },
            Self::Decline { offer_id } => Operation::Decline { offer_id },
            Self::Withdraw { offer_id } => Operation::Withdraw { offer_id },
        })
    }
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
    pub fn command(
        &mut self,
        who: Principal,
        id: Uuid,
        op: Operation,
    ) -> Result<Receipt, PartyError> {
        self.service.execute(
            who,
            &Command {
                version: VERSION,
                room_id: self.saved.invite.room,
                command_id: id,
                command: op,
            },
        )
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
            if matches!(result, Ok(_) | Err(PartyError::Rejected(_))) {
                self.leases.remove(&id);
            }
        }
    }
}

fn message(err: PartyError) -> &'static str {
    match err {
        PartyError::Rejected(Rejection::Closed) => "Room closed",
        PartyError::Rejected(Rejection::RevisionConflict) => {
            "Initiative changed. Review the updated order."
        }
        PartyError::Rejected(Rejection::Disconnected) => "Resume required",
        PartyError::Rejected(Rejection::Forbidden) => "Membership unavailable",
        PartyError::Rejected(Rejection::StaleWindow) => "Window no longer open",
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
    if matches!(
        p.request,
        Request::Resume | Request::Leave | Request::Offer { .. }
    ) {
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
        Request::Resume => {
            host.command(who, p.command_id, Operation::Resume)
                .map_err(failed)?;
        }
        Request::Leave => {
            host.command(who, p.command_id, Operation::Leave)
                .map_err(failed)?;
            host.leases.remove(&id);
            return Ok(Json(json!({"left":true})));
        }
        Request::Poll { cursor } => {
            // Re-read the authorized projection after every wait. No database lock is held while idle.
            // Map reports (who is inside a template) are not events, so a changed view also
            // ends the wait. That keeps a dragged template's suggestion within a quarter second.
            let mut first = None;
            for attempt in 0..=8 {
                let view = host.service.poll(who, p.room, cursor).map_err(failed)?;
                host.leases.insert(id, Instant::now());
                let body = json!(view);
                let changed = first.as_ref().is_some_and(|seen| seen != &body);
                if !view.events.is_empty() || attempt == 8 || changed {
                    return Ok(Json(body));
                }
                first.get_or_insert(body);
                drop(host);
                tokio::time::sleep(Duration::from_millis(250)).await;
                host = state.lock().await;
            }
        }
        Request::Offer { command } => {
            let op = command
                .operation(p.command_id)
                .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
            return Ok(Json(json!(
                host.command(who, p.command_id, op).map_err(failed)?
            )));
        }
        Request::Publish {
            session,
            revision,
            publication,
        } => {
            host.service
                .publish_ordered(who, p.room, publication, Some((session, revision)))
                .map_err(failed)?;
        }
        Request::Token { look } => {
            host.service
                .set_token_look(who, p.room, look)
                .map_err(failed)?;
        }
        Request::Clock { after } => {
            return Ok(Json(json!(
                host.service
                    .clock_page(who, p.room, after)
                    .map_err(failed)?
            )));
        }
        Request::Initiative { command } => {
            host.service.reconcile(who, p.room).map_err(failed)?;
            return Ok(Json(json!(
                host.command(who, p.command_id, Operation::Initiative(command))
                    .map_err(failed)?
            )));
        }
        Request::Window { command } => {
            host.service.reconcile(who, p.room).map_err(failed)?;
            return Ok(Json(match command {
                WindowCommand::Check { window } => json!(
                    host.service
                        .check_window(who, p.room, window)
                        .map_err(failed)?
                ),
                WindowCommand::Reply { window, reply } => json!(
                    host.command(who, p.command_id, Operation::WindowReply { window, reply })
                        .map_err(failed)?
                ),
            }));
        }
        Request::Reconcile => {
            let offers = host.service.reconcile(who, p.room).map_err(failed)?;
            let self_id = host.service.member_id(who, p.room).map_err(failed)?;
            return Ok(Json(json!({"self_id":self_id,"offers":offers})));
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
    saved.invite.version = VERSION;
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
        let result = service.execute(
            Principal::LocalHost,
            &Command {
                version: VERSION,
                room_id: saved.invite.room,
                command_id: Uuid::new_v4(),
                command: Operation::Resume,
            },
        );
        if !matches!(result, Err(PartyError::Rejected(Rejection::Closed))) {
            result?;
        }
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
        .layer(axum::extract::DefaultBodyLimit::max(1024 * 1024))
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
                "Initiative changed. Review the updated order."
                | "Room closed"
                | "Room unavailable"
                | "Membership unavailable"
                | "Incompatible party version"
                | "Window no longer open"
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
