use aurora_combat_tracker::party::RoomService;
use std::{env, error::Error, path::PathBuf, process::ExitCode};
#[path = "party_runtime/mod.rs"]
mod runtime;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            #[cfg(target_os = "macos")]
            runtime::player::report_failure(&error.to_string());
            ExitCode::FAILURE
        }
    }
}

/// The per-user folder for party bindings, rooms, libraries and sheet previews.
/// Windows: `%LOCALAPPDATA%\Aurora Combat Tracker`. macOS: `~/Library/Application Support/
/// Aurora Combat Tracker`. Other systems: `$XDG_DATA_HOME` or `~/.local/share`.
fn app_data() -> Result<PathBuf, Box<dyn Error + Send + Sync>> {
    let base = if cfg!(windows) {
        PathBuf::from(env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?)
    } else {
        let home = env::var_os("HOME").map(PathBuf::from);
        if cfg!(target_os = "macos") {
            home.ok_or("HOME is unavailable")?
                .join("Library")
                .join("Application Support")
        } else if let Some(data) = env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
            PathBuf::from(data)
        } else {
            home.ok_or("HOME is unavailable")?
                .join(".local")
                .join("share")
        }
    };
    let directory = base.join("Aurora Combat Tracker");
    std::fs::create_dir_all(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(directory)
}

fn run() -> Result<(), Box<dyn Error + Send + Sync>> {
    let mut args = env::args_os().skip(1);
    let action = args.next();
    if action.as_deref() == Some("serve".as_ref()) {
        return runtime::serve();
    }
    // The player launcher (macOS app bundle): pick a character, join a party, open the sheet.
    if action.as_deref() == Some("player".as_ref()) {
        return runtime::player::run(args.next().as_deref() == Some("--service".as_ref()));
    }
    if action.as_deref() != Some("init".as_ref()) {
        return Err("Usage: aurora-party init [database-path] | serve | player".into());
    }
    let path = match args.next() {
        Some(path) => PathBuf::from(path),
        None => app_data()?.join("party.sqlite3"),
    };
    if args.next().is_some() {
        return Err("Usage: aurora-party init [database-path]".into());
    }
    RoomService::open(path)?;
    println!("Party database ready.");
    Ok(())
}
