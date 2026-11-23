use std::{
    collections::HashSet,
    env, fs, io,
    io::Write,
    path::{Path, PathBuf},
    process::ExitCode,
    time::{SystemTime, UNIX_EPOCH},
};

use aurora_combat_tracker::{
    aurora::import_character_with_content,
    combat::{CombatSheet, render_html_with_profile},
};

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
    let mut files = Vec::new();
    for source in args.map(PathBuf::from) {
        if source.is_dir() {
            let mut discovered = folder_xml(&source).map_err(|error| {
                format!(
                    "could not read content folder {}: {error}",
                    source.display()
                )
            })?;
            files.append(&mut discovered);
        } else {
            files.push(source);
        }
    }
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
    let profile = format!("{hash:016x}");
    let html = render_html_with_profile(&sheet, &profile);
    if let Some(directory) = preview_dir {
        let path = write_preview(&directory, &profile, &html)?;
        println!("{}", path.display());
    } else {
        io::stdout().lock().write_all(html.as_bytes())?;
    }
    Ok(())
}

fn folder_xml(root: &Path) -> io::Result<Vec<PathBuf>> {
    let mut pending = vec![root.to_path_buf()];
    let mut visited = HashSet::new();
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        if !visited.insert(fs::canonicalize(&directory)?) {
            continue;
        }
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let path = entry.path();
            if kind.is_dir() {
                pending.push(path);
            } else if kind.is_file()
                && path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("xml"))
            {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
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
