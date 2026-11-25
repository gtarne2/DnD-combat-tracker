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

Supported cantrips show their dice at your character's level. Choose a slot in the cast dialog to
preview supported damage, healing, or projectile counts. Class features can use imported counters
and shared pools such as Ki or Sorcery Points.

The launcher remembers your file selections and stays in the Windows notification area. After editing
the character in Aurora, open **Session → Refresh from Aurora** and review the changes before applying
them. Use the launcher to edit the content file list. **Session** also exports and restores tracker
backups. To move an existing tracker session to an Aurora copy, open that copy and restore the backup there.

## Generate a sheet from the command line

From the repository root, generate a local HTML sheet and open it in a browser.

```powershell
cargo run --bin combat-sheet -- tests/fixtures/combat-sheet.dnd5e tests/fixtures/combat-sheet.xml > target/combat-sheet.html
```

Use your own save and content XML paths to preview your character. Supply multiple content files in Aurora load order, with overrides last.

Use **Layout** to reorder or hide combat sections and override missing or conditional stats. Pin a stat or combat option to keep a copy above the action groups. **Full sheet** opens your character’s background, personality, and lore. The browser saves preferences for each character in that preview.

Select **Use scroll** or **Use item** to record one unit spent. The sheet immediately updates the quantity on the action row and its favorites copies.

Select **Cast** on a concentration spell or use its scroll. The header shows the active spell and remaining duration. Use **Manage** to advance in-game time, or **Damage** to enter damage after reductions and choose the rules for the save DC. Record the result of each prompted Constitution save.

Expand a card in the **Companions** sidebar to adjust HP, track charges, add a condition, or inspect attacks and abilities. Add an imported template or a custom companion from either the sidebar or the **Companions** page. Collapse the sidebar for more room in Combat.

Use **Initiative** in the **Encounter** panel to set the order. **Next Turn** advances to the next participant. Without other initiative entries, each click advances one round. **Undo** reverses the last combat change shown in the panel. The HP card holds **Set HP**, **Damage**, and **Rest**. Damage uses temporary HP first. Long rests heal to known maximum HP and clear temporary HP. For a short rest, enter the healing you rolled. The preview saves progress locally.

Use **End Encounter** to pause initiative while keeping HP, resources, companions, concentration, and effects. **Start Encounter** begins again at round one with the same roster. Use **Undo** to return to the previous turn and round.

Choose an action tab or search across visible groups. Selecting a row opens its details beside the list on desktop and within the row on narrow screens. Drag the desktop divider to resize the panes, or use **Hide details** to widen the action list. Select an ability tile to inspect its check and saving throw. **Attack** records your latest weapon attack for the encounter. **Character** opens the full sheet and **Layout** opens display preferences.

Open **Roll Bonuses** below the ability tiles to search skills, saves, ability checks, attack and spell rolls, initiative, and tool proficiencies. Expand a roll to see its available components.

**Character** puts skills, saves, passive scores, and exploration information together. In Combat, select **Skills** to show the list in the details pane. Use **Find on sheet** or press `/` to look up a feature, spell, check, or item from any page.

During exploration or roleplay, use **Character**, **Companions**, **Inventory**, or **Journal**. Add dated Journal entries with links to sheet references or encounter activity. Your original journal and notes stay available below them. In Combat, **Activity** shows the current log and **Rosters and archive** holds saved rosters and previous encounters.

Use **Pin to Quick Actions** in the inspector or **Pin action** in the strip to add a direct execution shortcut. The star keeps an option in **Favorites** for browsing. Use **Organize favorites** on that tab to reorder your pins. The strip also offers cannon creation and activation for imported variants. Use the × next to a shortcut to unpin it.

Use **Traits** to find features and **Track uses or effect** to set up a counter or toggle. Create a shared pool such as Ki in **Manage resources**, then choose it and set the cost on each ability. **Tracked abilities** also holds custom imbuements and known Artificer infusions. During a long rest, you can review prepared spells and switch which imbuements and infusions are active. **Bonus Action** lists supported ongoing actions, such as Heat Metal and active Eldritch Cannons.

Expand a tracked ability by selecting its name. In **Add** or **Edit**, search for a spell, feature, item, or ongoing effect to link, and enter any custom description or notes.

On **Features & Traits**, choose **Organize groups** to collect and reorder the features you use together. Moxie has a shared counter in Resources. Spending points, using a limited feature, and recording a failed save update the shared pool and the individual feature counters. **Set up Moxie** lets you enter a maximum when it is missing from the import.

Open an item in **Inventory** to follow its linked attacks. Use **Table notes** on an item or attack to add a reminder or choose which gear a saved attack uses.

In **Inventory**, edit copper, silver, electrum, gold, and platinum in **Currency**. Pending edits persist when you reload. Choose **Export Aurora copy** to download an updated `.dnd5e` file, then open it in Aurora.

In **Active effects**, add a condition or effect such as **Berserk**, choose its target, and set when it ends. Include a mechanical note such as **Advantage on Strength checks**. For start or end of turn, choose whose turn to follow and how many matching boundaries to count. Use **Advance game time** for elapsed time outside initiative. Edit an effect to adjust its remaining duration, or use **End effect** to end it manually.

To try the cannon variants and a ranger companion, generate the companion playtest sheet.

```powershell
cargo run --bin combat-sheet -- tests/fixtures/companions.dnd5e tests/fixtures/companions.xml > target/companions.html
```
