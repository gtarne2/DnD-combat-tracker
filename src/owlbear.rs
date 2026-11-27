//! Owlbear Rodeo link (stage O1): pairing and request checks for the DM helper's bridge.
//!
//! Chrome blocks an Owlbear extension iframe from calling loopback directly (Owlbear does
//! not delegate `loopback-network`). The DM helper therefore serves a small bridge page on
//! `127.0.0.1`, which the extension opens as a pop-up window and talks to with
//! `postMessage`. The page makes same-origin requests to the helper. This module holds the
//! transport-independent parts: one-time pairing codes, session tokens, and the origin and
//! host checks, so they can be tested without the Windows runtime.

use std::time::{Duration, Instant};
use uuid::Uuid;

/// Preferred loopback port for the bridge. The helper falls back to an ephemeral port when
/// it is taken, and the dashboard then shows the port to enter in the extension.
pub const PREFERRED_PORT: u16 = 47831;

/// Extension origins the bridge page will talk to. The extension is published only to this
/// repository's GitHub Pages site (`.github/workflows/owlbear-pages.yml`).
pub const EXTENSION_ORIGINS: &[&str] = &["https://gtarne2.github.io"];

/// Wrong codes allowed before the code is replaced.
pub const MAX_FAILED_ATTEMPTS: u8 = 5;
/// A session that has not been used for this long must pair again.
pub const SESSION_IDLE: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_SESSIONS: usize = 4;
// No 0/O, 1/I/L, so a code read aloud or copied by hand is unambiguous.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairError {
    /// The code was wrong. `remaining` more attempts are allowed on this code.
    WrongCode { remaining: u8 },
    /// Too many wrong codes: the code was replaced and the DM must read the new one.
    CodeReplaced,
}

impl std::fmt::Display for PairError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrongCode { remaining } => write!(
                f,
                "That code is not right. Check the DM dashboard ({remaining} tries left)."
            ),
            Self::CodeReplaced => write!(
                f,
                "Too many wrong codes. The dashboard now shows a new code."
            ),
        }
    }
}

impl std::error::Error for PairError {}

struct Session {
    token: String,
    last_seen: Instant,
}

/// One-time pairing codes and the session tokens they produce. One instance lives in the
/// DM helper for the life of the process, so restarting the helper requires pairing again.
pub struct Pairing {
    code: String,
    failures: u8,
    sessions: Vec<Session>,
}

impl Default for Pairing {
    fn default() -> Self {
        Self::new()
    }
}

impl Pairing {
    pub fn new() -> Self {
        Self {
            code: new_code(),
            failures: 0,
            sessions: Vec::new(),
        }
    }

    /// The code the DM dashboard shows.
    pub fn code(&self) -> &str {
        &self.code
    }

    /// Replace the code, for example when the DM asks for a new one.
    pub fn new_code(&mut self) {
        self.code = new_code();
        self.failures = 0;
    }

    /// Exchange the dashboard code for a session token. A correct code is used up.
    pub fn pair(&mut self, code: &str, now: Instant) -> Result<String, PairError> {
        let typed: String = code
            .chars()
            .filter(|c| !c.is_whitespace() && *c != '-')
            .flat_map(char::to_uppercase)
            .collect();
        if !same(typed.as_bytes(), self.code.as_bytes()) {
            self.failures += 1;
            if self.failures >= MAX_FAILED_ATTEMPTS {
                self.new_code();
                return Err(PairError::CodeReplaced);
            }
            return Err(PairError::WrongCode {
                remaining: MAX_FAILED_ATTEMPTS - self.failures,
            });
        }
        self.new_code();
        self.expire(now);
        if self.sessions.len() >= MAX_SESSIONS {
            self.sessions.sort_by_key(|s| s.last_seen);
            self.sessions.remove(0);
        }
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        self.sessions.push(Session {
            token: token.clone(),
            last_seen: now,
        });
        Ok(token)
    }

    /// True when the token belongs to a live session. A valid check renews the session.
    pub fn check(&mut self, token: &str, now: Instant) -> bool {
        self.expire(now);
        match self
            .sessions
            .iter_mut()
            .find(|s| same(s.token.as_bytes(), token.as_bytes()))
        {
            Some(session) => {
                session.last_seen = now;
                true
            }
            None => false,
        }
    }

    /// Sign every extension out, for the dashboard's Disconnect button.
    pub fn revoke_all(&mut self) {
        self.sessions.clear();
    }

    /// Seconds since the most recent request from any paired extension.
    pub fn last_seen(&self, now: Instant) -> Option<u64> {
        self.sessions
            .iter()
            .map(|s| now.saturating_duration_since(s.last_seen).as_secs())
            .min()
    }

    pub fn sessions(&self) -> usize {
        self.sessions.len()
    }

    fn expire(&mut self, now: Instant) {
        self.sessions
            .retain(|s| now.saturating_duration_since(s.last_seen) < SESSION_IDLE);
    }
}

fn new_code() -> String {
    let bytes = Uuid::new_v4().into_bytes();
    // 16 random bytes; v4 fixes a few bits in bytes 6 and 8, so read from the others.
    [0usize, 1, 2, 3, 4, 5]
        .iter()
        .take(CODE_LENGTH)
        .map(|&i| {
            CODE_ALPHABET[usize::from(bytes[i] ^ bytes[i + 10]) % CODE_ALPHABET.len()] as char
        })
        .collect()
}

/// Length-independent comparison that does not stop at the first difference.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The `Host` header must name the loopback address and port the helper listens on.
/// This defeats DNS rebinding, where a hostile name resolves to 127.0.0.1.
pub fn host_allowed(host: Option<&str>, port: u16) -> bool {
    host.is_some_and(|h| h == format!("127.0.0.1:{port}"))
}

/// API requests must come from the bridge page itself, which is same-origin with the helper.
pub fn api_origin_allowed(origin: Option<&str>, port: u16) -> bool {
    origin.is_some_and(|o| o == format!("http://127.0.0.1:{port}"))
}

/// Paths the bridge page may forward. Everything else is refused by the page and the helper.
/// `inside` is the only write: the DM's extension reports which rows each template covers.
pub const BRIDGE_ACTIONS: &[&str] = &["pair", "status", "table", "inside"];

/// The bridge page with its origin allowlist filled in.
pub fn bridge_page() -> String {
    let origins = serde_json::to_string(EXTENSION_ORIGINS).unwrap();
    let actions = serde_json::to_string(BRIDGE_ACTIONS).unwrap();
    include_str!("owlbear-bridge.html")
        .replace("\"__ORIGINS__\"", &origins)
        .replace("\"__ACTIONS__\"", &actions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_use_the_unambiguous_alphabet() {
        for _ in 0..200 {
            let pairing = Pairing::new();
            assert_eq!(pairing.code().len(), CODE_LENGTH);
            assert!(pairing.code().bytes().all(|b| CODE_ALPHABET.contains(&b)));
        }
    }
}
