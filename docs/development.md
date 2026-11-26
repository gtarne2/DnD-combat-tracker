# Development workflow

## Start a session

Open the repository root. Codex discovers `AGENTS.md`. Claude Code uses the same file through the one-line `CLAUDE.md` import. Keep shared instructions in `AGENTS.md` and use its links to select context for the task. Claude Code's `/memory` lists the loaded instruction files. [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md) · [Claude Code imports](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools)

For a continuation, read the [current handoff](handoff.md) and compare its checkout and validation state with yours. For a new task, specify the expected behavior and entry point. The [component map](architecture.md#shipped-component-map) gives the owning paths and links to their design decisions.

For a multiplayer UI task, start with the [UI handoff](multiplayer-ui.md). It maps both browser surfaces and the native picker to their files, tests and state boundaries.

## Windows setup

Use Git, Node.js LTS, stable Rust via rustup, and a C toolchain for bundled SQLite. For the MSVC Rust target, install Microsoft C++ Build Tools with **Desktop development with C++**. The launcher build uses the Windows .NET Framework C# compiler. Playwright and Chrome or Chromium are browser-test dependencies.

If Playwright is unavailable to Node, install it into an ignored directory. Set `AURORA_TEST_CHROME` to an installed browser executable, or install Playwright Chromium.

```powershell
npm install --prefix target\browser-tools playwright
$env:NODE_PATH = (Resolve-Path target\browser-tools\node_modules).Path
$env:AURORA_TEST_CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
```

## Build and run

From the repository root, build only what the change needs. The first block builds and rehearses the solo browser sheet. The second assembles a Windows package in a separate output directory.

```powershell
cargo build --locked --bin combat-sheet
node tests/browser-review.cjs
```

```powershell
cargo build --release --locked --bins
.\launcher\build.cmd target\tracker-windows
```

The launcher build and packaged rehearsals read the two release binaries from `target/release`. To build separately while an existing helper is running, set `CARGO_TARGET_DIR=target\alt-build` for both Cargo and packaging, and package to `target\tracker-windows-alt`. Reuse these fixed folders instead of creating new ones for each task (see [Keep `target` from filling up](../AGENTS.md#keep-target-from-filling-up)). Rebuild `combat-sheet` after changing embedded sheet assets. Rebuild the release helpers or launcher package after changing their respective Rust code, native code, DM assets, or bundled data. Use Cargo's `--offline` when dependencies are already cached.

With the default Cargo target directory, run `.\launcher\build.cmd` without an output argument to update the repository shortcut's launcher in `target/release`. An open DM dashboard keeps its original helper. If Add to encounter rejects an unknown `license` or `schema_version` field, use **Exit refresh service** in the older launcher's tray menu, then choose **Party… → Resume DM room** in the current package. Protocol 2 requires updated helpers on all peers. Resume with the current package to reuse a saved binding.

The solo browser suite defaults to `target/debug/combat-sheet.exe`. Set `AURORA_TEST_IMPORTER` to use another built importer. The packaged suite uses synthetic fixtures, isolated app-data directories and separate Chrome profiles under `target/`. It builds a temporary launcher and compiles the harness from the current DM assets on each run. A DM markup, CSS or JavaScript change can be rehearsed against unchanged release binaries. A change to an embedded player asset requires rebuilding the release `combat-sheet` for this harness. The suite needs current-user DPAPI and loopback sockets.

## Validation matrix

Use a check that reaches the affected entry point. Add only the neighboring checks that cover a shared boundary. Run `cargo test --locked` for broad Rust coverage when warranted.

| Change | Targeted check |
| --- | --- |
| Aurora parsing, preview, or refresh | `cargo test --locked --test aurora_import --test session_reimport --test preview_cli`. Add the launcher refresh rehearsal for staged apply or failure handling. |
| Player sheet, combat, or persistence | Select the relevant Rust suite such as `combat_sheet`, `encounter`, `effects`, or `companions`. Rebuild `combat-sheet` and run `node tests/browser-review.cjs` for the shipped sheet. |
| Room commands, privacy, or restart | `cargo test --locked --test party_room`, plus the relevant packaged scenario below. |
| Windows launcher, TLS, or Aurora refresh | `node tests/party-launcher.cjs --review-refresh` with current release binaries. |
| HP offers, grants, or sharing | Run `node tests/party-launcher.cjs` with `--offers`, `--actions`, or `--dashboard` for the affected flow. |
| Shared initiative or clock | `node tests/party-launcher.cjs --initiative`. |
| Manual monster actions and recovery | `node tests/party-launcher.cjs --monster-actions`. |
| Finalized DM damage and owner receipts | `node tests/party-launcher.cjs --monster-damage` and the same command with `--fallback-writer`. |
| DM save and reaction questions | `node tests/party-launcher.cjs --strike-windows` and the same command with `--fallback-writer`. |
| DM Assist and damage suggestions | `node tests/party-launcher.cjs --monster-assist`. Add `--assist` to the strike-window and damage suites to exercise their flows in Assist. |
| Monster library or encounter snapshots | `node tests/party-launcher.cjs --monsters`. |
| Encounter export and import | `cargo test --locked --test encounter_portability`, then `node tests/party-launcher.cjs --encounters`. |
| Bundled pack or notices | Use the reproducibility and source audits for [SRD 5.1](srd51-pack.md#reproduce-and-audit) or [SRD 5.2.1](srd521-pack.md#reproduce-and-audit), then run the packaged suite with `--srd51` or `--srd521`. |

For storage or receipt changes, repeat the applicable player-writer scenario with `--fallback-writer` to exercise the guest's IndexedDB writer. Useful cases include `--offers`, `--initiative`, `--monster-damage` and `--strike-windows`. The browser suites cover different profiles and loopback connectivity. Record physical two-PC Wi-Fi, firewall, Windows picker, and real clipboard checks separately. The clipboard assertion in the launcher harness captures the value passed by **Copy invite**.

To exercise refresh against a running launcher, use an isolated settings directory containing synthetic `review.dnd5e` and `review.xml` copies of the combat-sheet fixtures. Leave the service open and set `AURORA_TEST_LAUNCHER_WORKSPACE` to the parent of its `Aurora Combat Tracker` settings subdirectory. The suite restores the copies after modifying them.

## Coding conventions

- Format changed Rust files with the crate's edition. Keep domain rules in the owning Rust or browser layer. Extend existing typed command and state paths when adding behavior.
- The player sheet embeds its scripts through `src/combat/html.rs`. The Windows launcher embeds the DM assets through `launcher/build.cmd` and serves the lobby through `PartySession.cs`. Keep script dependency order and render imported or remote values as text unless the owning renderer already handles their escaping.
- Preserve the [regression boundaries](architecture.md#regression-boundaries) and use synthetic fixtures for state and multiplayer tests. The pack rehearsals also verify the published assets that ship with the launcher.
- For a focused syntax and whitespace review, use targeted `rustfmt --edition 2024 --check`, `node --check` for changed scripts, and `git diff --check`.
