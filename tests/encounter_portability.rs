//! P10 portable encounter export/import with explicit player re-pairing.
use Operation::*;
use aurora_combat_tracker::party::initiative::{FightEdit, PortableEncounter};
use aurora_combat_tracker::party::{PartyError, Principal, RoomService, wire::*};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};
use uuid::Uuid;

const HOST: Principal = Principal::LocalHost;
const FIRST: Principal = Principal::Paired(Uuid::from_u128(1));
const SECOND: Principal = Principal::Paired(Uuid::from_u128(2));
const THIRD: Principal = Principal::Paired(Uuid::from_u128(3));
const FOURTH: Principal = Principal::Paired(Uuid::from_u128(4));

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

fn member(service: &mut RoomService, room: Uuid, who: Principal, name: &str) -> Uuid {
    match service
        .execute(who, &command(room, Join { name: name.into() }))
        .unwrap()
    {
        Receipt::Membership { member_id } => member_id,
        other => panic!("{other:?}"),
    }
}

fn dm_room(service: &mut RoomService) -> Uuid {
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
    room
}

fn board(service: &RoomService, room: Uuid) -> Value {
    service.poll(HOST, room, 0).unwrap().combat.unwrap()
}

fn edit(
    service: &mut RoomService,
    room: Uuid,
    who: Principal,
    edit: Value,
) -> Result<Receipt, PartyError> {
    let view = board(service, room);
    service.execute(
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
}

fn rejected<T>(result: Result<T, PartyError>, expected: Rejection) {
    assert!(
        matches!(result, Err(PartyError::Rejected(actual)) if actual == expected),
        "expected {expected:?}"
    );
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

fn row<'a>(view: &'a Value, name: &str) -> &'a Value {
    view["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["name"] == name)
        .unwrap_or_else(|| panic!("missing {name}"))
}

#[test]
fn encounter_export_omits_identities_and_imports_into_a_fresh_room_with_explicit_pairing() {
    let db = Database(std::env::temp_dir().join(format!("aurora-p10-{}.sqlite3", Uuid::new_v4())));
    let mut service = RoomService::open(&db.0).unwrap();

    // Source room: two players who share a name, one with a separate and a shared companion.
    let source = dm_room(&mut service);
    let first = member(&mut service, source, FIRST, "Lark");
    let second = member(&mut service, source, SECOND, "Lark");
    edit(
        &mut service,
        source,
        FIRST,
        json!({"kind":"submit","score":15,"companions":[
        {"local_id":1,"name":"Steel Defender","initiative":12},
        {"local_id":2,"name":"Hawk","initiative":null}]}),
    )
    .unwrap();
    edit(
        &mut service,
        source,
        SECOND,
        json!({"kind":"submit","score":8,"companions":[]}),
    )
    .unwrap();
    edit(
        &mut service,
        source,
        HOST,
        json!({"kind":"add_monsters","template":wolf(),"count":2,"score":14}),
    )
    .unwrap();
    edit(&mut service, source, HOST, json!({"kind":"start"})).unwrap();
    edit(&mut service, source, HOST, json!({"kind":"next"})).unwrap();

    // The current wolf bites the first player and takes damage, then the turn moves on twice.
    let view = board(&service, source);
    let wolves: Vec<_> = view["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["name"] == "Wolf")
        .cloned()
        .collect();
    let (bitten, other_wolf) = (wolves[0]["id"].clone(), wolves[1]["id"].clone());
    assert_eq!(view["current"], bitten);
    let first_row = row(&view, "Lark")["id"].clone();
    let lark_rows: Vec<_> = view["rows"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["name"] == "Lark")
        .map(|r| r["id"].clone())
        .collect();
    let (first_seat, second_seat) = if row(&view, "Lark")["damage_recipient"] == json!(first) {
        (lark_rows[0].clone(), lark_rows[1].clone())
    } else {
        (lark_rows[1].clone(), lark_rows[0].clone())
    };
    assert_eq!(first_row, lark_rows[0]);
    let mut enemy = wolves[0]["enemy"].clone();
    enemy["hp"] = json!(4);
    enemy["conditions"] = json!("Prone");
    enemy.as_object_mut().unwrap().remove("template");
    edit(
        &mut service,
        source,
        HOST,
        json!({"kind":"enemy","id":bitten,"score":14,"enemy":enemy}),
    )
    .unwrap();
    edit(&mut service, source, HOST, json!({"kind":"monster_action","id":bitten,"action":{"kind":"record","action":{
        "id":Uuid::new_v4(),"rule":"pack:actions.bite","note":"",
        "strikes":[{"id":Uuid::new_v4(),"rule":"pack:actions.bite","target":first_seat,"target_note":"","total":16,"outcome":"hit"}]}}})).unwrap();
    edit(&mut service, source, HOST, json!({"kind":"next"})).unwrap();
    edit(&mut service, source, HOST, json!({"kind":"next"})).unwrap();
    let view = board(&service, source);
    let defender = row(&view, "Steel Defender")["id"].clone();
    assert_eq!(view["current"], defender);

    // Export is DM-only and carries no member identity or recorded strike.
    rejected(
        service.export_encounter(FIRST, source),
        Rejection::Forbidden,
    );
    let exported = service.export_encounter(HOST, source).unwrap();
    let file = serde_json::to_value(&exported).unwrap();
    let text = file.to_string();
    for id in [first, second] {
        assert!(
            !text.contains(&id.to_string()),
            "member ID leaked into export"
        );
    }
    assert_eq!(file["format"], "aurora-encounter");
    assert_eq!(file["version"], 1);
    assert_eq!(file["running"], true);
    assert_eq!(file["round"], 1);
    assert_eq!(file["current"], defender);
    assert_eq!(file["rows"].as_array().unwrap().len(), 5);
    let exported_wolf = file["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == bitten)
        .unwrap();
    assert_eq!(exported_wolf["actor"]["actions"]["history"], json!([]));
    assert_eq!(exported_wolf["actor"]["enemy"]["hp"], 4);
    assert!(exported_wolf["actor"]["enemy"]["template"]["monster"]["stats"].is_object());
    let exported_defender = file["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == defender)
        .unwrap();
    assert_eq!(exported_defender["actor"]["seat"], first_seat);
    // A JSON round trip reproduces the same file.
    let reread: PortableEncounter = serde_json::from_str(&text).unwrap();
    assert_eq!(serde_json::to_value(&reread).unwrap(), file);

    // Destination room: different people. Pair only the first seat.
    let target = dm_room(&mut service);
    let third = member(&mut service, target, THIRD, "Lark (new laptop)");
    let fourth = member(&mut service, target, FOURTH, "Wren");
    let import = |seats: Value| json!({"kind":"import","encounter":file,"seats":seats});
    rejected(
        edit(&mut service, target, THIRD, import(json!({}))),
        Rejection::Forbidden,
    );
    rejected(
        edit(
            &mut service,
            target,
            HOST,
            import(json!({first_seat.as_str().unwrap():first})),
        ),
        Rejection::InvalidInput,
    );
    rejected(
        edit(
            &mut service,
            target,
            HOST,
            import(
                json!({first_seat.as_str().unwrap():third, second_seat.as_str().unwrap():third}),
            ),
        ),
        Rejection::InvalidInput,
    );
    rejected(
        edit(
            &mut service,
            target,
            HOST,
            import(json!({bitten.as_str().unwrap():third})),
        ),
        Rejection::InvalidInput,
    );
    let mut tampered = file.clone();
    tampered["version"] = json!(2);
    rejected(
        edit(
            &mut service,
            target,
            HOST,
            json!({"kind":"import","encounter":tampered,"seats":{}}),
        ),
        Rejection::UnsupportedVersion,
    );
    let mut tampered = file.clone();
    for r in tampered["rows"].as_array_mut().unwrap() {
        if r["id"] == bitten {
            r["actor"]["enemy"]["hp"] = json!(99);
        }
    }
    rejected(
        edit(
            &mut service,
            target,
            HOST,
            json!({"kind":"import","encounter":tampered,"seats":{}}),
        ),
        Rejection::InvalidInput,
    );
    let mut unknown = file.clone();
    unknown["credentials"] = json!("secret");
    assert!(serde_json::from_value::<PortableEncounter>(unknown).is_err());

    let before = board(&service, target)["id"].clone();
    edit(
        &mut service,
        target,
        HOST,
        import(json!({first_seat.as_str().unwrap():third})),
    )
    .unwrap();
    let view = board(&service, target);
    assert_ne!(view["id"], before, "an import is a new encounter");
    assert_eq!(view["running"], false);
    assert_eq!(view["round"], 1);
    assert_eq!(view["current"], defender);
    let names: Vec<_> = view["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["Lark (new laptop)", "Wolf", "Wolf", "Steel Defender"]
    );
    assert_eq!(row(&view, "Lark (new laptop)")["id"], first_seat);
    assert_eq!(
        row(&view, "Lark (new laptop)")["damage_recipient"],
        json!(third)
    );
    let wolf_view = view["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == bitten)
        .unwrap();
    assert_eq!(wolf_view["enemy"]["hp"], 4);
    assert_eq!(wolf_view["enemy"]["conditions"], "Prone");
    assert!(
        view["rows"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["id"] == other_wolf)
    );
    assert!(view["damage"].as_object().unwrap().is_empty());
    assert!(view["windows"].as_object().unwrap().is_empty());
    let player = service.poll(THIRD, target, 0).unwrap().combat.unwrap();
    assert_eq!(player["joined"], true);
    assert_eq!(
        service.poll(FOURTH, target, 0).unwrap().combat.unwrap()["joined"],
        false
    );

    // Resuming the imported encounter keeps the pointer and tells only the paired player.
    edit(&mut service, target, HOST, json!({"kind":"start"})).unwrap();
    assert_eq!(board(&service, target)["current"], defender);
    assert_eq!(service.clock_page(THIRD, target, 0).unwrap().len(), 1);
    assert!(service.clock_page(FOURTH, target, 0).unwrap().is_empty());
    rejected(
        edit(&mut service, target, HOST, import(json!({}))),
        Rejection::InvalidTransition,
    );
    edit(&mut service, target, HOST, json!({"kind":"end"})).unwrap();

    // With no pairing, both seats and the companion leave and the pointer moves to the next enemy.
    edit(&mut service, target, HOST, import(json!({}))).unwrap();
    let view = board(&service, target);
    assert_eq!(view["rows"].as_array().unwrap().len(), 2);
    assert_eq!(view["current"], bitten);
    let _ = fourth;
}
