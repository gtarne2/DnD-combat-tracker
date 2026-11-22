use std::path::Path;

use aurora_combat_tracker::aurora::{
    ContentDefinition, ContentElement, ContentNode, ImportedCharacter, import_character,
    import_character_with_content,
};

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
    let definition = item.definition.as_ref().expect("the ID has a definition");
    assert_eq!(definition.name.as_deref(), Some("Signal Lantern"));
    assert_eq!(definition.kind.as_deref(), Some("Item"));
    assert_eq!(definition.source.as_deref(), Some("Synthetic Test Content"));
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

fn import_versioned(with_custom: bool) -> ImportedCharacter {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let base = fixtures.join("versioned-base.xml");
    let custom = fixtures.join("versioned-custom.xml");
    let mut content = vec![base.as_path()];
    if with_custom {
        content.push(&custom);
    }
    import_character_with_content(&fixtures.join("versioned.dnd5e"), &content)
        .expect("the versioned save and content should import")
}

fn section<'a>(definition: &'a ContentDefinition, tag: &'a str) -> &'a ContentElement {
    definition.element.children_named(tag).next().expect(tag)
}

#[test]
fn uses_exact_spell_ids_and_the_supplied_content_version() {
    let base = import_versioned(false);
    let custom = import_versioned(true);
    assert_eq!(custom.spells.len(), 2);
    assert_eq!(custom.spells[0].content_id, "ID_TEST_SPELL_SPARK");
    assert_eq!(custom.spells[1].content_id, "ID_TEST_SPELL_BEACON");
    assert!(
        !custom
            .definitions
            .contains_key("ID_TEST_SPELL_BEACON_OTHER_EDITION")
    );

    for (character, version, range, filename) in [
        (&base, "1.0", "30 feet", "versioned-base.xml"),
        (&custom, "2.1", "60 feet", "versioned-custom.xml"),
    ] {
        let beacon = character.spells[1].definition.as_ref().unwrap();
        assert_eq!(beacon.file_version.as_deref(), Some(version));
        assert!(beacon.source_path.ends_with(filename));
        let setter = section(beacon, "setters")
            .children_named("set")
            .next()
            .unwrap();
        assert_eq!(setter.attributes["name"], "range");
        assert_eq!(setter.children, [ContentNode::Text(range.into())]);
    }

    let beacon = custom.spells[1].definition.as_ref().unwrap();
    let paragraph = section(beacon, "description")
        .children_named("p")
        .next()
        .unwrap();
    assert_eq!(
        paragraph.children_named("strong").next().unwrap().children,
        [ContentNode::Text("visible".into())]
    );
}

#[test]
fn imports_item_and_selected_companion_rules() {
    let character = import_versioned(true);
    let rod = character.equipment[0].definition.as_ref().unwrap();
    assert_eq!(rod.kind.as_deref(), Some("Magic Item"));
    assert_eq!(rod.rules().next().unwrap().attributes["value"], "3");
    assert_eq!(section(rod, "sheet").attributes["usage"], "3/Day");

    assert_eq!(character.companions.len(), 1);
    let finch = &character.companions[0];
    assert_eq!(finch.content_id, "ID_TEST_COMPANION_FINCH");
    let finch = finch.definition.as_ref().unwrap();
    assert_eq!(finch.file_version.as_deref(), Some("2.1"));
    let hp = section(finch, "setters")
        .children_named("set")
        .next()
        .unwrap();
    assert_eq!(hp.attributes["name"], "hp");
    assert_eq!(hp.children, [ContentNode::Text("7".into())]);

    let flash = character.definitions["ID_TEST_FINCH_FLASH"]
        .as_ref()
        .unwrap();
    assert_eq!(section(flash, "sheet").attributes["action"], "Reaction");
}

#[test]
fn loads_granted_variants_and_appended_rules_without_losing_missing_links() {
    let character = import_versioned(true);
    let features: Vec<_> = character.features().collect();
    assert_eq!(features.len(), 1);
    let class = character.definitions["ID_TEST_CLASS_TINKERER"]
        .as_ref()
        .unwrap();
    assert!(class.referenced_ids.contains(&features[0].content_id));
    let turret = features[0].definition.as_ref().unwrap();
    assert_eq!(
        section(turret, "supports").children,
        [ContentNode::Text("Workshop".into())]
    );
    let rules: Vec<_> = turret.rules().collect();
    assert_eq!(rules.len(), 5);
    assert_eq!(rules[2].attributes["level"], "3");
    assert_eq!(rules[3].attributes["supports"], "Workshop");
    assert_eq!(rules[4].attributes["level"], "9");

    for (id, stat, value) in [
        ("ID_TEST_TURRET_BALLISTA", "turret:ballista:dice", "2"),
        ("ID_TEST_TURRET_FLAME", "turret:flame:range", "15"),
        ("ID_TEST_TURRET_PROTECTOR", "turret:protector:dice", "1"),
    ] {
        assert!(turret.referenced_ids.contains(id));
        let variant = character.definitions[id].as_ref().unwrap();
        let rule = variant.rules().next().unwrap();
        assert_eq!(rule.attributes["name"], stat);
        assert_eq!(rule.attributes["value"], value);
    }
    let protector = character.definitions["ID_TEST_TURRET_PROTECTOR"]
        .as_ref()
        .unwrap();
    assert!(protector.referenced_ids.contains(&features[0].content_id));
    assert_eq!(
        character.definitions.get("ID_TEST_UNAVAILABLE_UPGRADE"),
        Some(&None)
    );
}
