use std::path::Path;

use aurora_combat_tracker::aurora::{ContentDefinition, ImportedCharacter, import_character};

fn import_sample() -> ImportedCharacter {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    import_character(
        &fixtures.join("sample.dnd5e"),
        &fixtures.join("sample-content.xml"),
    )
    .expect("the sample save and its content should import")
}

#[test]
fn reads_sample_save_and_resolves_equipment_by_content_id() {
    let character = import_sample();
    assert_eq!(character.name.as_deref(), Some("Rowan & Co."));
    assert_eq!(character.equipment.len(), 2);

    let item = &character.equipment[0];
    assert_eq!(item.content_id, "ID_TEST_ITEM_LANTERN");
    assert_eq!(item.saved_name.as_deref(), Some("Rowan's Lantern"));
    assert_eq!(
        item.definition,
        Some(ContentDefinition {
            name: Some("Signal Lantern".into()),
            kind: Some("Item".into()),
            source: Some("Synthetic Test Content".into()),
        })
    );
}

#[test]
fn keeps_missing_reference_alongside_resolved_equipment() {
    let character = import_sample();
    assert!(character.equipment[0].definition.is_some());

    let item = &character.equipment[1];
    assert_eq!(item.content_id, "ID_TEST_ITEM_MISSING");
    assert_eq!(item.saved_name.as_deref(), Some("Rowan's Lantern"));
    assert_eq!(item.definition, None);
}
