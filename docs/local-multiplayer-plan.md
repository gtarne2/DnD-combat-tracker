# Home Wi-Fi multiplayer and the DM screen

**Implementation handoff.** This plan targets the shipped Windows launcher, Rust importer and local browser sheet. LAN rooms and the DM screen are planned features. Each phase below is one Codex assignment. P03 delivers the first playable exchange between two players. P06 delivers a DM-run encounter with hand-entered enemies. P09 delivers the intended combat experience. P10 qualifies the packaged release.

## Prompt for each Codex task

> Implement **phase P01** of `docs/local-multiplayer-plan.md`. Read `AGENTS.md`, `docs/requirements.md`, `docs/architecture.md`, the common decisions in this plan, and prior phase handoffs. Inspect the existing code. Deliver this phase through its specified entry point, run its acceptance checks, and fix regressions you find. Use synthetic characters and monsters in tests. Preserve existing changes in the checkout. Record implemented behavior and significant decisions in the existing requirements and architecture docs. Report what changed, which checks passed, and anything still unverified. Stop at the end of the assigned phase.

Replace P01 with the next phase ID for each subsequent task. Work in order. The **Pass** paragraph is the completion condition for each phase. Append a brief handoff at the bottom of this file. Keep outstanding physical-device checks visible to the next agent.

## What the players and DM experience

An artificer joins the host's invite from their usual tracker. When they use their Protector cannon, they pick two party members and enter the rolled temporary HP once. Each player can accept or decline. The artificer sees a receipt per player. The cannon costs one bonus action. Each player sees their own new total.

The DM can host without an Aurora character. Their screen shows initiative, shared player vitals, and private enemy cards. Three wolves from one template each have their own HP, conditions, and attacks. The DM can open a consenting player's sheet details or reveal an enemy under a chosen name.

In Manual play, the DM can roll physical dice, ask “Does a 16 hit?”, hear the player's answer, and record the result. In Assist, the DM can send the attack total, let the player use Shield, and confirm damage. Both flows reach the same HP, reaction, and concentration handlers.

## Architecture decisions for all phases

| Owner | Responsibility |
| --- | --- |
| Player's local browser sheet | Owns effective stats, HP, temporary HP, resources, reactions, equipment selection, and undo. Constructs the data the player chooses to share. Applies accepted changes through the existing encounter transaction. |
| Rust party service | Add a sibling executable named `aurora-party` and a testable Rust room model. One helper runs per participating launcher. The host's helper owns membership, routing, receipts, and, in DM rooms, shared initiative and enemies. Other helpers connect outbound to the host. |
| Windows launcher | Exposes **Host Party**, **Host as DM**, and **Join**. Starts and stops its helper, manages invitations and native credentials, opens the DM screen, and attaches the player's existing sheet to the local helper. Choose the host's role at room creation. Only a DM-hosted room publishes shared encounters. |
| DM screen | A dedicated local browser view opened without a save or XML library. Reads the host's DM projection and submits DM commands. The library edits templates. The encounter edits individual enemies. |

**Transport.** Use versioned JSON commands and cursor-based long polling. The browser talks only to its own helper on loopback. Give each attached view a random, role-scoped local capability. Validate the capability and expected origin, including the file sheet's origin. The existing refresh bridge continues to handle Aurora stage/apply locally. Generated character HTML can contain the original save for currency export. Serialize an explicit list of shareable fields.

The host opens a TLS listener on the selected LAN interface when hosting. Use maintained HTTP and TLS libraries. **Copy invite** produces a pasteable invitation containing host address, port, a high-entropy join secret, and a host certificate fingerprint verified by the joining helper. This solves address discovery and trust on a home network without a cloud service or browser certificate installation. Pair each participant separately, rotate or close invitations from the host, and derive sender and role from the authenticated session. Keep host identity stable across room resume. Reserve DM authority for the local host session.

**Visibility.** Filter at the source before a player's sheet publishes and again at the host before sending a response. The host is trusted to relay addressed offers. The following table applies equally to polling, reconnect, history, and status responses.

| Audience | Fields available |
| --- | --- |
| Party | Chosen display names, presence, public turn order, revealed enemy aliases, and whose turn it is. Use “DM turn” for a concealed enemy. |
| Sender and recipient | Offer, source label, mechanics needed to apply it, and status. A receipt says “Accepted” even when the recipient capped healing or already had higher temporary HP. |
| DM with **Vitals** permission | Current/max HP, temporary HP, effective AC, initiative, condition names, and concentration. Mark stale or unknown values. |
| DM with **Character details** permission | Vitals plus a read-only inspector with ability scores, saves, skills, attacks, spells, features, inventory, resource counts, and associated rules text. The player can choose **Party name only**, **Vitals**, or **Character details** at join or later. Default to name only. |
| Local owner | Source files, generated HTML, backups, local paths, tokens, journal, table notes, and layout. |

Keep player projections in host memory. Publish a fresh projection on reconnect. A sharing downgrade or explicit leave purges withdrawn fields from the host and any open inspector. Distinguish a transient disconnect by showing the last update as stale. Never include private projections in room exports or diagnostic logs.

**Identity and storage.** Use opaque room, member, encounter, template, monster instance, action, and offer IDs. Names can collide. Bind a native resume credential to the local character and room and store it using Windows user-protected storage. Store host commands, pending offers, receipts, and shared encounters transactionally in a versioned SQLite database under launcher app data. Acknowledge host mutations after commit. Shutting down preserves a room for explicit resume. Closing a room ends membership and expires pending offers.

**Protocol.** A command carries a protocol version, room ID, unique command ID, kind, and typed payload. Shared encounter edits also carry encounter ID and expected revision. A repeat with the same ID and payload returns the saved result. A different payload under the same ID fails. Serialize host mutations, order events, and deliver authorized events with per-member cursors. After reconnect, rebuild display state from projections and replay unprocessed mechanical events in order. A new round number alone cannot reproduce a missed turn boundary.

**Remote application and undo.** Save the applied-offer receipt and resulting HP or effect in one durable local write under the character's transaction lock. Add delivery metadata to the encounter's storage envelope, outside undo snapshots. Return a receipt only after persistence succeeds. When storage fails, show a retryable error. Undo reverses the local mechanical change and can publish “undone.” Its original delivery ID stays consumed. The sender may withdraw a pending offer. Costs belong to the original action and are spent once, including for multi-target actions or a declined offer. Keep the delivery ledger, credentials, cursors, and live outboxes outside portable backups. Detach a profile before restoring a backup, then reconcile outstanding offers before accepting deliveries again.

**Working with the current undo stack.** The browser currently restores whole snapshots. Add a commit result that distinguishes a durable write, a logical no-op, and a storage failure before sending any acknowledgment. Keep delivery metadata out of snapshot restoration. Represent shared clock events as undo boundaries so an older snapshot cannot turn back a DM clock or resurrect an expired effect. Start fresh local undo history at a boundary and explain that boundary in the UI. A shared action already delivered to another player has an explicit correction path: cancel pending recipients, request a recipient-owned reversal for applied effects, and let the sender correct their cost. Keep local-only undo available above the latest boundary. Test restoring a backup with a stale claimed offer using an explicit per-offer choice of already handled, apply, or decline.

**Repository starting points.** Use `launcher/TrackerLauncher.cs` and `launcher/build.cmd` for native entry points and packaging. Wire the player Party control through `src/combat/html.rs`. Look at `src/combat/encounter.js` for persistence, `turns.js` and `effects.js` for time and HP, `concentration.js` for reactions and damage, and `playbook.js` and `attack-modifiers.js` for Protector and imbuements. The browser modules are in `src/combat/`. Use `src/companion.rs` and `src/aurora.rs` for existing stat-block parsing. Extend the existing packaged-sheet regression style in `tests/browser-review.cjs` with a dedicated multiplayer suite that can open distinct browser profiles.

## Implementation phases

### P01 · Room model and durable delivery

**Build.** Implement the Rust model, wire types, projections, and persistence. Cover create, join, disconnect, resume, leave, and close. An offer moves from pending to claimed by its recipient, then accepted or declined. A decline can also resolve a pending offer. Withdrawal or expiry can win only before a claim. Once claimed, let the same recipient finish or replay its receipt after a crash. Closing a room expires pending offers and preserves claimed outcomes for reconciliation. Store a small synthetic example of each legal exchange. P02 must use these same room functions.

**Pass.** Exercise a host and two identically named players. Verify role enforcement, member-specific responses, stable retries, revision conflicts, and one winner for claim versus withdrawal. Restart on the same temporary database and resume a claimed offer. Inspect what each member actually receives.

### P02 · Host and join through the Windows launcher

**Build.** Implement the listeners, invitation, helper lifecycle, and capability attachment. Add a compact Party entry under Session. Show host/join state, names, reconnect status, copy invite, leave, and end room. Allow selecting a Wi-Fi adapter when several exist. Handle an unreachable host, incompatible version, closed invite, and changed host identity. Include the helper in the Windows build. A CLI-generated standalone sheet can still open and run solo.

**Pass.** Launch independent helpers and browser profiles using synthetic saves. Host, join, reload, interrupt the connection, and reconnect as the original member. Test real TLS and the browser-to-loopback connection. Verify existing Aurora refresh still works. Check that the LAN listener exposes only party operations and that a joining player cannot acquire DM privileges.

### P03 · Healing and temporary HP

**Build.** Add **Send to party member** with recipient, heal/temp HP, amount, and a short source label. Present Accept/Decline to the target and status to the sender. Reuse the owner healing and temporary HP rules in `turns.js` and `playbook.js`. Implement durable delivery and undo in `encounter.js` and backup handling in `session-files.js`. For two open tabs, serialize receipt and effect application under one lock. Require a single active writer where the browser cannot provide that lock.

**Pass.** Send 8 healing to a player at 17/20 and observe 20/20 locally. Offer 6 temporary HP to a player with 9 and observe 9. Test decline, simultaneous offers, lost acknowledgment, reload between commit and acknowledgment, and duplicate delivery to two tabs. Undo the heal and redeliver the offer. HP stays at 17/20. Verify the sender and a third player cannot read the target's totals in their responses.

### P04 · Send from existing spells and abilities

**Build.** Add party targets to healing casts, variable healing pools such as Lay on Hands, and Protector. Commit caster cost, local effects, and a durable outgoing action together, then send one offer per remote target. Retry independently per target. Support an ally receiving an infusion or custom imbuement. Send a grant ID, source label, target category, modifier, and end rule. The recipient privately chooses their eligible weapon or spell attack. Use the existing modifier calculation. Link ending, replacing, or expiring the source to that grant, including across reconnects.

**Pass.** Protector targets a local companion and two players, spends one bonus action, and handles one decline. Retrying a healing cast spends one slot. An imbuement adjusts only the selected attack and ends once. Test a source ending before a disconnected recipient accepts. Verify the normal Combat and Quick Actions entry points and confirm the sender never receives the recipient's inventory.

### P05 · DM lobby and character inspector

**Build.** Add the standalone DM dashboard, room-scoped sharing picker, party overview, and read-only inspector. Publish effective values after local changes, including HP, resource use, and local stat corrections. Coalesce multiple redraws. Give the DM an overview preference to hide AC while keeping it available in the inspector. A DM can launch directly from the picker without generating a player sheet.

**Pass.** Open one DM and two player profiles. One shares details, the other vitals. Change HP and override AC, then check the DM sees the new values. Downgrade to name only while an inspector is open. Inspect both its rendered contents and the network responses. Put distinctive private markers in the synthetic journal and raw save and verify they are absent from remote payloads, logs, and persisted room data.

### P06 · Shared initiative and enemies entered by hand

**Build.** Extend the initiative and saved-roster interactions with a host-owned encounter. Add, edit, duplicate, hide, reveal, and remove enemies. Each instance has its own name/alias, current/max HP, AC, conditions, initiative, action notes, and ID. The DM can enter or roll initiative and group identical enemies under one initiative score while retaining individual actions and HP. Players can submit initiative. The DM breaks ties, starts, advances, ends, saves, and resumes. A player companion can act with its owner or submit its own initiative.

**Clock integration.** The DM controls Next Turn in a joined encounter. Map member/companion IDs to each sheet's existing owner and companion keys. Extract the existing boundary handling from `turns.js`, `effects.js`, and the related concentration and companion hooks. Apply outgoing end, round rollover, and incoming start in order, once per shared event. Use these hooks for action resets, Extra Attack, concentration, effect expiration, and companion timers. Keep a durable per-sheet clock cursor alongside the update. When the DM takes control, enter the starting position without ticking elapsed time. Preserve solo roster data for leaving the room. Offer **Correct current turn** to move the pointer without replaying mechanics. Let each owner correct any mechanical outcome already committed. Handle authorized game-clock advances once through the same event stream.

**Pass.** Run two players, a companion, and three enemies through two rounds. Observe one reset at each owner's turn start and six elapsed seconds per round. Hide a monster and inspect player responses for its name, stats, and attack list. Disconnect a player for a round and verify timers catch up once. Restart the host mid-encounter. Reordering ties, correcting the pointer, or retrying Next Turn must preserve the expected timers. Leave the encounter and verify the local sheet can resume solo.

### P07 · Offline monster library and local imports

**Build.** Define a versioned JSON pack with pack ID, rules edition, source, attribution, and stable template IDs. Include type, size, challenge rating, defenses, HP/hit dice, speed, abilities, saves, skills, senses, traits, actions, reactions, and legendary actions when supplied. Preserve readable rules text alongside optional typed attack bonus, reach/range, damage components, save DC, uses, and recharge. Distinguish unknown values from zero. Represent multiattack with text and optional action references. Add search, filters, stat-block preview, **Add N**, a manual editor, and validated local JSON import/export.

Create each enemy from a snapshot of its template. Reimport updates the library and leaves existing instances playable at their original version and current HP. Display conflicts before replacing a pack. Keep local library content on the DM's machine. Support importing creature-shaped Aurora Companion definitions from a DM-selected XML folder, including their linked actions. Index these independently of a character's build. The user's local Monster Manual companion file includes Imp, Pseudodragon, Quasit, and Sprite. Test with original synthetic equivalents.

**Pass.** Import a fixture pack, create three wolves, damage one, and update their template. The two other wolves stay at full HP and the original fight retains its stats. Round-trip supported fields and all action text. Reject an invalid pack atomically. Distinguish same-name monsters across editions. Import a synthetic Aurora creature with a linked attack.

### P08 · Bundle the open monster packs

**Build.** Ship separate offline packs from the official English **SRD 5.1** and **SRD 5.2.1** Creative Commons releases. Default to the 2014-compatible pack for Aurora characters. Include the licensed monster stat blocks and applicable creature appendices, with edition labels in the picker. Capture the attribution specified by each release, source version, source page or entry reference, and input checksums. Include attribution in the UI and distribution. Provide a repeatable content build from pinned inputs. Verify any action converted to structured mechanics and preserve readable text for exceptions. Other creatures can come from private local packs or manual entry. [Official source downloads and licensing](https://www.dndbeyond.com/srd)

**Pass.** Regenerate both packs and compare stable output. Reconcile each manifest against the stat blocks in its source and account for exclusions. Check a simple attack, multiattack, a save, a recharge power, and a legendary monster against the official text. Open the packaged library offline. Verify search, same-name variants, and credits. Keep personal Aurora libraries and commercial book exports outside Git.

### P09 · Run enemy attacks manually or with Assist

**Build.** Show the active monster's actions beside initiative. **Manual** is the initial preference. Let the DM select an attack, announce or enter a roll, record hit/miss/save, and optionally send damage. **Assist** accepts a physical total or rolls dice, records a natural die separately from a modified total, and suggests outcomes using available shared defenses. Offer rolled, average, or custom damage, per-target saves, and a DM override. Resolve multiattack as separate strikes. Track limited uses, reactions, legendary action costs, and recharge for individual monster instances with manual corrections.

Keep digital rolling, AC comparison, and damage suggestions independently selectable. The DM can switch modes per attack. A recipient can respond with hit/miss, a save, or a reaction even when sharing name only. Pause before finalizing a result so Shield or another table ruling can change it. Send a single final damage offer per affected target. Reuse the character's temporary HP absorption and concentration checks in one transaction. Unstructured traits or unusual resistances get readable rules and an editable result. The DM selects which rolls and outcomes to announce.

**Pass.** Play “Does a 16 hit?” with physical dice and record a miss. Repeat with Assist, use Shield to turn a hit into a miss, and verify zero damage and one reaction cost. Resolve damage against temporary HP while concentrating and a save with two different outcomes. Test a name-only target, an offline target, a natural critical versus an entered modified total, two strikes from one multiattack, and one of two identical monsters spending a recharge power. Deliver a repeated damage message and verify one final outcome.

### P10 · Package and rehearse a full session

**Build.** Package launcher, importer, party helper, DM assets, offline packs, and attributions together. Document host/join, adapter selection, reconnecting, privacy, resuming a DM encounter, and solo use in the README. Provide a DM encounter export/import for the host-owned encounter and monster data. Re-pair player identities explicitly when restoring into a new room. Player backups continue to cover the local character.

**Pass.** Run the Rust suite, release builds for both binaries, Windows launcher build, existing browser review, and a multi-profile LAN regression using the environment documented in `docs/development.md`. Run the packaged flow from host and join through sharing, combat, disconnect, resume, and end. Include host restart, two tabs, delayed or duplicate messages, a declined offer, and withdrawn visibility. Recheck the supported desktop viewport sizes. Report separate-process tests and two-PC Wi-Fi tests distinctly. If physical devices are unavailable, record that rehearsal as outstanding.

## Handoff record

After each implemented phase, add a dated entry with the phase ID, verified outcome, exact checks run, and any remaining manual check. The next agent uses this record and inspects the actual code before beginning the next phase.

### 2026-11-24 · P01 · Room model and durable delivery

P02 can call `party::RoomService` for room commands, publishing, polling, and receipt reconciliation. The local host chooses Party or DM mode. Two players named Lark received distinct memberships and private offer streams. The tests compared the serialized replies for each player and the host, including what the DM could see after a sharing change or disconnect. [Synthetic wire exchanges](../tests/fixtures/party-exchanges.json)

Competing SQLite connections produced one winner for claim versus withdrawal. A separate process committed a claim and exited before acknowledging it. On reopening the same database, the recipient resumed, replayed the claim, and accepted once. Closing a room expired pending offers and preserved outstanding claims. An injected write failure rolled back the state change, event, and receipt together. The DM revision and member-cursor tests also covered stale edits and replay across two pages.

Checks on Windows with stable GNU Rust, w64devkit for bundled SQLite, and installed Chrome passed.

- `cargo test --locked --test party_room` passed all 10 P01 tests.
- `cargo test --locked --quiet` passed all 44 Rust tests. `cargo build --locked --bins` built both debug binaries.
- `target\debug\aurora-party.exe init` ran twice with isolated `LOCALAPPDATA` and opened the expected database.
- `node tests/browser-review.cjs` passed the existing solo-sheet regression and desktop viewport checks using synthetic saves.
- `rustfmt --edition 2024 --check src/party.rs src/bin/aurora-party.rs tests/party_room.rs` and `git diff --check` passed.

P01 has no remaining manual acceptance check. Launcher host/join, TLS, Windows-protected resume credentials, and the optional live launcher refresh rehearsal remain for P02. The physical two-PC Wi-Fi rehearsal remains outstanding.

### 2026-11-25 · P02 · Host and join through the Windows launcher

The launcher offers Host Party, Host as DM, Join and explicit resume. Each active launcher starts a Rust helper. Host and guest sheets show the roster in Session → Party, and a DM can open a lobby without importing a sheet. The helper routes membership through the P01 room functions. Windows DPAPI protects the persistent bindings. Shutting down the host preserves its room and certificate. Closing the room ends membership.

The Windows rehearsal used independent helpers, isolated app-data directories, synthetic saves and separate Chrome profiles. The guest reloaded its sheet, lost the host, observed reconnection and recovered its original member ID across restarts. Tests exercised invite replacement and closure, unreachable hosts, incompatible versions, a changed host identity and a mismatched TLS certificate, guest role restrictions, incorrect loopback origins and capabilities, leave, fresh pairing and room closure. The LAN listener accepted TLS and rejected refresh and host-control routes. The existing refresh rehearsal staged and applied changes and preserved the previous sheet on malformed XML.

- `cargo test --locked --quiet` passed all 44 Rust tests.
- `cargo build --release --locked --bins` and `launcher\build.cmd target\p02-windows` built the two helpers and Windows launcher. The separate package directory allowed the existing release launcher to stay open.
- `node tests/party-launcher.cjs --review-refresh` passed the multiplayer rehearsal and the existing browser regressions, including desktop viewport checks.
- `rustfmt --edition 2024 --check src/bin/aurora-party.rs` and `git diff --check` passed.

The harness exercised the launcher's native helper startup, sheet generation, DM lobby and refresh bridge. Manual interaction with the WinForms adapter picker, the Windows clipboard and a physical two-PC Wi-Fi/firewall rehearsal remain unverified. P03 can extend the party request types and browser controls for recipient-owned effects.
