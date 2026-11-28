# Home Wi-Fi multiplayer and the DM screen

**Implementation plan.** This plan targets the Windows launcher, Rust importer, local browser sheet, and DM dashboard. Each phase below is one focused assignment. Use the rolling handoff to locate the current baseline and read the phase history for prior verification. [Current handoff](handoff.md)

## Assigning a phase

> Implement **phase `<ID>`** of `docs/local-multiplayer-plan.md`. Follow `AGENTS.md`. Read the common decisions, the assigned phase and its prerequisite handoff, and the relevant requirements and architecture sections. Inspect the code at the specified entry point, deliver the phase, and run its acceptance checks. Update the requirements, architecture, and handoff for the work. Stop at the end of the assigned phase.

Use the full phase ID, including its letter where applicable. The **Pass** paragraph gives the completion criteria. [Handoff procedure](handoff.md#handoff-procedure)

## What the players and DM experience

An artificer joins the host's invite from their usual tracker. When they use their Protector cannon, they pick two party members and enter the rolled temporary HP once. Each player can accept or decline. The artificer sees a receipt per player. The cannon costs one bonus action. Each player sees their own new total.

The DM can host without an Aurora character. Their screen shows initiative, shared player vitals, and private enemy cards. Three wolves from one template each have their own HP, conditions, and attacks. The DM can open a consenting player's sheet details or reveal an enemy under a chosen name.

In Manual play, the DM can roll physical dice, ask “Does a 16 hit?”, hear the player's answer, and record the result. Manual and Assist can open an addressed question, let the player use Shield, and confirm damage. The DM can announce a total separately. Both modes reach the same HP, reaction, and concentration handlers. [UI rework guide](multiplayer-ui.md)

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

### Library and monster combat phases

P01–P09D are implemented. The dated entries below record the checks and outstanding verification. P10 is the remaining implementation phase. For a UI-only assignment, preserve the shipped behavior and use the targeted [UI regression checklist](multiplayer-ui.md#test-the-rework). [Research, source pins and approval decisions](external-resource-research.md)

### P07A · Qualify the existing offline monster library

**Build.** Exercise Host as DM → Monster library using the existing `monsters.rs` model, DM-only store, browser editor and `aurora::import_monster_pack`. Reconcile observed gaps with R41–R42. Keep search by name, type/size/CR filters, edition/source, complete stat-block preview, Add N with one initiative score, manual creation/editing, JSON import/export and expected-revision replacement. Check the XML folder path independent of any player character. Preserve local-only content and snapshots. Use synthetic creature-shaped familiars and linked actions. Real user libraries stay out of Git.

**Pass.** Run `node tests/party-launcher.cjs --monsters` and the relevant room/initiative regressions against current packaged binaries. Import a version 1 pack, add three creatures, damage one, replace the pack, then resume the named roster after host restart. Old stats, independent HP and row IDs survive. Reject malformed imports and stale concurrent replacement atomically. Check JSON round-trip for zero, unknown and all text. Check Aurora setter and granted links, same-name editions and concealed guest responses. Record which existing scenarios passed and any fixes.

### P07B · Carry edition-specific rules through a compatible pack model

**Build.** Extend the validated pack where fidelity or an identified P09 mechanic needs it. Keep exact source version/locator, edition and license metadata, conditional defenses, fractional CR, printed initiative modifier/score, movement, abilities/saves, skills, senses, gear and optional fields with their qualifiers. Preserve additional sections, legendary preambles and full action/reaction text. Attach only supported save outcomes, damage components, bounded dice, uses, recharge, legendary cost or ordered strike references. Give incomplete conversions a readable explanation. Support native v1 import and stored snapshots explicitly. Keep the immutable descriptive data reusable by player-owned cards. Preserve existing companion keys, commands, timers, edits and undo.

**Pass.** Open a P06 template-free room and a v1 library with a saved snapshot, import/export a v2 pack and resume both editions after an update. Distinguish a +0 save, unknown AC, conditional AC, mixed sizes and fractional CR. Preserve a text-only rider and unresolved Aurora formula or link. Reject a native pack with a cyclic or missing executable reference before replacing the installed pack. Round-trip a multiattack that references the same leaf strike twice. Rehearse a cannon and an ordinary companion, shared/separate turns, expiration, re-import, zero HP and Undo in a solo sheet. Rename/reorder/hide/reload same-name enemy instances and verify stable distinct row IDs for future external references.

### P08A · Ship the licensed 2014 pack offline

**Build.** Convert the pinned Borealis SRD 5.1 monster, miscellaneous creature and NPC files into one 2014 pack. Use the English SRD 5.1 CC PDF as authority. Build from local pinned inputs with SHA-256 checks, stable IDs, deterministic ordering and an entry-to-source ledger. Preserve readable qualifiers and the source revision. Record exclusions, corrections and normalization changes. Include the official preamble's attribution, upstream notices and CC BY 4.0 license reference in pack details, credits and distribution. Default to 2014 for Aurora characters.

**Pass.** Generate the pack twice without a network connection and compare bytes. Reconcile the 317 candidate blocks by official entry, including both appendices, and explain any discrepancy before release. Check Wolf's conditional save, a multiattack, recharge and a legendary option against their source pages. Check the semantics of every enabled mechanic or leave its full rule manual. Search the installed pack, preview an entry, add it and open credits offline. Inspect the distribution file list for unexpected inputs or art.

### P08B · Ship the licensed 2024 pack alongside 2014

**Build.** Extend the same build to the Borealis SRD 5.2.1 monster and animal files and the English 5.2.1 CC PDF. Make the edition explicit in search, preview and snapshot. Retain printed initiative, alternative sizes, riders, conditional uses, gear and legendary/lair text. Resolve discrepancies from the official PDF with reviewed overrides. Open5e v2 can cross-check individual fields. Its 2024 document identifies itself as 5.2.

**Pass.** Reconcile all 330 candidate blocks by official entry and run the offline reproducibility, notices and enabled-mechanics checks from P08A. Put both wolves in one encounter. Their AC, bite and prone rules match their respective sources. Cover a save with a success branch, a multiattack with a substitution and a legendary creature with a lair qualifier. Upgrade or replace a pack and inspect an existing snapshot. Reopen both packs with networking disabled and verify source, edition and credits. Record any text-only exceptions.

### P09A · Run individual monster actions manually

**Build.** On the DM dashboard, show the current enemy's actions beside initiative, including hand-entered actions for template-free enemies. Manual is the initial preference. Support physical roll totals, spoken hit/miss/save, a note or override, and separate targets for separate strikes. An action has its own ID and stable strike IDs. Track the committed source cost, limited uses, recharge, reaction and legendary costs per instance. Duplicate copies the selected row's current counters under a new ID and discards pending exchanges. Add N initializes fresh counters. Keep a visible correction path. Recover on the printed boundary through P06 clock operations, with a manual roll or correction where needed. Keep raw rolls and private names DM-only unless the DM chooses what to announce.

**Pass.** Play “Does a 16 hit?” and record a miss with a hand-entered enemy. Use two strikes from a template against different targets and consume one parent action. Spend a recharge power and a legendary use on one of two matching monsters, then retry, restore, correct the current pointer and advance a real turn. Counters and any entered recovery roll change once at the right boundary. Canceling a preview costs nothing. An unstructured power remains usable. Verify initiative, rules text and action controls at 1920×1080.

### P09B · Deliver manually agreed damage to its owner

**Build.** From a recorded outcome, let the DM send one explicit, final damage amount per affected target and damage event. Use the existing `Effect::Damage` wire variant, claim and receipt path. Add explicit player-side dispatch for damage. Extract the state change from the local damage form and use the same temp HP, HP, concentration, zero-HP and log logic for accepted damage. Link child delivery IDs to the parent action. Each strike needs its own action ID on the wire for the same recipient. A miss or zero final amount closes cleanly. Support decline and recording an outcome handled at the table.

**Pass.** Apply 8 damage against 5 temp HP while concentrating, then check 3 HP lost and one concentration prompt. Repeat with full absorption, a drop to zero, both concentration rulesets and missing HP. Deliver two distinct hits to one target. Lose an acknowledgment, close after claim, inject a write failure, restore a backup, retry from two tabs and Undo. Each hit is consumed once and any correction belongs to the recipient. Run both writer modes. Keep other players' totals and private monster data out of responses.

### P09C · Pause for a save or reaction before final damage

**Build.** Add an optional addressed question with a versioned window ID per strike and target. Permit a name-only player to answer hit/miss/save, pass or use an available reaction. Revalidate locally and persist a reaction spend, effect and outgoing reply together. The DM can resume, cancel or record a spoken ruling with an explicit override. Persist outcomes and revisions so a late reply cannot finalize a canceled or superseded strike. Advance initiative or continue other targets while one player is offline. Route a stale trigger to manual adjudication. Reuse P09B only after finalization. Negotiate new protocol support or reject incompatible helpers clearly.

**Pass.** Shield changes a provisional hit to a miss. Spend one slot/reaction, send no damage and expire Shield once on the owner's boundary. Test delayed replies after Next Turn, tie correction, participant removal, cancellation, host restart and two tabs. A late reply cannot reopen a window. A reaction already spent can be corrected by its owner. Reconnect an offline recipient, downgrade sharing mid-window and resolve two targets independently. Inspect poll, replay, history, logs and storage for private defenses, raw sheets and hidden enemy labels. Public announcements contain only the DM's chosen fields.

### P09D · Suggest outcomes with bounded Assist

**Build.** Assist uses the Manual action and delivery paths. Make digital rolling, AC comparison and damage suggestions independently selectable per attack. Capture a natural die separately from a total, store rolls before retry, compare only currently permitted defenses, and offer rolled, printed average or custom damage. Show save branches, conditional riders, manual confirmation of modifiers and per-target outcomes. Allow mode changes and table rulings at every decision. Share pure calculations or existing state handlers with player actions where a second caller needs them.

**Pass.** Compare a natural critical, a natural 1 and an entered total of 20 with no natural die. Resolve an area save for two different outcomes and a multiattack interrupted between strikes. An unverified conditional resistance or missing defense stays manual. Switching modes or retrying a rolled attack reuses its roll, costs and final delivery. Exercise an existing player attack, a cast and Protector from Combat/Quick Actions for regression. Repeat the name-only Shield and duplicate damage cases from P09B–C through Assist.

### P10 · Package and rehearse a full session

**Build.** Package the Windows launcher, importer, Rust helper, DM assets, both offline packs and attributions. Document adapter selection, host/join, reconnect, sharing, manual adjudication, Assist and solo use. Provide host-owned encounter export/import with instance snapshots, roster, pointer and enemy state. Re-pair player identities explicitly when importing into a new room. Portable exports omit inspections, credentials, delivery ledgers and live pending exchanges. Players keep their existing backup/restore flow.

**Pass.** Run the Rust suite, release builds for both binaries, Windows launcher build, existing browser review and multi-profile LAN regression using `docs/development.md`. Rehearse host/join → share → encounter → interrupt → damage → disconnect/restart → resume/end. Include two tabs, delayed/duplicate delivery, decline, revoked visibility, fresh-room import and solo recovery. Open the package offline and verify both packs and credits. Check 1920×1080 first, then 2560×1440, both at 100% and 125% scaling. Report separate-process loopback and physical two-PC Wi-Fi/firewall results separately. Record any outstanding native picker/clipboard or device checks in the handoff.

## Handoff record

After each implemented phase, add a dated entry with its ID, outcome, exact checks, and remaining verification. Link the entry from the [current handoff](handoff.md) so the next session can find it without reading the full history.

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

### 2026-11-25 · P03 · Healing and temporary HP

Session → Party lets a player send a manual offer and see its status. The recipient claims and applies it using the sheet's HP rules. Acceptance follows the browser write that records both the change and its receipt. Undo keeps the delivery consumed. Backup export omits the receipt ledger. Restore detaches the sheet and keeps the local ledger. After resume, the recipient can apply a claimed offer, mark it already handled, or decline it.

The Windows rehearsal used three independent helpers with synthetic saves and separate Chrome profiles. Eight healing raised 17/20 HP to 20/20. An offer of 6 temporary HP kept 9 and still returned Accepted. Two tabs receiving the same offer recorded one change. After a reload and Undo, retrying the lost acknowledgment left HP at 17/20. A forced write failure left the offer claimed and HP unchanged until retry. Simultaneous offers, decline, all three restore choices, and sender and third-party privacy passed.

- `cargo test --locked --quiet` passed all 44 Rust tests.
- `cargo build --release --locked --bins` and `launcher\build.cmd target\p03-windows` built the Windows package in a separate directory.
- `node tests/party-launcher.cjs --offers --review-refresh` passed the P03 acceptance checks, the P02 launcher checks, Aurora refresh, and the solo browser regressions.
- `node tests/party-launcher.cjs --offers --fallback-writer` passed with Web Locks disabled in the recipient profile.
- Rust formatting, JavaScript syntax, and `git diff --check` passed.

The checked-out `dev` branch preceded P01 and P02. Their prerequisite diff from local `main` was applied to the working tree. The branch stayed on `dev`. Physical two-PC Wi-Fi and manual Windows picker and clipboard checks remain outstanding.

### 2026-11-25 · P04 · Send from existing spells and abilities

Healing casts, variable healing pools and Protector offer party targets from their existing controls. Each cast or activation writes costs, local effects and per-recipient commands together. Each recipient decides independently. A sender can withdraw a pending offer or request a correction for accepted HP. A committed outgoing action starts a new local undo history.

Active infusions and custom imbuements can be assigned to an ally. The ally chooses one eligible attack on their own sheet. Reassignment ends the previous grant. Source deactivation, expiry and rest resets also end grants. The host remembers an end even when it arrives before the original send. A temporarily disconnected sender can resume and retry with the same command ID.

The three-profile Windows rehearsal used synthetic characters, a Protector cannon, two matching player names, and separate Chrome profiles. Quick Actions granted 7 temporary HP to a companion and offered it to two players. One player accepted while the other delivery was interrupted, then the second player declined. One bonus action was spent. A failed browser write spent no slot. After a successful cast, a lost send response and sheet reload produced one slot spend and one heal. The variable healing pool spent three points and delivered three HP.

A custom grant changed Copper Blade and left Spare Hammer at its original value. Reassigning it to a spell attack removed the weapon modifier once. The new recipient's Lens Ray changed while Wizard Bolt kept its original roll. The caster's short rest ended the replacement. The sender's room response contained neither the selected weapon nor the recipient's inventory. A disconnected player resumed after an imported infusion had ended and had no grant to apply.

- `cargo test --locked --quiet` passed 46 Rust tests, including late sends, sender-scoped grant ends, and retry after a sender lease expires.
- The release binaries and `launcher\build.cmd target\p04-windows` produced a separate Windows package.
- `node tests/party-launcher.cjs --actions` passed the P04 acceptance scenarios. The same rehearsal passed with `--fallback-writer` and Web Locks disabled on the recipient. The P03 offer suite, launcher refresh and solo browser regressions also passed.
- Rust formatting, JavaScript syntax and diff whitespace checks passed.

The Windows rehearsal used loopback networking. Physical two-PC Wi-Fi, firewall setup, and manual interaction with the WinForms picker and system clipboard remain unverified.

### 2026-11-25 · P05 · DM lobby and character inspector

Host as DM opens a standalone dashboard without an Aurora save or content library. Players choose a sharing tier under Session → Party. The browser remembers it by profile, room and member, with name only for a new membership. The overview can hide AC while the inspector still shows shared AC. Offline rows mark retained vitals stale. The active sheet republishes after reconnect, and leaving clears the inspection. A connection token and sequence number keep delayed publications from restoring revoked details.

The Windows rehearsal opened a standalone DM and two independent synthetic player profiles. One shared details while the other shared vitals. The DM saw HP change to 11/25 with 4 temporary HP, an AC override of 19, a saving throw override, and a slot spend. The read-only inspector included distinct saved attacks even when the Aurora entries lacked pin IDs. Multiple redraws with identical values sent no new publication. Returning to name only closed and cleared the open inspector. The DM response dropped the revoked fields, and the player responses contained no inspections. Private markers from the raw save and journal stayed out of captured publish requests, responses, diagnostic logs and room database files.

- `cargo test --locked --quiet` passed 47 Rust tests, including rejection of a prior connection's publication and protection against a delayed details update after downgrade.
- `cargo build --release --locked --bins` and `launcher\build.cmd target\p05-windows` built the Windows package.
- `node tests/party-launcher.cjs --dashboard` passed the P05 acceptance rehearsal with Web Locks and with `--fallback-writer`.
- `node tests/party-launcher.cjs --actions --fallback-writer` and `node tests/party-launcher.cjs --offers --review-refresh` passed prior multiplayer, launcher refresh, and solo browser checks.
- Rust formatting, JavaScript syntax, and diff whitespace checks passed.

The packaged rehearsal used the launcher's native party components and separate Chrome profiles over loopback. Physical two-PC Wi-Fi and firewall behavior, manual WinForms picker interaction, and the system clipboard remain unverified.

### 2026-11-25 · P06 · Shared initiative and hand-entered enemies

Host as DM opens the encounter controls on the dashboard. Players submit their own score and companion choices from Combat → Initiative. The DM can roll or enter enemy initiative, group equal-name instances on one score, resolve ties, conceal or reveal aliases, and save or resume the roster and pointer. Each instance keeps its own HP, AC, conditions and action notes.

Turn changes use addressed clock events and a durable cursor on each sheet. Correct current turn changes position without replaying mechanics. Owners can explicitly restore the last local clock outcomes. Leaving restores the solo roster and turn. A named resume and a backup reattachment enter the saved position without advancing time.

- The packaged P06 rehearsal ran two synthetic players, an Opal moth and three synthetic sentinels through two rounds. It checked action resets, Extra Attack, turn effects, concentration, companion duration and six seconds per round. Player responses omitted hidden monster data.
- The rehearsal passed with Web Locks and with the IndexedDB fallback. It exercised a lost Next Turn response, tie and pointer edits, a missed round, a host restart, two browser tabs, an explicit time advance, backup restore, owner correction and a return to solo.
- All 48 Rust tests passed. The release binaries and Windows package built. Rust formatting, JavaScript syntax and diff whitespace checks passed.
- The packaged dashboard, party actions, HP offers, sheet refresh and solo browser regression suites passed.

Separate helpers and Chrome profiles ran on Windows loopback. Physical two-PC Wi-Fi and firewall behavior, manual WinForms picker interaction and the system clipboard remain unverified.

### 2026-11-25 · P07A · Qualify the offline monster library

The packaged Host as DM dashboard opened the library without an Aurora character. The rehearsal qualified v1 import/export, name search, type/size/CR filters, stat-block previews, and local creation and editing. Three synthetic wolves shared one initiative score and had distinct row IDs and HP. A named roster restored the original rules and the damaged wolf's HP after replacing its pack and restarting the helper. Two DM tabs previewed the same installed revision. Only the first replacement succeeded. Canceling a preview, malformed JSON, invalid rule references and a stale write preserved the installed revision.

The Aurora folder check resolved a setter-linked action, a granted reaction and an appended trait. The helper denied the library route to a guest and to a request from a different origin. Guest projections exposed the revealed alias and omitted the private name, actions and template. The library now disables pack controls while a load is in progress, gives the rule category control an explicit label and preserves line breaks in an encounter's stat-block preview.

- `cargo build --locked --offline --release --bins` and `launcher\build.cmd target\p07ab-windows` built the Windows package.
- `node tests/party-launcher.cjs --monsters` passed the combined P07A and P07B acceptance rehearsal on the rebuilt package.
- `cargo test --locked --offline --quiet` passed all 48 Rust tests. `node tests/party-launcher.cjs --initiative` and `node tests/party-launcher.cjs --initiative --fallback-writer` passed the packaged P06 shared-clock and initiative regressions.

### 2026-11-25 · P07B · Read and preserve versioned stat blocks

V2 preserves publication and license details, mixed size choices, conditional AC, fractional CR, printed initiative, qualified stats, gear, legendary preambles and additional rules sections. It carries structured save damage outcomes and legendary costs alongside rule text. The native reader rejected an unsupported version, out-of-bounds dice and missing or cyclic strike references before replacement. A repeated leaf strike survived export and import. The Aurora preview showed both an unresolved formula and a missing link.

The packaged rehearsal reloaded a P06-style template-free roster, an unversioned v1 snapshot roster, and a mixed-edition roster after updating both installed packs. The mixed-edition roster restored its saved turn and stable row IDs through rename, reveal, hide, tie reorder and helper restart. An unknown base AC, qualified alternatives and a +0 save remained distinct. The shared stat block contains descriptive data. Player cards keep their own live state.

- `node tests/party-launcher.cjs --monsters` passed, including the v2 round-trip, legacy data and edition-specific roster checks.
- `node tests/party-launcher.cjs --review-refresh` passed the launcher rehearsal, Aurora refresh and solo browser suite. The companion checks covered cannon destruction and expiry, shared and separate turns, the ordinary companion's configured zero-HP behavior, Undo and re-import preserving card IDs and local edits.
- Targeted `rustfmt --edition 2024 --check`, `node --check` and `git diff --check` passed.

The Windows harness uses the launcher's native components with separate helpers and Chrome profiles over loopback. Physical two-PC Wi-Fi and firewall behavior, manual WinForms adapter selection, the system clipboard and manual folder picker interaction remain unverified. The folder import itself passed with the browser file input and synthetic XML.

### 2026-11-25 · P08A · Bundled 2014 SRD 5.1 pack

Host as DM → Monster library installs and selects the bundled 2014 pack on first use. The English Creative Commons PDF reconciled all 317 pinned Borealis entries by name, section and source page. The inventory includes 201 Monsters chapter entries, 95 in Appendix MM-A and 21 in Appendix MM-B. Four reviewed overrides restore separate rules that upstream folded into adjacent text. The audit matched 1,480 named rules and 30 legendary preambles. [Entry ledger and source review](srd51-pack.md)

Wolf's Bite keeps its on-hit creature predicate and Strength save against prone. The Adult Red Dragon keeps its optional Frightful Presence and strike order, Fire Breath recharge and half-damage branch, and the Wing Attack cost and effects. Bundled rules are manual. The source audit checks printed HP, hit dice, CR, XP, base AC and conditional AC qualifiers used by the pack.

- `node tools/build-srd51.cjs target/p08a-offline-first` and `node tools/build-srd51.cjs target/p08a-offline-second` ran with external network access denied. Both generated files matched the checked-in pack and notices byte for byte.
- `python tools/check-srd51-source.py target/p08a-input/SRD_CC_v5.1.pdf content/monster-packs/srd-5.1-monsters.json` passed against the pinned PDF. The Wolf and Adult Red Dragon source pages were also reviewed visually.
- `cargo test --locked --offline --quiet` passed all 48 Rust tests. `cargo build --release --locked --offline --bins` and `launcher\build.cmd target\p08a-windows` built the Windows package. Targeted Rust formatting, JavaScript syntax and diff whitespace checks passed.
- `node tests/party-launcher.cjs --srd51` passed with external browser requests blocked. It covered the default pack, Wolf search, preview and add, offline credits, export, restart and preservation of a synthetic local replacement and the existing snapshot. The distribution contains three executables and the SRD notices file. `node tests/party-launcher.cjs --monsters` passed the synthetic v1/v2, local editing, Aurora XML, guest privacy and roster regressions after updating the second-tab test to select its synthetic pack explicitly.

The packaged rehearsal used Windows loopback with a fresh DM profile. Physical adapter disconnection, two-PC Wi-Fi and firewall behavior, and manual interaction with the WinForms picker remain unverified.

### 2026-11-25 · P08B · Bundled 2024 SRD 5.2.1 pack

Host as DM → Monster library offers 2024 alongside the default 2014 pack. Search results, the stat block and DM initiative distinguish the editions. In the same encounter, the 2014 Wolf had AC 13 and a Strength save against prone. The 2024 Wolf had AC 12, its printed initiative of 12, and a bite rider based on the target's size. After replacing the 2024 library pack with a synthetic revision, its previously added Wolf retained its edition, source, rules, row ID, and original installation revision.

The official English CC PDF reconciled all 330 candidates, with 235 Monsters A–Z entries and 95 Animals entries. The audit checked 1,329 rules and 30 legendary preambles, as well as printed stats, gear and lair XP. The Adult Red Dragon retained the one-attack Spellcasting substitution, half damage on a successful Fire Breath save, and lair-qualified legendary and resistance uses. The bundled actions, conditional riders, spell lists and lair rules are manual. Archmage keeps its printed XP, conditional movement reads as printed, and Young White Dragon's unsigned Intelligence save is shown as a table note. [Entry ledger and source review](srd521-pack.md)

- `node tools/build-srd51.cjs` and `node tools/build-srd521.cjs` ran for both `target/p08b-build-one` and `target/p08b-build-two` with external network access denied. Both pairs of JSON packs and notices matched the checked-in files byte for byte. The released 2014 bytes matched P08A.
- `python -B tools/check-srd51-source.py target/p08a-input/SRD_CC_v5.1.pdf content/monster-packs/srd-5.1-monsters.json` and `python -B tools/check-srd521-source.py target/p08b-input/SRD_CC_v5.2.1.pdf content/monster-packs/srd-5.2.1-monsters.json` passed against the pinned official PDFs. The Wolf and Adult Red Dragon checks also used their rendered pages.
- `cargo test --locked --offline --quiet` passed all 48 Rust tests. `cargo build --release --locked --offline --bins` and `launcher\build.cmd target\p08b-windows` built the package. Targeted Rust formatting, JavaScript syntax and diff whitespace checks passed.
- `node tests/party-launcher.cjs --srd521` passed mixed-edition initiative, printed 2024 rules and gear, re-open after helper restart, offline credits and export, and snapshot inspection after replacement. The distribution contains three executables and two notices files. `node tests/party-launcher.cjs --srd51` and `node tests/party-launcher.cjs --monsters` passed the 2014 and synthetic library regressions.

The packaged rehearsals used Windows loopback and blocked external browser requests. Physical adapter disconnection, two-PC Wi-Fi and firewall behavior, and manual WinForms picker interaction remain unverified.

### 2026-11-25 · P09A · Manual monster actions

Host as DM shows the active enemy's rules and Manual action controls beside initiative. The DM can add a hand-entered action, record physical totals and spoken outcomes with a private ruling, or assign separate targets to repeat strikes. The host records one parent cost and stable action and strike IDs. Canceling a preview spends nothing. Text-only rules can be adjudicated with manually added strikes and configured counters. The player projection omits rolls, action history, private names and counters.

Action, bonus action, reaction, legendary, limited-use and recharge counters belong to individual enemies. A legendary capacity is set by the DM from the creature's rules. The shared turn operation consumes a queued recharge roll at the enemy's next real start. Correct current turn and resuming a saved position preserve counters and queued rolls. Named saves also preserve history. Duplicate keeps counters under a new row ID and clears history and queued rolls. Add to encounter initializes each copy independently.

- `node tests/party-launcher.cjs --monster-actions` passed on Windows loopback with two synthetic characters, a hand-entered enemy and two copies of a synthetic template. The rehearsal covered the spoken miss on 16, replay of a committed multiattack after a lost response, distinct targets and strike IDs, a text-only rule, reaction, limited-use and legendary spending, duplication, correction, roster restore, helper restart and exact recharge timing. Initiative, rules and action controls were visible side by side at 1920×1080.
- `node tests/party-launcher.cjs --initiative`, the same check with `--fallback-writer`, `node tests/party-launcher.cjs --monsters` and `node tests/party-launcher.cjs --dashboard` passed.
- `cargo test --locked --offline --quiet` passed all 48 tests. `cargo build --locked --offline --release --bins` and `launcher\build.cmd target\p09a-windows` built the isolated Windows package with `CARGO_TARGET_DIR=target/p09a-build`. Targeted Rust formatting, JavaScript syntax and `git diff --check` passed.

The shared Windows rehearsal used loopback. Physical two-PC Wi-Fi, firewall behavior and manual WinForms interaction remain unverified. The existing running package was left in place. The next phase is P09B when assigned.

### 2026-11-25 · P09B · Deliver manually agreed damage

From a recorded strike, the DM enters a final amount or closes the result as handled at the table. The room links the parent action, distinct strike ID and addressed offer in one transaction. Misses and zero amounts close without an offer. Named roster restore preserves finalized deliveries. Players can accept or decline at name-only sharing, and the DM can request a recipient correction. The offer carries a generic label and the amount. Private monster names, raw rolls, rulings and other players' damage stay out of player responses.

Acceptance reuses local damage mechanics and the claim/receipt writer. The owner applies temporary HP first, uses the saved 2014 or 2024 concentration rules, ends concentration at zero HP, and can undo the mechanical change without reopening delivery. The sheet asks the owner to set missing HP before accepting. A claimed offer can be reconciled after backup restore or room closure.

- `node tests/party-launcher.cjs --monster-damage` and the same command with `--fallback-writer` passed. Synthetic sessions covered partial and full absorption, zero HP, both concentration rulesets, missing HP, distinct strikes to one recipient, a lost DM response and player acknowledgment, two tabs, a write failure, browser and room closure after claim, backup and roster restore, decline, correction, Undo and privacy.
- Packaged regressions passed with `node tests/party-launcher.cjs --review-refresh`, `node tests/party-launcher.cjs --offers` and `node tests/party-launcher.cjs --monster-actions`. These covered local damage, reactions, healing and temporary HP offers, and P09A action and recovery.
- `cargo test --locked --offline --quiet` passed all 48 tests. `cargo build --locked --offline --release --bins` and `launcher\build.cmd target\p09b-windows` built the Windows package in isolation. Targeted Rust formatting, JavaScript syntax and `git diff --check` passed.

Physical two-PC Wi-Fi, firewall behavior and manual WinForms interaction remain unverified. The existing running package was left in place. The next phase is P09C when assigned.

### 2026-11-25 · P09C · Save and reaction questions

The DM can ask the target of a recorded strike about a hit, save or reaction. Each question has a versioned window. The player can answer or pass at name-only sharing and can spend a prepared Shield reaction with a spell slot. The damage offer still requires a finalized ruling. The DM can use the reply, cancel the question, or enter a spoken ruling and private override reason. A real turn advance makes pending reaction triggers stale. Save questions can remain open across turns and reconnects. A late reply leaves the ruling intact and the owner retains control of any local reaction correction.

The recipient sees only the question kind and window reference. Replies include the ruling and a reaction-used flag. Public announcements contain only the DM's explicit text. Protocol 2 rejects version 1 helpers and invitations. The replacement package can resume persisted rooms using their existing identities.

- `node tests/party-launcher.cjs --strike-windows` and the same command with `--fallback-writer` passed. The synthetic rehearsal covered Shield turning a hit into a miss, single slot and reaction spend, owner-start expiry, duplicated tabs and a lost response, tie and pointer edits, stale and canceled replies, replacement generations, participant removal, an offline save across restart, sharing downgrade, owner Undo and privacy in projections and stored exchanges.
- `cargo test --locked --offline --quiet` passed all 48 Rust tests. `cargo build --locked --offline --release --bins` and `launcher\build.cmd target\p09c-windows` built the isolated package. Targeted Rust formatting, JavaScript syntax and `git diff --check` passed.
- Packaged regressions passed with `node tests/party-launcher.cjs --monster-damage`, `--initiative`, and `--review-refresh`. These covered finalized damage, the shared clock, launcher and TLS, and the player's solo combat controls.
- The isolated `node target/p09c-version-upgrade.cjs` check created a version 1 DM room and guest binding with the P09B package, then resumed both with P09C. The resumed session retained the same host certificate, endpoint, room, member and encounter.

Physical two-PC Wi-Fi, firewall behavior and manual WinForms interaction remain unverified. The running package was left in place. The next phase is P09D when assigned.

### 2026-11-25 · P09D · Bounded Assist

Host as DM → Monster actions opens in Manual. Assist makes digital attack dice, AC comparisons and damage suggestions independent per strike. The DM confirms printed attack bonuses, situational adjustments and any riders or damage modifiers. A natural die is stored separately from the entered total. Missing or withdrawn AC leaves the outcome to the table.

The DM can review another strike while a reply is pending. Each strike retains its identity, the parent action spends once, and a recorded digital roll stays fixed. Damage can use a stored roll, printed average or custom amount. Multiple targets using the same typed save can reuse its raw roll and apply different save branches. The DM confirms the final amount through the existing P09B offer. Bundled text-only rules remain available for manual adjudication.

- `cargo test --locked --offline --quiet` passed all 48 Rust tests. `cargo build --offline --locked --release --bins` and `launcher\build.cmd target\p09d-windows` built the isolated Windows package. Targeted Rust formatting, JavaScript syntax and `git diff --check` passed.
- `node tests/party-launcher.cjs --monster-assist` passed natural 20, natural 1, a total of 20 without a natural die, missing and withdrawn AC, an interrupted multiattack, a lost roll and offer response, mode changes, and full and half branches from the same area roll. It exercised printed-average and custom damage and required confirmation before using a damage suggestion with an unresolved resistance.
- `node tests/party-launcher.cjs --strike-windows --assist` passed name-only Shield, late replies and owner corrections with Web Locks. `node tests/party-launcher.cjs --monster-damage --assist --fallback-writer` passed duplicate delivery, receipt recovery and Undo with IndexedDB.
- `node tests/party-launcher.cjs --monster-actions`, `--review-refresh` and `--actions` passed the manual monster action, player attack, casting and Quick Actions Protector regressions.

Physical two-PC Wi-Fi, firewall behavior and manual WinForms interaction remain unverified. The running package was left in place. The next phase is P10 when assigned.

### 2026-11-26 · P10 (first part) · Portable encounter export and import

Implemented on Linux in a cloud session, so the Windows package and packaged rehearsals were not run. Host as DM → Initiative now has **Export encounter** and **Import encounter**. The room service exports the current position as an `aurora-encounter` v1 file and imports it as a DM-only, stopped-encounter edit with explicit seat pairing. [Design](architecture.md#shared-initiative-and-turn-boundaries) · [R54](requirements.md)

- `cargo test --locked --quiet` passed all 49 Rust tests, including the new `tests/encounter_portability.rs`. It covers two players sharing a name, a separate and a shared companion, two SRD 5.1 wolves with one damaged and one recorded strike, export privacy (no member IDs, empty history), a JSON round trip, rejection of guest import, foreign or duplicate pairing, a non-seat key, version 2, HP above max and unknown fields, a fresh-room import with one seat paired, pointer and enemy state retained, a clock delivery only to the paired player, rejection while running, and pointer movement when all seats are left out.
- `cargo build --release --locked --bins` built both helpers on Linux. `cargo check --locked --target x86_64-pc-windows-gnu --bins` type-checked the Windows-only runtime, including the new `export_encounter` loopback action.
- A Playwright smoke of the assembled DM lobby page with stubbed helper responses passed the import preview, same-name prefill only when unambiguous, duplicate-pairing rejection and the submitted `import` edit at 1920×1080.
- `node --check` passed for the changed JavaScript. `rustfmt --edition 2024 --check` passed for the changed Rust files.

Not run: `launcher\build.cmd`, `node tests/party-launcher.cjs --encounters` (new, unrun), the other packaged regressions, the full session rehearsal, 2560×1440 and 125% scaling, offline package inspection, and physical two-PC Wi-Fi/firewall. The rest of P10 (full packaging rehearsal and session documentation review) remains.
