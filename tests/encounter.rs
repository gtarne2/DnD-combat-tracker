use std::path::Path;

use aurora_combat_tracker::{
    companion::CompanionTurn,
    concentration::{ConcentrationCast, ConcentrationRules, ConcentrationSpell},
    effects::{EffectDetails, EffectDuration},
    encounter::{HitPoints, InitiativeId},
    session::CharacterSession,
};

fn session(save: &str, content: &str) -> CharacterSession<(), ()> {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    CharacterSession::open(fixtures.join(save), vec![fixtures.join(content)], (), ()).unwrap()
}

#[test]
fn initiative_keeps_current_actor_on_edit_wraps_and_undoes_the_round() {
    let mut session = session("companions.dnd5e", "companions.xml");
    let companion = session.companions.cards[0].id;
    let mut enemy = 0;
    session.edit_combat(|progress, companions| {
        companions.owner_initiative = Some(12);
        companions.cards[0].turn = CompanionTurn::Separate(16);
        companions.cards[0].remaining_rounds = Some(2);
        enemy = progress.add_combatant(
            "Sentry".into(),
            15,
            Some(HitPoints {
                current: 14,
                maximum: None,
            }),
        );
    });
    assert_eq!(
        session.next_turn(),
        Some(InitiativeId::Companion(companion))
    );
    assert_eq!(session.next_turn(), Some(InitiativeId::Combatant(enemy)));
    session.edit_combat(|progress, _| progress.combatants[0].initiative = 14);
    assert_eq!(
        session.progress().current,
        Some(InitiativeId::Combatant(enemy))
    );
    assert_eq!(session.next_turn(), Some(InitiativeId::Owner));
    assert_eq!(
        session.next_turn(),
        Some(InitiativeId::Companion(companion))
    );
    assert_eq!(session.progress().round, 2);
    assert_eq!(session.companions.cards[0].remaining_rounds, Some(1));
    assert!(session.undo_combat());
    assert_eq!(session.progress().round, 1);
    assert_eq!(session.progress().current, Some(InitiativeId::Owner));
    assert_eq!(session.companions.cards[0].remaining_rounds, Some(2));
}

#[test]
fn damage_and_resource_changes_undo_without_affecting_the_import() {
    let mut session = session("combat-sheet.dnd5e", "combat-sheet.xml");
    let sheet = session.combat_sheet();
    assert_eq!(
        sheet
            .resources
            .iter()
            .find(|slot| slot.key == "Spell slot:1")
            .unwrap()
            .capacity,
        3
    );
    assert_eq!(
        sheet
            .resources
            .iter()
            .find(|slot| slot.key == "Pact Magic slot:2")
            .unwrap()
            .capacity,
        2
    );
    let turret = sheet
        .resources
        .iter()
        .find(|feature| feature.name == "Signal Turret")
        .unwrap();
    assert_eq!(turret.capacity, 1);
    let spell = sheet
        .groups
        .iter()
        .flat_map(|group| &group.options)
        .find(|option| option.name == "Flare")
        .unwrap()
        .concentration
        .clone()
        .unwrap();
    session
        .start_concentration(ConcentrationCast {
            spell,
            scroll_key: None,
        })
        .unwrap();
    let rules = ConcentrationRules::Rules2014;
    assert_eq!(session.record_damage(8, rules).unwrap().dc, 10);
    assert_eq!(session.progress().owner_hp(Some(27)).unwrap().current, 19);
    assert_eq!(session.record_damage(40, rules), None);
    assert!(session.concentration.active().is_none());
    assert!(session.undo_combat());
    assert!(session.concentration.active().is_some());
    assert!(session.concentration.next_save().is_some());
    assert_eq!(session.progress().owner_hp(Some(27)).unwrap().current, 19);

    session.edit_combat(|progress, _| {
        assert!(progress.spend(&turret.key, turret.capacity));
        assert!(!progress.spend(&turret.key, turret.capacity));
    });
    assert_eq!(
        session.progress().remaining(&turret.key, turret.capacity),
        0
    );
    assert!(session.undo_combat());
    assert_eq!(
        session.progress().remaining(&turret.key, turret.capacity),
        1
    );
    session.reimport().unwrap();
    assert_eq!(session.progress().owner_hp(Some(27)).unwrap().current, 19);
}

#[test]
fn ending_and_restarting_an_encounter_preserves_combat_state_and_can_be_undone() {
    let mut session = session("companions.dnd5e", "companions.xml");
    session.edit_combat(|progress, roster| {
        roster.owner_initiative = Some(14);
        roster.cards[0].remaining_rounds = Some(5);
        progress.owner_hp = Some(HitPoints {
            current: 8,
            maximum: Some(16),
        });
        progress.spend("Spell slot:1", 2);
        progress.effects.add(EffectDetails {
            name: "Ongoing".into(),
            notes: String::new(),
            target: InitiativeId::Owner,
            duration: EffectDuration::Rounds(4),
        });
    });
    session
        .start_concentration(ConcentrationCast {
            spell: ConcentrationSpell::new(
                "test".into(),
                "Test focus".into(),
                Some("1 minute".into()),
            ),
            scroll_key: None,
        })
        .unwrap();
    session.next_turn();
    session.next_turn();
    let before = session.progress().clone();
    let companions = session.companions.clone();
    let concentration = session.concentration.clone();
    assert_eq!(before.round, 2);
    assert!(session.end_encounter());
    assert!(!session.end_encounter());
    assert_eq!(session.next_turn(), None);
    let mut stopped = before.clone();
    stopped.active = false;
    assert_eq!(session.progress(), &stopped);
    assert_eq!(session.companions, companions);
    assert_eq!(session.concentration, concentration);
    assert!(session.undo_combat());
    assert_eq!(session.progress(), &before);
    assert!(session.end_encounter());
    assert!(session.start_encounter());
    assert!(!session.start_encounter());
    let mut restarted = before;
    restarted.round = 1;
    assert_eq!(session.progress(), &restarted);
    assert_eq!(session.companions, companions);
    assert_eq!(session.concentration, concentration);
    assert!(session.undo_combat());
    assert_eq!(session.progress(), &stopped);
}
