// R75: imported monster damage defenses applied by damage type. Standalone: node tests/damage-defenses.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "launcher", "dm-monster-assist.js"), "utf8");
const {defense} = vm.runInNewContext(source + "\nmonsterAssist;");

const werewolf = {resistances: null, immunities: "bludgeoning, piercing, and slashing from nonmagical attacks not made with silvered weapons"};
assert.equal(defense(werewolf, "slashing").apply(13), 0, "nonmagical slashing is immune");
assert.equal(defense(werewolf, "slashing", {magical: true}).apply(13), 13, "a magical or silvered weapon gets through");
assert.equal(defense(werewolf, "slashing").qualified, true);
assert.equal(defense(werewolf, "fire").apply(13), 13);

const wight = {resistances: "necrotic; bludgeoning, piercing, and slashing from nonmagical attacks that aren’t silvered", immunities: "poison"};
assert.equal(defense(wight, "necrotic", {magical: true}).apply(15), 7, "a plain clause beside a qualified one still applies");
assert.equal(defense(wight, "piercing").apply(15), 7);
assert.equal(defense(wight, "poison").apply(15), 0);
assert.equal(defense(wight, "poison").note, "immune to poison");
assert.equal(defense(wight, "radiant").note, "");

const mummy = {vulnerabilities: "fire", resistances: "fire"};
assert.equal(defense(mummy, "fire").apply(15), 14, "resistance then vulnerability");
assert.equal(defense({vulnerabilities: "Fire"}, "fire").apply(9), 18, "case does not matter (2024 packs)");
assert.equal(defense(null, "fire").apply(9), 9);
assert.equal(defense(wight, "").apply(9), 9, "no damage type, no change");
console.log("damage-defenses: ok");
