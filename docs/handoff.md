# Current development handoff

## Product baseline

- The Windows launcher, player sheet, LAN room service, and DM dashboard are implemented through P09D. The DM can select Assist for individual strikes while using the same roll records, reaction windows and damage delivery. [P09D results and exact checks](local-multiplayer-plan.md#2026-11-25--p09d--bounded-assist)
- Bundled monster actions retain their full rules for table adjudication. P10 covers encounter portability and the full packaging rehearsal. [Remaining phases](local-multiplayer-plan.md#implementation-phases)
- For multiplayer UI work, start with the [UI handoff](multiplayer-ui.md) for the shipped entry points, state boundaries and targeted browser checks.
- Physical two-PC Wi-Fi and firewall behavior, physical adapter disconnection, manual Windows picker interaction, and the real clipboard remain unverified in the recorded rehearsals. [Validation and scope of the harness](development.md#validation-matrix)

## Latest handoff

| Field | Record |
| --- | --- |
| Date and checkout | 2026-11-26 on `claude/project-thread-0dbc2v`, branched from `dev` at `3747dbd`. |
| Completed | First multiplayer UI rework (R54). DM dashboard: top room bar with a connection pill, party cards with HP bars, a clickable visual turn order beside the labelled select, a selected-combatant card, budget pills, parchment stat blocks with an ability grid, and a two-pane monster library. Player sheet: a Party chip in the header showing connection and the count of questions and offers waiting, plus restyled Session → Party, offer cards and DM question cards. Icons are game-icons.net (CC BY 3.0), credited in the footer and [third-party assets](third-party-assets.md). |
| Modified components | `launcher/dm-dashboard.{html,css,js}`, `launcher/dm-initiative.js`, `launcher/dm-monsters.js`, `launcher/dm-monster-actions.js`, `src/combat/party.js`, `src/combat/party-windows.js`, `src/combat/session-files.html`, `src/combat/sheet.css`, `src/combat/html.rs`, `tests/dm-dashboard.cjs` (party rows are now cards). No asset was added or renamed, so `build.cmd`, `WriteLobby` and the harness resource list are unchanged. |
| Validation | `cargo test --locked --offline` passed (48). The packaged scenarios ran on Linux through a local-only harness that builds `aurora-party` with a non-Windows vault stub and replaces `PartyHarness.cs` with Node: `--dashboard`, `--initiative`, `--monster-actions`, `--monsters`, `--monster-damage` (with and without `--fallback-writer`), `--strike-windows` (with and without `--assist`), `--monster-assist`, `--actions`, `--srd51` and `--srd521` passed. `--offers` passed its offer checks and then stopped at the Aurora refresh step, which the Linux harness does not emulate (same as before the change). Not run: the Windows package build, `--review-refresh`, physical Wi-Fi, and 2560×1440 or 125% scaling checks. |
| Next action | Build the Windows package and run `node tests/party-launcher.cjs --dashboard` and `--monster-actions` on Windows to confirm the layout at 1920×1080 and 125% scaling. Then collect playtest feedback on the turn list and the Party chip. |

## Handoff procedure

1. At session start, compare the recorded checkout with `git status --short --branch` and `git rev-parse --short HEAD`. Inspect the relevant diff and confirm the task or phase before using earlier results.
2. At a completion or pause, replace the table above. Record the outcome, affected paths, exact commands and results, any failed or unverified checks, and one actionable next step. If no application checks were applicable, say so. Link detailed evidence where it already exists.
3. Update the product baseline when its milestones or outstanding checks change. For a completed multiplayer phase, add a dated entry in the [phase history](local-multiplayer-plan.md#handoff-record) and link it from here. Keep durable behavior and design decisions in the requirements and architecture docs.

To resume in either agent, point it at this file and name the task. Keep the note useful from another checkout by using repository-relative paths and identifying any uncommitted work it depends on.
