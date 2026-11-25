# User requirements

A personal Windows app that uses an Aurora character and its content to show combat options and track the encounter.

| ID | Requirement |
| --- | --- |
| R1 | Import a `.dnd5e` save and resolve entries against the same Aurora content, including custom XML. Load available combat stats, attacks, spells, features, and inventory. Flag missing details and allow manual corrections. Treat source files as read-only. |
| R2 | Use the spell, item, feature, and companion definitions referenced by the character for version-specific rules and options. |
| R3 | Refresh through the Windows launcher using the original Aurora inputs. Preview unresolved definitions, unavailable stats, definition sources, and significant changes before applying a refresh. Preserve the previous sheet and tracker progress when an import fails. |
| R4 | Group attacks, spells, scrolls, items, and features by Action, Bonus Action, or Reaction. Keep the groups available for reference throughout the turn. Show relevant costs, ranges, rolls, and save DCs with full descriptions that expand in place. |
| R5 | Keep HP, AC, speed, and saves easy to find. Allow per-character pins, reordering, and hidden sections. Keep lore, personality, and background available in the full sheet. |
| R6 | Record consumable use immediately. When re-import changes a stack with pending usage, show both imported quantities and let the player reconcile units already reflected in Aurora. Preserve stack identity and encounter progress. |
| R7 | Show active concentration and its tracked duration. Prompt for a concentration save when recorded damage calls for one, let the user record the result, and confirm before replacing an active concentration spell. |
| R8 | Support pets, familiars, summons, constructs, and other companions through editable cards. Share availability with initiative and action controls. An Eldritch Cannon vanishes at zero HP or on expiration. Other companions have a configurable zero-HP rule. Advance summon timers in their chosen units and restore HP and availability together on undo. |
| R9 | Keep round, current turn, initiative, and Next Turn accessible from the encounter panel. Let the user end or restart an encounter while preserving character state and ongoing effects. Save progress locally and allow undo for turn advances, ending an encounter, resource spending, HP, effect changes, and other combat updates. |
| R10 | Track conditions and ongoing effects with notes and expiration rules. Support rounds, game time, turn boundaries, rests, and manual expiration. When a participant is removed, end its target effects and allow turn-anchored effects on other participants to end or move to another turn in the same undoable update. |
| R11 | Pin actions to a collapsible Quick Actions strip for direct execution, independently of Favorites. Preserve cannon creation and activation shortcuts. Share resource, availability, and companion state with the other combat views. |
| R12 | Keep character vitals, resources, concentration, companions, and effects accessible while browsing Character, Inventory, and the combined Journal and Notes page. Preserve navigation state and combat activity between views and after reopening a sheet. Keep the desktop panes usable at 1920×1080 and 2560×1440 at 100% and 125% scaling. |
| R13 | Let the user search skills, saves, ability checks, casts, attacks, and supported tool and initiative bonuses from the character header. Show passive scores and break down modifiers wherever the imported data supports it. |
| R14 | Let the user expand tracked abilities to read custom descriptions or link to existing spells, features, items, and ongoing effects. Preserve saved ability states, usage, and resource bindings. |
| R15 | Show skills, saves, and passive scores directly on Character. Let players dock skills in Combat and search the entire sheet without changing the current page. Keep senses, languages, tools, movement, and background features easy to find. |
| R16 | Let players organize Features & Traits into named groups and set their own order. Show timing, triggers, costs, and rest recovery separately. Track shared class pools such as Moxie alongside individual uses and let the player record outcomes. |
| R17 | Link imported gear and saved attacks where the association is clear. Allow local notes and corrections to the association. |
| R18 | Show and edit currency in Inventory. Persist pending balances across reloads. Export an Aurora `.dnd5e` copy with updated balances and the original character data. |
| R19 | Export a versioned tracker backup and validate and preview it before replacing the current session. Restore in another browser profile or against a moved or exported Aurora save. Include encounter state, preferences, notes, and local corrections. |
| R20 | Offer a persistent Compact Combat layout with vitals and pinned resources, an initiative summary, direct owner healing and combatant HP adjustments, stable keyboard focus, and search that includes active follow-ups. |
| R21 | Activate reusable charged items from a bound pool and show remaining uses. Distinguish slot, ritual, and free-use casting and commit applicable costs together with concentration. Filter Inventory, reorder custom feature groups, and open Table notes from either side of an attack and gear link. |
| R22 | Keep a persistent undo-aware encounter activity log for combat updates and zero-cost casts. Save reusable rosters and effect presets and archive encounters for later review. |
| R23 | Optionally track Action, Bonus Action, and Reaction for the owner and companions. Share availability across execution controls and allow a per-use override for table rulings. |
| R24 | Add dated, searchable Journal entries linked to encounter activity or sheet references. Preserve existing journal and notes text. |
| R25 | Show current cantrip dice and separate attacks when the resolved spell text identifies how they scale with character level. Preview supported damage, healing, and projectile counts for the selected spell slot. Leave ambiguous effects available as rules text. |
| R26 | Resolve supported Aurora class-stat formulas using the saved class levels and ability modifiers. Show the resulting dice, uses, save DCs, and shared pools. Let features spend stated costs or select an amount for a variable healing pool. |
| R27 | Track numbered strikes in the same Attack action when the character has Extra Attack. Record hit or miss and let the player apply eligible Sneak Attack and on-hit maneuvers. |
| R28 | Show authored reaction triggers and offer matching, available spell reactions while recording incoming attack or Magic Missile damage. Let the player apply situational attack modifiers when the imported spell states a supported condition. |
| R29 | Filter the character's spells by preparation, school, ritual, concentration, and material cost. Show costly or consumed materials during casting. Preview supported target-count upcasts, link supported spell effects to their targets and concentration, and show turn reminders for tracked creatures in an area. |
| R30 | Show attunement requirements and let the player record which items they have attuned to. Gate supported item activations on the saved selection. Restore charges from supported dawn formulas when the player advances to dawn. |

## First playtest

1. Import an Artillerist whose Aurora content provides Force Ballista, Flamethrower, and Protector. Verify that all three variants show the imported details.
2. Add a ranger companion using the same companion system.
3. Apply a timed effect, advance initiative until it expires, and undo the update to restore it.
4. Use a scroll from its action group and record damage while concentrating. Verify the quantity and concentration prompt, then close and reopen the app to verify the encounter resumes.
