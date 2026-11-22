# Aurora Combat Tracker

A personal Windows companion app for characters built in Aurora. It brings attacks, spells, scrolls, and companion abilities together on a combat sheet and keeps encounter state between sessions.

- [User requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Windows development and workflow](docs/development.md)

The first implementation milestone is a Rust importer that opens one Aurora character save, resolves references against sample content XML, and reports missing references. A small synthetic fixture will make the test reproducible.
