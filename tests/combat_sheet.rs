use std::path::Path;

use aurora_combat_tracker::{
    aurora::import_character,
    combat::{ActionGroup, CombatOption, CombatSheet, OptionKind, render_html},
};

fn sheet() -> CombatSheet {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let character = import_character(
        &fixtures.join("combat-sheet.dnd5e"),
        &fixtures.join("combat-sheet.xml"),
    )
    .unwrap();
    CombatSheet::from_character(&character)
}

fn option<'a>(sheet: &'a CombatSheet, group: ActionGroup, name: &str) -> &'a CombatOption {
    sheet
        .groups
        .iter()
        .find(|entry| entry.action == group)
        .unwrap()
        .options
        .iter()
        .find(|option| option.name == name)
        .expect(name)
}

fn detail<'a>(option: &'a CombatOption, label: &str) -> Option<&'a str> {
    option
        .details
        .iter()
        .find(|detail| detail.label == label)
        .map(|detail| detail.value.as_str())
}

#[test]
fn groups_attacks_spells_scrolls_items_and_features_with_their_mechanics() {
    let sheet = sheet();
    let bow = option(&sheet, ActionGroup::Action, "Signal Bow");
    assert_eq!(bow.kind, OptionKind::Attack);
    assert_eq!(detail(bow, "Range"), Some("80/320 ft."));
    assert_eq!(detail(bow, "Attack roll"), Some("+5 vs AC"));
    assert_eq!(detail(bow, "Damage"), Some("1d8+3 piercing"));
    let spur = option(&sheet, ActionGroup::Action, "Clockwork Spur");
    assert_eq!(spur.kind, OptionKind::Attack);
    assert_eq!(detail(spur, "Damage"), Some("1d4 piercing"));

    let flare = option(&sheet, ActionGroup::Action, "Flare");
    assert_eq!(flare.kind, OptionKind::Spell);
    assert_eq!(flare.preparation, Some(true));
    assert_eq!(detail(flare, "Range"), Some("60 feet"));
    assert_eq!(detail(flare, "Save DC"), Some("15"));
    assert_eq!(detail(flare, "Attack roll"), None);
    assert_eq!(detail(flare, "Dice in description"), Some("2d6 · 1d6"));
    assert_eq!(detail(flare, "Components"), Some("V, S, M"));
    assert_eq!(
        detail(flare, "Duration"),
        Some("Concentration, up to 1 minute")
    );
    assert_eq!(
        detail(flare, "Material"),
        Some("a copper reflector worth 5 gp")
    );

    let rod = option(&sheet, ActionGroup::Action, "Signal Rod");
    assert_eq!(rod.kind, OptionKind::Item);
    assert_eq!(detail(rod, "Cost"), Some("1 charge"));
    assert_eq!(detail(rod, "Uses"), Some("3/Day"));

    let turret = option(&sheet, ActionGroup::BonusAction, "Signal Turret");
    assert_eq!(turret.kind, OptionKind::Feature);
    assert_eq!(detail(turret, "Uses"), Some("1/Long Rest"));
    let ballista = option(&sheet, ActionGroup::BonusAction, "Ballista Mode");
    assert_eq!(detail(ballista, "Damage"), Some("2d8 force"));
    assert_eq!(detail(ballista, "Uses"), Some("2/Long Rest"));
    assert_eq!(
        detail(
            option(&sheet, ActionGroup::Reaction, "Ballista Mode"),
            "Level"
        ),
        Some("6")
    );

    assert_eq!(
        detail(
            option(&sheet, ActionGroup::Reaction, "Alarm Pulse"),
            "Save DC"
        ),
        Some("12")
    );
    let counter = option(&sheet, ActionGroup::Reaction, "Counter Spark");
    assert_eq!(detail(counter, "Attack roll"), Some("+6"));
    assert_eq!(detail(counter, "Save DC"), None);
    assert_eq!(
        detail(counter, "Casting time"),
        Some("1 reaction, which you take when a spark approaches")
    );

    let scroll = option(&sheet, ActionGroup::Reaction, "Scroll of Shield Flash");
    assert_eq!(scroll.kind, OptionKind::Scroll);
    assert_eq!(detail(scroll, "Cost"), Some("1 scroll"));
    assert_eq!(detail(scroll, "Range"), Some("15 feet"));
    assert_eq!(detail(scroll, "Attack roll"), Some("Unavailable"));
    let scroll = option(&sheet, ActionGroup::Action, "Scroll of Flare");
    assert_eq!(detail(scroll, "Save DC"), Some("13"));
    assert_eq!(detail(scroll, "Material"), None);

    assert_eq!(
        option(&sheet, ActionGroup::Other, "Beacon Ritual").preparation,
        Some(false)
    );
    assert!(option(&sheet, ActionGroup::Other, "Beacon Ritual").ritual);
    let ambiguous = option(&sheet, ActionGroup::Other, "Scroll of Twin Signal");
    assert_eq!(
        detail(ambiguous, "Aurora content"),
        Some("Definition unavailable")
    );
    let vial = option(&sheet, ActionGroup::Other, "Unidentified Vial");
    assert_eq!(
        detail(vial, "Aurora content"),
        Some("Definition unavailable")
    );
    assert!(
        !sheet
            .groups
            .iter()
            .flat_map(|group| &group.options)
            .any(|option| {
                matches!(
                    option.name.as_str(),
                    "Higher-Level Turret" | "Hidden Attack"
                )
            })
    );
}

#[test]
fn renders_all_groups_and_full_linked_descriptions_as_inline_disclosures() {
    let html = render_html(&sheet());
    for group in ["action", "bonus-action", "reaction"] {
        assert!(html.contains(&format!("href=\"#{group}\"")));
        assert!(html.contains(&format!("<section id=\"{group}\"")));
    }
    assert!(html.contains("Rowan &amp; Co."));
    assert!(html.contains("Lvl 3 · Tinkerer · Beacon Keeper"));
    assert!(html.contains("id=\"inspector-divider\" role=\"separator\""));
    assert!(html.contains("data-record-attack=\"Signal Bow\""));
    assert!(html.contains("data-ritual-cast"));
    assert!(html.contains("<details><summary>Full description</summary>"));
    assert!(html.contains("<strong>At higher levels.</strong>"));
    assert!(html.contains("<ul><li>Blue points north.</li><li>Amber signals a retreat.</li></ul>"));
    assert!(html.contains("The parchment vanishes after use."));
    assert!(html.contains("Make a ranged spell attack as you release the flash."));
    assert_eq!(html.matches("Choose a signal mode.").count(), 1);
}

#[test]
fn shows_character_stats_and_preserves_lore_in_the_full_sheet() {
    let sheet = sheet();
    let stats = &sheet.profile.stats;
    assert_eq!(stats.max_hp, Some(27));
    assert_eq!(stats.armor_class, Some(18));
    assert_eq!(stats.speed.as_deref(), Some("40 ft. walk · 40 ft. swim"));
    assert_eq!(stats.modifiers[2], Some(3));
    assert_eq!(stats.checks[2], Some(3));
    assert_eq!(
        stats.saves,
        [Some(0), Some(3), Some(6), Some(1), Some(0), Some(-1)]
    );

    let html = render_html(&sheet);
    assert!(html.contains("data-pin=\"saved-attack:signal-bow\""));
    assert!(html.contains("data-pin=\"Spell:ID_TEST_SPELL_FLARE\""));
    assert!(html.contains("data-stat=\"hp\">27 max"));
    assert!(html.contains("data-stat=\"ac\">18"));
    assert!(html.contains("data-stat=\"con\">+6"));
    assert_eq!(html.matches("class=\"ability-tile\"").count(), 6);
    assert!(html.contains("data-ability=\"Constitution\" data-check=\"+3\""));
    let full = html.split_once("id=\"full-sheet\"").unwrap().1;
    assert!(full.contains("Rowan &amp; Mira kept the coast lit.\nThey now chart the fog."));
    assert!(full.contains("I always leave a light in the window."));
    assert!(full.contains("Lamplighters offer a dry bunk."));
    assert!(full.contains("Lamplighter"));
}

#[test]
fn shows_saved_hp_rolls_equipped_speed_and_unresolved_spell_levels() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let character = import_character(
        &fixtures.join("rolled-hp.dnd5e"),
        &fixtures.join("combat-sheet.xml"),
    )
    .unwrap();
    let sheet = CombatSheet::from_character(&character);
    assert_eq!(sheet.profile.stats.max_hp, Some(27)); // 8 + 3 + 7 + (3 × 3 CON)
    assert_eq!(
        sheet.profile.stats.speed.as_deref(),
        Some("45 ft. walk · 45 ft. swim")
    );
    let html = render_html(&sheet);
    assert!(html.contains(
        "Spark</span><span class=\"option-badges\"><span class=\"spell-level\">Cantrip</span>"
    ));
    assert!(html.contains(
        "Flash</span><span class=\"option-badges\"><span class=\"spell-level\">Level 2</span>"
    ));
    assert_eq!(sheet.infusions.len(), 2);
    assert!(html.contains(
        "data-infusion=\"ID_TEST_ARTIFICER_INFUSION_ENHANCED_DEFENSE\">Enhanced Defense"
    ));
    assert!(html.contains("data-infusion=\"ID_TEST_ARTIFICER_INFUSION_REPLICATE_MAGIC_ITEM_OPTION_CLOAK\">Cloak of Hiding"));
}

#[test]
fn leaves_unsupplied_stats_available_for_local_correction() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let character = import_character(
        &fixtures.join("sample.dnd5e"),
        &fixtures.join("sample-content.xml"),
    )
    .unwrap();
    let sheet = CombatSheet::from_character(&character);
    assert!(sheet.profile.stats.max_hp.is_none());
    assert!(sheet.profile.stats.armor_class.is_none());
    assert!(sheet.profile.stats.speed.is_none());
    assert_eq!(sheet.profile.stats.saves, [None; 6]);
    let html = render_html(&sheet);
    assert!(html.contains("data-stat=\"hp\">Unavailable"));
    assert!(html.contains("Save stat overrides"));
}

#[test]
fn imports_consumable_quantities_without_treating_reusable_charges_as_units() {
    let sheet = sheet();
    let belt = option(&sheet, ActionGroup::BonusAction, "Healing Draught (belt)")
        .consumable
        .as_ref()
        .unwrap();
    let pack = option(&sheet, ActionGroup::BonusAction, "Healing Draught (pack)")
        .consumable
        .as_ref()
        .unwrap();
    assert_ne!(belt.key, pack.key);
    assert_eq!(belt.remaining, Some(2));
    assert_eq!(pack.remaining, Some(4));
    assert_eq!(
        option(&sheet, ActionGroup::Reaction, "Scroll of Shield Flash")
            .consumable
            .as_ref()
            .unwrap()
            .remaining,
        Some(1)
    );
    let legacy: Vec<_> = sheet
        .groups
        .iter()
        .flat_map(|group| &group.options)
        .filter(|option| option.name == "Scroll of Twin Signal")
        .collect();
    assert_eq!(legacy.len(), 1);
    assert_eq!(legacy[0].consumable.as_ref().unwrap().remaining, Some(3));
    assert!(
        option(&sheet, ActionGroup::Action, "Signal Rod")
            .consumable
            .is_none()
    );

    let html = render_html(&sheet);
    assert!(html.contains("aria-label=\"Use Empty Draught Stack\" disabled"));
    assert!(html.contains("aria-label=\"Use Uncertain Draught Stack\" disabled"));
    assert!(!html.contains("aria-label=\"Use Signal Rod\""));
}

#[test]
fn exposes_concentration_from_a_spell_and_a_generated_scroll() {
    let sheet = sheet();
    let spell = option(&sheet, ActionGroup::Action, "Flare")
        .concentration
        .as_ref()
        .unwrap();
    assert_eq!(spell.duration_seconds, Some(60));
    let scroll = option(&sheet, ActionGroup::Reaction, "Scroll of Shield Flash")
        .concentration
        .as_ref()
        .unwrap();
    assert_eq!(scroll.name, "Shield Flash");
    assert_eq!(scroll.duration_seconds, Some(12));
    assert!(
        option(&sheet, ActionGroup::Reaction, "Counter Spark")
            .concentration
            .is_none()
    );

    let html = render_html(&sheet);
    assert!(html.contains("data-cast-spell aria-label=\"Cast Flare\""));
    assert!(html.contains("data-focus-spell=\"Shield Flash\""));
    assert!(html.contains("id=\"replace-concentration\""));
}
