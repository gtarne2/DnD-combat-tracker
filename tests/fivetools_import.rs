use aurora_combat_tracker::{
    fivetools::{import_fivetools_pack, plain},
    monsters::{Pack, PackInfo},
};

fn info() -> PackInfo {
    PackInfo {
        id: "5etools-test".into(),
        edition: "2014".into(),
        source: "Synthetic 5etools file".into(),
        attribution: "Original synthetic creatures for tests.".into(),
        source_version: None,
        license: None,
    }
}

// Original creatures in 5etools bestiary shape.
const FILE: &str = r#"{
  "_meta": {"sources": [{"json": "TST", "full": "Test Book"}]},
  "monster": [
    {
      "name": "Moss Prowler", "source": "TST", "page": 12,
      "size": ["M"],
      "type": {"type": "monstrosity", "tags": ["shapechanger"]},
      "alignment": ["C", "E"],
      "ac": [{"ac": 14, "from": ["{@item hide armor|phb}"]}, {"ac": 16, "condition": "while in moss", "braces": true}],
      "hp": {"average": 33, "formula": "6d8 + 6"},
      "speed": {"walk": 30, "climb": 20, "fly": {"number": 40, "condition": "(only in storms)"}},
      "str": 14, "dex": 15, "con": 12, "int": 6, "wis": 13, "cha": 8,
      "save": {"dex": "+4"},
      "skill": {"perception": "+3", "sleight of hand": "+4"},
      "senses": ["darkvision 60 ft."], "passive": 13,
      "resist": ["cold", {"resist": ["bludgeoning", "piercing"], "note": "from nonmagical attacks", "cond": true}],
      "conditionImmune": ["charmed"],
      "languages": ["understands Sylvan but can't speak"],
      "cr": "2",
      "trait": [{"name": "Moss Step", "entries": ["The prowler ignores {@quickref difficult terrain||3} made of plants."]}],
      "spellcasting": [{
        "name": "Innate Spellcasting", "headerEntries": ["The prowler's spellcasting ability is Wisdom (spell save {@dc 11})."],
        "will": ["{@spell druidcraft}"], "daily": {"1e": ["{@spell entangle}"]}, "ability": "wis"
      }],
      "action": [
        {"name": "Multiattack", "entries": ["The prowler makes two claw attacks."]},
        {"name": "Claw", "entries": ["{@atk mw} {@hit 4} to hit, reach 5 ft., one target. {@h}6 ({@damage 1d8 + 2}) slashing damage."]},
        {"name": "Spore Burst {@recharge 5}", "entries": ["Each creature within 10 feet must make a {@dc 12} Constitution saving throw, taking 7 ({@damage 2d6}) poison damage on a failed save, or half as much on a success.",
          {"type": "list", "items": ["{@condition Poisoned} creatures also fall {@condition prone}."]}]}
      ],
      "legendaryActions": 2,
      "legendary": [{"name": "Lunge (Costs 2 Actions)", "entries": ["The prowler moves 15 feet and makes a claw attack."]}],
      "legendaryGroup": {"name": "Moss Prowler", "source": "TST"}
    },
    {
      "name": "Lantern Mite", "source": "TST",
      "size": ["T", "S"], "type": "beast", "alignment": ["U"],
      "ac": [11], "hp": {"special": "1 per mite"},
      "speed": {"walk": 10, "fly": 30, "canHover": true},
      "str": 2, "dex": 13, "con": 8, "int": 1, "wis": 10, "cha": 3,
      "passive": 10, "cr": {"cr": "1/8", "lair": "1/4"},
      "initiative": {"proficiency": 1},
      "action": [{"name": "Sting", "entries": ["{@atkr m} {@hit 3}, reach 5 ft. {@h}1 piercing damage."]}]
    },
    {"name": "Moss Prowler Elder", "source": "TST", "_copy": {"name": "Moss Prowler", "source": "TST", "_mod": {}}}
  ]
}"#;

#[test]
fn converts_5etools_monsters_into_a_valid_pack() {
    let import = import_fivetools_pack(info(), FILE).unwrap();
    let pack = import.pack;
    assert_eq!(pack.monsters.len(), 2);
    assert_eq!(import.warnings.len(), 1);
    assert!(import.warnings[0].contains("Moss Prowler Elder"));

    let prowler = &pack.monsters[0];
    let s = &prowler.stats;
    assert_eq!(prowler.id, "5et:moss-prowler.tst");
    assert_eq!(s.size.as_deref(), Some("Medium"));
    assert_eq!(s.creature_type.as_deref(), Some("Monstrosity"));
    assert_eq!(s.defenses.ac, Some(14));
    assert_eq!(s.defenses.armor.as_deref(), Some("hide armor"));
    assert_eq!(s.defenses.conditional_ac[0].ac, Some(16));
    assert_eq!(s.defenses.conditional_ac[0].qualifier, "while in moss");
    assert_eq!(s.hp, Some(33));
    assert_eq!(s.hit_dice.as_deref(), Some("6d8+6"));
    assert_eq!(
        s.speed.as_deref(),
        Some("30 ft., climb 20 ft., fly 40 ft. (only in storms)")
    );
    assert_eq!(s.abilities["Dexterity"], 15);
    assert_eq!(s.saves["Dexterity"], 4);
    assert_eq!(s.skills["Sleight of Hand"], 4);
    assert_eq!(
        s.senses.as_deref(),
        Some("darkvision 60 ft., passive Perception 13")
    );
    assert_eq!(
        s.defenses.resistances.as_deref(),
        Some("cold; bludgeoning, piercing from nonmagical attacks")
    );
    assert_eq!(s.challenge.as_deref(), Some("2"));
    let details = s.details.as_ref().unwrap();
    assert_eq!(details.alignment.as_deref(), Some("chaotic evil"));
    assert_eq!(details.xp, Some(450));
    assert_eq!(details.sections[0].text, "Monstrosity (shapechanger)");
    assert_eq!(
        details.legendary_preamble.as_deref(),
        Some("Can take 2 legendary actions.")
    );
    assert_eq!(
        pack.monsters[1].stats.details.as_ref().unwrap().xp,
        Some(25)
    );
    assert!(s.notes.as_deref().unwrap().contains("Lair actions"));

    assert_eq!(
        s.traits[0].text,
        "The prowler ignores difficult terrain made of plants."
    );
    let casting = &s.traits[1];
    assert!(casting.text.contains("spell save DC 11"));
    assert!(casting.text.contains("At will: druidcraft"));
    assert!(casting.text.contains("1/day each: entangle"));

    let claw = &s.actions[1];
    assert_eq!(
        claw.text,
        "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 6 (1d8 + 2) slashing damage."
    );
    assert_eq!(claw.attack_bonus, Some(4));
    let burst = &s.actions[2];
    assert_eq!(burst.name, "Spore Burst (Recharge 5–6)");
    assert_eq!(burst.recharge.as_ref().map(|r| r.minimum), Some(5));
    assert_eq!(burst.save_dc, Some(12));
    assert!(
        burst
            .text
            .ends_with("• Poisoned creatures also fall prone.")
    );
    let lunge = &s.legendary_actions[0];
    assert_eq!(
        lunge.resolution.as_ref().and_then(|r| r.legendary_cost),
        Some(2)
    );

    let mite = &pack.monsters[1];
    let details = mite.stats.details.as_ref().unwrap();
    assert_eq!(mite.stats.size, None);
    assert_eq!(details.sizes, ["Tiny", "Small"]);
    assert_eq!(details.alignment.as_deref(), Some("unaligned"));
    assert_eq!(mite.stats.challenge.as_deref(), Some("1/8"));
    assert_eq!(details.challenge_notes.as_deref(), Some("lair 1/4"));
    assert_eq!(
        mite.stats.speed.as_deref(),
        Some("10 ft., fly 30 ft. (hover)")
    );
    assert_eq!(mite.stats.hp, None);
    assert!(mite.stats.notes.as_deref().unwrap().contains("1 per mite"));
    // Dex 13 (+1) plus proficiency bonus 2.
    assert_eq!(
        details.initiative.as_ref().and_then(|i| i.modifier),
        Some(3)
    );
    assert_eq!(
        mite.stats.actions[0].text,
        "Melee Attack Roll: +3, reach 5 ft. Hit: 1 piercing damage."
    );

    // The converted pack survives the native round trip used by save and export.
    let json = serde_json::to_vec(&pack).unwrap();
    Pack::decode(&json).unwrap();
}

#[test]
fn computes_2024_initiative_and_gear() {
    let file = r#"{"monster": [{"name": "Reed Scout", "source": "TST", "dex": 15, "cr": "1",
        "gear": ["shortbow|xphb", {"item": "arrow|xphb", "quantity": 20}]}]}"#;
    let mut modern = info();
    modern.edition = "2024".into();
    let pack = import_fivetools_pack(modern, file).unwrap().pack;
    let details = pack.monsters[0].stats.details.as_ref().unwrap();
    let initiative = details.initiative.as_ref().unwrap();
    assert_eq!((initiative.modifier, initiative.score), (Some(2), Some(12)));
    assert_eq!(details.gear.as_deref(), Some("shortbow, arrow (20)"));
    let older = import_fivetools_pack(info(), file).unwrap().pack;
    assert!(
        older.monsters[0]
            .stats
            .details
            .as_ref()
            .unwrap()
            .initiative
            .is_none()
    );
}

#[test]
fn rejects_files_without_importable_monsters() {
    assert!(import_fivetools_pack(info(), r#"{"spell": []}"#).is_err());
    let copies = r#"{"monster": [{"name": "A", "_copy": {"name": "B", "source": "MM"}}]}"#;
    let error = import_fivetools_pack(info(), copies).unwrap_err();
    assert!(error.contains("copies B · MM"));
}

#[test]
fn duplicate_names_get_distinct_ids() {
    let file = r#"{"monster": [
        {"name": "Twin", "source": "TST", "action": [{"name": "Poke", "entries": ["Poke."]}, {"name": "Poke", "entries": ["Again."]}]},
        {"name": "Twin", "source": "TST"}
    ]}"#;
    let pack = import_fivetools_pack(info(), file).unwrap().pack;
    assert_eq!(pack.monsters[1].id, "5et:twin.tst-2");
    assert_eq!(pack.monsters[0].stats.actions[1].id, "actions.poke-2");
}

#[test]
fn renders_common_tags() {
    assert_eq!(plain("{@spell fireball|phb|Fire Ball}"), "Fire Ball");
    assert_eq!(plain("{@creature goblin|mm}"), "goblin");
    assert_eq!(
        plain("{@actSave dex} {@dc 14}"),
        "Dexterity Saving Throw: DC 14"
    );
    assert_eq!(plain("{@d20 -1}"), "-1");
    assert_eq!(plain("{@chance 25}"), "25 percent");
    assert_eq!(plain("{@note see {@i below}}"), "see below");
    assert_eq!(plain("{@recharge}"), "(Recharge 6)");
    assert_eq!(plain("{@atk mw,rw}"), "Melee or Ranged Weapon Attack:");
}

/// Manual check against a real local bestiary file, which stays outside Git:
/// `FIVETOOLS_FILE=path/to/bestiary-mm.json cargo test --test fivetools_import -- --ignored --nocapture`
#[test]
#[ignore]
fn imports_local_bestiary_file() {
    let path = std::env::var("FIVETOOLS_FILE").expect("set FIVETOOLS_FILE");
    let import = import_fivetools_pack(info(), &std::fs::read_to_string(path).unwrap()).unwrap();
    println!(
        "{} monsters, {} warnings",
        import.pack.monsters.len(),
        import.warnings.len()
    );
    // Optionally write the converted response for inspection.
    if let Ok(out) = std::env::var("FIVETOOLS_OUT") {
        std::fs::write(out, serde_json::to_vec(&import).unwrap()).unwrap();
    }
    for warning in import.warnings.iter().take(10) {
        println!("  {warning}");
    }
    let leftover: Vec<_> = import
        .pack
        .monsters
        .iter()
        .flat_map(|m| {
            let s = &m.stats;
            [
                &s.traits,
                &s.actions,
                &s.bonus_actions,
                &s.reactions,
                &s.legendary_actions,
            ]
            .into_iter()
            .flatten()
            .filter(|a| a.text.contains("{@") || a.name.contains("{@"))
            .map(move |a| format!("{}: {}", m.name, a.name))
        })
        .collect();
    assert!(leftover.is_empty(), "unrendered tags: {leftover:?}");
}
