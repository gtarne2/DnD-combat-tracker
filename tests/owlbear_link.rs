//! O1 Owlbear link: pairing codes and the player-safe table projection.
use Operation::*;
use aurora_combat_tracker::owlbear::{self, PairError, Pairing};
use aurora_combat_tracker::party::initiative::FightEdit;
use aurora_combat_tracker::party::{PartyError, Principal, RoomService, wire::*};
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};
use uuid::Uuid;

const HOST: Principal = Principal::LocalHost;
const PLAYER: Principal = Principal::Paired(Uuid::from_u128(7));

struct Database(PathBuf);
impl Drop for Database {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn command(room_id: Uuid, command: Operation) -> Command {
    Command {
        version: VERSION,
        room_id,
        command_id: Uuid::new_v4(),
        command,
    }
}

fn board(service: &RoomService, room: Uuid) -> Value {
    service.poll(HOST, room, 0).unwrap().combat.unwrap()
}

fn edit(service: &mut RoomService, room: Uuid, who: Principal, edit: Value) {
    let view = board(service, room);
    service
        .execute(
            who,
            &command(
                room,
                Initiative(FightEdit {
                    encounter_id: serde_json::from_value(view["id"].clone()).unwrap(),
                    expected_revision: view["revision"].as_u64().unwrap(),
                    edit: serde_json::from_value(edit).unwrap(),
                }),
            ),
        )
        .unwrap();
}

fn wolf() -> Value {
    let pack: Value = serde_json::from_str(include_str!(
        "../content/monster-packs/srd-5.1-monsters.json"
    ))
    .unwrap();
    let monster = pack["monsters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "ID_SRD51_MONSTER_WOLF")
        .unwrap()
        .clone();
    json!({"schema_version":pack["schema_version"],"pack":pack["info"],"revision":Uuid::new_v4(),"monster":monster})
}

#[test]
fn table_view_shows_only_what_players_may_see() {
    let db = Database(std::env::temp_dir().join(format!("aurora-obr-{}.sqlite3", Uuid::new_v4())));
    let mut service = RoomService::open(&db.0).unwrap();
    let room = Uuid::new_v4();
    service
        .execute(
            HOST,
            &command(
                room,
                Create {
                    mode: HostMode::Dm,
                    name: "Warden".into(),
                },
            ),
        )
        .unwrap();
    service
        .execute(
            PLAYER,
            &command(
                room,
                Join {
                    name: "Lark".into(),
                },
            ),
        )
        .unwrap();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"submit","score":15,"companions":[{"local_id":1,"name":"Steel Defender","initiative":12}]}),
    );
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":2,"score":14}),
    );
    let enemies: Vec<Value> = board(&service, room)["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .cloned()
        .collect();
    assert_eq!(enemies.len(), 2);
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"reveal","id":enemies[0]["id"],"revealed":true}),
    );

    let table = service.table_view(HOST, room).unwrap();
    assert_eq!(table["room_id"], json!(room));
    let rows = table["encounter"]["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 4);
    let text = table.to_string();
    // No stat blocks, HP, AC, conditions, scores or notes leave the helper.
    for private in [
        "\"hp\"",
        "\"ac\"",
        "conditions",
        "\"notes\"",
        "\"score\"",
        "\"stats\"",
        "\"actions\"",
    ] {
        assert!(!text.contains(private), "{private} leaked: {text}");
    }
    let hidden = rows.iter().find(|r| r["id"] == enemies[1]["id"]).unwrap();
    assert_eq!(hidden["kind"], "enemy");
    assert_eq!(hidden["revealed"], false);
    assert_eq!(hidden["name"], enemies[1]["enemy"]["alias"]);
    assert_eq!(hidden["down"], false);
    assert_eq!(
        hidden["template"]["key"],
        "srd-5.1-monsters/ID_SRD51_MONSTER_WOLF"
    );
    assert_eq!(hidden["template"]["name"], "Wolf");
    assert_eq!(hidden["template"]["size"], "Medium");
    let shown = rows.iter().find(|r| r["id"] == enemies[0]["id"]).unwrap();
    assert_eq!(shown["revealed"], true);
    assert_eq!(shown["name"], enemies[0]["enemy"]["alias"]);
    assert!(
        rows.iter()
            .any(|r| r["kind"] == "player" && r["name"] == "Lark")
    );
    assert!(
        rows.iter().any(|r| r["kind"] == "companion"
            && r["name"] == "Steel Defender"
            && r["local_id"] == 1)
    );

    assert!(matches!(
        service.table_view(PLAYER, room),
        Err(PartyError::Rejected(Rejection::Forbidden))
    ));
}

#[test]
fn a_pairing_code_works_once_and_tokens_renew_on_use() {
    let mut pairing = Pairing::new();
    let now = Instant::now();
    let code = pairing.code().to_owned();
    let lower = format!("{}-{}", &code[..3], &code[3..]).to_lowercase();
    let token = pairing.pair(&lower, now).unwrap();
    assert_ne!(pairing.code(), code, "a used code is replaced");
    assert!(pairing.pair(&code, now).is_err(), "codes are single use");
    assert!(pairing.check(&token, now + Duration::from_secs(60)));
    assert!(!pairing.check("not-a-token", now));
    assert_eq!(pairing.last_seen(now + Duration::from_secs(70)), Some(10));
    // Idle sessions expire; use renews them.
    assert!(pairing.check(&token, now + owlbear::SESSION_IDLE));
    assert!(!pairing.check(
        &token,
        now + owlbear::SESSION_IDLE * 2 + Duration::from_secs(61)
    ));
    pairing.revoke_all();
    assert_eq!(pairing.sessions(), 0);
}

#[test]
fn repeated_wrong_codes_replace_the_code() {
    let mut pairing = Pairing::new();
    let now = Instant::now();
    let original = pairing.code().to_owned();
    for remaining in (1..owlbear::MAX_FAILED_ATTEMPTS).rev() {
        assert_eq!(
            pairing.pair("WRONG1", now),
            Err(PairError::WrongCode { remaining })
        );
    }
    assert_eq!(pairing.pair("WRONG1", now), Err(PairError::CodeReplaced));
    assert_ne!(pairing.code(), original);
    assert!(pairing.pair(&original, now).is_err());
}

#[test]
fn bridge_checks_pin_the_loopback_origin_and_host() {
    assert!(owlbear::host_allowed(Some("127.0.0.1:47831"), 47831));
    assert!(!owlbear::host_allowed(Some("evil.example:47831"), 47831));
    assert!(!owlbear::host_allowed(Some("localhost:47831"), 47831));
    assert!(!owlbear::host_allowed(None, 47831));
    assert!(owlbear::api_origin_allowed(
        Some("http://127.0.0.1:47831"),
        47831
    ));
    assert!(!owlbear::api_origin_allowed(
        Some("https://raw.githack.com"),
        47831
    ));
    assert!(!owlbear::api_origin_allowed(Some("null"), 47831));
    assert!(!owlbear::api_origin_allowed(None, 47831));
    let page = owlbear::bridge_page();
    assert!(page.contains("const ORIGINS = [\"https://gtarne2.github.io\"]"));
    assert!(page.contains("const ACTIONS = [\"pair\",\"status\",\"table\",\"inside\"]"));
    assert!(!page.contains("__ORIGINS__") && !page.contains("__ACTIONS__"));
}

fn try_edit(
    service: &mut RoomService,
    room: Uuid,
    who: Principal,
    edit: Value,
) -> Result<(), PartyError> {
    let view = board(service, room);
    service
        .execute(
            who,
            &command(
                room,
                Initiative(FightEdit {
                    encounter_id: serde_json::from_value(view["id"].clone()).unwrap(),
                    expected_revision: view["revision"].as_u64().unwrap(),
                    edit: serde_json::from_value(edit).unwrap(),
                }),
            ),
        )
        .map(|_| ())
}

#[test]
fn players_place_spell_templates_that_follow_their_casting() {
    let db = Database(std::env::temp_dir().join(format!("aurora-obr-{}.sqlite3", Uuid::new_v4())));
    let mut service = RoomService::open(&db.0).unwrap();
    let room = Uuid::new_v4();
    service
        .execute(
            HOST,
            &command(
                room,
                Create {
                    mode: HostMode::Dm,
                    name: "Warden".into(),
                },
            ),
        )
        .unwrap();
    service
        .execute(
            PLAYER,
            &command(
                room,
                Join {
                    name: "Lark".into(),
                },
            ),
        )
        .unwrap();
    let template = |id: Uuid, shape: &str, lasts: &str| json!({"kind":"place_template","template":{"id":id,"spell":"Burning Hands","shape":shape,"size":15,"lasts":lasts}});
    let burn = Uuid::new_v4();
    // A player needs a row first, and the DM does not place templates through this edit.
    assert!(try_edit(&mut service, room, PLAYER, template(burn, "cone", "turn")).is_err());
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"submit","score":15,"companions":[]}),
    );
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":1,"score":10}),
    );
    assert!(try_edit(&mut service, room, HOST, template(burn, "cone", "turn")).is_err());
    let wolf_row = board(&service, room)["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r.get("enemy").is_some())
        .unwrap()["id"]
        .clone();
    let mut aimed = template(burn, "cone", "turn");
    aimed["template"]["aim"] = wolf_row.clone();
    edit(&mut service, room, PLAYER, aimed);
    let guardians = Uuid::new_v4();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"place_template","template":{"id":guardians,"spell":"Spirit Guardians","shape":"emanation","size":15,"lasts":"concentration","focus":3,"colour":"#fab005"}}),
    );

    // Bad shapes and sizes are refused.
    for bad in [
        json!({"kind":"place_template","template":{"id":Uuid::new_v4(),"spell":"X","shape":"cone","size":0,"lasts":"turn"}}),
        json!({"kind":"place_template","template":{"id":Uuid::new_v4(),"spell":"X","shape":"cone","size":15,"width":5,"lasts":"turn"}}),
        json!({"kind":"place_template","template":{"id":Uuid::new_v4(),"spell":"","shape":"cone","size":15,"lasts":"turn"}}),
        json!({"kind":"place_template","template":{"id":Uuid::new_v4(),"spell":"X","shape":"cone","size":15,"lasts":"turn","aim":Uuid::new_v4()}}),
        json!({"kind":"place_template","template":{"id":Uuid::new_v4(),"spell":"X","shape":"cone","size":15,"lasts":"turn","colour":"orange"}}),
    ] {
        assert!(try_edit(&mut service, room, PLAYER, bad).is_err());
    }

    let table = service.table_view(HOST, room).unwrap();
    let templates = table["encounter"]["templates"].as_array().unwrap();
    assert_eq!(templates.len(), 2);
    let cone = templates.iter().find(|t| t["id"] == json!(burn)).unwrap();
    let player_row = table["encounter"]["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["kind"] == "player")
        .unwrap()["id"]
        .clone();
    assert_eq!(cone["caster"], player_row);
    assert_eq!(cone["shape"], "cone");
    assert_eq!(cone["size"], 15);
    assert_eq!(cone["aim"], wolf_row);
    // The spell's colour from the sheet's mechanics overlay reaches the extension.
    assert!(cone.get("colour").is_none());
    let aura = templates
        .iter()
        .find(|t| t["id"] == json!(guardians))
        .unwrap();
    assert_eq!(aura["colour"], "#fab005");
    let mine = service.poll(PLAYER, room, 0).unwrap().combat.unwrap();
    assert_eq!(mine["templates"].as_array().unwrap().len(), 2);
    assert_eq!(mine["templates"][1]["focus"], 3);

    // An instantaneous template goes when the caster's turn ends; concentration stays.
    edit(&mut service, room, HOST, json!({"kind":"start"}));
    edit(&mut service, room, HOST, json!({"kind":"next"}));
    let ids: Vec<Value> = service.table_view(HOST, room).unwrap()["encounter"]["templates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].clone())
        .collect();
    assert_eq!(ids, vec![json!(guardians)]);

    // The caster clears their own; more than the cap drops the oldest.
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"clear_template","id":guardians}),
    );
    for _ in 0..8 {
        edit(
            &mut service,
            room,
            PLAYER,
            template(Uuid::new_v4(), "sphere", "removed"),
        );
    }
    let count = |service: &RoomService| {
        service.table_view(HOST, room).unwrap()["encounter"]["templates"]
            .as_array()
            .unwrap()
            .len()
    };
    assert_eq!(
        count(&service),
        aurora_combat_tracker::party::initiative::MAX_TEMPLATES
    );
    // Ending the encounter clears them.
    edit(&mut service, room, HOST, json!({"kind":"end"}));
    assert_eq!(count(&service), 0);
    edit(
        &mut service,
        room,
        PLAYER,
        template(Uuid::new_v4(), "sphere", "removed"),
    );
    assert_eq!(count(&service), 1);
    // So does leaving.
    edit(&mut service, room, PLAYER, json!({"kind":"leave"}));
    assert_eq!(count(&service), 0);
}

#[test]
fn map_reports_suggest_targets_and_players_confirm_them() {
    use aurora_combat_tracker::party::InsideReport;
    let db = Database(std::env::temp_dir().join(format!("aurora-obr-{}.sqlite3", Uuid::new_v4())));
    let mut service = RoomService::open(&db.0).unwrap();
    let room = Uuid::new_v4();
    service
        .execute(
            HOST,
            &command(
                room,
                Create {
                    mode: HostMode::Dm,
                    name: "Warden".into(),
                },
            ),
        )
        .unwrap();
    service
        .execute(
            PLAYER,
            &command(
                room,
                Join {
                    name: "Lark".into(),
                },
            ),
        )
        .unwrap();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"submit","score":15,"companions":[]}),
    );
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":2,"score":10}),
    );
    let rows = board(&service, room)["rows"].as_array().unwrap().clone();
    let wolves: Vec<Value> = rows
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .map(|r| r["id"].clone())
        .collect();
    let lark = rows.iter().find(|r| r.get("enemy").is_none()).unwrap()["id"].clone();
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"reveal","id":wolves[0],"revealed":true}),
    );
    let fireball = Uuid::new_v4();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"place_template","template":{"id":fireball,"spell":"Fireball","shape":"sphere","size":20,"lasts":"removed"}}),
    );

    let id = |v: &Value| serde_json::from_value::<Uuid>(v.clone()).unwrap();
    let report = vec![InsideReport {
        template: fireball,
        rows: vec![id(&wolves[0]), id(&wolves[1]), id(&lark), Uuid::new_v4()],
    }];
    // Only the DM's own link may report.
    assert!(service.report_inside(PLAYER, room, report.clone()).is_err());
    service.report_inside(HOST, room, report).unwrap();
    let revision = board(&service, room)["revision"].clone();

    // The caster sees revealed rows only; the DM sees every row; neither sees unknown rows.
    let mine = service.poll(PLAYER, room, 0).unwrap().combat.unwrap();
    let inside: Vec<Value> = mine["templates"][0]["inside"].as_array().unwrap().clone();
    assert!(
        inside.contains(&wolves[0]) && inside.contains(&lark) && !inside.contains(&wolves[1]),
        "{inside:?}"
    );
    assert_eq!(inside.len(), 2);
    assert_eq!(
        board(&service, room)["templates"][0]["inside"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        board(&service, room)["revision"],
        revision,
        "reports do not touch the revision"
    );

    // A later report replaces the earlier one, and reports for unknown templates are ignored.
    service
        .report_inside(
            HOST,
            room,
            vec![InsideReport {
                template: Uuid::new_v4(),
                rows: vec![id(&lark)],
            }],
        )
        .unwrap();
    assert!(
        service.poll(PLAYER, room, 0).unwrap().combat.unwrap()["templates"][0]
            .get("inside")
            .is_none()
    );

    // The caster confirms targets; rows must be in the encounter and listed once.
    assert!(
        try_edit(
            &mut service,
            room,
            PLAYER,
            json!({"kind":"confirm_template","id":fireball,"targets":[Uuid::new_v4()]})
        )
        .is_err()
    );
    assert!(
        try_edit(
            &mut service,
            room,
            PLAYER,
            json!({"kind":"confirm_template","id":fireball,"targets":[wolves[0], wolves[0]]})
        )
        .is_err()
    );
    assert!(
        try_edit(
            &mut service,
            room,
            HOST,
            json!({"kind":"confirm_template","id":fireball,"targets":[wolves[0]]})
        )
        .is_err()
    );
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"confirm_template","id":fireball,"targets":[wolves[0], lark]}),
    );
    let dm = board(&service, room);
    assert_eq!(dm["templates"][0]["confirmed"], json!([wolves[0], lark]));
    assert_eq!(
        service.poll(PLAYER, room, 0).unwrap().combat.unwrap()["templates"][0]["confirmed"],
        json!([wolves[0], lark])
    );
}

#[test]
fn an_area_spell_resolves_through_the_dm_queue() {
    let db = Database(std::env::temp_dir().join(format!("aurora-obr-{}.sqlite3", Uuid::new_v4())));
    let mut service = RoomService::open(&db.0).unwrap();
    let room = Uuid::new_v4();
    let ally = Principal::Paired(Uuid::from_u128(8));
    service
        .execute(
            HOST,
            &command(
                room,
                Create {
                    mode: HostMode::Dm,
                    name: "Warden".into(),
                },
            ),
        )
        .unwrap();
    for (who, name) in [(PLAYER, "Lark"), (ally, "Wren")] {
        service
            .execute(who, &command(room, Join { name: name.into() }))
            .unwrap();
        edit(
            &mut service,
            room,
            who,
            json!({"kind":"submit","score":15,"companions":[]}),
        );
    }
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":4,"score":10}),
    );
    let rows = board(&service, room)["rows"].as_array().unwrap().clone();
    let wolves: Vec<Value> = rows
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .map(|r| r["id"].clone())
        .collect();
    let wren = rows.iter().find(|r| r["name"] == "Wren").unwrap()["id"].clone();
    let hp: Vec<u64> = rows
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .map(|r| r["enemy"]["hp"].as_u64().unwrap())
        .collect();

    let fireball = Uuid::new_v4();
    let save = json!({"ability":"dexterity","dc":15,"on_success":"half"});
    // A template without a damage roll cannot be sent.
    let plain = Uuid::new_v4();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"place_template","template":{"id":plain,"spell":"Fog Cloud","shape":"sphere","size":20,"lasts":"removed"}}),
    );
    assert!(try_edit(&mut service, room, PLAYER, json!({"kind":"send_area","request":{"id":Uuid::new_v4(),"template":plain,"amount":5,"targets":[wolves[0]]}})).is_err());
    // Bad saves are refused.
    assert!(try_edit(&mut service, room, PLAYER, json!({"kind":"place_template","template":{"id":Uuid::new_v4(),"spell":"Fireball","shape":"sphere","size":20,"lasts":"turn","damage":"8d6","save":{"ability":"luck","dc":15,"on_success":"half"}}})).is_err());
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"place_template","template":{"id":fireball,"spell":"Fireball","shape":"sphere","size":20,"lasts":"removed","damage":"8d6","damage_type":"fire","save":save}}),
    );

    // First confirmation: the caster sends 28 damage to four wolves and an ally.
    let request = Uuid::new_v4();
    let mut targets = wolves.clone();
    targets.push(wren.clone());
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"send_area","request":{"id":request,"template":fireball,"amount":28,"targets":targets}}),
    );
    assert!(try_edit(&mut service, room, PLAYER, json!({"kind":"send_area","request":{"id":request,"template":fireball,"amount":28,"targets":[wolves[0]]}})).is_err(), "an ID is used once");
    let dm = board(&service, room);
    let queued = &dm["areas"][0];
    assert_eq!(queued["spell"], "Fireball");
    assert_eq!(queued["amount"], 28);
    assert_eq!(queued["save"], save);
    assert_eq!(queued["damage_type"], "fire");
    assert!(queued["results"].is_null());
    assert_eq!(
        dm["templates"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"] == json!(fireball))
            .unwrap()["confirmed"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    let mine = service.poll(PLAYER, room, 0).unwrap().combat.unwrap();
    assert_eq!(mine["areas"].as_array().unwrap().len(), 1);
    assert!(
        service.poll(ally, room, 0).unwrap().combat.unwrap()["areas"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        try_edit(
            &mut service,
            room,
            PLAYER,
            json!({"kind":"apply_area","id":request,"results":[]})
        )
        .is_err(),
        "players cannot apply"
    );

    // Second confirmation: the DM applies full damage to failed saves and half to successes.
    let results = json!([
        {"row":wolves[0],"amount":28,"save":"failed"},
        {"row":wolves[1],"amount":14,"save":"succeeded"},
        {"row":wolves[2],"amount":28,"save":"failed"},
        {"row":wolves[3],"amount":0,"save":"table"},
        {"row":wren,"amount":14,"save":"succeeded"},
    ]);
    assert!(
        try_edit(
            &mut service,
            room,
            HOST,
            json!({"kind":"apply_area","id":request,"results":[{"row":Uuid::new_v4(),"amount":1}]})
        )
        .is_err(),
        "only queued targets"
    );
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"apply_area","id":request,"results":results}),
    );
    let after = board(&service, room);
    let new_hp: Vec<u64> = after["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .map(|r| r["enemy"]["hp"].as_u64().unwrap())
        .collect();
    assert_eq!(
        new_hp,
        vec![
            hp[0].saturating_sub(28),
            hp[1].saturating_sub(14),
            hp[2].saturating_sub(28),
            hp[3]
        ]
    );
    assert_eq!(after["areas"][0]["results"], results);
    // Wolves at 0 HP show as down to the map.
    let table = service.table_view(HOST, room).unwrap();
    assert_eq!(
        table["encounter"]["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["down"] == true)
            .count(),
        new_hp.iter().filter(|hp| **hp == 0).count()
    );
    // The ally gets a damage offer; the caster gets none.
    let offers = service.poll(ally, room, 0).unwrap().offers;
    let offers = serde_json::to_value(offers).unwrap();
    assert_eq!(offers.as_array().unwrap().len(), 1);
    assert_eq!(offers[0]["effect"], json!({"kind":"damage","amount":14}));
    assert_eq!(offers[0]["source"], "Fireball (area)");
    assert!(
        serde_json::to_value(service.poll(PLAYER, room, 0).unwrap().offers)
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        try_edit(
            &mut service,
            room,
            HOST,
            json!({"kind":"apply_area","id":request,"results":results})
        )
        .is_err(),
        "applied once"
    );

    // The DM can dismiss a pending application instead.
    let again = Uuid::new_v4();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"send_area","request":{"id":again,"template":fireball,"amount":9,"targets":[wolves[3]]}}),
    );
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"dismiss_area","id":again}),
    );
    assert_eq!(board(&service, room)["areas"].as_array().unwrap().len(), 1);
}

#[test]
fn enemies_with_the_same_name_are_numbered_and_can_have_an_alias() {
    let db = Database(std::env::temp_dir().join(format!("aurora-obr-{}.sqlite3", Uuid::new_v4())));
    let mut service = RoomService::open(&db.0).unwrap();
    let room = Uuid::new_v4();
    service
        .execute(
            HOST,
            &command(
                room,
                Create {
                    mode: HostMode::Dm,
                    name: "Warden".into(),
                },
            ),
        )
        .unwrap();
    let names = |service: &RoomService| -> Vec<(String, String)> {
        board(service, room)["rows"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|r| {
                let enemy = r.get("enemy")?;
                Some((
                    enemy["name"].as_str()?.to_string(),
                    enemy["alias"].as_str()?.to_string(),
                ))
            })
            .collect()
    };
    let pair = |name: &str, alias: &str| (name.to_string(), alias.to_string());
    // One alone keeps its name.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":1,"score":14}),
    );
    assert_eq!(names(&service), [pair("Wolf", "Wolf")]);
    // A second one numbers both, and a third continues the count.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":2,"score":14}),
    );
    assert_eq!(
        names(&service),
        [
            pair("Wolf 1", "Wolf 1"),
            pair("Wolf 2", "Wolf 2"),
            pair("Wolf 3", "Wolf 3")
        ]
    );
    // Duplicate takes the next number.
    let first = board(&service, room)["rows"][0]["id"].clone();
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"duplicate","id":first}),
    );
    assert_eq!(names(&service).last().unwrap(), &pair("Wolf 4", "Wolf 4"));
    // An alias from the monster library names what players see; the DM keeps the stat block name.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":2,"score":10,"alias":"Grey hound"}),
    );
    let all = names(&service);
    assert!(all.contains(&pair("Wolf 5", "Grey hound 1")), "{all:?}");
    assert!(all.contains(&pair("Wolf 6", "Grey hound 2")), "{all:?}");
    // A blank alias falls back to the monster's name.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":1,"score":9,"alias":"  "}),
    );
    assert!(names(&service).contains(&pair("Wolf 7", "Wolf 5")));
}

#[test]
fn a_shared_companion_has_a_map_spot_and_can_anchor_an_aura() {
    use aurora_combat_tracker::party::InsideReport;
    use aurora_combat_tracker::party::initiative::companion_map_id;
    let db = Database(std::env::temp_dir().join(format!("aurora-obr-{}.sqlite3", Uuid::new_v4())));
    let mut service = RoomService::open(&db.0).unwrap();
    let room = Uuid::new_v4();
    service
        .execute(
            HOST,
            &command(
                room,
                Create {
                    mode: HostMode::Dm,
                    name: "Warden".into(),
                },
            ),
        )
        .unwrap();
    service
        .execute(
            PLAYER,
            &command(
                room,
                Join {
                    name: "Lark".into(),
                },
            ),
        )
        .unwrap();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"submit","score":15,"companions":[{"local_id":4,"name":"Eldritch Cannon — Protector","initiative":null}]}),
    );
    let lark: Uuid =
        serde_json::from_value(board(&service, room)["rows"][0]["id"].clone()).unwrap();
    let cannon = companion_map_id(lark, 4);
    assert_ne!(cannon, lark);

    // The map gets a companion row for the cannon, though it shares Lark's turn.
    let table = service.table_view(HOST, room).unwrap();
    let rows = table["encounter"]["rows"].as_array().unwrap();
    let spot = rows.iter().find(|r| r["id"] == json!(cannon)).unwrap();
    assert_eq!(spot["kind"], "companion");
    assert_eq!(spot["shared"], true);
    // The owner's sheet learns the cannon's map ID; Lark's row names its member.
    let mine = service.poll(PLAYER, room, 0).unwrap().combat.unwrap();
    assert_eq!(mine["rows"][0]["companion_rows"]["4"], json!(cannon));
    assert!(mine["rows"][0]["member_id"].is_string());

    // An aura anchored on the cannon is drawn at the cannon, not at Lark.
    let aura = Uuid::new_v4();
    edit(
        &mut service,
        room,
        PLAYER,
        json!({"kind":"place_template","template":{"id":aura,"spell":"Protector aura","shape":"emanation","size":10,"lasts":"removed","anchor":4}}),
    );
    let table = service.table_view(HOST, room).unwrap();
    assert_eq!(table["encounter"]["templates"][0]["caster"], json!(cannon));
    // Inside reports may name the cannon's map ID.
    service
        .report_inside(
            HOST,
            room,
            vec![InsideReport {
                template: aura,
                rows: vec![lark, cannon],
            }],
        )
        .unwrap();
    let mine = service.poll(PLAYER, room, 0).unwrap().combat.unwrap();
    assert_eq!(mine["templates"][0]["inside"].as_array().unwrap().len(), 2);
    // A template can't be anchored on a companion the caster doesn't have.
    let view = board(&service, room);
    let refused = service.execute(
        PLAYER,
        &command(
            room,
            Initiative(FightEdit {
                encounter_id: serde_json::from_value(view["id"].clone()).unwrap(),
                expected_revision: view["revision"].as_u64().unwrap(),
                edit: serde_json::from_value(json!({"kind":"place_template","template":{"id":Uuid::new_v4(),"spell":"Protector aura","shape":"emanation","size":10,"lasts":"removed","anchor":9}})).unwrap(),
            }),
        ),
    );
    assert!(refused.is_err());
}
