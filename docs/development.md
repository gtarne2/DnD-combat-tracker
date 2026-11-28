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

The launcher build and packaged rehearsals read the two release binaries from `target/release`. While an existing helper is running, set `CARGO_TARGET_DIR` to `target\alt-build` for both Cargo and packaging, and package into `target\tracker-windows-alt`. Reuse those folders rather than creating new ones, as described in [AGENTS.md](../AGENTS.md#keep-target-tidy). Rebuild `combat-sheet` after changing embedded sheet assets. Rebuild the release helpers or launcher package after changing their respective Rust code, native code, DM assets, or bundled data. Use Cargo's `--offline` when dependencies are already cached.

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
| Launcher browser activity | `node tests/party-launcher.cjs --lifecycle` with current release binaries. |
| HP offers, grants, or sharing | Run `node tests/party-launcher.cjs` with `--offers`, `--actions`, or `--dashboard` for the affected flow. |
| Shared initiative or clock | `node tests/party-launcher.cjs --initiative`. |
| Manual monster actions and recovery | `node tests/party-launcher.cjs --monster-actions`. |
| Finalized DM damage and owner receipts | `node tests/party-launcher.cjs --monster-damage` and the same command with `--fallback-writer`. |
| DM save and reaction questions | `node tests/party-launcher.cjs --strike-windows` and the same command with `--fallback-writer`. |
| DM Assist and damage suggestions | `node tests/party-launcher.cjs --monster-assist`. Add `--assist` to the strike-window and damage suites to exercise their flows in Assist. |
| Monster library or encounter snapshots | `node tests/party-launcher.cjs --monsters`. |
| Owlbear Rodeo link | `cargo test --locked --test owlbear_link --test spell_areas` and `node tests/owlbear-tokens.cjs` (token and template sync against a stand-in SDK, no browser), then `node tests/owlbear-bridge.cjs` with `AURORA_PARTY` pointing at the built helper. The extension publishes from `gh-pages` on each push to `dev` that touches `owlbear/`; bump `owlbear/manifest.json`'s `version` when it changes. |
| Mechanics overlay, buffs or template looks | `cargo test --locked --test mechanics_overlay --test stat_buffs --test owlbear_link`. After editing `content/mechanics/curated.json`, rerun `node tools/build-mechanics-overlay.cjs <5etools-src checkout>` and commit both JSON files. Regenerate textures with `python tools/build-template-art.py` (numpy and Pillow). For the sheet, `node tests/stat-buffs.cjs`. |
| 5etools bestiary import | `cargo test --locked --test fivetools_import`. For real files kept outside Git, `FIVETOOLS_FILE=<path to bestiary-*.json> cargo test --locked --test fivetools_import -- --ignored`. The files are at `raw.githubusercontent.com/5etools-mirror-3/5etools-src` under `data/bestiary/`. |
| Damage defenses, save spells sent from the sheet, enemy timers | `cargo test --locked --test table_rules` and `node tests/damage-defenses.cjs`. |
| Token art | `node tests/owlbear-tokens.cjs`. Rebuild class icons with `node tools/build-class-tokens.cjs` (Playwright). |
| Reaction calls, lasting areas, difficulty, fight recap, summons | `cargo test --locked --test table_tools --test mechanics_overlay`. In the Linux cloud, the shared `table-tools/table-demo.cjs` runs the DM and two players through all four table tools with the preview harness (`AURORA_DEMO=<path to table-demo.cjs> AURORA_SHOTS=<folder>`), and `table-tools/summon-check.cjs <shots folder>` casts Summon Beast on the `overlay-spells` fixture with a debug `combat-sheet`. |
| Party offers on the rail and auto-accept | `cargo test --locked --test owlbear_link --test table_rules` for the offer sources. In the Linux cloud, the shared `offers-review/offers-demo.cjs` (`AURORA_DEMO`) covers the rail cards, previews, sender notices, auto-accept and Undo. Run `--offers` and `--monster-damage` for the older flows; in the Linux harness `--offers` stops at the backup-restore step ("Party detached" is hidden), before and after R87. |
| Encounter export and import | `cargo test --locked --test encounter_portability`, then `node tests/party-launcher.cjs --encounters`. |
| Bundled pack or notices | Use the reproducibility and source audits for [SRD 5.1](srd51-pack.md#reproduce-and-audit) or [SRD 5.2.1](srd521-pack.md#reproduce-and-audit), then run the packaged suite with `--srd51` or `--srd521`. |

For storage or receipt changes, repeat the applicable player-writer scenario with `--fallback-writer` to exercise the guest's IndexedDB writer. Useful cases include `--offers`, `--initiative`, `--monster-damage` and `--strike-windows`. The browser suites cover different profiles and loopback connectivity. Record physical two-PC Wi-Fi, firewall, Windows picker, and real clipboard checks separately. The clipboard assertion in the launcher harness captures the value passed by **Copy invite**.

To exercise refresh against a running launcher, use an isolated settings directory containing synthetic `review.dnd5e` and `review.xml` copies of the combat-sheet fixtures. Leave the service open and set `AURORA_TEST_LAUNCHER_WORKSPACE` to the parent of its `Aurora Combat Tracker` settings subdirectory. The suite restores the copies after modifying them.

## Windows builds from GitHub

`.github/workflows/windows-build.yml` builds on a Windows runner for every push to `dev` (not for changes only to `docs/`, `owlbear/` or Markdown): it runs `cargo test --locked`, `cargo build --release --locked --bins` and `launcher\build.cmd`, then replaces the `dev-build` pre-release with `Aurora-Combat-Tracker-Windows.zip`. The download link stays the same: `https://github.com/gtarne2/DnD-combat-tracker/releases/download/dev-build/Aurora-Combat-Tracker-Windows.zip`. Pull requests into `dev` run the same build as a check without publishing, and each run also keeps the zip as an artifact. The Mac player app builds in `.github/workflows/macos-player.yml` the same way, as a run artifact.

## Windows builds from the cloud

For a branch that is not on `dev` yet, a Linux cloud session can build the Windows zip. All three exes import only system DLLs.

1. `rustup target add x86_64-pc-windows-gnu` and `apt-get install gcc-mingw-w64-x86-64`, then `cargo build --release --locked --bins --target x86_64-pc-windows-gnu`. For a quick compile check, `cargo check --locked --target x86_64-pc-windows-gnu --bins`; a Linux build alone does not compile the `cfg(windows)` party runtime on `dev`.
2. `apt-get install mono-mcs mono-devel`, then build the launcher with `mcs -nostdlib -noconfig -target:winexe -optimize+` and every `-r:` pointing into `/usr/lib/mono/4.8-api/` (`mscorlib`, `System`, `System.Core`, `System.Windows.Forms`, `System.Drawing`, `System.Web.Extensions`). Use the same `-resource:` list and source files as `launcher/build.cmd`. Mono's default `mscorlib` binds newer overloads that crash on .NET 4.8 with `MissingMethodException`.
3. Zip `Aurora Combat Tracker.exe`, `combat-sheet.exe`, `aurora-party.exe` and the two `content/monster-packs/SRD-*-NOTICES.txt` files. Name the zip after the branch and short commit. Grant unzips it over `target\release`, which the desktop shortcut runs.

The `mcs` output is deterministic, so a hash of the launcher can be checked against a rebuild from the same commit. The exes are unsigned, and Windows Defender has flagged the launcher as `Trojan:Win32/Wacatac.C!ml` (a false positive). Don't upload builds to public scanners without asking.

## Rehearsals in the Linux cloud

The packaged rehearsals in `tests/party-launcher.cjs` expect Windows. Since the Mac player app (R81) the party runtime builds on Linux with a plain `cargo build --bins`, so the old `aurora_preview` patch is no longer needed. The shared `ui-overhaul/linux-harness/` folder holds `harness.cjs` (stands in for the WinForms launcher) and `run.cjs`; run `node run.cjs --dashboard` (or `--initiative`, `--monster-damage`, `--strike-windows`, `--monsters`, `--monster-actions`, `--encounters`) from the repository root with `AURORA_ROOT` set. `run.cjs` points `XDG_DATA_HOME` at each profile's data folder, where Linux helpers keep app data. `AURORA_DEMO=<script> AURORA_SHOTS=<dir>` runs a demo script instead, such as `death-saves/death-demo.cjs` or `party-rest/rest-demo.cjs` in the project folder. `--offers` stops at the Aurora refresh step, which the harness doesn't emulate. The cloud cannot reach owlbear.rodeo or github.io, so real Owlbear checks happen on Grant's PC.

## Coding conventions

- Format changed Rust files with the crate's edition. Keep domain rules in the owning Rust or browser layer. Extend existing typed command and state paths when adding behavior.
- The player sheet embeds its scripts through `src/combat/html.rs`. The Windows launcher embeds the DM assets through `launcher/build.cmd` and serves the lobby through `PartySession.cs`. Keep script dependency order and render imported or remote values as text unless the owning renderer already handles their escaping.
- Preserve the [regression boundaries](architecture.md#regression-boundaries) and use synthetic fixtures for state and multiplayer tests. The pack rehearsals also verify the published assets that ship with the launcher.
- For a focused syntax and whitespace review, use targeted `rustfmt --edition 2024 --check`, `node --check` for changed scripts, and `git diff --check`.
