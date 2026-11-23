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
| R9 | Keep round, current turn, initiative, and Next Turn accessible from the encounter panel. Let the user end or restart an encounter while preserving character state and ongoing effects. Save progress locally and allow undo for turn advances, ending an encounter, resource spending, HP, effect changes, and other combat updates. |
| R10 | Track conditions and ongoing effects on characters and companions. Show their modifiers and when they end. Support rounds, in-game time, start or end of turn, rests, and manual expiration. Apply automatic updates at the relevant turn or round boundary. |
| R11 | Pin actions to a collapsible Quick Actions strip for direct execution, independently of Favorites. Preserve cannon creation and activation shortcuts. Share resource, availability, and companion state with the other combat views. |
| R12 | Keep character vitals, resources, concentration, companions, and effects accessible while browsing Character, Inventory, Journal, and Notes. Preserve navigation state and combat activity between views and after reopening a sheet. Keep the desktop panes usable at 1920×1080 and 2560×1440 at 100% and 125% scaling. |
| R13 | Let the user search skills, saves, ability checks, casts, attacks, and supported tool and initiative bonuses from the character header. Show passive scores and break down modifiers wherever the imported data supports it. |
| R14 | Let the user expand tracked abilities to read custom descriptions or link to existing spells, features, items, and ongoing effects. Preserve saved ability states, usage, and resource bindings. |
| R15 | Show skills, saves, and passive scores directly on Character. Let players dock skills in Combat and search the entire sheet without changing the current page. Keep senses, languages, tools, movement, and background features easy to find. |
| R16 | Let players organize Features & Traits into named groups and set their own order. Show timing, triggers, costs, and rest recovery separately. Track shared class pools such as Moxie alongside individual uses and let the player record outcomes. |
| R17 | Link imported gear and saved attacks where the association is clear. Allow local notes and corrections to the association. |

## First playtest

1. Import an Artillerist whose Aurora content provides Force Ballista, Flamethrower, and Protector. Verify that all three variants show the imported details.
2. Add a ranger companion using the same companion system.
3. Apply a timed effect, advance initiative until it expires, and undo the update to restore it.
4. Use a scroll from its action group and record damage while concentrating. Verify the quantity and concentration prompt, then close and reopen the app to verify the encounter resumes.
