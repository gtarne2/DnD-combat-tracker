//! R79: buff spells carry stat changes from the mechanics overlay, and equipped gear rules
//! with an `equipped` condition feed AC and saving throws.

use std::{fs, path::Path};

use aurora_combat_tracker::{
    aurora::import_character,
    combat::{CombatSheet, render_html},
    mechanics::overlay,
};

const GEAR: &str = r#"
  <element id="ID_TEST_WARD_CLOAK" name="Ward Cloak" type="Magic Item" source="Synthetic Test Content">
    <rules>
      <stat name="ac:misc" value="1" equipped="true" />
      <stat name="dexterity:save:misc" value="1" equipped="true" />
    </rules>
  </element>
  <element id="ID_TEST_GUARD_STYLE" name="Guard Style" type="Class Feature" source="Synthetic Test Content">
    <rules>
      <stat name="ac:misc" value="1" equipped="[armor:any]" />
      <stat name="wisdom:save:misc" value="2" equipped="[armor:none]" />
    </rules>
  </element>
  <element id="ID_TEST_SPELL_LONGSTRIDER" name="Longstrider" type="Spell" source="SPELL_SOURCE">
    <description><p>You touch a creature. The target's speed increases by 10 feet until the spell ends.</p></description>
    <setters><set name="level">1</set><set name="time">1 action</set><set name="duration">1 hour</set><set name="range">Touch</set></setters>
  </element>
</elements>"#;

fn sheet(equip_cloak: bool, book: &str) -> CombatSheet {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let directory = std::env::temp_dir().join(format!("stat-buffs-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&directory).unwrap();
    let content = fs::read_to_string(fixtures.join("combat-sheet.xml"))
        .unwrap()
        .replace("</elements>", &GEAR.replace("SPELL_SOURCE", book));
    let cloak = if equip_cloak {
        r#"<item id="ID_TEST_WARD_CLOAK" name="Ward Cloak"><equipped>true</equipped></item>"#
    } else {
        r#"<item id="ID_TEST_WARD_CLOAK" name="Ward Cloak"><equipped>false</equipped></item>"#
    };
    let save = fs::read_to_string(fixtures.join("combat-sheet.dnd5e"))
        .unwrap()
        .replace("</equipment>", &format!("{cloak}</equipment>"))
        .replace(
            "<spell id=\"ID_TEST_SPELL_FLARE\"",
            &format!("<spell id=\"ID_TEST_SPELL_LONGSTRIDER\" name=\"Longstrider\" level=\"1\" prepared=\"true\" /><spell id=\"ID_TEST_SPELL_FLARE\""),
        )
        .replace(
            "</sum>",
            r#"<element id="ID_TEST_WARD_CLOAK" type="Magic Item" /><element id="ID_TEST_GUARD_STYLE" type="Class Feature" /></sum>"#,
        );
    fs::write(directory.join("hero.dnd5e"), save).unwrap();
    fs::write(directory.join("content.xml"), content).unwrap();
    let character = import_character(
        &directory.join("hero.dnd5e"),
        &directory.join("content.xml"),
    )
    .unwrap();
    let _ = fs::remove_dir_all(&directory);
    CombatSheet::from_character(&character)
}

#[test]
fn equipped_gear_rules_feed_ac_and_saves() {
    // The fixture wears armor and a shield: AC 18 before the cloak and the armored style.
    let worn = sheet(true, "Player's Handbook");
    assert_eq!(worn.profile.stats.armor_class, Some(20));
    // Dexterity +3 save, +1 from the cloak; the unarmored Wisdom rule does not apply.
    assert_eq!(worn.profile.stats.saves[1], Some(4));
    assert_eq!(worn.profile.stats.saves[4], Some(0));
    let stowed = sheet(false, "Player's Handbook");
    assert_eq!(stowed.profile.stats.armor_class, Some(19));
    assert_eq!(stowed.profile.stats.saves[1], Some(3));
}

#[test]
fn buff_spells_from_listed_books_carry_their_stat_changes() {
    let html = render_html(&sheet(true, "Player's Handbook"));
    assert!(html.contains("data-spell-buff=\"speed=10,seconds=3600\""));
    assert!(html.contains("data-target-counts=\"1,2,3,4,5,6,7,8,9\""));
    let homebrew = render_html(&sheet(true, "Homebrew Hall"));
    assert!(!homebrew.contains("data-spell-buff=\""));

    let overlay = overlay();
    let bless = overlay.buff("Bless", Some("Player's Handbook")).unwrap();
    assert_eq!((bless.attack_die, bless.save_die), (4, 4));
    assert_eq!(bless.target_counts(1)[..3], [3, 4, 5]);
    assert!(overlay.buff("Bless", Some("Homebrew Hall")).is_none());
    assert_eq!(
        overlay
            .buff("Shield of Faith", Some("Player's Handbook 2024"))
            .unwrap()
            .ac,
        2
    );
}
