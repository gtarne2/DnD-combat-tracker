# SRD 5.1 monster pack

The English Creative Commons SRD 5.1 PDF is the authority for the 2014 pack. The input manifest pins its SHA-256 and the Borealis commit and file hashes. The vendored directory contains the three data files, the upstream pack and source records, attribution and coverage notes. The local source audit accepts a copy of the official PDF. [Official PDF](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf) · [Pinned Borealis source](https://github.com/TeamBorealis/borealis/tree/609b818ab4f911a64bacfd1c1377300e919d0a5a/content/srd-5.1-monsters) · [Input manifest](../content/srd51/inputs.json)

## Official inventory

| Section | Official candidates | Included |
| --- | ---: | ---: |
| Monsters chapter | 201 | 201 |
| Appendix MM-A, Miscellaneous Creatures | 95 | 95 |
| Appendix MM-B, Nonplayer Characters | 21 | 21 |
| Total | 317 | 317 |

The ledger uses the first printed page of each stat block. It joins every heading to its Borealis ID and expected section. Half-Red Dragon Veteran, Will-o’-Wisp and Saber-Toothed Tiger required normalization of PDF hyphenation or apostrophes. The prose-only Half-Dragon Template (p. 320), variant diseased giant rats (p. 378), variant insect swarms (p. 391), Customizing NPCs (p. 395), and general lair and regional rules (p. 260) are outside the stat-block inventory. The printed Half-Red Dragon Veteran sample is included. [Entry ledger](../content/srd51/entries.tsv)

## Conversion and corrections

- Each stat block retains the SRD page, source edition and upstream ID. The inventory keeps printed CR fractions and XP, including zero XP for Frog and Sea Horse. The converter uses printed HP and unconditional AC for encounter initialization. Form-specific AC for Werebear, Wereboar and Werewolf stays conditional. Movement, defenses, skill notes and senses retain their qualifiers, including Grimlock's two blindsight distances and Wererat's rat-form darkvision.
- The official PDF prints Phantasms as its own Cloaker action on p. 268. It also separates Night Hag's Magic Resistance (p. 319), Oni's Magic Weapons (p. 336) and Unicorn's Magic Resistance (p. 351) from their spellcasting traits. The reviewed overrides restore these boundaries. [Reviewed corrections](../content/srd51/overrides.json)
- The converter restores recharge, rest, daily-use, form and legendary-cost labels to their printed rule headings. It reflows wrapped text and formats spell lists for reading. Pack data keeps creature classifications, tags, swarm size, printed HP and hit dice, and explicit saves and skill bonuses. The 2014 blocks have no printed initiative or proficiency bonuses.
- All 1,480 bundled rules and 30 legendary preambles are text for table adjudication. The source check compares the names, labels and wording in order after normalizing PDF typography. Wolf's Bite on p. 393 retains the on-hit creature predicate and DC 11 Strength save against prone. Adult Red Dragon on p. 287 retains the optional Frightful Presence and one bite plus two claws, Fire Breath's Recharge 5–6 and half damage on success, and the 2-action Wing Attack with its knockdown and flight text. These rules do not create structured action mechanics in the bundle. [Wolf source page](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf#page=393) · [Adult Red Dragon source page](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf#page=287)

## Reproduce and audit

Run `node tools/build-srd51.cjs target/srd51-review` from the repository root. It reads the pinned local inputs and writes the v2 JSON and notices. Compare those files byte for byte with `content/monster-packs`. Regenerate that directory before a release build if the reviewed inputs change.

To audit against the authority, run `python tools/check-srd51-source.py <official-pdf> content/monster-packs/srd-5.1-monsters.json` with `pdfplumber` installed. The script verifies the PDF hash and matches its headings, section boundaries, base AC, HP and rules to the ledger and generated pack. The converter and helper run without the PDF-reading dependency.

Build the release helpers and run `node tests/party-launcher.cjs --srd51` to rehearse the installed pack with only local browser requests allowed. The packaged files include the three executables and the notices. [Distribution notices](../content/monster-packs/SRD-5.1-NOTICES.txt)
