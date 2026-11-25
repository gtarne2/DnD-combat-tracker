use aurora_combat_tracker::party::RoomService;
use std::{env, error::Error, path::PathBuf, process::ExitCode};
#[cfg(windows)]
#[path = "party_runtime/mod.rs"]
mod runtime;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), Box<dyn Error + Send + Sync>> {
    let mut args = env::args_os().skip(1);
    let action = args.next();
    #[cfg(windows)]
    if action.as_deref() == Some("serve".as_ref()) {
        return runtime::serve();
    }
    if action.as_deref() != Some("init".as_ref()) {
        return Err("Usage: aurora-party init [database-path]".into());
    }
    let path = match args.next() {
        Some(path) => PathBuf::from(path),
        None => {
            let app_data = env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
            let directory = PathBuf::from(app_data).join("Aurora Combat Tracker");
            std::fs::create_dir_all(&directory)?;
            directory.join("party.sqlite3")
        }
    };
    if args.next().is_some() {
        return Err("Usage: aurora-party init [database-path]".into());
    }
    RoomService::open(path)?;
    println!("Party database ready.");
    Ok(())
}
