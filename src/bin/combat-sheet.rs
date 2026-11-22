use std::{
    env, fs, io,
    io::Write,
    path::{Path, PathBuf},
    process::ExitCode,
};

use aurora_combat_tracker::{
    aurora::import_character_with_content,
    combat::{CombatSheet, render_html_with_profile},
};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args_os().skip(1);
    let save = args
        .next()
        .ok_or("usage: combat-sheet <save.dnd5e> [content.xml ...]")?;
    let files: Vec<_> = args.map(PathBuf::from).collect();
    let paths: Vec<_> = files.iter().map(PathBuf::as_path).collect();
    let save = Path::new(&save);
    let character = import_character_with_content(save, &paths)?;
    let sheet = CombatSheet::from_character(&character);
    let source = fs::canonicalize(save)?;
    // A stable browser key based on the source path, without embedding the path in the preview.
    let hash = source
        .to_string_lossy()
        .bytes()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
    io::stdout()
        .lock()
        .write_all(render_html_with_profile(&sheet, &format!("{hash:016x}")).as_bytes())?;
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
