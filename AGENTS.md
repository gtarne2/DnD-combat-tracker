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
