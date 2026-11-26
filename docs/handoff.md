# Current development handoff

## Product baseline

- The Windows launcher, player sheet, LAN room service, and DM dashboard are implemented through P09D. The DM can select Assist for individual strikes while using the same roll records, reaction windows and damage delivery. [P09D results and exact checks](local-multiplayer-plan.md#2026-11-25--p09d--bounded-assist)
- Bundled monster actions retain their full rules for table adjudication. P10 covers encounter portability and the full packaging rehearsal. [Remaining phases](local-multiplayer-plan.md#implementation-phases)
- For multiplayer UI work, start with the [UI handoff](multiplayer-ui.md) for the shipped entry points, state boundaries and targeted browser checks.
- Physical two-PC Wi-Fi and firewall behavior, physical adapter disconnection, manual Windows picker interaction, and the real clipboard remain unverified in the recorded rehearsals. [Validation and scope of the harness](development.md#validation-matrix)

## Latest handoff

| Field | Record |
| --- | --- |
| Date and checkout | 2026-11-26 on `claude/project-thread-yeppfq`, branched from `dev` at `3747dbd`. This branch does not include the P10 encounter export work on `claude/project-thread-p9jla2`. |
| Completed | 5etools bestiary import: `src/fivetools.rs`, the `monsters/fivetools` helper route, an "Import 5etools JSON" button in the DM Monster library, and a warning list in the import review. [Design](architecture.md#offline-monster-library) |
| Validation | `cargo test --locked` passed (53 tests, including 5 in `tests/fivetools_import.rs`). `cargo check --locked --target x86_64-pc-windows-gnu --bins` passed. The ignored `imports_local_bestiary_file` test converted local copies of the 2014 and 2024 monster manuals and Mordenkainen's Monsters of the Multiverse (450, 503 and 261 monsters) with no leftover tags; those files stay outside Git. A Playwright check of `dm-monsters.js` with a mocked helper imported the converted file, showed the warning list and added a Lich to the encounter. The packaged Windows rehearsal was not run. |
| Next action | Import a real 5etools file through the packaged launcher on Windows and add a monster to a live encounter. |

## Previous handoff

| Field | Record |
| --- | --- |
| Date and checkout | 2026-11-25 on `dev`. The P09D implementation baseline is `73b25d3` on `origin/dev`, including the earlier P01/P02 merge from `main`. |
| Completed | Published P09C and P09D and prepared the multiplayer UI handoff. The isolated P09D package is in `target/p09d-windows` in the checkout that built it. The running package was left in place. |
| Modified components | The implementation changed the DM action and damage dialogs, roll calculations, room and strike storage, launcher assets, and synthetic Windows rehearsals. The subsequent handoff updated documentation. |
| Validation | The merge preserved the tested P09D file tree. The Rust suite, Windows package, Assist rehearsal, Shield and duplicate damage in Assist, and Manual, player attack, casting and Protector regressions passed for that baseline. The handoff review checked local Markdown links and heading references. [Exact checks](local-multiplayer-plan.md#2026-11-25--p09d--bounded-assist) |
| Next action | For the UI rework, follow the [UI entry points and checks](multiplayer-ui.md). Keep portable encounter export/import and the full packaging rehearsal in [P10](local-multiplayer-plan.md#p10--package-and-rehearse-a-full-session). |

## Handoff procedure

1. At session start, compare the recorded checkout with `git status --short --branch` and `git rev-parse --short HEAD`. Inspect the relevant diff and confirm the task or phase before using earlier results.
2. At a completion or pause, replace the table above. Record the outcome, affected paths, exact commands and results, any failed or unverified checks, and one actionable next step. If no application checks were applicable, say so. Link detailed evidence where it already exists.
3. Update the product baseline when its milestones or outstanding checks change. For a completed multiplayer phase, add a dated entry in the [phase history](local-multiplayer-plan.md#handoff-record) and link it from here. Keep durable behavior and design decisions in the requirements and architecture docs.

To resume in either agent, point it at this file and name the task. Keep the note useful from another checkout by using repository-relative paths and identifying any uncommitted work it depends on.
