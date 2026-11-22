# Architecture

## Initial design

**Rust** owns the Aurora importer and encounter state. The importer turns a character save and its content definitions into data the app can use. The combat logic owns how damage, concentration, companion changes, and timed effects update an encounter. Keep this logic testable without opening the desktop window.

**Tauri** provides the Windows window, native file dialogs, and a bridge from the UI to Rust. A Svelte click handler calls a named Rust command through `invoke()`. The command calls the core and returns the updated session view or an error through local inter-process communication.

**Svelte and TypeScript** render the combat sheet and handle interactions such as opening a description or changing the layout. A change to encounter state, such as spending a scroll, goes through a Rust command.

Aurora is the source of character build data. The tracker owns the session and layout, so re-import can update available options without resetting the fight. Companion behavior comes from imported definitions and editable cards. The Artillerist’s cannon exercises the same companion system as a ranger’s pet or a summon.
