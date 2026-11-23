use std::path::Path;

use aurora_combat_tracker::{
    aurora::import_character,
    combat::{CombatSheet, render_html},
    companion::{CompanionDetails, CompanionTurn},
    session::CharacterSession,
};

#[test]
fn imports_cannon_variants_and_creature_abilities_as_reusable_templates() {
    let files = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let character = import_character(
        &files.join("companions.dnd5e"),
        &files.join("companions.xml"),
    )
    .unwrap();
    let sheet = CombatSheet::from_character(&character);
    let template = |name| {
        &sheet
            .companion_templates
            .iter()
            .find(|template| template.details.name == name)
            .unwrap()
            .details
    };
    let ballista = template("Eldritch Cannon — Force Ballista");
    assert_eq!(ballista.max_hp, Some(15));
    assert_eq!(ballista.armor_class, "18");
    assert_eq!(ballista.duration, "1 hour");
    assert!(ballista.command.contains("bonus action"));
    assert!(ballista.attacks.contains("120 feet"));
    assert!(
        template("Eldritch Cannon — Flamethrower")
            .abilities
            .contains("15-foot cone")
    );
    assert_eq!(template("Eldritch Cannon — Protector").duration, "2 hours");
    assert!(
        template("Eldritch Cannon — Protector")
            .abilities
            .contains("temporary HP")
    );
    assert_eq!(template("Warden Hound").max_hp, Some(11));

    let selected = &sheet.companions.cards[0];
    assert_eq!(selected.details.name, "Moth");
    assert_eq!(selected.current_hp, Some(7));
    assert!(selected.details.stats.contains("wisdom: 12"));
    assert!(selected.details.command.contains("command an attack"));
    assert!(selected.details.attacks.contains("Nip:"));
    assert!(selected.details.abilities.contains("Warm Glow:"));
    let html = render_html(&sheet);
    assert!(html.contains("data-companion-template=\"ID_TEST_WARDEN_HOUND\""));
    assert!(html.contains("aria-controls=\"companion-roster-content\""));
    assert!(html.contains("id=\"companion-resource-form\""));
    assert!(html.contains("id=\"quick-actions\""));
}

#[test]
fn companion_edits_and_separate_initiative_survive_reimport() {
    let files = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut session = CharacterSession::open(
        files.join("companions.dnd5e"),
        vec![files.join("companions.xml")],
        (),
        (),
    )
    .unwrap();
    let card = &mut session.companions.cards[0];
    let imported = card.id;
    card.current_hp = Some(3);
    card.turn = CompanionTurn::Separate(15);
    let summon = session.companions.add(
        None,
        CompanionDetails {
            name: "Wisp".into(),
            kind: "Summon".into(),
            duration: "1 minute".into(),
            ..CompanionDetails::default()
        },
    );
    assert_eq!(session.companions.cards[1].remaining_rounds, Some(10));
    assert_eq!(session.companions.cards[1].turn, CompanionTurn::WithOwner);
    session.companions.cards[1].turn = CompanionTurn::Separate(20);
    session.reimport().unwrap();
    assert_eq!(session.companions.cards.len(), 2);
    assert_eq!(session.companions.cards[0].current_hp, Some(3));
    assert_eq!(
        session.companions.separate_turns(),
        [(20, summon), (15, imported)]
    );
    session.companions.cards.remove(0);
    session.reimport().unwrap();
    assert_eq!(session.companions.cards.len(), 1);
    assert_eq!(
        session.combat_sheet().companions.cards[0].details.name,
        "Wisp"
    );
}
