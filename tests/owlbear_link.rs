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
    assert!(hidden["name"].is_null());
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
    assert!(page.contains("const ACTIONS = [\"pair\",\"status\",\"table\"]"));
    assert!(!page.contains("__ORIGINS__") && !page.contains("__ACTIONS__"));
}
