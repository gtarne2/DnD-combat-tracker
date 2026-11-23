# User requirements

A personal Windows app that uses an Aurora character and its content to show combat options and track the encounter.

| ID | Requirement |
| --- | --- |
| R1 | Import a `.dnd5e` save and resolve entries against the same Aurora content, including custom XML. Load available combat stats, attacks, spells, features, and inventory. Flag missing details and allow manual corrections. Treat source files as read-only. |
| R2 | Use the spell, item, feature, and companion definitions referenced by the character for version-specific rules and options. |
| R3 | Re-import after an Aurora change while preserving the encounter, layout, and applicable pins. |
| R4 | Group attacks, spells, scrolls, items, and features by Action, Bonus Action, or Reaction. Keep the groups available for reference throughout the turn. Show relevant costs, ranges, rolls, and save DCs with full descriptions that expand in place. |
| R5 | Keep HP, AC, speed, and saves easy to find. Allow per-character pins, reordering, and hidden sections. Keep lore, personality, and background available in the full sheet. |
| R6 | Record consumable use from the combat view and show the updated quantity immediately. |
| R7 | Show active concentration and its tracked duration. Prompt for a concentration save when recorded damage calls for one, let the user record the result, and confirm before replacing an active concentration spell. |
| R8 | Support multiple pets, familiars, summons, constructs, and other companions through expandable cards in a collapsible sidebar. Show HP, AC, conditions, and available attacks and abilities. Track companion resources, command costs, and summon duration, and support acting with the owner or on a separate initiative entry. Use imported templates where available and support custom cards. |
| R9 | Keep round, current turn, initiative, and Next Turn accessible from the encounter panel. Save progress locally and allow undo for turn advances, resource spending, HP, effect changes, and other combat updates. |
| R10 | Track conditions and ongoing effects on characters and companions. Show their modifiers and when they end. Support rounds, in-game time, start or end of turn, rests, and manual expiration. Apply automatic updates at the relevant turn or round boundary. |
| R11 | Pin actions to a collapsible Quick Actions strip for direct execution, independently of Favorites. Preserve cannon creation and activation shortcuts. Share resource, availability, and companion state with the other combat views. |

## First playtest

1. Import an Artillerist whose Aurora content provides Force Ballista, Flamethrower, and Protector. Verify that all three variants show the imported details.
2. Add a ranger companion using the same companion system.
3. Apply a timed effect, advance initiative until it expires, and undo the update to restore it.
4. Use a scroll from its action group and record damage while concentrating. Verify the quantity and concentration prompt, then close and reopen the app to verify the encounter resumes.
