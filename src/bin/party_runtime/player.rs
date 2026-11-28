//! The player launcher for computers without the Windows launcher (the macOS app bundle).
//!
//! It does what `TrackerLauncher.cs` and `RefreshBridge.cs` do for a player on Windows: pick an
//! Aurora save and content, join (or rejoin) a party with an invitation, write the sheet with
//! the party and refresh URLs, open it in the browser, and keep the loopback services running
//! while the sheet checks in. Hosting a room stays on the Windows launcher.

use super::{Error, Launch, vault::Vault};
use aurora_combat_tracker::preview;
use axum::{
    Router,
    body::Bytes,
    extract::{Path as UrlPath, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{BufRead, Write},
    net::Ipv4Addr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use uuid::Uuid;

/// The sheet checks in every 30 seconds. With no check-in for this long, the service exits.
const IDLE: Duration = Duration::from_secs(5 * 60);
const SETTINGS: &str = "player-launcher.txt";
const SERVICE_PID: &str = "player-service.pid";
const SERVICE_LOG: &str = "player-service.log";

#[derive(Serialize, Deserialize)]
enum Plan {
    Solo,
    Join { name: String, invite: String },
    Resume,
}

#[derive(Serialize, Deserialize)]
struct Service {
    save: PathBuf,
    sources: Vec<PathBuf>,
    profile: String,
    plan: Plan,
}

/// `aurora-party player` asks with dialogs, then hands the party and refresh services to a
/// background copy of itself and exits. The app can then be opened again at any time (macOS
/// only activates an app that is still running), and opening it again replaces the old service.
/// `aurora-party player --service` is that background copy: it reads its job from stdin.
pub fn run(service: bool) -> Result<(), Error> {
    let directory = crate::app_data()?;
    if service {
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        let job: Service = serde_json::from_str(&line)?;
        let _ = fs::write(directory.join(SERVICE_PID), std::process::id().to_string());
        return tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()?
            .block_on(open(directory, job));
    }
    let Some((save, sources)) = choose_files(&directory)? else {
        return Ok(());
    };
    let profile = format!("sheet:{}", fs::canonicalize(&save)?.display());
    let saved = Vault::new(&directory, profile.clone())?.load(None)?;
    let Some(plan) = choose_plan(&save, saved.is_some())? else {
        return Ok(());
    };
    stop_previous(&directory);
    let log = directory.join(SERVICE_LOG);
    let mut child = std::process::Command::new(std::env::current_exe()?)
        .args(["player", "--service"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(fs::File::create(&log)?)
        .spawn()?;
    let job = Service {
        save,
        sources,
        profile,
        plan,
    };
    let mut input = child
        .stdin
        .take()
        .ok_or("Could not start the party service")?;
    writeln!(input, "{}", serde_json::to_string(&job)?)?;
    drop(input);
    let mut ready = String::new();
    std::io::BufReader::new(
        child
            .stdout
            .take()
            .ok_or("Could not start the party service")?,
    )
    .read_line(&mut ready)?;
    let Ok(ready) = serde_json::from_str::<Value>(&ready) else {
        let _ = child.wait();
        let reason = fs::read_to_string(&log).unwrap_or_default();
        let reason = reason.trim();
        return Err(if reason.is_empty() {
            "The party service stopped without a reason".into()
        } else {
            reason.into()
        });
    };
    let sheet = PathBuf::from(
        ready["sheet"]
            .as_str()
            .ok_or("The party service gave no sheet")?,
    );
    println!("{ready}");
    open_browser(&sheet);
    Ok(())
}

/// Ends a service left by an earlier launch, so one sheet and one party binding stay live.
fn stop_previous(directory: &Path) {
    let file = directory.join(SERVICE_PID);
    if let Some(pid) = fs::read_to_string(&file)
        .ok()
        .and_then(|text| text.trim().parse::<u32>().ok())
    {
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .arg(pid.to_string())
                .stderr(Stdio::null())
                .status();
            std::thread::sleep(Duration::from_millis(300));
        }
        #[cfg(not(unix))]
        let _ = pid;
    }
    let _ = fs::remove_file(file);
}

async fn open(directory: PathBuf, job: Service) -> Result<(), Error> {
    let Service {
        save,
        sources,
        profile,
        plan,
    } = job;
    let party_url = match plan {
        Plan::Solo => None,
        Plan::Join { name, invite } => Some(join("join", profile, name, invite).await?),
        Plan::Resume => Some(join("resume", profile, String::new(), String::new()).await?),
    };
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let token = Uuid::new_v4().simple().to_string();
    let bridge = Arc::new(Bridge {
        url: format!("http://{}/{token}", listener.local_addr()?),
        token,
        save,
        sources,
        previews: directory.join("Previews"),
        party_url,
        state: Mutex::new(BridgeState {
            preview: None,
            pending: None,
            seen: Instant::now(),
        }),
    });
    let first = bridge.clone();
    let revision =
        tokio::task::spawn_blocking(move || first.stage().map(|(revision, _)| revision)).await??;
    let sheet = bridge.apply(&revision)?;
    let app = Router::new()
        .route("/{token}/{*action}", post(refresh).options(refresh))
        .with_state(bridge.clone());
    tokio::spawn(async move { axum::serve(listener, app).await });
    // The launcher reads this one line and exits; nothing else is written to stdout.
    println!("{}", serde_json::json!({"sheet": sheet}));
    std::io::stdout().flush()?;
    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;
        if bridge.state.lock().unwrap().seen.elapsed() >= IDLE {
            let pid = directory.join(SERVICE_PID);
            if fs::read_to_string(&pid).is_ok_and(|p| p.trim() == std::process::id().to_string()) {
                let _ = fs::remove_file(pid);
            }
            return Ok(());
        }
    }
}

/// Starts the party binding in this process and returns the sheet's party URL.
async fn join(mode: &str, profile: String, name: String, invite: String) -> Result<String, Error> {
    let (ready, server) = super::start(Launch {
        mode: mode.into(),
        profile,
        name,
        invite,
        bind: None,
        bestiary: Vec::new(),
    })
    .await?;
    tokio::spawn(server);
    Ok(ready["url"]
        .as_str()
        .ok_or("Party helper gave no URL")?
        .into())
}

struct Bridge {
    token: String,
    url: String,
    save: PathBuf,
    sources: Vec<PathBuf>,
    previews: PathBuf,
    party_url: Option<String>,
    state: Mutex<BridgeState>,
}

struct BridgeState {
    preview: Option<PathBuf>,
    pending: Option<(String, String)>,
    seen: Instant,
}

impl Bridge {
    /// Imports the save again and holds the sheet until the browser applies its revision.
    fn stage(&self) -> Result<(String, String), Error> {
        let built = preview::render(&self.save, &self.sources).map_err(|e| e.to_string())?;
        let revision = Uuid::new_v4().simple().to_string();
        let party = self
            .party_url
            .as_deref()
            .map(|url| format!("data-party-url=\"{}\" ", attribute(url)))
            .unwrap_or_default();
        let html = built.html.replacen(
            "<body data-profile=",
            &format!(
                "<body {party}data-refresh-url=\"{}\" data-refresh-revision=\"{revision}\" data-profile=",
                attribute(&self.url)
            ),
            1,
        );
        let destination = self.previews.join(format!("{}.html", built.profile));
        let mut state = self.state.lock().unwrap();
        if state.preview.as_ref().is_some_and(|p| p != &destination) {
            return Err("The Aurora save resolved to a different tracker session.".into());
        }
        state.preview = Some(destination);
        state.pending = Some((revision.clone(), html.clone()));
        state.seen = Instant::now();
        Ok((revision, html))
    }

    /// Writes the staged sheet over the open one and returns its path.
    fn apply(&self, revision: &str) -> Result<PathBuf, Error> {
        let mut state = self.state.lock().unwrap();
        let current = matches!(&state.pending, Some((staged, _)) if staged == revision);
        let (Some(preview), true) = (state.preview.clone(), current) else {
            return Err("This import preview is no longer current. Refresh again.".into());
        };
        let (_, html) = state.pending.take().unwrap();
        fs::create_dir_all(&self.previews)?;
        let temporary = self.previews.join(format!(".refresh-{revision}.tmp"));
        fs::write(&temporary, html)?;
        if let Err(error) = fs::rename(&temporary, &preview) {
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
        state.seen = Instant::now();
        Ok(preview)
    }
}

/// The file sheet's refresh and check-in calls, as `RefreshBridge.Handle` serves them.
async fn refresh(
    State(bridge): State<Arc<Bridge>>,
    UrlPath((token, action)): UrlPath<(String, String)>,
    headers: HeaderMap,
    method: axum::http::Method,
    _body: Bytes,
) -> Response {
    let origin = headers.get("origin").map(|v| v.to_str().unwrap_or(""));
    if token != bridge.token || origin.is_some_and(|o| o != "null") {
        return StatusCode::FORBIDDEN.into_response();
    }
    bridge.state.lock().unwrap().seen = Instant::now();
    let result: Result<String, Error> = if method == axum::http::Method::OPTIONS {
        Ok(String::new())
    } else if action == "heartbeat" {
        Ok(String::new())
    } else if action == "stage" {
        let staging = bridge.clone();
        match tokio::task::spawn_blocking(move || staging.stage()).await {
            Ok(staged) => staged.map(|(_, html)| html),
            Err(error) => Err(error.into()),
        }
    } else if let Some(revision) = action.strip_prefix("apply/") {
        bridge.apply(revision).map(|_| String::new())
    } else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let (status, body) = match result {
        Ok(body) if method == axum::http::Method::OPTIONS => (StatusCode::NO_CONTENT, body),
        Ok(body) => (StatusCode::OK, body),
        Err(error) => (StatusCode::BAD_REQUEST, error.to_string()),
    };
    let mut response = (status, body).into_response();
    for (key, value) in [
        ("content-type", "text/plain; charset=utf-8"),
        ("cache-control", "no-store"),
        ("access-control-allow-origin", "null"),
        ("access-control-allow-methods", "POST, OPTIONS"),
        ("access-control-allow-private-network", "true"),
    ] {
        response.headers_mut().insert(key, value.parse().unwrap());
    }
    response
}

fn attribute(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The save and content sources, remembered between launches like the Windows launcher's list.
fn choose_files(directory: &Path) -> Result<Option<(PathBuf, Vec<PathBuf>)>, Error> {
    let settings = directory.join(SETTINGS);
    let remembered: Vec<PathBuf> = fs::read_to_string(&settings)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect();
    if let Some((save, sources)) = remembered.split_first().filter(|(save, _)| save.is_file()) {
        let content = match sources.len() {
            0 => "No content files".to_string(),
            1 => format!("Content: {}", sources[0].display()),
            n => format!("{n} content files and folders"),
        };
        let message = format!(
            "Character: {}\n{content}",
            save.file_name().unwrap_or_default().to_string_lossy()
        );
        match ask::buttons(&message, &["Quit", "Change files…", "Continue"])?.as_deref() {
            Some("Continue") => return Ok(Some((save.clone(), sources.to_vec()))),
            Some("Change files…") => {}
            _ => return Ok(None),
        }
    }
    let Some(save) = ask::file("Select your Aurora character (.dnd5e)")? else {
        return Ok(None);
    };
    if !save
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("dnd5e"))
    {
        return Err("Select an Aurora character save ending in .dnd5e".into());
    }
    let mut sources = Vec::new();
    let message = "Choose the folder with the Aurora content (XML) files this character uses. \
        On a Windows PC with Aurora it is Documents\\5e Character Builder\\custom. \
        Subfolders are included.";
    loop {
        let more = if sources.is_empty() {
            ask::buttons(message, &["No content", "Choose folder…"])?
        } else {
            ask::buttons(
                &format!("{} content folders chosen.", sources.len()),
                &["Done", "Add another folder…"],
            )?
        };
        match more.as_deref() {
            Some("Choose folder…") | Some("Add another folder…") => {
                if let Some(folder) = ask::folder("Select an Aurora content folder")? {
                    sources.push(folder);
                }
            }
            Some(_) => break,
            None => return Ok(None),
        }
    }
    let mut lines = vec![save.display().to_string()];
    lines.extend(sources.iter().map(|path| path.display().to_string()));
    let _ = fs::write(&settings, lines.join("\n") + "\n");
    Ok(Some((save, sources)))
}

fn choose_plan(save: &Path, saved: bool) -> Result<Option<Plan>, Error> {
    let mut options = vec!["Play solo", "Join a party"];
    if saved {
        options.push("Rejoin last party");
    }
    let message =
        "Join your DM's party with the invitation they sent, or open the sheet on its own.";
    let plan = match ask::buttons(message, &options)?.as_deref() {
        Some("Play solo") => Plan::Solo,
        Some("Rejoin last party") => Plan::Resume,
        Some("Join a party") => {
            let stem = save.file_stem().unwrap_or_default().to_string_lossy();
            let Some(name) = ask::text("Your display name in the party", &stem, "Next")? else {
                return Ok(None);
            };
            let Some(invite) = ask::text("Paste the invitation from your DM", "", "Join")? else {
                return Ok(None);
            };
            Plan::Join {
                name: name.trim().into(),
                invite: invite.trim().into(),
            }
        }
        _ => return Ok(None),
    };
    Ok(Some(plan))
}

fn open_browser(sheet: &Path) {
    if std::env::var_os("AURORA_NO_BROWSER").is_some() {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        // Chrome is the tested browser. Safari is used only when Chrome is not installed.
        let chrome = std::process::Command::new("open")
            .args(["-a", "Google Chrome"])
            .arg(sheet)
            .status();
        if !chrome.is_ok_and(|status| status.success()) {
            let _ = std::process::Command::new("open").arg(sheet).status();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = std::process::Command::new("xdg-open").arg(sheet).status();
    }
}

/// Shows an error the user would otherwise never see (the app has no terminal).
#[cfg(target_os = "macos")]
pub fn report_failure(message: &str) {
    let _ = ask::osascript(
        "display alert \"Aurora Combat Tracker\" message (item 1 of argv) as critical",
        &[message],
    );
}

/// Native dialogs on macOS (AppleScript), plain prompts on a terminal elsewhere.
/// Every function returns `None` when the user cancels.
mod ask {
    use super::Error;
    use std::path::PathBuf;

    #[cfg(target_os = "macos")]
    pub fn osascript(script: &str, args: &[&str]) -> Result<Option<String>, Error> {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(format!("on run argv\nactivate\n{script}\nend run"))
            .args(args)
            .output()?;
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            return Ok(Some(text.trim_end_matches('\n').to_string()));
        }
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("-128") {
            return Ok(None); // User canceled.
        }
        Err(error.trim().to_string().into())
    }

    #[cfg(target_os = "macos")]
    pub fn file(prompt: &str) -> Result<Option<PathBuf>, Error> {
        Ok(osascript(
            "POSIX path of (choose file with prompt (item 1 of argv))",
            &[prompt],
        )?
        .map(PathBuf::from))
    }

    #[cfg(target_os = "macos")]
    pub fn folder(prompt: &str) -> Result<Option<PathBuf>, Error> {
        Ok(osascript(
            "POSIX path of (choose folder with prompt (item 1 of argv))",
            &[prompt],
        )?
        .map(PathBuf::from))
    }

    /// Up to three buttons. The last one is the default. Closing the dialog cancels.
    #[cfg(target_os = "macos")]
    pub fn buttons(message: &str, buttons: &[&str]) -> Result<Option<String>, Error> {
        let list = (2..buttons.len() + 2)
            .map(|i| format!("item {i} of argv"))
            .collect::<Vec<_>>()
            .join(", ");
        let script = format!(
            "button returned of (display dialog (item 1 of argv) with title \"Aurora Combat Tracker\" \
             buttons {{{list}}} default button {})",
            buttons.len()
        );
        let mut args = vec![message];
        args.extend_from_slice(buttons);
        osascript(&script, &args)
    }

    #[cfg(target_os = "macos")]
    pub fn text(message: &str, default: &str, ok: &str) -> Result<Option<String>, Error> {
        osascript(
            "text returned of (display dialog (item 1 of argv) with title \"Aurora Combat Tracker\" \
             default answer (item 2 of argv) buttons {\"Cancel\", item 3 of argv} \
             default button 2 cancel button 1)",
            &[message, default, ok],
        )
    }

    #[cfg(not(target_os = "macos"))]
    fn line(prompt: &str) -> Result<Option<String>, Error> {
        use std::io::{BufRead, Write};
        eprint!("{prompt}");
        std::io::stderr().flush()?;
        let mut answer = String::new();
        if std::io::stdin().lock().read_line(&mut answer)? == 0 {
            return Ok(None);
        }
        Ok(Some(answer.trim_end_matches(['\r', '\n']).to_string()))
    }

    #[cfg(not(target_os = "macos"))]
    pub fn file(prompt: &str) -> Result<Option<PathBuf>, Error> {
        Ok(line(&format!("{prompt}: "))?
            .filter(|p| !p.is_empty())
            .map(PathBuf::from))
    }

    #[cfg(not(target_os = "macos"))]
    pub fn folder(prompt: &str) -> Result<Option<PathBuf>, Error> {
        file(prompt)
    }

    #[cfg(not(target_os = "macos"))]
    pub fn buttons(message: &str, buttons: &[&str]) -> Result<Option<String>, Error> {
        eprintln!("{message}");
        for (i, button) in buttons.iter().enumerate() {
            eprintln!("  {}. {button}", i + 1);
        }
        Ok(line("> ")?.and_then(|answer| {
            let index: usize = answer.trim().parse().ok()?;
            buttons.get(index.checked_sub(1)?).map(|b| b.to_string())
        }))
    }

    #[cfg(not(target_os = "macos"))]
    pub fn text(message: &str, default: &str, _ok: &str) -> Result<Option<String>, Error> {
        Ok(line(&format!("{message} [{default}]: "))?.map(|answer| {
            if answer.is_empty() {
                default.to_string()
            } else {
                answer
            }
        }))
    }
}
