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

In **Companions**, add an imported template or a custom companion. Edit the card to change HP, duration, command costs, and turn mode. Open **Companion initiative** to view separate entries and companions that act with their owner.

In **Encounter**, enter your initiative and add other combatants. Start the turn order, then use **Next turn** to advance it. Set or adjust HP, and open **Spell slots and feature uses** to spend or restore resources. The damage form applies damage and handles concentration in one update. The preview saves progress locally, and **Undo combat update** reverses the latest change.

To try the cannon variants and a ranger companion, generate the companion playtest sheet.

```powershell
cargo run --bin combat-sheet -- tests/fixtures/companions.dnd5e tests/fixtures/companions.xml > target/companions.html
```
