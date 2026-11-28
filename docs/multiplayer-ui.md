# Multiplayer UI handoff

Start here for a multiplayer UI rework. The baseline is P09D plus the table-feedback, Owlbear and playtest rounds through R80, and the table tools R82–R86 (see the [handoff baseline](handoff.md#product-baseline)); the core multiplayer contract is R31–R53, with later behavior in R56–R86 (R81 is reserved by the Mac PR). Read the architecture section for the surface you are changing. Use the phase history for exact verification and P10 for remaining release work. [Requirements](requirements.md#user-requirements) · [Architecture](architecture.md#home-wi-fi-multiplayer) · [Current handoff](handoff.md) · [P10](local-multiplayer-plan.md#p10--package-and-rehearse-a-full-session)

## Entry points and owners

| Surface | Open it | Start in these files |
| --- | --- | --- |
| Windows host, join and resume | Launcher → **Party…** | [TrackerLauncher.cs](../launcher/TrackerLauncher.cs) opens the native picker in [PartySession.cs](../launcher/PartySession.cs). The helper dispatch and transport live in [party_runtime](../src/bin/party_runtime/). |
| DM dashboard | **Host as DM** or **Resume DM room** | [DM markup](../launcher/dm-dashboard.html), [styles](../launcher/dm-dashboard.css), and [overview and inspector](../launcher/dm-dashboard.js). The dashboard opens without an Aurora save. |
| DM initiative, monsters and recorded actions | Dashboard → **Initiative**, **Monster library**, or **Monster actions** | [Initiative and enemy controls](../launcher/dm-initiative.js), [library](../launcher/dm-monsters.js), [action and damage dialogs](../launcher/dm-monster-actions.js), and [Assist calculations](../launcher/dm-monster-assist.js). |
| Player party controls | Attached sheet → **Session → Party** | [Session markup](../src/combat/session-files.html), [room controls, browser polling and offers](../src/combat/party.js), [sharing](../src/combat/party-sharing.js), and [addressed questions](../src/combat/party-windows.js). The DM dashboard also embeds `party.js` for room controls and outgoing damage offers. |
| Player initiative and party combat actions | **Combat → Initiative**, **Combat** or **Quick Actions** | [Initiative markup](../src/combat/turns.html), [shared clock and initiative UI](../src/combat/party-initiative.js), and [party targets and outgoing action staging](../src/combat/party-actions.js). [Encounter writer](../src/combat/encounter.js) commits local mechanical changes. |

The Windows launcher embeds the DM assets through [build.cmd](../launcher/build.cmd). `PartySession.WriteLobby` assembles the local document, and `tests/party-launcher.cjs` has its own matching resource list for the native harness. If you add, rename or split a DM asset, update all three and preserve dependency order. Player assets are embedded by [src/combat/html.rs](../src/combat/html.rs). [RefreshBridge.cs](../launcher/RefreshBridge.cs) attaches the player capability to generated sheets.

## Flows to preserve

- **Connection and privacy.** Preserve solo, player-host, guest and DM entry points. Keep lobby connection, offline, closed, detached and empty states visible. Players default to **Party name only** and can change their sharing choice at any time. A downgrade removes withdrawn fields and can close the inspector. **Show AC in overview** is a DM display preference. Assist uses only currently permitted AC. Tie display and target choices must distinguish same-name members and monsters by stable IDs. Hidden enemies expose the public “DM turn” projection or their revealed alias, and addressed questions and offers have their own scoped projections. [Sharing ownership](architecture.md#dm-dashboard-and-sharing)
- **Initiative and library.** Keep **Next Turn** distinct from **Correct current turn**, which only moves the pointer. Preserve explicit time advance, real turn and round boundaries, inactive or running state, same-room named roster resume, tied order, and per-enemy counters and stat-block snapshots. Keep template preview, pack replacement and add-to-encounter distinct from instance editing. [Shared turns](architecture.md#shared-initiative-and-turn-boundaries) · [Library](architecture.md#offline-monster-library)
- **One action, separate strikes.** **Preview action** can be canceled without spending. **Record action** spends the parent once. **Recorded actions** is where the DM can review an unresolved strike, ask its target, use a reply, cancel or override a question, and confirm final damage. Each target can progress independently while another question waits. Pending reactions can go stale on turn advance, while save questions can survive it. Keep Manual available throughout Assist. Preserve the natural die, entered total and stored damage roll across retries and mode changes. [Action lifecycle](architecture.md#manual-monster-actions)
- **Recipient-owned outcomes.** The player's **Session → Party** shows only that player's addressed questions and offers. A reply can spend a local Shield reaction, and accepting damage uses the same HP, concentration and activity rules as the local damage form. Preserve retry, decline, Already handled, and correction states. Undo keeps delivery receipts consumed. [Owner receipts](architecture.md#recipient-owned-healing-and-temporary-hp) · [Damage and questions](architecture.md#delivering-a-final-damage-amount)

## Rendering and storage boundaries

- Treat browser projections as the view state. The browser polls its capability-scoped loopback helper from `party.js`. The guest helper separately long-polls the LAN host. A browser redraw, an initiative revision, an inspection publication and a mechanical clock delivery can arrive at different times. Updates to presence, shared AC and offers can occur without an initiative revision. Keep drafts, selection and focus stable on unrelated polls, and clear private content promptly when permission changes.
- Keep authenticated commands and their outcomes in the owning layer. [RoomService](../src/party.rs) owns command replay and serialization, [the room model](../src/party/model.rs) owns room state transitions, and the player writer owns local HP, effects, slots and receipts. Persist the same IDs across a retry and render success after the owning commit. Keep capability URLs, raw saves, unshared fields, private rolls and live ledgers out of screenshots, logs and portable backups.
- Protocol 2 is the shipped LAN packet version. `/v1/party` is the existing endpoint path. Use matching helper packages for all peers. Same-room roster saves, player backups and portable DM encounter export/import with re-pairing in a new room (P10 first part) exist. The full packaged rehearsal is the remaining P10 work. [Transport](architecture.md#windows-launcher-and-party-transport) · [Portable backup boundaries](architecture.md#session-portability-and-combat-controls)

## Test the rework

Build and use the packaged entry point with synthetic fixtures. The full command setup is in the development workflow. Run the scenarios covering the affected surfaces, and update test queries when intentionally changing accessible labels or controls. [Build commands](development.md#build-and-run) · [Validation matrix](development.md#validation-matrix)

| Change | Packaged scenario under `node tests/party-launcher.cjs` |
| --- | --- |
| Overview, inspector, presence or consent | `--dashboard` |
| Initiative, enemy details or selection | `--initiative` and `--monster-actions` |
| Library, picker, or stat blocks | `--monsters` and the affected `--srd51` or `--srd521` check |
| Offers, replies or Assist | `--offers`, `--monster-damage`, `--strike-windows` or `--monster-assist` for the affected flow. Add `--assist` to the damage or strike-window scenario when testing through Assist. |
| Player combat or launcher lifecycle | `--actions` for casts and Quick Actions Protector. Use `--review-refresh` for the packaged launcher, Aurora refresh and solo browser rehearsal. |

For changes to the writer or delivery controls, repeat the applicable initiative, damage or strike-window scenario with `--fallback-writer`. Exercise a disconnected peer, a sharing downgrade with the inspector open, and a pending strike while the DM continues initiative when those states are affected.

The DM monster-action rehearsal captures a 1920×1080 screenshot under the isolated `target/p02-package-*` directory. The solo sheet separately checks 1920×1080 and 2560×1440 viewport approximations at 100% and 125%. For DM layout work, check those sizes explicitly and verify keyboard focus, dialog scrolling, access to Next Turn during a pending reply, and readability of long rules beside initiative. Report loopback results separately from physical two-PC Wi-Fi, firewall, Windows picker and real clipboard checks.
