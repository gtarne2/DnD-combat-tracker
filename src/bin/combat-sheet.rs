use std::{
    env, fs, io,
    io::Write,
    path::{Path, PathBuf},
    process::ExitCode,
    time::{SystemTime, UNIX_EPOCH},
};

use aurora_combat_tracker::preview::{self, Preview};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args_os().skip(1);
    let first = args.next().ok_or(
        "usage: combat-sheet [--preview-dir <directory>] <save.dnd5e> [content.xml or folder ...]",
    )?;
    let (preview_dir, save) = if first == "--preview-dir" {
        let directory = args.next().ok_or("--preview-dir requires a directory")?;
        let save = args.next().ok_or("missing character save")?;
        (Some(PathBuf::from(directory)), save)
    } else {
        (None, first)
    };
    let sources: Vec<PathBuf> = args.map(PathBuf::from).collect();
    let Preview { profile, html } = preview::render(Path::new(&save), &sources)?;
    if let Some(directory) = preview_dir {
        let path = write_preview(&directory, &profile, &html)?;
        println!("{}", path.display());
    } else {
        io::stdout().lock().write_all(html.as_bytes())?;
    }
    Ok(())
}

fn write_preview(directory: &Path, profile: &str, html: &str) -> io::Result<PathBuf> {
    fs::create_dir_all(directory)?;
    let path = directory.join(format!("{profile}.html"));
    let created = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let pending = directory.join(format!(".{profile}-{}-{created}.tmp", std::process::id()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)?;
    let result = file.write_all(html.as_bytes());
    drop(file);
    let result = result.and_then(|()| fs::rename(&pending, &path));
    if result.is_err() {
        let _ = fs::remove_file(&pending);
    }
    result.map(|()| path)
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
