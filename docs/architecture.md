# Architecture

## Initial design

**Rust** owns the Aurora importer and encounter state. The importer turns a character save and its content definitions into data the app can use. The combat logic owns how damage, concentration, companion changes, and timed effects update an encounter. Keep this logic testable without opening the desktop window.

**Tauri** provides the Windows window, native file dialogs, and a bridge from the UI to Rust. A Svelte click handler calls a named Rust command through `invoke()`. The command calls the core and returns the updated session view or an error through local inter-process communication.

**Svelte and TypeScript** render the combat sheet and handle interactions such as opening a description or changing the layout. A change to encounter state, such as spending a scroll, goes through a Rust command.

Aurora is the source of character build data. The tracker owns the session and layout, so re-import can update available options without resetting the fight. Companion behavior comes from imported definitions and editable cards. The Artillerist’s cannon exercises the same companion system as a ranger’s pet or a summon.

## Aurora content import

The Rust importer reads a UTF-8 character save and local content XML files. It resolves equipment, spells, build selections, and companions by the exact Aurora content ID. Each saved reference retains its ID and label with an optional definition. A missing definition leaves the reference available for display or later correction. File read errors, malformed XML, and duplicate definitions within one file fail the import.

Callers pass content files in Aurora load order. A later file can replace a definition with the same ID, and targeted `append` entries contribute rules and supports in file order. Each resolved definition records its source file and published version when present. It keeps the definition's description markup, sheet text, setters, rule attributes, and other content as data.

The import catalog follows exact IDs named by grants, ID-based selections, and embedded descriptions. This makes related options such as the Artillerist's cannon variants available even when the save names only the parent feature. The catalog records unavailable targets and visits each ID once. Saved selections retain their own lists, and rule data retains conditions such as levels and support expressions for later evaluation by the app.
