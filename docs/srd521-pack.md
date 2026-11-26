# SRD 5.2.1 monster pack

The English Creative Commons SRD 5.2.1 PDF is the authority for the 2024 pack. The input manifest pins its SHA-256 and the Borealis commit and file hashes. The vendored inputs contain the two data files and the upstream pack, source, attribution, and coverage records. [Official PDF](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) · [Pinned Borealis data](https://github.com/TeamBorealis/borealis/tree/609b818ab4f911a64bacfd1c1377300e919d0a5a/content/srd-5.2.1-monsters) · [Input manifest](../content/srd521/inputs.json)

## Official inventory

| Section | Official candidates | Included |
| --- | ---: | ---: |
| Monsters A–Z | 235 | 235 |
| Animals | 95 | 95 |
| Total | 330 | 330 |

Each candidate maps by first printed page, heading, section, and Borealis ID. The join normalizes the apostrophe in Will-o’-Wisp for comparison. All creature blocks are included. General monster rules, such as the chapter's explanation of legendary actions, remain outside the per-entry inventory. [Entry ledger](../content/srd521/entries.tsv)

## Conversion and review

- Initiative uses both printed values. Gray Ooze's −2 (13) and Invisible Stalker's +7 (22) retain their printed scores. The audit compares all ability scores and signed saves against the PDF's columns. Young White Dragon's unsigned Intelligence SAVE of 2 is visible as a table note with its −2 modifier. That save has no typed value. [Young White Dragon, p. 340](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf#page=340)
- Archmage keeps the 8,000 XP printed on the stat block, along with both size choices and its Wand. Four werecreatures keep their printed form-specific speed lines. Swarm of Insects keeps the GM's choice of Climb or Fly at 20 ft. The reviewed overrides record each changed field and authority page. [Reviewed corrections](../content/srd521/overrides.json) · [Archmage, p. 305](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf#page=305)
- The source review matches all 1,329 named rules and 30 legendary preambles after normalizing PDF layout, typography, and line-break hyphenation. The pack carries rules as text for table adjudication. This includes spell lists, riders, conditional damage, save success branches, recharge, form restrictions, and lair-qualified uses. The builder preserves the published legendary preambles and lair XP.
- The 2024 Wolf has AC 12, printed initiative +2 (12), and a bite whose prone rider applies to a Medium or smaller creature. The Adult Red Dragon can substitute Spellcasting for one Rend in Multiattack, Fire Breath deals half damage on a successful save, and its legendary and resistance use limits increase in its lair. [Wolf, p. 364](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf#page=364) · [Adult Red Dragon, pp. 318–319](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf#page=318)

## Reproduce and audit

Run `node tools/build-srd521.cjs target/srd521-review` from the repository root. The shared offline converter reads only pinned local inputs and writes the JSON pack and notices. Compare both files byte for byte with `content/monster-packs`. `node tools/build-srd51.cjs target/srd51-review` uses the same converter with the 2014 inputs.

With `pdfplumber` installed, run `python tools/check-srd521-source.py <official-pdf> content/monster-packs/srd-5.2.1-monsters.json`. It verifies the PDF hash and reconciles headings, pages, printed fields, and ordered rules and preambles. The converter and launcher do their work without the PDF.

Build the release helpers and run `node tests/party-launcher.cjs --srd521` to rehearse both packs with external browser requests blocked. The Windows distribution contains the three executables and both notices files. [2014 notices](../content/monster-packs/SRD-5.1-NOTICES.txt) · [2024 notices](../content/monster-packs/SRD-5.2.1-NOTICES.txt)
