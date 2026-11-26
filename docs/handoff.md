# Current development handoff

## Product baseline

- The Windows launcher, player sheet, LAN room service, and DM dashboard are implemented through P09D. The DM can select Assist for individual strikes while using the same roll records, reaction windows and damage delivery. [P09D results and exact checks](local-multiplayer-plan.md#2026-11-25--p09d--bounded-assist)
- Bundled monster actions retain their full rules for table adjudication. Encounter export/import from P10 is implemented and Rust-tested. The full Windows packaging rehearsal remains. [P10 first part](local-multiplayer-plan.md#2026-11-26--p10-first-part--portable-encounter-export-and-import)
- For multiplayer UI work, start with the [UI handoff](multiplayer-ui.md) for the shipped entry points, state boundaries and targeted browser checks.
- Physical two-PC Wi-Fi and firewall behavior, physical adapter disconnection, manual Windows picker interaction, and the real clipboard remain unverified in the recorded rehearsals. [Validation and scope of the harness](development.md#validation-matrix)

## Latest handoff

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

## Handoff procedure

1. At session start, compare the recorded checkout with `git status --short --branch` and `git rev-parse --short HEAD`. Inspect the relevant diff and confirm the task or phase before using earlier results.
2. At a completion or pause, replace the table above. Record the outcome, affected paths, exact commands and results, any failed or unverified checks, and one actionable next step. If no application checks were applicable, say so. Link detailed evidence where it already exists.
3. Update the product baseline when its milestones or outstanding checks change. For a completed multiplayer phase, add a dated entry in the [phase history](local-multiplayer-plan.md#handoff-record) and link it from here. Keep durable behavior and design decisions in the requirements and architecture docs.

To resume in either agent, point it at this file and name the task. Keep the note useful from another checkout by using repository-relative paths and identifying any uncommitted work it depends on.
