use Operation::*;
use aurora_combat_tracker::party::{PartyError, Principal, RoomService, wire::*};
use rusqlite::Connection;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap, fs, path::PathBuf, process::Command as Process, sync::Barrier, thread,
};
use uuid::Uuid;

const HOST: Principal = Principal::LocalHost;
const FIRST: Principal = Principal::Paired(Uuid::from_u128(1));
const SECOND: Principal = Principal::Paired(Uuid::from_u128(2));

struct Database(PathBuf);
impl Database {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("aurora-party-{}.sqlite3", Uuid::new_v4())))
    }
    fn open(&self) -> RoomService {
        RoomService::open(&self.0).unwrap()
    }
}
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
fn run(service: &mut RoomService, room: Uuid, who: Principal, op: Operation) -> Receipt {
    service.execute(who, &command(room, op)).unwrap()
}
fn member_id(receipt: Receipt) -> Uuid {
    match receipt {
        Receipt::Membership { member_id } => member_id,
        other => panic!("{other:?}"),
    }
}
fn roster(service: &mut RoomService, mode: HostMode) -> (Uuid, Uuid, Uuid) {
    let room = Uuid::new_v4();
    run(
        service,
        room,
        HOST,
        Create {
            mode,
            name: "Warden".into(),
        },
    );
    let join = Join {
        name: "Lark".into(),
    };
    let first = member_id(run(service, room, FIRST, join.clone()));
    let second = member_id(run(service, room, SECOND, join));
    assert_ne!(first, second);
    (room, first, second)
}
#[test]
fn initiative_rejects_stale_edits_and_replays_only_the_addressed_clock_after_close() {
    use aurora_combat_tracker::party::initiative::{Edit, FightEdit, Phase};

    let db = Database::new();
    let mut service = db.open();
    let (room, _, _) = roster(&mut service, HostMode::Dm);
    let board = service.poll(HOST, room, 0).unwrap().combat.unwrap();
    let encounter_id = serde_json::from_value(board["id"].clone()).unwrap();
    let edit = |revision, edit| {
        command(
            room,
            Initiative(FightEdit {
                encounter_id,
                expected_revision: revision,
                edit,
            }),
        )
    };
    service
        .execute(
            FIRST,
            &edit(
                0,
                Edit::Submit {
                    score: 10,
                    companions: vec![],
                },
            ),
        )
        .unwrap();
    rejected(
        service.execute(FIRST, &edit(1, Edit::Start)),
        Rejection::Forbidden,
    );
    service.execute(HOST, &edit(1, Edit::Start)).unwrap();
    rejected(
        service.execute(HOST, &edit(1, Edit::Next)),
        Rejection::RevisionConflict,
    );
    let next = edit(2, Edit::Next);
    service.execute(HOST, &next).unwrap();
    service.execute(HOST, &next).unwrap();
    run(&mut service, room, HOST, Close);
    let page = service.clock_page(FIRST, room, 0).unwrap();
    let phases: Vec<_> = page
        .iter()
        .map(|d| match &d.event {
            Event::Clock { tick } => tick.phase.clone(),
            _ => panic!("Unexpected non-clock delivery"),
        })
        .collect();
    assert_eq!(phases, [Phase::Enter, Phase::Step, Phase::Exit]);
    assert!(service.clock_page(SECOND, room, 0).unwrap().is_empty());
    assert_eq!(
        service
            .clock_page(FIRST, room, page[1].cursor)
            .unwrap()
            .len(),
        1
    );
}

fn send(service: &mut RoomService, room: Uuid, sender: Principal, recipient: Uuid) -> Uuid {
    let op = Send {
        action_id: Uuid::new_v4(),
        recipient,
        source: "Glass moth".into(),
        effect: Effect::Damage(3.try_into().unwrap()),
    };
    match run(service, room, sender, op) {
        Receipt::Offer {
            offer_id,
            status: Status::Pending,
        } => offer_id,
        other => panic!("{other:?}"),
    }
}
fn rejected<T>(result: Result<T, PartyError>, expected: Rejection) {
    assert!(
        matches!(result, Err(PartyError::Rejected(actual)) if actual == expected),
        "expected {expected:?}"
    );
}

fn substitute(value: &mut Value, ids: &BTreeMap<String, Value>) {
    match value {
        Value::String(key) => {
            if let Some(actual) = ids.get(key) {
                *value = actual.clone();
            }
        }
        Value::Object(fields) => fields.values_mut().for_each(|v| substitute(v, ids)),
        _ => (),
    }
}

#[test]
fn stale_publication_cannot_restore_revoked_details() {
    let db = Database::new();
    let mut service = db.open();
    let (room, player, _) = roster(&mut service, HostMode::Dm);
    let token = service
        .poll(FIRST, room, 0)
        .unwrap()
        .publication_session
        .unwrap();
    let details = Publication::CharacterDetails {
        vitals: Vitals::default(),
        details: Default::default(),
    };
    service
        .publish_ordered(FIRST, room, details.clone(), Some((token, 1)))
        .unwrap();
    service
        .publish_ordered(FIRST, room, Publication::PartyNameOnly, Some((token, 3)))
        .unwrap();
    service
        .publish_ordered(FIRST, room, details.clone(), Some((token, 2)))
        .unwrap();
    assert!(
        service
            .poll(HOST, room, 0)
            .unwrap()
            .members
            .iter()
            .find(|m| m.member_id == player)
            .unwrap()
            .inspection
            .is_none()
    );
    run(&mut service, room, FIRST, Resume);
    rejected(
        service.publish_ordered(FIRST, room, details, Some((token, 4))),
        Rejection::Disconnected,
    );
}

#[test]
fn queued_action_retries_after_the_senders_lease_resumes() {
    let db = Database::new();
    let mut service = db.open();
    let (room, _, recipient) = roster(&mut service, HostMode::Party);
    let send = command(
        room,
        Send {
            action_id: Uuid::new_v4(),
            recipient,
            source: "Mending light".into(),
            effect: Effect::Healing(4.try_into().unwrap()),
        },
    );
    run(&mut service, room, FIRST, Disconnect);
    rejected(service.execute(FIRST, &send), Rejection::Disconnected);
    run(&mut service, room, FIRST, Resume);
    let result = service.execute(FIRST, &send).unwrap();
    assert_eq!(service.execute(FIRST, &send).unwrap(), result);
    assert_eq!(service.reconcile(SECOND, room).unwrap().len(), 1);
}

#[test]
fn grant_end_is_scoped_to_sender_and_survives_a_late_send() {
    let db = Database::new();
    let mut service = db.open();
    let (room, _, recipient) = roster(&mut service, HostMode::Party);
    let grant_id = Uuid::new_v4();
    let grant = Effect::Grant(AttackGrant {
        grant_id,
        category: AttackCategory::Weapon,
        stacking: BonusStacking::Infusion,
        attack: 1,
        damage: 1,
        end_rule: GrantEnd::SourceEnds,
    });
    let send = Send {
        action_id: Uuid::new_v4(),
        recipient,
        source: "Glass etching".into(),
        effect: grant,
    };
    run(&mut service, room, HOST, EndGrant { grant_id });
    drop(service);
    let mut service = db.open();
    for who in [HOST, FIRST, SECOND] {
        run(&mut service, room, who, Resume);
    }
    assert!(matches!(
        run(&mut service, room, HOST, send.clone()),
        Receipt::Offer {
            status: Status::Ended,
            ..
        }
    ));
    let Receipt::Offer {
        offer_id,
        status: Status::Pending,
    } = run(&mut service, room, FIRST, send)
    else {
        panic!("Expected live grant")
    };
    run(&mut service, room, SECOND, Claim { offer_id });
    run(&mut service, room, FIRST, EndGrant { grant_id });
    rejected(
        service.execute(SECOND, &command(room, Accept { offer_id })),
        Rejection::InvalidTransition,
    );
    assert!(
        service
            .reconcile(SECOND, room)
            .unwrap()
            .iter()
            .all(|o| o.status == Status::Ended)
    );
}

#[test]
fn buff_offers_validate_and_end_with_their_source() {
    let db = Database::new();
    let mut service = db.open();
    let (room, _, recipient) = roster(&mut service, HostMode::Party);
    let grant_id = Uuid::new_v4();
    let buff = StatBuff {
        grant_id,
        speed: 10,
        ac: 0,
        attack: 0,
        attack_die: 0,
        damage: 0,
        save: 0,
        save_die: 0,
        seconds: std::num::NonZeroU32::new(3600),
    };
    let parsed: Effect = serde_json::from_value(json!({
        "kind": "buff", "amount": {"grant_id": grant_id, "speed": 10, "seconds": 3600}
    }))
    .unwrap();
    assert_eq!(parsed, Effect::Buff(buff));
    let send = |effect| Send {
        action_id: Uuid::new_v4(),
        recipient,
        source: "Longstrider".into(),
        effect,
    };
    rejected(
        service.execute(
            FIRST,
            &command(
                room,
                send(Effect::Buff(StatBuff {
                    attack_die: 5,
                    ..buff
                })),
            ),
        ),
        Rejection::InvalidInput,
    );
    let Receipt::Offer {
        offer_id,
        status: Status::Pending,
    } = run(&mut service, room, FIRST, send(Effect::Buff(buff)))
    else {
        panic!("Expected a pending buff")
    };
    run(&mut service, room, SECOND, Claim { offer_id });
    run(&mut service, room, SECOND, Accept { offer_id });
    run(&mut service, room, FIRST, EndGrant { grant_id });
    let offers = service.reconcile(SECOND, room).unwrap();
    assert!(
        offers
            .iter()
            .any(|o| o.offer_id == offer_id && o.status == Status::Ended)
    );
}

#[test]
fn replay_documented_wire_exchanges() {
    let db = Database::new();
    let mut service = db.open();
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/party-exchanges.json")).unwrap();
    let mut ids = BTreeMap::new();
    for exchange in fixture["exchanges"].as_array().unwrap() {
        let principal = match exchange["as"].as_str().unwrap() {
            "host" => HOST,
            "first" => FIRST,
            "second" => SECOND,
            unknown => panic!("{unknown}"),
        };
        let mut request = json!({ "room_id": fixture["room_id"], "version": fixture["version"],
            "command_id": exchange["command_id"], "command": exchange["command"] });
        substitute(&mut request, &ids);
        let cmd: Command = serde_json::from_value(request).unwrap();
        let receipt = service.execute(principal, &cmd).unwrap();
        assert_eq!(service.execute(principal, &cmd).unwrap(), receipt);
        let actual = serde_json::to_value(receipt).unwrap();
        let mut expected = exchange["receipt"].clone();
        let generated = match cmd.command {
            Create { .. } | Join { .. } => Some("member_id"),
            Send { .. } => Some("offer_id"),
            _ => None,
        };
        if let Some(key) = generated {
            ids.insert(expected[key].as_str().unwrap().into(), actual[key].clone());
        }
        substitute(&mut expected, &ids);
        assert_eq!(actual, expected);
    }
}

#[test]
fn role_scoped_dispatch_and_stable_revision_conflicts() {
    let db = Database::new();
    let mut service = db.open();
    let (room, _, second) = roster(&mut service, HostMode::Dm);
    let round = |encounter_id, expected_revision| SetRound {
        encounter_id,
        expected_revision,
        round: 1.try_into().unwrap(),
    };
    let enc = Uuid::new_v4();
    let fresh = Principal::Paired(Uuid::new_v4());
    let refused = command(
        room,
        Join {
            name: String::new(),
        },
    );
    rejected(service.execute(fresh, &refused), Rejection::InvalidInput);
    let altered = Command {
        command: Join {
            name: "Moss".into(),
        },
        ..refused
    };
    rejected(service.execute(fresh, &altered), Rejection::CommandConflict);
    for op in [
        Close,
        round(enc, 0),
        Expire {
            offer_id: Uuid::new_v4(),
        },
    ] {
        rejected(
            service.execute(FIRST, &command(room, op)),
            Rejection::Forbidden,
        );
    }
    rejected(
        service.execute(
            SECOND,
            &command(
                Uuid::new_v4(),
                Create {
                    mode: HostMode::Dm,
                    name: "DM".into(),
                },
            ),
        ),
        Rejection::Forbidden,
    );
    let later = command(room, round(enc, 1));
    rejected(service.execute(HOST, &later), Rejection::RevisionConflict);
    let initial = command(room, round(enc, 0));
    let receipt = service.execute(HOST, &initial).unwrap();
    rejected(service.execute(HOST, &later), Rejection::RevisionConflict);
    run(&mut service, room, HOST, round(enc, 1));
    assert_eq!(service.execute(HOST, &initial).unwrap(), receipt);
    let conflict = Command {
        command: Close,
        ..initial.clone()
    };
    rejected(service.execute(HOST, &conflict), Rejection::CommandConflict);
    rejected(service.execute(FIRST, &initial), Rejection::Forbidden);
    rejected(
        service.execute(HOST, &command(room, round(Uuid::new_v4(), 2))),
        Rejection::RevisionConflict,
    );
    let bad_version = Command {
        version: VERSION + 1,
        ..initial.clone()
    };
    rejected(
        service.execute(HOST, &bad_version),
        Rejection::UnsupportedVersion,
    );
    let offer_id = send(&mut service, room, FIRST, second);
    for (who, op) in [
        (HOST, Claim { offer_id }),
        (FIRST, Accept { offer_id }),
        (SECOND, Withdraw { offer_id }),
    ] {
        rejected(
            service.execute(who, &command(room, op)),
            Rejection::Forbidden,
        );
    }
    rejected(
        service.execute(SECOND, &command(room, Accept { offer_id })),
        Rejection::InvalidTransition,
    );
    run(&mut service, room, HOST, Expire { offer_id });
    assert_eq!(
        service.reconcile(SECOND, room).unwrap()[0].status,
        Status::Expired
    );
    rejected(
        service.execute(SECOND, &command(room, Claim { offer_id })),
        Rejection::InvalidTransition,
    );
    let (other, _, _) = roster(&mut service, HostMode::Party);
    rejected(
        service.execute(HOST, &command(other, round(enc, 0))),
        Rejection::Forbidden,
    );
    rejected(
        service.execute(SECOND, &command(other, Claim { offer_id })),
        Rejection::Forbidden,
    );
    assert!(service.poll(HOST, other, 0).unwrap().encounter.is_none());
    assert_eq!(
        service
            .poll(SECOND, room, 0)
            .unwrap()
            .encounter
            .unwrap()
            .revision,
        2
    );
}

#[test]
fn member_specific_serialized_responses_and_ephemeral_inspections() {
    let db = Database::new();
    let mut service = db.open();
    let (room, first, second) = roster(&mut service, HostMode::Dm);
    let view = |service: &RoomService, who, cursor| {
        serde_json::to_value(service.poll(who, room, cursor).unwrap()).unwrap()
    };
    let host_cursor = view(&service, HOST, 0)["cursor"].as_u64().unwrap();
    let offer_id = send(&mut service, room, FIRST, second);
    run(&mut service, room, SECOND, Claim { offer_id });
    let receipt = run(&mut service, room, SECOND, Accept { offer_id });
    assert_eq!(
        serde_json::to_value(receipt).unwrap(),
        json!({"kind":"offer","offer_id":offer_id,"status":"accepted"})
    );
    let details = json!({"sharing":"character_details","vitals":{"current_hp":17,"max_hp":20},
        "details":{"inventory":[{"name":"Private prism","rules":"Prism marker"}]}});
    service
        .publish(SECOND, room, serde_json::from_value(details).unwrap())
        .unwrap();
    for who in [FIRST, SECOND, HOST] {
        let response = view(&service, who, 0);
        assert_eq!(
            response["members"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|m| m["name"] == "Lark")
                .count(),
            2
        );
        let text = response.to_string();
        assert_eq!(text.contains("Prism marker"), who == HOST);
        assert_eq!(text.contains("current_hp"), who == HOST);
        assert_eq!(text.contains("Glass moth"), who != HOST);
        assert_eq!(text.contains(&offer_id.to_string()), who != HOST);
        if who != HOST {
            assert_eq!(response["offers"][0]["status"], "accepted");
            let events: Vec<_> = response["events"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|d| d["event"]["offer"]["status"].as_str())
                .collect();
            assert_eq!(events, ["pending", "claimed", "accepted"]);
        }
    }
    assert!(
        view(&service, HOST, host_cursor)["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(service.reconcile(HOST, room).unwrap().is_empty());
    run(&mut service, room, SECOND, Disconnect);
    let dm = service.poll(HOST, room, 0).unwrap();
    let stale = dm.members.iter().find(|m| m.member_id == second).unwrap();
    assert!(!stale.online && stale.inspection.is_some());
    rejected(service.poll(SECOND, room, 0), Rejection::Disconnected);
    run(&mut service, room, SECOND, Resume);
    assert!(!view(&service, HOST, 0).to_string().contains("Prism marker"));
    service
        .publish(
            SECOND,
            room,
            serde_json::from_value(json!({"sharing":"vitals","vitals":{"current_hp":19}})).unwrap(),
        )
        .unwrap();
    assert!(view(&service, HOST, 0).to_string().contains("current_hp"));
    service
        .publish(SECOND, room, Publication::PartyNameOnly)
        .unwrap();
    assert!(!view(&service, HOST, 0).to_string().contains("current_hp"));
    run(&mut service, room, FIRST, Leave);
    assert!(
        !service
            .poll(HOST, room, 0)
            .unwrap()
            .members
            .iter()
            .any(|m| m.member_id == first)
    );
    rejected(
        service.execute(FIRST, &command(room, Resume)),
        Rejection::Forbidden,
    );
    assert!(
        serde_json::from_value::<Publication>(
            json!({"sharing":"vitals","vitals":{"journal":"secret"}})
        )
        .is_err()
    );
    let mut forged = serde_json::to_value(command(room, Close)).unwrap();
    forged["principal"] = json!("LocalHost");
    assert!(serde_json::from_value::<Command>(forged).is_err());
    drop(service);
    let file = fs::read(&db.0).unwrap();
    for marker in ["Prism marker", "Private prism", "current_hp"] {
        assert!(!file.windows(marker.len()).any(|w| w == marker.as_bytes()));
    }
}

#[test]
fn restart_and_close_preserve_claims_without_restoring_membership() {
    let db = Database::new();
    let mut service = db.open();
    let (room, _, recipient) = roster(&mut service, HostMode::Dm);
    let claimed = send(&mut service, room, FIRST, recipient);
    let pending = send(&mut service, room, FIRST, recipient);
    let claim = command(room, Claim { offer_id: claimed });
    let claimed_receipt = service.execute(SECOND, &claim).unwrap();
    let cursor = service.poll(SECOND, room, 0).unwrap().cursor;
    drop(service);
    let mut service = db.open();
    rejected(service.poll(SECOND, room, cursor), Rejection::Disconnected);
    assert_eq!(
        member_id(run(&mut service, room, SECOND, Resume)),
        recipient
    );
    assert_eq!(service.execute(SECOND, &claim).unwrap(), claimed_receipt);
    let resumed = service.poll(SECOND, room, cursor).unwrap();
    assert!(
        resumed
            .events
            .iter()
            .all(|d| d.cursor > cursor && d.event == Event::RosterChanged)
    );
    assert!(
        resumed
            .offers
            .iter()
            .any(|o| o.offer_id == claimed && o.status == Status::Claimed)
    );
    run(&mut service, room, HOST, Resume);
    run(&mut service, room, HOST, Expire { offer_id: claimed });
    run(&mut service, room, HOST, Close);
    rejected(service.poll(SECOND, room, 0), Rejection::Closed);
    rejected(
        service.execute(SECOND, &command(room, Resume)),
        Rejection::Closed,
    );
    rejected(
        service.execute(
            Principal::Paired(Uuid::new_v4()),
            &command(room, Join { name: "New".into() }),
        ),
        Rejection::Closed,
    );
    let offers = service.reconcile(SECOND, room).unwrap();
    assert!(
        offers
            .iter()
            .any(|o| o.offer_id == pending && o.status == Status::Expired)
    );
    assert!(
        offers
            .iter()
            .any(|o| o.offer_id == claimed && o.status == Status::Claimed)
    );
    drop(service);
    let mut service = db.open();
    assert_eq!(
        run(&mut service, room, SECOND, Claim { offer_id: claimed }),
        claimed_receipt
    );
    rejected(
        service.execute(FIRST, &command(room, Claim { offer_id: claimed })),
        Rejection::Closed,
    );
    let accept = command(room, Accept { offer_id: claimed });
    let receipt = service.execute(SECOND, &accept).unwrap();
    drop(service);
    let mut service = db.open();
    assert_eq!(service.execute(SECOND, &accept).unwrap(), receipt);
    assert_eq!(
        run(&mut service, room, SECOND, accept.command.clone()),
        receipt
    );
    rejected(
        service.execute(SECOND, &command(room, Decline { offer_id: claimed })),
        Rejection::InvalidTransition,
    );
    assert!(
        service
            .reconcile(FIRST, room)
            .unwrap()
            .iter()
            .any(|o| o.status == Status::Accepted)
    );
    assert!(service.reconcile(HOST, room).unwrap().is_empty());
}

#[test]
fn lost_claim_acknowledgment_survives_process_exit() {
    // The child exits immediately after commit, before returning a receipt or
    // running destructors. The parent has only the original command to retry.
    if let Some(path) = std::env::var_os("AURORA_P01_CHILD_DATABASE") {
        let claim: Command =
            serde_json::from_str(&std::env::var("AURORA_P01_CHILD_CLAIM").unwrap()).unwrap();
        let mut service = RoomService::open(path).unwrap();
        run(&mut service, claim.room_id, SECOND, Resume);
        service.execute(SECOND, &claim).unwrap();
        std::process::exit(0);
    }
    let db = Database::new();
    let mut service = db.open();
    let (room, _, second) = roster(&mut service, HostMode::Party);
    let offer_id = send(&mut service, room, FIRST, second);
    let claim = command(room, Claim { offer_id });
    drop(service);

    let child = Process::new(std::env::current_exe().unwrap())
        .args(["--exact", "lost_claim_acknowledgment_survives_process_exit"])
        .env("AURORA_P01_CHILD_DATABASE", &db.0)
        .env(
            "AURORA_P01_CHILD_CLAIM",
            serde_json::to_string(&claim).unwrap(),
        )
        .output()
        .unwrap();
    assert!(
        child.status.success(),
        "{}",
        String::from_utf8_lossy(&child.stdout)
    );
    let mut service = db.open();
    let recovered = service.reconcile(SECOND, room).unwrap();
    assert_eq!(recovered[0].status, Status::Claimed);
    assert_eq!(member_id(run(&mut service, room, SECOND, Resume)), second);
    assert_eq!(
        service.execute(SECOND, &claim).unwrap(),
        Receipt::Offer {
            offer_id,
            status: Status::Claimed
        }
    );
    run(&mut service, room, SECOND, Accept { offer_id });
    let view = service.poll(SECOND, room, 0).unwrap();
    assert_eq!(view.events.iter().filter(|d| matches!(&d.event, Event::OfferChanged { offer } if offer.status == Status::Claimed)).count(), 1);
    assert_eq!(view.offers[0].status, Status::Accepted);
}

#[test]
fn concurrent_claim_and_withdraw_have_one_durable_winner() {
    let db = Database::new();
    let mut sender = db.open();
    let (room, _, second) = roster(&mut sender, HostMode::Party);
    let mut recipient = db.open();
    run(&mut recipient, room, SECOND, Resume);
    let offer_id = send(&mut sender, room, FIRST, second);
    let gate = Barrier::new(2);
    let (claim, withdraw) = thread::scope(|scope| {
        let claim = scope.spawn(|| {
            gate.wait();
            recipient.execute(SECOND, &command(room, Claim { offer_id }))
        });
        gate.wait();
        let withdraw = sender.execute(FIRST, &command(room, Withdraw { offer_id }));
        (claim.join().unwrap(), withdraw)
    });
    let status = match (claim, withdraw) {
        (Ok(_), Err(PartyError::Rejected(Rejection::InvalidTransition))) => Status::Claimed,
        (Err(PartyError::Rejected(Rejection::InvalidTransition)), Ok(_)) => Status::Withdrawn,
        other => panic!("unexpected competing results {other:?}"),
    };
    let deliveries = sender.poll(FIRST, room, 0).unwrap().events;
    assert_eq!(
        deliveries
            .iter()
            .filter(|d| matches!(d.event, Event::OfferChanged { .. }))
            .count(),
        2
    );
    assert_eq!(db.open().reconcile(SECOND, room).unwrap()[0].status, status);
}

#[test]
fn leaving_retires_pending_offers_and_preserves_the_recipients_claim() {
    let db = Database::new();
    let mut service = db.open();
    let (room, first, second) = roster(&mut service, HostMode::Dm);
    let pending_in = send(&mut service, room, FIRST, second);
    let pending_out = send(&mut service, room, SECOND, first);
    let claimed = send(&mut service, room, FIRST, second);
    run(&mut service, room, SECOND, Claim { offer_id: claimed });
    service
        .publish(
            SECOND,
            room,
            Publication::Vitals {
                vitals: Vitals {
                    current_hp: Some(17),
                    ..Default::default()
                },
            },
        )
        .unwrap();
    run(&mut service, room, SECOND, Leave);
    let dm = serde_json::to_string(&service.poll(HOST, room, 0).unwrap()).unwrap();
    assert!(!dm.contains("current_hp"));
    assert!(!dm.contains(&second.to_string()));
    for offer_id in [pending_in, pending_out] {
        assert!(
            service
                .reconcile(FIRST, room)
                .unwrap()
                .iter()
                .any(|o| o.offer_id == offer_id && o.status == Status::Expired)
        );
    }
    rejected(
        service.execute(FIRST, &command(room, Decline { offer_id: claimed })),
        Rejection::Forbidden,
    );
    let result = run(&mut service, room, SECOND, Decline { offer_id: claimed });
    assert_eq!(
        result,
        Receipt::Offer {
            offer_id: claimed,
            status: Status::Declined
        }
    );
    rejected(service.poll(SECOND, room, 0), Rejection::Forbidden);
}

#[test]
fn offline_events_replay_in_order_across_cursor_pages() {
    let db = Database::new();
    let mut service = db.open();
    let (room, _, second) = roster(&mut service, HostMode::Dm);
    let before = service.poll(SECOND, room, 0).unwrap().cursor;
    run(&mut service, room, SECOND, Disconnect);
    let encounter_id = Uuid::new_v4();
    for revision in 0..131 {
        run(
            &mut service,
            room,
            HOST,
            SetRound {
                encounter_id,
                expected_revision: revision,
                round: 1.try_into().unwrap(),
            },
        );
    }
    let offer_id = send(&mut service, room, FIRST, second);
    drop(service);
    let mut service = db.open();
    run(&mut service, room, SECOND, Resume);
    let mut cursor = before;
    let mut revisions = Vec::new();
    let mut pages = 0;
    loop {
        let view = service.poll(SECOND, room, cursor).unwrap();
        if view.events.is_empty() {
            break;
        }
        for delivery in view.events {
            assert_eq!(delivery.cursor, cursor + 1);
            cursor = delivery.cursor;
            if let Event::EncounterChanged { encounter } = delivery.event {
                revisions.push(encounter.revision);
            }
        }
        assert_eq!(view.cursor, cursor);
        pages += 1;
    }
    assert_eq!(pages, 2);
    assert_eq!(revisions, (1..=131).collect::<Vec<_>>());
    run(&mut service, room, SECOND, Claim { offer_id });
    run(&mut service, room, SECOND, Accept { offer_id });
    assert_eq!(
        service.reconcile(FIRST, room).unwrap()[0].status,
        Status::Accepted
    );
}

#[test]
fn failed_write_rolls_back_state_delivery_and_receipt() {
    let db = Database::new();
    let mut service = db.open();
    let (room, _, second) = roster(&mut service, HostMode::Party);
    let offer_id = send(&mut service, room, FIRST, second);
    let cmd = command(room, Claim { offer_id });
    let before = service.poll(SECOND, room, 0).unwrap().cursor;
    let sql = Connection::open(&db.0).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_journal BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'test fault'); END;").unwrap();
    assert!(matches!(
        service.execute(SECOND, &cmd),
        Err(PartyError::Storage(_))
    ));
    let view = service.poll(SECOND, room, before).unwrap();
    assert_eq!(view.offers[0].status, Status::Pending);
    assert!(view.events.is_empty());
    sql.execute_batch("DROP TRIGGER fail_journal").unwrap();
    service.execute(SECOND, &cmd).unwrap();
    assert_eq!(service.poll(SECOND, room, before).unwrap().events.len(), 1);
}

#[test]
fn native_entry_point_initializes_and_preserves_versioned_database() {
    let db = Database::new();
    for _ in 0..2 {
        let output = Process::new(env!("CARGO_BIN_EXE_aurora-party"))
            .arg("init")
            .arg(&db.0)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let sql = Connection::open(&db.0).unwrap();
    assert_eq!(
        sql.pragma_query_value(None, "user_version", |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
    sql.pragma_update(None, "user_version", 2).unwrap();
    assert!(matches!(
        RoomService::open(&db.0),
        Err(PartyError::Schema(2))
    ));
}

#[test]
fn vitals_carry_death_saves_only_while_dying() {
    // Older sheets publish no death_saves; the field stays out of the JSON when absent.
    let old: Vitals = serde_json::from_value(json!({"current_hp": 7, "max_hp": 20})).unwrap();
    assert!(old.death_saves.is_none());
    assert!(!serde_json::to_string(&old).unwrap().contains("death_saves"));
    let dying: Vitals = serde_json::from_value(json!({
        "current_hp": 0, "max_hp": 20,
        "death_saves": {"successes": 1, "failures": 2, "stable": false, "dead": false}
    }))
    .unwrap();
    let saves = dying.death_saves.as_ref().unwrap();
    assert_eq!((saves.successes, saves.failures), (1, 2));
    assert!(
        serde_json::from_value::<Vitals>(json!({"death_saves": {"successes": 1, "extra": 1}}))
            .is_err()
    );
    assert!(
        serde_json::from_value::<Vitals>(json!({"death_saves": {"successes": 300}})).is_err()
    );
}
