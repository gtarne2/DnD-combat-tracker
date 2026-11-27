//! The tracker's mechanics overlay: template shapes, sizes and colours keyed by spell name and
//! book, used only for spells the player has imported.
use std::path::Path;

use aurora_combat_tracker::{
    aurora::import_character,
    combat::{AreaShape, CombatSheet, OptionKind, SpellArea, render_html},
    mechanics::{Overlay, overlay},
};

#[test]
fn bundled_overlay_matches_by_name_and_book() {
    let overlay = overlay();
    assert!(overlay.spell_count() > 200);

    let wall = overlay
        .spell("Wall of Fire", Some("Player’s Handbook"))
        .unwrap();
    assert_eq!(wall.edition, "2014");
    assert_eq!(
        wall.area.unwrap().spell_area(),
        SpellArea {
            shape: AreaShape::Line,
            size: 60,
            width: Some(1)
        }
    );
    // The 2024 book picks the 2024 version, which differs for Sleep.
    let sleep_2014 = overlay.spell("Sleep", Some("Player's Handbook")).unwrap();
    let sleep_2024 = overlay
        .spell("Sleep", Some("Player's Handbook (2024)"))
        .unwrap();
    assert_eq!(sleep_2014.area.unwrap().size, 20);
    assert_eq!(sleep_2024.area.unwrap().size, 5);
    // A 5etools code works as a source too.
    assert_eq!(
        overlay.spell("sleep", Some("XPHB")).unwrap().edition,
        "2024"
    );
    // Homebrew or unknown books get nothing; no source falls back to 2014.
    assert!(
        overlay
            .spell("Fireball", Some("Homebrew Workshop"))
            .is_none()
    );
    assert_eq!(overlay.spell("Fireball", None).unwrap().edition, "2014");
    assert!(overlay.spell("Not A Real Spell", None).is_none());

    let fire = overlay.damage_colour("fire").unwrap().to_owned();
    let fireball = overlay.spell("Fireball", None);
    assert_eq!(overlay.template_colour(fireball, None), Some(fire.clone()));
    let web = overlay.spell("Web", None);
    assert_ne!(overlay.template_colour(web, Some("fire")), Some(fire));
}

#[test]
fn unusable_entries_are_dropped_and_other_schemas_refused() {
    let parsed = Overlay::parse(
        r##"{"schema":1,"damage_colours":{"fire":"orange"},"books":{"Book":"BK"},
        "spells":[{"name":"Odd","edition":"2014","sources":["BK"],
        "area":{"shape":"cone","size":15,"width":5},"colour":"#12345"}]}"##,
    )
    .unwrap();
    let odd = parsed.spell("Odd", Some("Book")).unwrap();
    assert!(odd.area.is_none());
    assert!(odd.colour.is_none());
    assert!(parsed.damage_colour("fire").is_none());
    assert!(Overlay::parse(r#"{"schema":2}"#).is_err());
}

#[test]
fn the_sheet_uses_the_overlay_only_for_matching_imports() {
    let files = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let character = import_character(
        &files.join("overlay-spells.dnd5e"),
        &files.join("overlay-spells.xml"),
    )
    .unwrap();
    let sheet = CombatSheet::from_character(&character);
    let spell = |name: &str| {
        sheet
            .groups
            .iter()
            .flat_map(|group| &group.options)
            .find(|option| option.kind == OptionKind::Spell && option.name == name)
            .unwrap_or_else(|| panic!("{name} is on the sheet"))
            .spell_options
            .clone()
    };
    let fire = overlay().damage_colour("fire").map(str::to_owned);

    // The description names no area; the overlay supplies the wall.
    let wall = spell("Wall of Fire");
    assert!(wall.overlay);
    assert_eq!(
        wall.area,
        Some(SpellArea {
            shape: AreaShape::Line,
            size: 60,
            width: Some(1)
        })
    );
    assert_eq!(wall.colour, fire);

    // The overlay's measurement for the matched book replaces the one read from the text.
    let fireball = spell("Fireball");
    assert!(fireball.overlay);
    assert_eq!(
        fireball.area,
        Some(SpellArea {
            shape: AreaShape::Sphere,
            size: 20,
            width: None
        })
    );

    // A homebrew book is left to its own text.
    let web = spell("Web");
    assert!(!web.overlay);
    assert_eq!(
        web.area,
        Some(SpellArea {
            shape: AreaShape::Cube,
            size: 15,
            width: None
        })
    );
    assert_eq!(web.colour, None);

    // No source: the 2014 entry applies.
    let shatter = spell("Shatter");
    assert!(shatter.overlay);
    assert_eq!(
        shatter.area,
        Some(SpellArea {
            shape: AreaShape::Sphere,
            size: 10,
            width: None
        })
    );

    let html = render_html(&sheet);
    assert!(html.contains("data-spell-area=\"line 60 1\""));
    assert!(html.contains(&format!("data-spell-colour=\"{}\"", fire.unwrap())));
    assert!(html.contains("data-spell-overlay"));
}
