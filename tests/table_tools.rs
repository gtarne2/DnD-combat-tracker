//! R82 reaction calls, R84 damage from lasting spell areas, and R86 the fight log.
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

fn view(service: &RoomService, room: Uuid, who: Principal) -> Value {
    service.poll(who, room, 0).unwrap().combat.unwrap()
}

fn try_edit(
    service: &mut RoomService,
    room: Uuid,
    who: Principal,
    edit: Value,
) -> Result<(), PartyError> {
    let board = view(service, room, HOST);
    service
        .execute(
            who,
            &command(
                room,
                Initiative(FightEdit {
                    encounter_id: serde_json::from_value(board["id"].clone()).unwrap(),
                    expected_revision: board["revision"].as_u64().unwrap(),
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

struct Table {
    _db: Database,
    service: RoomService,
    room: Uuid,
    wolves: Vec<Value>,
    lark: Value,
    lark_member: Value,
    wren_member: Value,
}

/// A running DM room: Lark at 16, Wren at 15 and two hidden wolves at 10.
fn table() -> Table {
    let db =
        Database(std::env::temp_dir().join(format!("aurora-tools-{}.sqlite3", Uuid::new_v4())));
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
    for (who, name, score) in [(PLAYER, "Lark", 16), (ALLY, "Wren", 15)] {
        service
            .execute(who, &command(room, Join { name: name.into() }))
            .unwrap();
        edit(
            &mut service,
            room,
            who,
            json!({"kind":"submit","score":score,"companions":[]}),
        );
    }
    edit(
        &mut service,
        room,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":2,"score":10}),
    );
    edit(&mut service, room, HOST, json!({"kind":"start"}));
    let rows = view(&service, room, HOST)["rows"]
        .as_array()
        .unwrap()
        .clone();
    let wolves = rows
        .iter()
        .filter(|r| r.get("enemy").is_some())
        .map(|r| r["id"].clone())
        .collect();
    let lark = rows.iter().find(|r| r["name"] == "Lark").unwrap();
    let wren = rows.iter().find(|r| r["name"] == "Wren").unwrap();
    Table {
        _db: db,
        lark: lark["id"].clone(),
        lark_member: lark["damage_recipient"].clone(),
        wren_member: wren["damage_recipient"].clone(),
        service,
        room,
        wolves,
    }
}

#[test]
fn players_answer_reaction_calls_addressed_to_them() {
    let mut t = table();
    let call = Uuid::new_v4();
    // Only players in the order can be asked, and only while the fight runs.
    assert!(
        try_edit(
            &mut t.service,
            t.room,
            HOST,
            json!({"kind":"call_reaction","call":{"id":Uuid::new_v4(),"source":t.wolves[0],"trigger":"casts_spell","recipients":[Uuid::new_v4()]}}),
        )
        .is_err()
    );
    edit(
        &mut t.service,
        t.room,
        HOST,
        json!({"kind":"call_reaction","call":{"id":call,"source":t.wolves[0],"trigger":"casts_spell","detail":"Fireball (3rd)","recipients":[t.lark_member]}}),
    );
    // Lark sees it, named as a hidden creature; Wren does not.
    let lark = view(&t.service, t.room, PLAYER);
    assert_eq!(lark["calls"][0]["source"], "A hidden creature");
    assert_eq!(lark["calls"][0]["detail"], "Fireball (3rd)");
    assert!(lark["calls"][0].get("answers").is_none());
    assert_eq!(view(&t.service, t.room, ALLY)["calls"], json!([]));
    // Wren cannot answer it, and the DM cannot answer for a player.
    let answer =
        json!({"kind":"answer_call","id":call,"answer":{"reacted":true,"note":"Counterspell"}});
    assert!(try_edit(&mut t.service, t.room, ALLY, answer.clone()).is_err());
    assert!(try_edit(&mut t.service, t.room, HOST, answer.clone()).is_err());
    edit(&mut t.service, t.room, PLAYER, answer.clone());
    assert!(
        try_edit(&mut t.service, t.room, PLAYER, answer).is_err(),
        "one answer"
    );
    let dm = view(&t.service, t.room, HOST);
    let member = t.lark_member.as_str().unwrap();
    assert_eq!(dm["calls"][0]["answers"][member]["note"], "Counterspell");
    assert_eq!(
        view(&t.service, t.room, PLAYER)["calls"][0]["answer"]["reacted"],
        true
    );
    // The reaction is in the fight log, and the call goes when the turn moves on.
    assert!(
        dm["log"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "reaction" && e["note"] == "Counterspell")
    );
    // A sheet that cannot react passes by itself and says why; a reaction cannot claim that.
    let second = Uuid::new_v4();
    edit(
        &mut t.service,
        t.room,
        HOST,
        json!({"kind":"call_reaction","call":{"id":second,"source":t.wolves[0],"trigger":"attacks","recipients":[t.lark_member]}}),
    );
    assert!(
        try_edit(
            &mut t.service,
            t.room,
            PLAYER,
            json!({"kind":"answer_call","id":second,"answer":{"reacted":true,"unable":"used"}}),
        )
        .is_err()
    );
    edit(
        &mut t.service,
        t.room,
        PLAYER,
        json!({"kind":"answer_call","id":second,"answer":{"reacted":false,"unable":"used"}}),
    );
    let dm = view(&t.service, t.room, HOST);
    assert_eq!(dm["calls"][1]["answers"][member]["unable"], "used");
    edit(&mut t.service, t.room, HOST, json!({"kind":"next"}));
    assert_eq!(view(&t.service, t.room, HOST)["calls"], json!([]));
}

#[test]
fn lasting_areas_queue_damage_for_a_creature_the_dm_picks() {
    let mut t = table();
    let template = Uuid::new_v4();
    edit(
        &mut t.service,
        t.room,
        PLAYER,
        json!({"kind":"place_template","template":{"id":template,"spell":"Spirit Guardians","shape":"emanation","size":15,"lasts":"removed","damage":"3d8","damage_type":"radiant","save":{"ability":"wisdom","dc":15,"on_success":"half"}}}),
    );
    // Players cannot queue zone damage.
    let zone = Uuid::new_v4();
    let queue = json!({"kind":"queue_zone","id":zone,"template":template,"targets":[t.wolves[1]],"amount":13});
    assert!(try_edit(&mut t.service, t.room, PLAYER, queue.clone()).is_err());
    edit(&mut t.service, t.room, HOST, queue);
    let dm = view(&t.service, t.room, HOST);
    let area = dm["areas"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == json!(zone))
        .unwrap();
    assert_eq!(area["spell"], "Spirit Guardians");
    assert_eq!(area["member_id"], t.lark_member);
    assert_eq!(area["save"]["dc"], 15);
    // The caster sees it among their own sends, and the DM applies it as usual.
    assert!(
        view(&t.service, t.room, PLAYER)["areas"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["id"] == json!(zone))
    );
    edit(
        &mut t.service,
        t.room,
        HOST,
        json!({"kind":"apply_area","id":zone,"results":[{"row":t.wolves[1],"amount":6,"save":"succeeded"}]}),
    );
    let log = view(&t.service, t.room, HOST)["log"].clone();
    assert!(log.as_array().unwrap().iter().any(|e| e["kind"] == "damage"
        && e["amount"] == 6
        && e["what"] == "Spirit Guardians"
        && e["by"]["name"] == "Lark"));
}

#[test]
fn the_fight_log_names_who_did_what_and_hides_unrevealed_enemies() {
    let mut t = table();
    let wolf = |t: &Table, i: usize| {
        view(&t.service, t.room, HOST)["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == t.wolves[i])
            .unwrap()["enemy"]
            .clone()
    };
    // Lark's turn: the DM's quick damage is credited to the current row.
    let mut enemy = wolf(&t, 0);
    let hp = enemy["hp"].as_u64().unwrap();
    enemy["hp"] = json!(0);
    enemy.as_object_mut().unwrap().remove("template");
    enemy.as_object_mut().unwrap().remove("timers");
    edit(
        &mut t.service,
        t.room,
        HOST,
        json!({"kind":"enemy","id":t.wolves[0],"score":10,"enemy":enemy,"source":t.lark}),
    );
    edit(
        &mut t.service,
        t.room,
        PLAYER,
        json!({"kind":"cast","spell":"Hunter's Mark"}),
    );
    let dm = view(&t.service, t.room, HOST)["log"].clone();
    let entries = dm.as_array().unwrap();
    assert!(entries.iter().any(|e| e["kind"] == "damage"
        && e["amount"] == hp
        && e["by"]["name"] == "Lark"
        && e["to"]["name"] == "Wolf 1"));
    assert!(
        entries
            .iter()
            .any(|e| e["kind"] == "down" && e["who"]["name"] == "Wolf 1")
    );
    assert!(
        entries
            .iter()
            .any(|e| e["kind"] == "spell" && e["spell"] == "Hunter's Mark")
    );
    // Players get the log only after the fight, with the hidden wolf unnamed.
    assert!(view(&t.service, t.room, PLAYER).get("log").is_none());
    assert!(
        try_edit(
            &mut t.service,
            t.room,
            ALLY,
            json!({"kind":"cast","spell":"Bless"})
        )
        .is_ok()
    );
    edit(&mut t.service, t.room, HOST, json!({"kind":"end"}));
    let player = view(&t.service, t.room, PLAYER)["log"].clone();
    assert!(
        player
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["to"]["name"] != "Wolf 1" && e["who"]["name"] != "Wolf 1")
    );
    assert!(
        player
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["kind"] == "down" && e["who"]["name"] == "A hidden creature")
    );
    // Casting outside a running fight is refused; a fresh start clears the log.
    assert!(
        try_edit(
            &mut t.service,
            t.room,
            PLAYER,
            json!({"kind":"cast","spell":"Bless"})
        )
        .is_err()
    );
    edit(&mut t.service, t.room, HOST, json!({"kind":"clear_log"}));
    assert_eq!(view(&t.service, t.room, HOST)["log"], json!([]));
    let _ = t.wren_member;
}
