# Current development handoff

## Product baseline

- The Windows launcher, player sheet, LAN room service, and DM dashboard are implemented through P09D. The DM can select Assist for individual strikes while using the same roll records, reaction windows and damage delivery. [P09D results and exact checks](local-multiplayer-plan.md#2026-11-25--p09d--bounded-assist)
- Bundled monster actions retain their full rules for table adjudication. Encounter export/import from P10 is implemented and Rust-tested. The full Windows packaging rehearsal remains. [P10 first part](local-multiplayer-plan.md#2026-11-26--p10-first-part--portable-encounter-export-and-import)
- Owlbear Rodeo link O1 (bridge window, pairing), O2 (tokens on the map) and O3 (spell templates) are on `claude/project-thread-k0i2u2` and still need a Windows build and a real Owlbear check. [Owlbear handoff](#owlbear-rodeo-link-handoff-o1-o3)
- For multiplayer UI work, start with the [UI handoff](multiplayer-ui.md) for the shipped entry points, state boundaries and targeted browser checks.
- Physical two-PC Wi-Fi and firewall behavior, physical adapter disconnection, manual Windows picker interaction, and the real clipboard remain unverified in the recorded rehearsals. [Validation and scope of the harness](development.md#validation-matrix)

## Latest handoff

| Field | Record |
| --- | --- |
| Date and checkout | 2026-11-26 on `dev`, with local launcher lifecycle changes based on `5bf661b`. |
| Completed | R59. The Windows shortcut reuses the launcher. The hidden launcher exits after five minutes without a browser check-in and keeps active hosted rooms open. The tray can reopen the current browser session. The launcher owns a kill-on-close job for its Party helper. |
| Modified components | `launcher/TrackerLauncher.cs`, `launcher/RefreshBridge.cs`, `launcher/PartySession.cs`, `src/combat/party.js`, `tests/PartyHarness.cs`, and `tests/party-launcher.cjs`. |
| Validation | Passed `cargo build --release --locked --offline --bins` with cached GNU Rust, w64devkit and `RUSTFLAGS=-C link-self-contained=yes`, then `launcher\build.cmd` and `launcher\build.cmd target\tracker-windows`. The shortcut resolves to the updated `target/release`. Passed `node --check src/combat/party.js`, `node --check tests/party-launcher.cjs`, and `git diff --check`. Passed `node tests/party-launcher.cjs --lifecycle` and `node tests/party-launcher.cjs --review-refresh` with Windows Chrome and current-user DPAPI. A packaged duplicate-launch smoke and a native fixture smoke also passed. The native smoke advanced the idle clock and checked wake grace, active host protection, shutdown after room end, and job cleanup while stdin was open. |
| Next action | During the Windows playtest, close all Aurora tabs after solo or joined play and confirm the launcher exits after five minutes. Also check physical two-PC play with the host dashboard closed and reopened from the tray. |

## Owlbear Rodeo link handoff (O1-O3)

| Field | Record |
| --- | --- |
| Date and checkout | 2026-11-26 on `claude/project-thread-k0i2u2`, branched from `dev` at `8d663d4`. |
| Completed | Stage O0 spike (removed after recording), O1, O2 and O3. The DM helper serves an Owlbear bridge window and a token-gated API on `127.0.0.1:47831`. The DM dashboard shows a pairing code with link status, New code and Unpair. The new `owlbear/` extension pairs through the bridge window and lists the encounter. O2 adds and removes tokens from the extension popover, with art per template, hidden unrevealed enemies, reveal and Down sync, a Link to tracker row context menu, and player matching. O3 adds the spell area parser, an Owlbear template section in the cast dialog, `place_template` and `clear_template` fight edits, and template drawing by the caster's extension with the DM's as a fallback. The extension is published to GitHub Pages from `gh-pages`. R60–R62, [architecture](architecture.md#owlbear-rodeo-link). |
| Modified components | `src/owlbear.rs`, `src/owlbear-bridge.html`, `src/bin/party_runtime/{mod,owlbear}.rs`, `src/party.rs` and `src/party/initiative.rs` (`table_view`, templates), `src/combat/spell_options.rs`, `src/combat/{concentration,party-initiative}.js`, `src/combat/{concentration,turns}.html`, `launcher/dm-dashboard.{html,css,js}`, `owlbear/`, `.github/workflows/owlbear-pages.yml`, `tests/owlbear_link.rs`, `tests/owlbear-bridge.cjs`, `tests/owlbear-tokens.cjs`, `tests/spell_areas.rs`. |
| Validation | Linux cloud: `cargo test --locked` passed, including 4 new `owlbear_link` tests. `cargo fmt -- --check` passed. `cargo check --locked --target x86_64-pc-windows-gnu --bins` passed. With a local preview build of the helper, `node tests/owlbear-bridge.cjs` passed. It covers host and origin refusal, the wrong code, pairing, the table, reload recovery, unpair, and a closed window. A dashboard screenshot showed the new panel. O2: `cargo test --locked`, `cargo fmt --check` and the Windows target check passed again. `node tests/owlbear-tokens.cjs` passed. The popover and link picker rendered without script errors against a stand-in SDK. O3: `cargo test --locked` passed, including 3 `spell_areas` tests and a template room test. `node tests/owlbear-tokens.cjs` passed with template geometry and drawing checks. With the Linux preview helper, a scripted DM room rehearsal cast a spell with a cone template aimed at an enemy, saw it in the room, removed it from the combat rail, and saw a stale concentration template cleared. `node tests/browser-review.cjs` and the shared initiative rehearsal passed. Not run: the Windows package build and `target\release` update, the launcher rehearsals, and real Owlbear. |
| Next action | Confirm GitHub Pages serves the `gh-pages` branch. On Windows, build with `cargo build --release --locked --bins` and `launcher\build.cmd`, then host as DM. In Owlbear, add `https://gtarne2.github.io/DnD-combat-tracker/manifest.json`, open the bridge window, pair, and reload the Owlbear tab to confirm it reconnects. Add the encounter to the map, reveal an enemy, drop one to 0 HP, link a hand-placed token, and check from a player account that hidden enemies stay hidden. As a player with the extension loaded, cast Burning Hands, Fireball, Lightning Bolt and Spirit Guardians with templates, then drag and rotate each, and check that the instant ones go when the turn ends. `.github/workflows/owlbear-pages.yml` republishes on pushes to `dev` and `main`. |

## Table-feedback UI handoff

| Field | Record |
| --- | --- |
| Date and checkout | 2026-11-26 on `claude/project-thread-0dbc2v`, branched from `dev` at `1864d93`. |
| Completed | Table-feedback UI round (R56–R58). DM: players without a row are listed under "Not in the order yet" and the DM can seat them with a table roll (`Edit::Seat`); the selected monster action shows its cost, rules and, for a multiattack, each strike with its count and rules (from the pack's strike list, or read from the text for v1 packs), plus an "All actions" list grouped by cost. Player: a Party encounter banner, the shared order (revealed enemies and "DM turn" rows) whether or not the player has joined, a Join form, and End Turn on their own turn (`Edit::EndTurn`); Next Turn, Start and End Encounter are hidden in DM rooms; leaving still returns to solo. The header is the same on every page and can show a character portrait kept in local storage. The HP card has one number box with Damage, Heal, Set HP and Temp HP; an empty box opens the full forms as before. |
| Modified components | `src/party/initiative.rs`, `src/party/model.rs`, `tests/encounter_portability.rs` (seat and end-turn test), `launcher/dm-dashboard.{html,css}`, `launcher/dm-initiative.js`, `launcher/dm-monster-actions.js`, `src/combat/turns.{html,js}`, `src/combat/party-initiative.js`, `src/combat/portrait.{html,js}` (new, included by `html.rs`), `src/combat/html.rs`, `src/combat/sheet.css`, `tests/browser-review.cjs` (waits for the saved companion before damaging it; this step also failed intermittently on unchanged `dev`). |
| Validation | `cargo test`: 55 passed. `AURORA_TEST_IMPORTER=$PWD/target/debug/combat-sheet node tests/browser-review.cjs` passed. Linux harness: `--dashboard`, `--initiative`, `--monster-actions`, `--monster-assist`, `--monster-damage`, `--strike-windows`, `--actions` and `--monsters` passed. `--offers` still stops at the Aurora refresh step the Linux harness does not emulate. Not run: Windows package build, 125% scaling, physical Wi-Fi. |
| Next action | Build the Windows package and run a table session: DM seats a player, a player ends their own turn, and a multiattack from a 5etools-imported monster shows its strikes. |

## Local Windows test package for 1864d93

- Built dev commit `1864d93` with `cargo build --release --locked --offline --bins` using cached GNU Rust, w64devkit, `RUSTFLAGS=-C link-self-contained=yes`, and `CARGO_TARGET_DIR=target/dev-1864d93-build`. Packaged with `launcher\build.cmd target\dev-1864d93-windows`. Both commands passed.
- Passed `aurora-party.exe init <scratch>/party.sqlite3` and `combat-sheet.exe --preview-dir <scratch> tests/fixtures/combat-sheet.dnd5e tests/fixtures/combat-sheet.xml` using the packaged executables. Both wrote their expected outputs under an isolated scratch directory.
- The earlier package is at `target/dev-1864d93-windows/Aurora Combat Tracker.exe`. The packaged browser rehearsal and physical two-PC session remain pending. Build a fresh Windows package for the current dev checkout before rehearsing its changes.

## Windows shortcut verification for 5bf661b

- Updated `target/release` with `cargo build --release --locked --offline --bins` using cached GNU Rust, w64devkit and `RUSTFLAGS=-C link-self-contained=yes`. Both `launcher\build.cmd` and `launcher\build.cmd target\tracker-windows` passed.
- Verified that `Open Aurora Combat Tracker.lnk` resolves to `target/release/Aurora Combat Tracker.exe` and that its embedded UI assets match the source files by SHA-256. `aurora-party.exe init <scratch>/party.sqlite3` and `combat-sheet.exe --preview-dir <scratch> tests/fixtures/combat-sheet.dnd5e tests/fixtures/combat-sheet.xml` passed. The generated preview contains the Party encounter UI.
- Next, use the shortcut for the manual Windows UI and two-PC session rehearsal before merging into `main`.

## Handoff procedure

1. At session start, compare the recorded checkout with `git status --short --branch` and `git rev-parse --short HEAD`. Inspect the relevant diff and confirm the task or phase before using earlier results.
2. At a completion or pause, replace the table above. Record the outcome, affected paths, exact commands and results, any failed or unverified checks, and one actionable next step. If no application checks were applicable, say so. Link detailed evidence where it already exists.
3. Update the product baseline when its milestones or outstanding checks change. For a completed multiplayer phase, add a dated entry in the [phase history](local-multiplayer-plan.md#handoff-record) and link it from here. Keep durable behavior and design decisions in the requirements and architecture docs.

To resume in either agent, point it at this file and name the task. Keep the note useful from another checkout by using repository-relative paths and identifying any uncommitted work it depends on.
