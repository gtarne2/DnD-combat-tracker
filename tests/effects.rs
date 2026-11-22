use std::path::Path;

use aurora_combat_tracker::{
    companion::CompanionTurn,
    effects::{EffectDetails, EffectDuration, OngoingEffect, TurnBoundary},
    encounter::InitiativeId,
    session::CharacterSession,
};

fn session() -> CharacterSession<(), ()> {
    let files = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    CharacterSession::open(
        files.join("companions.dnd5e"),
        vec![files.join("companions.xml")],
        (),
        (),
    )
    .unwrap()
}

fn details(name: &str, target: InitiativeId, duration: EffectDuration) -> EffectDetails {
    EffectDetails {
        name: name.into(),
        notes: "Custom effect".into(),
        target,
        duration,
    }
}

fn effect(session: &CharacterSession<(), ()>, name: &str) -> &'static str {
    let effect = session
        .progress()
        .effects
        .entries()
        .iter()
        .find(|effect| effect.details.name == name)
        .unwrap();
    if effect.active() { "active" } else { "ended" }
}

fn details_of<'a>(session: &'a CharacterSession<(), ()>, name: &str) -> &'a OngoingEffect {
    session
        .progress()
        .effects
        .entries()
        .iter()
        .find(|effect| effect.details.name == name)
        .unwrap()
}

#[test]
fn advances_rounds_starts_ends_and_the_in_game_clock_in_order() {
    let mut session = session();
    let moth = InitiativeId::Companion(session.companions.cards[0].id);
    let mut sentry = InitiativeId::Owner;
    session.edit_combat(|progress, roster| {
        roster.owner_initiative = Some(18);
        sentry = InitiativeId::Combatant(progress.add_combatant("Sentry".into(), 12, None));
        progress
            .effects
            .add(details("Berserk", moth, EffectDuration::Rounds(1)));
        progress.effects.add(details(
            "Clock",
            InitiativeId::Owner,
            EffectDuration::Seconds(12),
        ));
        progress.effects.add(details(
            "Shared start",
            moth,
            EffectDuration::Turn {
                anchor: None,
                boundary: TurnBoundary::Start,
                remaining: 1,
            },
        ));
        progress.effects.add(details(
            "Shared end",
            moth,
            EffectDuration::Turn {
                anchor: None,
                boundary: TurnBoundary::End,
                remaining: 1,
            },
        ));
        progress.effects.add(details(
            "Sentry start",
            InitiativeId::Owner,
            EffectDuration::Turn {
                anchor: Some(sentry),
                boundary: TurnBoundary::Start,
                remaining: 1,
            },
        ));
    });
    assert_eq!(session.next_turn(), Some(InitiativeId::Owner));
    assert_eq!(effect(&session, "Shared start"), "ended");
    assert_eq!(effect(&session, "Shared end"), "active");
    assert_eq!(effect(&session, "Sentry start"), "active");
    assert_eq!(session.next_turn(), Some(sentry));
    assert_eq!(effect(&session, "Shared end"), "ended");
    assert_eq!(effect(&session, "Sentry start"), "ended");
    assert_eq!(effect(&session, "Berserk"), "active");
    assert_eq!(session.next_turn(), Some(InitiativeId::Owner));
    assert_eq!(session.progress().round, 2);
    assert_eq!(effect(&session, "Berserk"), "ended");
    assert_eq!(
        details_of(&session, "Clock").details.duration,
        EffectDuration::Seconds(6)
    );
    assert!(session.undo_combat());
    assert_eq!(session.progress().current, Some(sentry));
    assert_eq!(effect(&session, "Berserk"), "active");
    assert_eq!(
        details_of(&session, "Clock").details.duration,
        EffectDuration::Seconds(12)
    );
}

#[test]
fn follows_separate_companion_turns_and_preserves_edited_effects_on_reimport() {
    let mut session = session();
    let moth = InitiativeId::Companion(session.companions.cards[0].id);
    let mut manual = 0;
    session.edit_combat(|progress, roster| {
        roster.owner_initiative = Some(18);
        roster.cards[0].turn = CompanionTurn::Separate(10);
        progress.effects.add(details(
            "Moth start",
            moth,
            EffectDuration::Turn {
                anchor: None,
                boundary: TurnBoundary::Start,
                remaining: 1,
            },
        ));
        manual = progress
            .effects
            .add(details("Berserk", moth, EffectDuration::Manual))
            .unwrap();
    });
    assert_eq!(session.next_turn(), Some(InitiativeId::Owner));
    assert_eq!(effect(&session, "Moth start"), "active");
    assert_eq!(session.next_turn(), Some(moth));
    assert_eq!(effect(&session, "Moth start"), "ended");
    assert_eq!(effect(&session, "Berserk"), "active");
    session.edit_combat(|progress, _| assert!(progress.effects.end(manual)));
    assert!(details_of(&session, "Berserk").ended);
    assert!(session.undo_combat());
    session.edit_combat(|progress, _| {
        assert!(
            progress
                .effects
                .edit(manual, details("Berserk", moth, EffectDuration::Seconds(8)))
        )
    });
    session.reimport().unwrap();
    session.advance_concentration_time(8);
    assert_eq!(effect(&session, "Berserk"), "ended");
    assert!(session.undo_combat());
    assert_eq!(
        details_of(&session, "Berserk").details.duration,
        EffectDuration::Seconds(8)
    );
}
