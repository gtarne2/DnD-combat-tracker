# Third-party assets

## Icons

The DM dashboard (`launcher/dm-dashboard.html`) and the player sheet's Party chip (`src/combat/session-files.html`) embed icons from [game-icons.net](https://game-icons.net) as an inline SVG sprite. The background square was removed and the fill set to `currentColor`.

License: [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). Source: [game-icons/icons](https://github.com/game-icons/icons).

| Author | Icons |
| --- | --- |
| [Lorc](https://lorcblog.blogspot.com) | crossed-swords, dragon-head, heart-organ, checked-shield, magic-swirl, hourglass, scroll-unfurled, eyeball, skull-crossed-bones, envelope, padlock, magnifying-glass, quill-ink, conversation, wolf-head |
| [Delapouite](https://delapouite.com) | dice-twenty-faces-twenty, tabletop-players, invisible, padlock-open, exit-door, next-button, sword-brandish, save, load, files, stop-sign, rolling-dices, wizard-face |

The player sheet also draws icons with CSS masks from data URIs defined as `--gi-*` custom properties near the end of `src/combat/sheet.css`: heart-organ, checked-shield, magic-swirl, crossed-swords, scroll-unfurled, quill-ink, hourglass and magnifying-glass (Lorc); boots, wolf-howl, knapsack, bleeding-wound, heart-bottle, campfire, fairy-wand and star-swirl (Lorc); character, sword-brandish, next-button and dice-twenty-faces-twenty (Delapouite). The comment above those properties carries the credit.

The dashboard footer shows the credit. Keep this table and the footer in step when adding icons.

## Design references

The layout takes ideas, not code or art, from Owlbear Rodeo's initiative tracker (current-turn highlight and compact rows), Foundry VTT's dnd5e sheets and DiceCloud (HP bars and stat chips), and the classic printed stat block (parchment card with rules and ability grid).
