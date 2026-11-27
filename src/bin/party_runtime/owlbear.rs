//! Owlbear Rodeo bridge listener for the DM helper (stage O1).
//!
//! A second loopback listener, separate from the sheet capability, serves the bridge page
//! and a small token-gated API. See `aurora_combat_tracker::owlbear` for the reasoning and
//! the pairing rules. It never binds to a LAN address.
use aurora_combat_tracker::owlbear::{self, Pairing};
use aurora_combat_tracker::party::{InsideReport, Principal, RoomService};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    net::Ipv4Addr,
    sync::{Arc, Mutex},
    time::Instant,
};
use uuid::Uuid;

use super::{Error, lan};

#[derive(Clone)]
pub struct Link {
    pub port: u16,
    pairing: Arc<Mutex<Pairing>>,
    host: lan::Shared,
    room: Uuid,
}

impl Link {
    /// What the DM dashboard shows: the port, the current code and whether an extension is connected.
    pub fn status(&self) -> Value {
        let pairing = self.pairing.lock().unwrap();
        let now = Instant::now();
        json!({"port":self.port,"code":pairing.code(),"sessions":pairing.sessions(),
            "last_seen":pairing.last_seen(now)})
    }
    pub fn new_code(&self) -> Value {
        self.pairing.lock().unwrap().new_code();
        self.status()
    }
    pub fn disconnect(&self) -> Value {
        self.pairing.lock().unwrap().revoke_all();
        self.status()
    }
}

/// Bind the bridge on 127.0.0.1, preferring the well-known port, and serve it in the background.
pub async fn start(host: lan::Shared, room: Uuid) -> Result<Link, Error> {
    let listener =
        match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, owlbear::PREFERRED_PORT)).await {
            Ok(listener) => listener,
            Err(_) => tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?,
        };
    let link = Link {
        port: listener.local_addr()?.port(),
        pairing: Arc::new(Mutex::new(Pairing::new())),
        host,
        room,
    };
    let app = Router::new()
        .route("/obr/bridge", get(bridge))
        .route("/obr/api/{action}", post(api))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(link.clone());
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok(link)
}

fn hardened(mut response: Response) -> Response {
    for (key, value) in [
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        (
            "content-security-policy",
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        ),
    ] {
        response.headers_mut().insert(key, value.parse().unwrap());
    }
    response
}

fn header_text<'a>(headers: &'a HeaderMap, name: header::HeaderName) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn refuse(status: StatusCode, message: &str) -> Response {
    hardened((status, Json(json!({"error": message}))).into_response())
}

async fn bridge(State(link): State<Link>, headers: HeaderMap) -> Response {
    if !owlbear::host_allowed(header_text(&headers, header::HOST), link.port) {
        return refuse(StatusCode::FORBIDDEN, "Open the bridge at 127.0.0.1.");
    }
    hardened(
        (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            owlbear::bridge_page(),
        )
            .into_response(),
    )
}

#[derive(Deserialize)]
struct ApiRequest {
    #[serde(default)]
    token: String,
    #[serde(default)]
    code: String,
    #[serde(default)]
    reports: Vec<InsideReport>,
}

async fn api(
    State(link): State<Link>,
    Path(action): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !owlbear::host_allowed(header_text(&headers, header::HOST), link.port)
        || !owlbear::api_origin_allowed(header_text(&headers, header::ORIGIN), link.port)
    {
        return refuse(
            StatusCode::FORBIDDEN,
            "Requests must come from the bridge window.",
        );
    }
    let Ok(request) = serde_json::from_slice::<ApiRequest>(&body) else {
        return refuse(StatusCode::BAD_REQUEST, "Invalid request.");
    };
    let now = Instant::now();
    if action == "pair" {
        let result = link.pairing.lock().unwrap().pair(&request.code, now);
        return match result {
            Ok(token) => {
                hardened(Json(json!({"token": token, "room_id": link.room})).into_response())
            }
            Err(error) => refuse(StatusCode::UNAUTHORIZED, &error.to_string()),
        };
    }
    if !link.pairing.lock().unwrap().check(&request.token, now) {
        return refuse(
            StatusCode::UNAUTHORIZED,
            "Not paired. Enter the code from the DM dashboard.",
        );
    }
    let mut host = link.host.lock().await;
    let result = match action.as_str() {
        "status" => Ok(json!({"room_id": link.room, "role": "dm", "paired": true})),
        "table" => table(&host.service, link.room),
        "inside" => host
            .service
            .report_inside(Principal::LocalHost, link.room, request.reports)
            .map(|()| json!({"ok": true}))
            .map_err(Error::from),
        _ => return refuse(StatusCode::NOT_FOUND, "Unknown request."),
    };
    match result {
        Ok(value) => hardened(Json(value).into_response()),
        Err(error) => refuse(StatusCode::CONFLICT, &error.to_string()),
    }
}

fn table(service: &RoomService, room: Uuid) -> Result<Value, Error> {
    Ok(service.table_view(Principal::LocalHost, room)?)
}
