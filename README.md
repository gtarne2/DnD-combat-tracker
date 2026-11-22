# Aurora Combat Tracker

A personal Windows companion app for characters built in Aurora. It brings attacks, spells, scrolls, and companion abilities together on a combat sheet and keeps encounter state between sessions.

- [User requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Windows development and workflow](docs/development.md)

## Preview the combat sheet

From the repository root, generate a local HTML sheet and open it in a browser.

```powershell
cargo run --bin combat-sheet -- tests/fixtures/combat-sheet.dnd5e tests/fixtures/combat-sheet.xml > target/combat-sheet.html
```

Use your own save and content XML paths to preview your character. Supply multiple content files in Aurora load order, with overrides last.

Use **Layout** to reorder or hide combat sections and override missing or conditional stats. Pin a stat or combat option to keep a copy above the action groups. **Full sheet** opens your character’s background, personality, and lore. The browser saves preferences for each character in that preview.

Select **Use** on a scroll, potion, or other consumable to record one unit spent. The sheet immediately updates the quantity on the action card and its pinned copies.

Select **Concentrate** on a concentration spell or use its scroll. In **Concentration**, advance in-game time or record damage after reductions. Record the result of each prompted Constitution save. Choose 2014 or 2024 rules for the DC calculation.
