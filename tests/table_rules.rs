//! R76 save spells sent from the sheet without a map template, and R77 timed enemy conditions.
use Operation::*;
use aurora_combat_tracker::party::initiative::FightEdit;
use aurora_combat_tracker::party::{PartyError, Principal, RoomService, wire::*};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};
use uuid::Uuid;

const HOST: Principal = Principal::LocalHost;
const PLAYER: Principal = Principal::Paired(Uuid::from_u128(7));
const ALLY: Principal = Principal::Paired(Uuid::from_u128(8));

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

fn edit(service: &mut RoomService, room: Uuid, who: Principal, edit: Value) {
    try_edit(service, room, who, edit).unwrap();
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

/// A DM room with two players at 15 and two wolves at 10. Returns the wolf and Wren row IDs.
fn room_with_wolves(service: &mut RoomService, room: Uuid) -> (Vec<Value>, Value) {
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
    for (who, name, score) in [(PLAYER, "Lark", 16), (ALLY, "Wren", 15)] {
        service
            .execute(who, &command(room, Join { name: name.into() }))
            .unwrap();
        edit(
            service,
            room,
            who,
            json!({"kind":"submit","score":score,"companions":[]}),
        );
    }
    edit(
        service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":2,"score":10}),
    );
    let rows = board(service, room)["rows"].as_array().unwrap().clone();
    let wolves = rows
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .map(|r| r["id"].clone())
        .collect();
    let wren = rows.iter().find(|r| r["name"] == "Wren").unwrap()["id"].clone();
    (wolves, wren)
}

fn open() -> (Database, RoomService) {
    let db =
        Database(std::env::temp_dir().join(format!("aurora-rules-{}.sqlite3", Uuid::new_v4())));
    let service = RoomService::open(&db.0).unwrap();
    (db, service)
}

fn wolf_hp(service: &RoomService, room: Uuid) -> Vec<u64> {
    board(service, room)["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .map(|r| r["enemy"]["hp"].as_u64().unwrap())
        .collect()
}

#[test]
fn a_save_spell_sent_from_the_sheet_joins_the_dm_queue() {
    let (_db, mut service) = open();
    let room = Uuid::new_v4();
    let (wolves, wren) = room_with_wolves(&mut service, room);
    let hp = wolf_hp(&service, room);
    let save = json!({"ability":"wisdom","dc":14,"on_success":"half"});
    let request = Uuid::new_v4();
    let spell = |id: Uuid, targets: Value| {
        json!({"kind":"send_spell","request":{"id":id,"spell":"Synaptic Static","amount":20,
            "targets":targets,"damage_type":"psychic","save":save}})
    };
    // The DM cannot send one, and bad requests are refused.
    assert!(try_edit(&mut service, room, HOST, spell(request, json!([wolves[0]]))).is_err());
    assert!(try_edit(&mut service, room, PLAYER, spell(request, json!([]))).is_err());
    assert!(
        try_edit(
            &mut service,
            room,
            PLAYER,
            spell(request, json!([wolves[0], wolves[0]]))
        )
        .is_err()
    );
    assert!(
        try_edit(
            &mut service,
            room,
            PLAYER,
            spell(request, json!([Uuid::new_v4()]))
        )
        .is_err()
    );
    assert!(try_edit(&mut service, room, PLAYER, json!({"kind":"send_spell","request":{"id":request,"spell":"X","amount":1,"targets":[wolves[0]],"save":{"ability":"luck","dc":14,"on_success":"half"}}})).is_err());

    let targets = json!([wolves[0], wolves[1], wren]);
    edit(&mut service, room, PLAYER, spell(request, targets.clone()));
    assert!(
        try_edit(&mut service, room, PLAYER, spell(request, targets.clone())).is_err(),
        "an ID is used once"
    );
    let queued = &board(&service, room)["areas"][0];
    assert_eq!(queued["spell"], "Synaptic Static");
    assert_eq!(queued["template"], json!(Uuid::nil()));
    assert_eq!(queued["targets"], targets);
    assert_eq!(queued["save"], save);
    assert_eq!(queued["damage_type"], "psychic");
    // The caster sees their own send; the ally does not.
    let mine = service.poll(PLAYER, room, 0).unwrap().combat.unwrap();
    assert_eq!(mine["areas"].as_array().unwrap().len(), 1);
    let theirs = service.poll(ALLY, room, 0).unwrap().combat.unwrap();
    assert!(theirs["areas"].as_array().unwrap().is_empty());

    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"apply_area","id":request,"results":[
            {"row":wolves[0],"amount":20,"save":"failed"},
            {"row":wolves[1],"amount":10,"save":"succeeded"},
            {"row":wren,"amount":10,"save":"succeeded"},
        ]}),
    );
    assert_eq!(
        wolf_hp(&service, room),
        vec![hp[0].saturating_sub(20), hp[1].saturating_sub(10)]
    );
    let offers = serde_json::to_value(service.poll(ALLY, room, 0).unwrap().offers).unwrap();
    assert_eq!(offers[0]["effect"], json!({"kind":"damage","amount":10}));
    assert_eq!(offers[0]["source"], "Synaptic Static (spell)");
}

fn timers(service: &RoomService, room: Uuid, row: &Value) -> Value {
    board(service, room)["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| &r["id"] == row)
        .unwrap()["enemy"]
        .get("timers")
        .cloned()
        .unwrap_or(json!([]))
}

#[test]
fn timed_enemy_conditions_count_down_by_turn() {
    let (_db, mut service) = open();
    let room = Uuid::new_v4();
    let (wolves, wren) = room_with_wolves(&mut service, room);
    let (frightened, poisoned, held) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    // Order: Lark 16, Wren 15, Wolf 1 and Wolf 2 at 10.
    // Frightened: until the end of Wolf 1's turn, twice.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_timer","id":wolves[0],"timer":{"id":frightened,"name":"Frightened","remaining":2,"ends":"end"}}),
    );
    // Poisoned: counts at the start of Wren's turn, once.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_timer","id":wolves[0],"timer":{"id":poisoned,"name":"Poisoned","remaining":1,"ends":"start","anchor":wren}}),
    );
    // Refused: players, zero turns, unknown anchors and non-enemies.
    let timer = |id: &Value, remaining: u32, anchor: Value| json!({"kind":"add_timer","id":id,"timer":{"id":held,"name":"Restrained","remaining":remaining,"ends":"end","anchor":anchor}});
    assert!(
        try_edit(
            &mut service,
            room,
            PLAYER,
            timer(&wolves[1], 1, Value::Null)
        )
        .is_err()
    );
    assert!(try_edit(&mut service, room, HOST, timer(&wolves[1], 0, Value::Null)).is_err());
    assert!(
        try_edit(
            &mut service,
            room,
            HOST,
            timer(&wolves[1], 1, json!(Uuid::new_v4()))
        )
        .is_err()
    );
    assert!(try_edit(&mut service, room, HOST, timer(&wren, 1, Value::Null)).is_err());
    let remaining = |service: &RoomService| -> Vec<u64> {
        timers(service, room, &wolves[0])
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["remaining"].as_u64().unwrap())
            .collect()
    };
    assert_eq!(remaining(&service), vec![2, 1]);

    // Editing the enemy (quick HP sends the whole enemy without timers) keeps them.
    let row = board(&service, room)["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == wolves[0])
        .unwrap()
        .clone();
    let mut enemy = row["enemy"].clone();
    enemy.as_object_mut().unwrap().remove("timers");
    enemy.as_object_mut().unwrap().remove("template");
    enemy["hp"] = json!(3);
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"enemy","id":wolves[0],"score":10,"enemy":enemy}),
    );
    assert_eq!(remaining(&service), vec![2, 1]);

    edit(&mut service, room, HOST, json!({"kind":"start"}));
    // Lark's turn starts. Next: Wren's turn starts, so Poisoned ends.
    edit(&mut service, room, HOST, json!({"kind":"next"}));
    assert_eq!(remaining(&service), vec![2, 0]);
    // Wolf 1's turn starts, then ends: Frightened counts once.
    edit(&mut service, room, HOST, json!({"kind":"next"}));
    assert_eq!(remaining(&service), vec![2, 0]);
    edit(&mut service, room, HOST, json!({"kind":"next"}));
    assert_eq!(remaining(&service), vec![1, 0]);
    // A round of advanced time counts for every timer.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"advance","amount":1,"rounds":true}),
    );
    assert_eq!(remaining(&service), vec![0, 0]);
    // Ended timers stay until the DM clears them.
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"remove_timer","id":wolves[0],"timer":poisoned}),
    );
    assert_eq!(remaining(&service), vec![0]);
    assert!(
        try_edit(
            &mut service,
            room,
            HOST,
            json!({"kind":"remove_timer","id":wolves[0],"timer":poisoned})
        )
        .is_err()
    );
    // Players never see enemy timers.
    let player = service.poll(PLAYER, room, 0).unwrap().combat.unwrap();
    assert!(!player.to_string().contains("Frightened"));
    // Timers travel with an exported encounter.
    let exported = serde_json::to_value(service.export_encounter(HOST, room).unwrap()).unwrap();
    assert!(exported.to_string().contains("Frightened"));
}
