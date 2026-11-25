use std::path::Path;

use aurora_combat_tracker::{aurora::import_character_with_content, combat::CombatSheet};

#[test]
fn custom_definition_replaces_the_projected_damage() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let character = import_character_with_content(
        &fixtures.join("progression.dnd5e"),
        &[
            &fixtures.join("progression.xml"),
            &fixtures.join("progression-custom.xml"),
        ],
    )
    .unwrap();
    let sheet = CombatSheet::from_character(&character);
    let spell = sheet
        .groups
        .iter()
        .flat_map(|group| &group.options)
        .find(|option| option.name == "Static Arc")
        .unwrap();
    assert!(
        spell
            .details
            .iter()
            .any(|fact| fact.label == "Damage" && fact.value == "3d6 thunder")
    );
}

#[test]
fn scales_spells_and_class_resources_from_the_resolved_rules() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut character = import_character_with_content(
        &fixtures.join("progression.dnd5e"),
        &[&fixtures.join("progression.xml")],
    )
    .unwrap();
    assert_eq!(character.level, Some(11));
    assert_eq!(character.class_levels["ID_TEST_CLASS_MONK"], 5);
    let sheet = CombatSheet::from_character(&character);
    let option = |name| {
        sheet
            .groups
            .iter()
            .flat_map(|group| &group.options)
            .find(|option| option.name == name)
            .unwrap()
    };
    let fact = |name, label| {
        option(name)
            .details
            .iter()
            .find(|entry| entry.label == label)
            .map(|entry| entry.value.as_str())
    };
    let pool = |name| sheet.resources.iter().find(|pool| pool.name == name);
    assert_eq!(fact("Static Arc", "Damage"), Some("3d8 lightning"));
    assert_eq!(fact("Static Arc", "Attack roll"), Some("+7"));
    assert_eq!(
        fact("Cobalt Rays", "Damage"),
        Some("3 beams · 1d10 cold per beam")
    );
    assert_eq!(fact("Lantern Burst", "Save DC"), Some("15"));
    assert_eq!(
        option("Lantern Burst").cast_previews[3],
        "Damage: 7d6 radiant"
    );
    assert_eq!(option("Mend Wounds").cast_previews[2], "Healing: 6d4 + 3");
    assert_eq!(
        option("Numerous Darts").cast_previews[2],
        "Damage: 5 darts · 1d4 + 1 force per dart"
    );
    assert_eq!(fact("Metal Mark", "Damage"), None);
    assert_eq!(
        fact("Metal Mark", "Dice in description"),
        Some("1d4 · 2d4 · 3d4")
    );
    assert_eq!(fact("Forceful Press", "Save DC"), Some("15"));
    let ki = pool("Ki").unwrap();
    assert_eq!((ki.capacity, ki.recovery), (5, "short"));
    for (name, cost) in [("Gust Step", 1), ("Forceful Press", 2)] {
        let binding = option(name).resource_binding.as_ref().unwrap();
        assert_eq!(binding.key, ki.key);
        assert_eq!(binding.cost, Some(cost));
    }
    assert_eq!(pool("Rally Surge").unwrap().capacity, 1);
    assert_eq!(pool("Rallying Note").unwrap().capacity, 1);
    let reserve = pool("Sorcery Points").unwrap();
    assert_eq!((reserve.capacity, reserve.recovery), (4, "long"));
    assert_eq!(
        option("Vary Tone").resource_binding.as_ref().unwrap().cost,
        Some(2)
    );
    let divinity = pool("Channel Divinity").unwrap();
    assert_eq!((divinity.capacity, divinity.recovery), (1, "short"));
    assert_eq!(
        option("Radiant Resolve")
            .resource_binding
            .as_ref()
            .unwrap()
            .key,
        divinity.key
    );
    assert!(
        option("Rallying Note")
            .summary
            .as_deref()
            .unwrap()
            .contains("d6")
    );
    assert_eq!(pool("Restoring Touch").unwrap().capacity, 6);
    assert_eq!(
        option("Restoring Touch")
            .resource_binding
            .as_ref()
            .unwrap()
            .cost,
        None
    );
    assert!(pool("Conditional Feature").is_none());
    assert_eq!(
        fact("Conditional Feature", "Uses"),
        Some("{{unknown:uses}}/Long Rest")
    );

    for (level, expected) in [
        (None, None),
        (Some(4), Some("1d8 lightning")),
        (Some(5), Some("2d8 lightning")),
        (Some(17), Some("4d8 lightning")),
    ] {
        character.level = level;
        let sheet = CombatSheet::from_character(&character);
        let actual = sheet
            .groups
            .iter()
            .flat_map(|group| &group.options)
            .find(|option| option.name == "Static Arc")
            .unwrap()
            .details
            .iter()
            .find(|entry| entry.label == "Damage")
            .map(|entry| entry.value.as_str());
        assert_eq!(actual, expected);
    }
}
