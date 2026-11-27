//! O3 spell templates: reading an area of effect from Aurora's range text and descriptions.
use aurora_combat_tracker::combat::{AreaShape::*, SpellArea, spell_area};

fn area(
    shape: aurora_combat_tracker::combat::AreaShape,
    size: u32,
    width: Option<u32>,
) -> Option<SpellArea> {
    Some(SpellArea { shape, size, width })
}

#[test]
fn areas_from_range_text() {
    assert_eq!(
        spell_area(Some("Self (15-foot cone)"), ""),
        area(Cone, 15, None)
    );
    assert_eq!(
        spell_area(Some("Self (15-foot cube)"), ""),
        area(Cube, 15, None)
    );
    assert_eq!(
        spell_area(Some("Self (100-foot line)"), ""),
        area(Line, 100, Some(5))
    );
    assert_eq!(
        spell_area(Some("Self (15-foot radius)"), ""),
        area(Emanation, 15, None)
    );
    assert_eq!(
        spell_area(Some("Self (30-foot-radius sphere)"), ""),
        area(Sphere, 30, None)
    );
    // The range wins over the description.
    assert_eq!(
        spell_area(
            Some("Self (60-foot cone)"),
            "Each creature in a 20-foot-radius sphere"
        ),
        area(Cone, 60, None)
    );
}

#[test]
fn areas_from_descriptions() {
    let fireball = "A bright streak flashes from your pointing finger to a point you choose within range and then blossoms with a low roar into an explosion of flame. Each creature in a 20-foot-radius sphere centered on that point must make a Dexterity saving throw.";
    assert_eq!(
        spell_area(Some("150 feet"), fireball),
        area(Sphere, 20, None)
    );
    let bolt = "A stroke of lightning forming a line 100 feet long and 5 feet wide blasts out from you in a direction you choose.";
    assert_eq!(spell_area(Some("Self"), bolt), area(Line, 100, Some(5)));
    let wall = "a 60-foot-long, 10-foot-wide Line that blasts out from you";
    assert_eq!(spell_area(Some("Self"), wall), area(Line, 60, Some(10)));
    let flame = "A vertical column of divine fire roars down from the heavens in a location you specify. Each creature in a 10-foot-radius, 40-foot-high cylinder centered on a point within range must make a Dexterity saving throw.";
    assert_eq!(spell_area(Some("60 feet"), flame), area(Cylinder, 10, None));
    let web = "You conjure a mass of thick, sticky webbing at a point of your choice within range. The webs fill a 20-foot cube from that point for the duration.";
    assert_eq!(spell_area(Some("60 feet"), web), area(Cube, 20, None));
    let guardians = "Spirits flit around you to a distance of 15 feet. In a 15-foot Emanation";
    assert_eq!(
        spell_area(Some("Self"), guardians),
        area(Emanation, 15, None)
    );
    let hands = "As you hold your hands with thumbs touching and fingers spread, a thin sheet of flames shoots forth from your outstretched fingertips. Each creature in a 15-foot cone must make a Dexterity saving throw.";
    assert_eq!(
        spell_area(Some("Self (15-foot cone)"), hands),
        area(Cone, 15, None)
    );
}

#[test]
fn no_area_when_none_is_named() {
    assert_eq!(
        spell_area(
            Some("120 feet"),
            "You hurl a mote of fire at a creature within range."
        ),
        None
    );
    assert_eq!(
        spell_area(
            Some("Touch"),
            "A creature you touch regains hit points. It can move 30 feet."
        ),
        None
    );
    assert_eq!(spell_area(None, ""), None);
    assert_eq!(
        SpellArea {
            shape: Line,
            size: 100,
            width: Some(5)
        }
        .attribute(),
        "line 100 5"
    );
    assert_eq!(
        SpellArea {
            shape: Sphere,
            size: 20,
            width: None
        }
        .attribute(),
        "sphere 20"
    );
}

#[test]
fn saves_and_damage_types_from_descriptions() {
    use aurora_combat_tracker::combat::{SpellSave, spell_damage_type, spell_save};
    let fireball = "Each creature in a 20-foot-radius sphere centered on that point must make a Dexterity saving throw. A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one.";
    assert_eq!(
        spell_save(fireball),
        Some(SpellSave {
            ability: "dexterity",
            half: true
        })
    );
    assert_eq!(spell_damage_type(fireball), Some("fire"));
    let guardians = "an affected creature's speed is halved in the area, and when the creature enters the area for the first time on a turn or starts its turn there, it must make a Wisdom saving throw. On a failed save, the creature takes 3d8 radiant damage (if you are good or neutral) or 3d8 necrotic damage (if you are evil). On a successful save, the creature takes half as much damage.";
    assert_eq!(
        spell_save(guardians),
        Some(SpellSave {
            ability: "wisdom",
            half: true
        })
    );
    assert_eq!(spell_damage_type(guardians), Some("radiant"));
    let sleep = "Creatures within 20 feet of a point you choose fall unconscious.";
    assert_eq!(spell_save(sleep), None);
    let hold =
        "Choose a humanoid. The target must succeed on a Wisdom saving throw or be paralyzed.";
    assert_eq!(
        spell_save(hold),
        Some(SpellSave {
            ability: "wisdom",
            half: false
        })
    );
    assert_eq!(
        SpellSave {
            ability: "dexterity",
            half: true
        }
        .attribute(),
        "dexterity half"
    );
}
