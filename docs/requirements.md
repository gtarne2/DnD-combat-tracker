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
| R8 | Support multiple pets, familiars, summons, constructs, and other companions through reusable, editable cards with applicable stats, HP, attacks, abilities, and duration. Show their command costs and support taking a turn with their owner or using a separate initiative entry. Use imported details, including variants, where available. |
| R9 | Enter and edit initiative, show the current turn and round, and track HP, spell slots, and feature uses. Save progress locally and allow undo for combat updates. |
| R10 | Track ongoing effects on characters and companions, including custom effects such as Berserk. Show when they end and support durations in rounds or in-game time, start or end of turn, or manual expiration. Update turn-based durations as initiative advances and allow manual adjustments. |

## First playtest

1. Import an Artillerist whose Aurora content provides Force Ballista, Flamethrower, and Protector. Verify that all three variants show the imported details.
2. Add a ranger companion using the same companion system.
3. Apply a timed effect, advance initiative until it expires, and undo the update to restore it.
4. Use a scroll from its action group and record damage while concentrating. Verify the quantity and concentration prompt, then close and reopen the app to verify the encounter resumes.
