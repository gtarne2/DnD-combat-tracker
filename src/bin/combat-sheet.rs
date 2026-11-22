use std::{
    env, io,
    io::Write,
    path::{Path, PathBuf},
    process::ExitCode,
};

use aurora_combat_tracker::{
    aurora::import_character_with_content,
    combat::{CombatSheet, render_html},
};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args_os().skip(1);
    let save = args
        .next()
        .ok_or("usage: combat-sheet <save.dnd5e> [content.xml ...]")?;
    let files: Vec<_> = args.map(PathBuf::from).collect();
    let paths: Vec<_> = files.iter().map(PathBuf::as_path).collect();
    let character = import_character_with_content(Path::new(&save), &paths)?;
    let sheet = CombatSheet::from_character(&character);
    io::stdout()
        .lock()
        .write_all(render_html(&sheet).as_bytes())?;
    Ok(())
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
