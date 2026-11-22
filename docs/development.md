# Development workflow

## Windows setup

Use Git, Node.js LTS with npm, Rust via rustup with the stable MSVC toolchain, and Microsoft C++ Build Tools with **Desktop development with C++**. Tauri also uses the Microsoft Edge WebView2 Runtime. Use your preferred editor. VS Code with rust-analyzer and Svelte for VS Code is one option. [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

Open the project folder in Codex on Windows when a task needs your local Aurora files, Windows file dialogs, or a desktop playtest. Sign in with your ChatGPT account to use your plan’s Codex allowance. [Codex plan access](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)

## Working with Codex

Give each task one outcome and a way to verify it. Start a fresh session for a different task after saving decisions and changes in the repo. Use the standard model and default reasoning for routine work, and reserve more reasoning for difficult debugging or design decisions.

> Implement the initial Rust importer for R1. Open a synthetic Aurora save and resolve one content reference. Add a targeted test for a missing reference and summarize the data model choice for review.

Review small diffs and discuss major decisions as they arise. Once code is in place, ordinary Rust and TypeScript checks can run on every PR. Run a Windows packaging job when there is a build to test on the laptop.
