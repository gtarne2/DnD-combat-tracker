# Aurora Combat Tracker

A personal Windows companion app for characters built in Aurora. It brings attacks, spells, scrolls, and companion abilities together on a combat sheet and keeps encounter state between sessions.

- [User requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Windows development and workflow](docs/development.md)

## Open the tracker on Windows

Extract the Windows package and double-click **Aurora Combat Tracker.exe**.
If you are running from source, first run `cargo build --release --bin combat-sheet`
and `.\launcher\build.cmd`, then open the launcher in `target\release`.

1. Click **Browse** and select your Aurora `.dnd5e` save.
2. Click **Add folder** to scan a parent folder and all its subfolders for XML each time you open the sheet. You can also use **Add files** for individual XML files or open the sheet with the save alone. Files inside a folder load in path order. To give an override priority, add it separately and move it below the folder.
3. Click **Open Combat Sheet** to open it in your default browser.

The launcher remembers your last successful file selections. After editing the
character in Aurora, click **Open Combat Sheet** again. The launcher refreshes
the same local sheet so that the same browser profile can retain your progress.

## Generate a sheet from the command line

From the repository root, generate a local HTML sheet and open it in a browser.

```powershell
cargo run --bin combat-sheet -- tests/fixtures/combat-sheet.dnd5e tests/fixtures/combat-sheet.xml > target/combat-sheet.html
```

Use your own save and content XML paths to preview your character. Supply multiple content files in Aurora load order, with overrides last.

Use **Layout** to reorder or hide combat sections and override missing or conditional stats. Pin a stat or combat option to keep a copy above the action groups. **Full sheet** opens your character’s background, personality, and lore. The browser saves preferences for each character in that preview.

Select **Use scroll** or **Use item** to record one unit spent. The sheet immediately updates the quantity on the action row and its favorites copies.

Select **Cast** on a concentration spell or use its scroll. The header shows the active spell and remaining duration. Use **Manage** to advance in-game time, or **Damage** to enter damage after reductions and choose the rules for the save DC. Record the result of each prompted Constitution save.

In the **Companions** rail or header roster, add an imported template or a custom companion. The roster shows HP and AC. Select a companion to see its details and editing controls.

Use **Next Turn** to advance timers. Without other initiative entries, each click advances one round. Optional initiative settings are in **Layout**. The HP card holds **Set HP**, **Damage**, and **Rest**. Damage uses temporary HP first. Long rests heal to known maximum HP and clear temporary HP. For a short rest, enter the healing you rolled. Cast directly from a spell row and select a spell slot when needed. The preview saves progress locally.

Choose an action tab or search across visible groups. Selecting a row opens its details beside the list on desktop and within the row on narrow screens. Drag the desktop divider to resize the panes, or use **Hide details** to widen the action list. Select an ability tile to inspect its check and saving throw. **Attack** records your latest weapon attack for the encounter. **Character** opens the full sheet and **Layout** opens display preferences.

Use **Traits** to find features and **Track uses or effect** to set up a counter or toggle. Create a shared pool such as Ki in **Manage resources**, then choose it and set the cost on each ability. **Tracked abilities** also holds custom imbuements and known Artificer infusions. During a long rest, you can review prepared spells and switch which imbuements and infusions are active. **Bonus Action** lists supported ongoing actions, such as Heat Metal and active Eldritch Cannons.

In **Effects**, add a custom effect such as **Berserk**, choose its target, and set when it ends. For start or end of turn, choose whose turn to follow and how many matching boundaries to count. Use **Advance game time** for elapsed time outside initiative. Edit an effect to adjust its remaining duration, or use **End effect** to end it manually.

To try the cannon variants and a ranger companion, generate the companion playtest sheet.

```powershell
cargo run --bin combat-sheet -- tests/fixtures/companions.dnd5e tests/fixtures/companions.xml > target/companions.html
```
