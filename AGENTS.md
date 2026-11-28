# Working in this repository

These instructions are shared by Codex and Claude Code. Start in the repository root. Check `git status --short --branch` and preserve existing work, including untracked files.

The current line is `dev`. GitHub's default branch (`codex/dev-character-sheet`) is stale, so branch from `dev` and open pull requests into `dev`. The user (Grant) has no Rust toolchain on the Windows PC, so changes to try at the table need a Windows zip built in the cloud ([how](docs/development.md#windows-builds-from-the-cloud)). The backlog and dislikes are in the [handoff](docs/handoff.md#grants-backlog-and-preferences).

## Load context for the task

Read the relevant behavior in [requirements.md](docs/requirements.md) and the owning section of the [architecture map](docs/architecture.md#shipped-component-map). Follow the map to the entry point and its tests. Use `rg` to find the relevant headings, requirement IDs, and symbols before opening full files.

| When | Read |
| --- | --- |
| Resuming or locating the current baseline | [Current handoff](docs/handoff.md) |
| Implementing a multiplayer phase | [Common decisions](docs/local-multiplayer-plan.md#architecture-decisions-for-all-phases), the assigned phase, and the prerequisite handoff it depends on |
| Reworking the multiplayer UI | [UI entry points, state boundaries and regression checklist](docs/multiplayer-ui.md) |
| Building or validating a change | [Development commands and check matrix](docs/development.md) |
| Owlbear extension, mechanics overlay or template art | [Owlbear link](docs/architecture.md#owlbear-rodeo-link) and [mechanics overlay](docs/architecture.md#mechanics-overlay) |
| Changing bundled SRD data | [2014 source audit](docs/srd51-pack.md) or [2024 source audit](docs/srd521-pack.md) |

Use the historical handoffs and research for specific questions. Keep large documents as links so each session can choose what to read.

## Implement and leave a handoff

- Keep the task focused on a testable outcome. Use the existing entry point, preserve layer ownership, and check supported older saves or snapshots when changing storage or wire formats.
- Use synthetic or sanitized fixtures for automated tests. Keep personal Aurora saves and content libraries outside Git.
- Run the smallest checks that cover the change. Record the exact commands, results, and outstanding checks in the [handoff](docs/handoff.md#handoff-procedure). Name the next recommended action and stop at the assigned scope.
- Record durable behavior changes in [requirements.md](docs/requirements.md) and significant design decisions with their rationale in [architecture.md](docs/architecture.md).

## Keep `target` tidy

Every build and test copy on the user's Windows PC stays until someone deletes it. Reuse fixed output folders instead of creating new ones:

- Keep `target\release` current. It holds the exes the user runs, including `Aurora Combat Tracker.exe`. After any change that affects a built exe, finish with `cargo build --release --locked --bins` and `.\launcher\build.cmd` (no output argument) on the default target directory, so `target\release` has the latest build. If a running app blocks this, ask the user to close it and retry, and don't leave the work only in an alternate folder. Say in the handoff whether `target\release` was updated.
- Package into `target\tracker-windows`. If a running app locks it, use `target\tracker-windows-alt`. Never name a package folder after a phase, commit, review or random suffix.
- When a separate Cargo build is needed because a helper is running, set `CARGO_TARGET_DIR` to `target\alt-build` and reuse it. Do not create another `*-build` folder; each one costs 1–2 GB.
- Put scratch output such as review copies, smoke checks and repro files under `target\tmp`, and delete what the session created before finishing.
- Close any app, helper or party window the session launched before handing off. List anything that could not be deleted or closed in the handoff.
