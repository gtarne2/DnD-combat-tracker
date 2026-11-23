use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

struct ScratchDirectory(PathBuf);

impl Drop for ScratchDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run_preview(directory: &Path, save: &Path, content: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_combat-sheet"))
        .arg("--preview-dir")
        .arg(directory)
        .arg(save)
        .arg(content)
        .output()
        .unwrap()
}

fn preview_path(output: Output) -> PathBuf {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    PathBuf::from(String::from_utf8(output.stdout).unwrap().trim())
}

#[test]
fn preview_refresh_keeps_the_same_url_and_preserves_the_previous_sheet_on_failure() {
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let scratch = ScratchDirectory(
        std::env::temp_dir().join(format!("aurora preview {}-{id}", std::process::id())),
    );
    fs::create_dir(&scratch.0).unwrap();
    let save = scratch.0.join("character é.dnd5e");
    let previews = scratch.0.join("Previews");
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let first_save = fixtures.join("sample.dnd5e");
    let first_content = fixtures.join("sample-content.xml");
    fs::copy(&first_save, &save).unwrap();

    let sheet = preview_path(run_preview(&previews, &save, &first_content));
    let original = fs::read_to_string(&sheet).unwrap();
    assert!(original.contains("Rowan &amp; Co."));

    let library = scratch.0.join("content library");
    let nested = library.join("supplements").join("items");
    fs::create_dir_all(&nested).unwrap();
    fs::copy(&first_content, nested.join("lantern.XML")).unwrap();
    fs::write(library.join("ignored.txt"), "not XML").unwrap();
    assert_eq!(preview_path(run_preview(&previews, &save, &library)), sheet);
    assert_eq!(fs::read_to_string(&sheet).unwrap(), original);

    let other_save = scratch.0.join("alternate.dnd5e");
    fs::copy(&save, &other_save).unwrap();
    assert_ne!(
        preview_path(run_preview(&previews, &other_save, &first_content)),
        sheet
    );

    fs::copy(fixtures.join("reimported.dnd5e"), &save).unwrap();
    let refreshed = preview_path(run_preview(
        &previews,
        &save,
        &fixtures.join("reimported-content.xml"),
    ));
    assert_eq!(refreshed, sheet);
    let updated = fs::read_to_string(&sheet).unwrap();
    assert!(updated.contains("Rowan Revised"));

    let broken_content = scratch.0.join("broken.xml");
    fs::write(&broken_content, "<elements>").unwrap();
    let failure = run_preview(&previews, &save, &broken_content);
    assert!(!failure.status.success());
    assert!(failure.stdout.is_empty());
    assert!(String::from_utf8_lossy(&failure.stderr).contains("broken.xml"));
    assert_eq!(fs::read_to_string(&sheet).unwrap(), updated);
    assert_eq!(previews.read_dir().unwrap().count(), 2);
}
