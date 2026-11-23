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

Use **Manage initiative** to enter scores, add combatants, and set HP. The left rail shows the current turn and keeps **Next turn** and undo in reach. Use the **Resources** strip to spend or restore spell slots and feature uses. The damage form applies damage and handles concentration in one update. The preview saves progress locally.

Choose an action tab or search across visible groups. Selecting a row opens its details beside the list on desktop and within the row on narrow screens. **Character** opens the full sheet and **Layout** opens display preferences.

In **Effects**, add a custom effect such as **Berserk**, choose its target, and set when it ends. For start or end of turn, choose whose turn to follow and how many matching boundaries to count. Use **Advance game time** for elapsed time outside initiative. Edit an effect to adjust its remaining duration, or use **End effect** to end it manually.

To try the cannon variants and a ranger companion, generate the companion playtest sheet.

```powershell
cargo run --bin combat-sheet -- tests/fixtures/companions.dnd5e tests/fixtures/companions.xml > target/companions.html
```
