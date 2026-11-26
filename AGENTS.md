# Working in this repository

These instructions are shared by Codex and Claude Code. Start in the repository root. Check `git status --short --branch` and preserve existing work, including untracked files.

## Load context for the task

Read the relevant behavior in [requirements.md](docs/requirements.md) and the owning section of the [architecture map](docs/architecture.md#shipped-component-map). Follow the map to the entry point and its tests. Use `rg` to find the relevant headings, requirement IDs, and symbols before opening full files.

| When | Read |
| --- | --- |
| Resuming or locating the current baseline | [Current handoff](docs/handoff.md) |
| Implementing a multiplayer phase | [Common decisions](docs/local-multiplayer-plan.md#architecture-decisions-for-all-phases), the assigned phase, and the prerequisite handoff it depends on |
| Reworking the multiplayer UI | [UI entry points, state boundaries and regression checklist](docs/multiplayer-ui.md) |
| Building or validating a change | [Development commands and check matrix](docs/development.md) |
| Changing bundled SRD data | [2014 source audit](docs/srd51-pack.md) or [2024 source audit](docs/srd521-pack.md) |

Use the historical handoffs and research for specific questions. Keep large documents as links so each session can choose what to read.

## Implement and leave a handoff

- Keep the task focused on a testable outcome. Use the existing entry point, preserve layer ownership, and check supported older saves or snapshots when changing storage or wire formats.
- Use synthetic or sanitized fixtures for automated tests. Keep personal Aurora saves and content libraries outside Git.
- Run the smallest checks that cover the change. Record the exact commands, results, and outstanding checks in the [handoff](docs/handoff.md#handoff-procedure). Name the next recommended action and stop at the assigned scope.
- Record durable behavior changes in [requirements.md](docs/requirements.md) and significant design decisions with their rationale in [architecture.md](docs/architecture.md).

## Keep `target` from filling up

Each packaged build is about 20 MB, and each separate Cargo target directory takes 1–2 GB. Don't create a new build folder for each task, phase, commit or review.

- Package the Windows app into `target\tracker-windows`. If a running copy locks that folder, use `target\tracker-windows-alt` instead. Ask the user to close the app before falling back to it. Don't create other package folders, such as `target\p10-windows` or `target\<commit>-windows`.
- If the default `target\release` binaries are locked, use `CARGO_TARGET_DIR=target\alt-build` and pass the same value to `launcher\build.cmd`. Reuse that one directory. Don't create other `*-build` or `*-cargo` directories.
- Give temporary scratch output, such as review profiles, test packages, previews, generated packs and repro scripts, a name under `target\tmp\`. Before finishing, delete everything your session created there.
- Keep `target\release`, `target\debug`, `target\tracker-windows`, `target\tracker-windows-alt`, `target\alt-build`, `.rustc_info.json` and `CACHEDIR.TAG`. If a folder can't be deleted because a process is running from it, leave it, and list it and the process in the handoff.
- In the handoff, name the package folder that the user should open.
