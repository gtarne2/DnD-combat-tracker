use std::{
    env, fs,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicUsize, Ordering},
};

use aurora_combat_tracker::{
    aurora::{ImportError, import_character_with_content},
    combat::{CombatSheet, ConsumableAmount},
    concentration::{
        ConcentrationCast, ConcentrationRules, ConcentrationStart, SaveResult, StartError,
    },
    inventory::ConsumableUseError,
    session::{CharacterSession, Pin},
};

#[derive(Debug, PartialEq, Eq)]
struct Encounter {
    round: u32,
    initiative: Vec<&'static str>,
    active_turn: usize,
    hit_points: u32,
    spell_slots_spent: u32,
}

#[derive(Debug, PartialEq, Eq)]
struct Layout {
    ordered_sections: Vec<&'static str>,
    hidden_sections: Vec<&'static str>,
}

fn encounter() -> Encounter {
    Encounter {
        round: 3,
        initiative: vec!["Sentry", "Rowan", "Scout"],
        active_turn: 1,
        hit_points: 12,
        spell_slots_spent: 2,
    }
}

fn layout() -> Layout {
    Layout {
        ordered_sections: vec!["Spells", "Equipment", "Features", "Companions"],
        hidden_sections: vec!["Equipment"],
    }
}

#[test]
fn refreshes_the_saved_character_and_keeps_encounter_layout_and_applicable_pins() {
    let files = TestFiles::new();
    let mut session = files.open();
    let beacon = Pin::Spell("ID_TEST_SPELL_BEACON".into());
    let spark = Pin::Spell("ID_TEST_SPELL_SPARK".into());
    let rod = Pin::Equipment("ID_TEST_ITEM_ROD".into());
    let turret = Pin::BuildElement("ID_TEST_FEATURE_TURRET".into());
    let flame = Pin::LinkedOption("ID_TEST_TURRET_FLAME".into());
    let protector = Pin::LinkedOption("ID_TEST_TURRET_PROTECTOR".into());
    let finch = Pin::Companion("ID_TEST_COMPANION_FINCH".into());
    let hp = Pin::Local("hp".into());
    session.pins = vec![
        hp.clone(),
        spark.clone(),
        turret.clone(),
        rod.clone(),
        beacon.clone(),
        protector.clone(),
        flame.clone(),
        finch.clone(),
    ];
    session.encounter.hit_points -= 4;
    session.layout.ordered_sections.swap(0, 1);

    fs::copy(fixture("reimported.dnd5e"), files.save()).unwrap();
    fs::copy(fixture("reimported-content.xml"), files.custom()).unwrap();
    let removed = session.reimport().unwrap();

    let character = session.character();
    assert_eq!(character.name.as_deref(), Some("Rowan Revised"));
    assert_eq!(
        character.spells[0].saved_name.as_deref(),
        Some("Guiding Beacon")
    );
    let revised_beacon = character.spells[0].definition.as_ref().unwrap();
    assert_eq!(revised_beacon.file_version.as_deref(), Some("3.0"));
    assert_eq!(
        character.spells[1].content_id,
        "ID_TEST_SPELL_LANTERN_FLARE"
    );
    assert_eq!(
        character.equipment[0].saved_name.as_deref(),
        Some("Signal Rod")
    );
    assert_eq!(
        character.equipment[0].content_id,
        "ID_TEST_ITEM_REVISED_ROD"
    );

    assert_eq!(
        session.encounter,
        Encounter {
            hit_points: 8,
            ..encounter()
        }
    );
    let mut expected_layout = layout();
    expected_layout.ordered_sections.swap(0, 1);
    assert_eq!(session.layout, expected_layout);
    assert_eq!(session.pins, [hp, turret, beacon, flame]);
    assert_eq!(removed, [spark, rod, protector, finch]);
    assert!(session.reimport().unwrap().is_empty());
}

#[test]
fn failed_refresh_preserves_the_snapshot_and_the_previous_content_sources() {
    let files = TestFiles::new();
    let mut session = files.open();
    let spark = Pin::Spell("ID_TEST_SPELL_SPARK".into());
    session.pins.push(spark.clone());
    let base = fixture("versioned-base.xml");
    let previous = import_character_with_content(&files.save(), &[&base, &files.custom()]).unwrap();

    fs::copy(fixture("reimported.dnd5e"), files.save()).unwrap();
    let broken = files.0.join("broken.xml");
    fs::write(&broken, "<elements>").unwrap();
    let error = session
        .reimport_with_content(vec![base, broken])
        .unwrap_err();

    assert!(matches!(error, ImportError::Xml { .. }));
    assert_eq!(session.character(), &previous);
    assert_eq!(session.encounter, encounter());
    assert_eq!(session.layout, layout());
    assert_eq!(session.pins, [spark.clone()]);

    assert_eq!(session.reimport().unwrap(), [spark]);
    let beacon = session.character().spells[0].definition.as_ref().unwrap();
    assert_eq!(beacon.file_version.as_deref(), Some("2.1"));
}

#[test]
fn changing_content_sources_keeps_pins_for_references_whose_definitions_are_missing() {
    let files = TestFiles::new();
    let mut session = files.open();
    let finch = Pin::Companion("ID_TEST_COMPANION_FINCH".into());
    session.pins.push(finch.clone());
    assert!(session.character().companions[0].definition.is_some());

    let removed = session
        .reimport_with_content(vec![fixture("versioned-base.xml")])
        .unwrap();
    assert!(removed.is_empty());
    assert_eq!(session.pins, [finch]);
    assert!(session.character().companions[0].definition.is_none());

    assert!(session.reimport().unwrap().is_empty());
    assert!(session.character().companions[0].definition.is_none());
}

#[test]
fn consumable_use_is_per_stack_and_survives_an_inventory_refresh() {
    let files = TestFiles::new();
    let save = files.save();
    fs::copy(fixture("combat-sheet.dnd5e"), &save).unwrap();
    let before = fs::read_to_string(&save).unwrap();
    let mut session = CharacterSession::open(
        save.clone(),
        vec![fixture("combat-sheet.xml")],
        encounter(),
        layout(),
    )
    .unwrap();
    let key = stack(&session.combat_sheet(), "Healing Draught (belt)")
        .key
        .clone();

    assert_eq!(session.use_consumable(&key), Ok(1));
    let sheet = session.combat_sheet();
    assert_eq!(stack(&sheet, "Healing Draught (belt)").remaining, Some(1));
    assert_eq!(stack(&sheet, "Healing Draught (pack)").remaining, Some(4));
    assert_eq!(session.use_consumable(&key), Ok(0));
    assert_eq!(
        session.use_consumable(&key),
        Err(ConsumableUseError::Depleted)
    );
    let unavailable = &stack(&sheet, "Uncertain Draught Stack").key;
    assert_eq!(
        session.use_consumable(unavailable),
        Err(ConsumableUseError::QuantityUnavailable)
    );
    assert_eq!(
        session.use_consumable("removed-item"),
        Err(ConsumableUseError::UnknownStack)
    );
    assert_eq!(fs::read_to_string(&save).unwrap(), before);

    let refreshed = before.replace(
        "identifier=\"belt-potion\" amount=\"2\"",
        "identifier=\"belt-potion\" amount=\"5\"",
    );
    fs::write(&save, &refreshed).unwrap();
    session.reimport().unwrap();
    assert_eq!(
        stack(&session.combat_sheet(), "Healing Draught (belt)").remaining,
        Some(3)
    );
    assert_eq!(session.encounter, encounter());

    fs::write(
        &save,
        refreshed.replace(
            "identifier=\"belt-potion\"",
            "identifier=\"replacement-potion\"",
        ),
    )
    .unwrap();
    session.reimport().unwrap();
    assert_eq!(
        session.use_consumable(&key),
        Err(ConsumableUseError::UnknownStack)
    );
    assert_eq!(
        stack(&session.combat_sheet(), "Healing Draught (belt)").remaining,
        Some(5)
    );
}

fn stack<'a>(sheet: &'a CombatSheet, name: &str) -> &'a ConsumableAmount {
    sheet
        .groups
        .iter()
        .flat_map(|group| &group.options)
        .find(|option| option.name == name)
        .and_then(|option| option.consumable.as_ref())
        .unwrap()
}

#[test]
fn damage_queues_individual_constitution_saves_and_failure_ends_concentration() {
    let files = TestFiles::new();
    let mut session = concentration_session(&files);
    let rules = ConcentrationRules::Rules2014;
    assert_eq!(session.concentration.record_damage(12, rules), None);
    let flare = concentration_cast(&session.combat_sheet(), "Flare");
    assert_eq!(
        session.start_concentration(flare),
        Ok(ConcentrationStart::Started)
    );
    assert_eq!(
        session.concentration.active().unwrap().remaining_seconds,
        Some(60)
    );
    assert!(!session.concentration.elapse(6));
    assert_eq!(
        session.concentration.active().unwrap().remaining_seconds,
        Some(54)
    );
    assert_eq!(session.concentration.record_damage(0, rules), None);
    let first = session.concentration.record_damage(21, rules).unwrap();
    let second = session
        .concentration
        .record_damage(83, ConcentrationRules::Rules2024)
        .unwrap();
    assert_eq!(first.dc, 10);
    assert_eq!(second.dc, 30);
    assert_eq!(rules.save_dc(83), Some(41));
    assert_eq!(session.concentration.next_save(), Some(first));
    assert!(
        session
            .concentration
            .record_save(second.id, SaveResult::Success)
            .is_none()
    );
    session
        .concentration
        .record_save(first.id, SaveResult::Success)
        .unwrap();
    assert!(session.concentration.active().is_some());
    assert_eq!(session.concentration.next_save(), Some(second));
    session
        .concentration
        .record_save(second.id, SaveResult::Failure)
        .unwrap();
    assert!(session.concentration.active().is_none());
    assert_eq!(session.concentration.next_save(), None);
    assert_eq!(
        session.concentration.last_result().unwrap().result,
        SaveResult::Failure
    );
}

#[test]
fn replacing_concentration_spends_the_scroll_only_after_confirmation() {
    let files = TestFiles::new();
    let mut session = concentration_session(&files);
    let sheet = session.combat_sheet();
    let flare = concentration_cast(&sheet, "Flare");
    let name = "Scroll of Shield Flash";
    let scroll = concentration_cast(&sheet, name);
    assert_eq!(
        session.start_concentration(flare),
        Ok(ConcentrationStart::Started)
    );
    let hit = session
        .concentration
        .record_damage(8, ConcentrationRules::Rules2014)
        .unwrap();
    let ConcentrationStart::ConfirmReplacement(declined) =
        session.start_concentration(scroll.clone()).unwrap()
    else {
        panic!("replacement should require confirmation")
    };
    assert_eq!(declined.current_spell, "Flare");
    drop(declined);
    assert_eq!(session.concentration.active().unwrap().spell.name, "Flare");
    assert_eq!(session.concentration.next_save(), Some(hit));
    assert_eq!(stack(&session.combat_sheet(), name).remaining, Some(1));

    let ConcentrationStart::ConfirmReplacement(stale) =
        session.start_concentration(scroll.clone()).unwrap()
    else {
        panic!("replacement should require confirmation")
    };
    let ConcentrationStart::ConfirmReplacement(confirmed) =
        session.start_concentration(scroll.clone()).unwrap()
    else {
        panic!("replacement should require confirmation")
    };
    session.confirm_concentration(confirmed).unwrap();
    assert_eq!(
        session.confirm_concentration(stale),
        Err(StartError::StaleReplacement)
    );
    assert_eq!(
        session.concentration.active().unwrap().spell.name,
        "Shield Flash"
    );
    assert_eq!(session.concentration.next_save(), None);
    assert_eq!(stack(&session.combat_sheet(), name).remaining, Some(0));

    let ConcentrationStart::ConfirmReplacement(depleted) =
        session.start_concentration(scroll).unwrap()
    else {
        panic!("replacement should require confirmation")
    };
    assert_eq!(
        session.confirm_concentration(depleted),
        Err(StartError::Consumable(ConsumableUseError::Depleted))
    );
    session.reimport().unwrap();
    assert_eq!(
        session.concentration.active().unwrap().remaining_seconds,
        Some(12)
    );
    assert!(!session.concentration.elapse(6));
    assert!(session.concentration.elapse(6));
    assert!(session.concentration.active().is_none());
}

fn concentration_session(files: &TestFiles) -> CharacterSession<Encounter, Layout> {
    fs::copy(fixture("combat-sheet.dnd5e"), files.save()).unwrap();
    CharacterSession::open(
        files.save(),
        vec![fixture("combat-sheet.xml")],
        encounter(),
        layout(),
    )
    .unwrap()
}

fn concentration_cast(sheet: &CombatSheet, name: &str) -> ConcentrationCast {
    let option = sheet
        .groups
        .iter()
        .flat_map(|group| &group.options)
        .find(|option| option.name == name)
        .unwrap();
    ConcentrationCast {
        spell: option.concentration.clone().unwrap(),
        scroll_key: option.consumable.as_ref().map(|stack| stack.key.clone()),
    }
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

struct TestFiles(PathBuf);

impl TestFiles {
    fn new() -> Self {
        static NEXT_DIR: AtomicUsize = AtomicUsize::new(0);
        let number = NEXT_DIR.fetch_add(1, Ordering::Relaxed);
        let path = env::temp_dir().join(format!("aurora-reimport-{}-{number}", process::id()));
        fs::create_dir(&path).unwrap();
        let files = Self(path);
        fs::copy(fixture("versioned.dnd5e"), files.save()).unwrap();
        fs::copy(fixture("versioned-custom.xml"), files.custom()).unwrap();
        files
    }

    fn save(&self) -> PathBuf {
        self.0.join("character.dnd5e")
    }

    fn custom(&self) -> PathBuf {
        self.0.join("custom.xml")
    }

    fn open(&self) -> CharacterSession<Encounter, Layout> {
        CharacterSession::open(
            self.save(),
            vec![fixture("versioned-base.xml"), self.custom()],
            encounter(),
            layout(),
        )
        .unwrap()
    }
}

impl Drop for TestFiles {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
