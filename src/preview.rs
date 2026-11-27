//! Builds a character's browser sheet from an Aurora save. Shared by the `combat-sheet` CLI
//! (which the Windows launcher runs) and the macOS player launcher inside `aurora-party`.

use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
};

use crate::{
    aurora::import_character_with_content,
    combat::{CombatSheet, render_html_with_profile},
};

/// A rendered sheet and the browser storage key it uses.
pub struct Preview {
    pub profile: String,
    pub html: String,
}

/// Imports `save` with content files and folders in load order, then renders the sheet.
pub fn render(save: &Path, sources: &[PathBuf]) -> Result<Preview, Box<dyn std::error::Error>> {
    let mut files = Vec::new();
    for source in sources {
        if source.is_dir() {
            let mut discovered = folder_xml(source).map_err(|error| {
                format!(
                    "could not read content folder {}: {error}",
                    source.display()
                )
            })?;
            files.append(&mut discovered);
        } else {
            files.push(source.clone());
        }
    }
    let paths: Vec<_> = files.iter().map(PathBuf::as_path).collect();
    let character = import_character_with_content(save, &paths)?;
    let sheet = CombatSheet::from_character(&character);
    let profile = profile_key(save)?;
    let html = render_html_with_profile(&sheet, &profile);
    Ok(Preview { profile, html })
}

/// A stable browser key based on the source path, without embedding the path in the preview.
pub fn profile_key(save: &Path) -> io::Result<String> {
    let source = fs::canonicalize(save)?;
    let hash = source
        .to_string_lossy()
        .bytes()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
    Ok(format!("{hash:016x}"))
}

/// Every `.xml` file under `root`, sorted, following each folder once.
pub fn folder_xml(root: &Path) -> io::Result<Vec<PathBuf>> {
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
