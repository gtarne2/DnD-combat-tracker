// R79 browser check: a buff spell cast on the sheet's owner changes the header speed, and a
// custom effect's stat changes reach AC, attack rolls and saving throws.
// Run after building combat-sheet: AURORA_TEST_IMPORTER=target/debug/combat-sheet node tests/stat-buffs.cjs
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright");

const root = path.resolve(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures");
const importer = process.env.AURORA_TEST_IMPORTER || path.join(root, "target", "debug", "combat-sheet.exe");
fs.mkdirSync(path.join(root, "target"), {recursive: true});
const directory = fs.mkdtempSync(path.join(root, "target", "review-"));

const spell = `<element id="ID_TEST_SPELL_LONGSTRIDER" name="Longstrider" type="Spell" source="Player's Handbook">
    <description><p>You touch a creature. The target's speed increases by 10 feet until the spell ends.</p></description>
    <setters><set name="level">1</set><set name="time">1 action</set><set name="duration">1 hour</set><set name="range">Touch</set></setters>
  </element>
</elements>`;
fs.writeFileSync(path.join(directory, "content.xml"),
  fs.readFileSync(path.join(fixtures, "combat-sheet.xml"), "utf8").replace("</elements>", spell));
fs.writeFileSync(path.join(directory, "hero.dnd5e"), fs.readFileSync(path.join(fixtures, "combat-sheet.dnd5e"), "utf8")
  .replace('<spell id="ID_TEST_SPELL_FLARE"', '<spell id="ID_TEST_SPELL_LONGSTRIDER" name="Longstrider" level="1" prepared="true" /><spell id="ID_TEST_SPELL_FLARE"'));

async function main() {
  const url = pathToFileURL(execFileSync(importer, ["--preview-dir", directory,
    path.join(directory, "hero.dnd5e"), path.join(directory, "content.xml")], {encoding: "utf8"}).trim()).href;
  const browser = await chromium.launch({executablePath: process.env.AURORA_TEST_CHROME});
  const errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1536, height: 900}});
    page.setDefaultTimeout(5000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    const speed = page.locator("#key-stats [data-stat=speed]");
    const ac = page.locator("#key-stats [data-stat=ac]");
    assert.equal(await speed.textContent(), "40 ft. walk · 40 ft. swim");
    assert.equal(await ac.textContent(), "18");

    const row = (name) => page.locator("#action-groups .option-row").filter({has: page.locator(".option-title", {hasText: name})}).first();
    await row("Longstrider").locator("[data-cast-spell]").click();
    const cast = page.locator("#cast-form");
    await cast.getByLabel("Casting method").selectOption("Spell slot:1");
    await page.locator("#cast-target-feedback").filter({hasText: "+10 ft. speed · Choose up to 1 target."}).waitFor();
    assert.equal(await cast.locator("#cast-targets input:checked").count(), 1);
    await cast.getByRole("button", {name: "Confirm cast"}).click();
    await page.waitForFunction(() => document.querySelector("#key-stats [data-stat=speed]").textContent === "50 ft. walk · 40 ft. swim");
    assert.equal(await page.locator("#key-stats .stat-boost-note").first().textContent(), "+10 ft. · Longstrider");
    await page.locator("#effect-list").getByText("1 h of game time remaining").waitFor();

    // A custom effect with stat changes: +2 AC, +1 to attack rolls, +1d4 to saves.
    await page.locator("#add-effect").click();
    const editor = page.locator("#effect-form");
    await editor.getByLabel("Effect name").fill("War Blessing");
    await editor.locator("summary", {hasText: "Stat changes"}).click();
    await editor.getByLabel("AC", {exact: true}).fill("2");
    await editor.getByLabel("Attack rolls").fill("1");
    await editor.getByLabel("Save die").selectOption("4");
    await editor.getByRole("button", {name: "Save effect"}).click();
    await page.waitForFunction(() => document.querySelector("#key-stats [data-stat=ac]").textContent === "20");
    await page.locator("#effect-list .effect-mods").filter({hasText: "+2 AC · +1 to attack rolls · +1d4 to saving throws"}).waitFor();
    const bow = await row("Signal Bow").locator(".option-roll").textContent();
    assert.match(bow, /^\+6 vs AC/);
    const dexSave = await page.locator('[data-roll-save="dex"] summary > strong').textContent();
    assert.equal(dexSave, "+3 +1d4");

    // Ending the spell puts the speed back.
    const longstrider = page.locator("#effect-list article").filter({hasText: "Longstrider"});
    await longstrider.getByRole("button", {name: "End effect"}).click();
    await page.waitForFunction(() => document.querySelector("#key-stats [data-stat=speed]").textContent === "40 ft. walk · 40 ft. swim");
    assert.equal(await page.locator("#key-stats .stat-boost-note").count(), 1);
    if (process.env.AURORA_SHOTS) await page.screenshot({path: path.join(process.env.AURORA_SHOTS, "r78-custom-effect.png")});
    assert.deepEqual(errors, []);
    console.log("Longstrider speed, custom effect AC, attack and save changes passed.");
  } finally {
    await browser.close();
    fs.rmSync(directory, {recursive: true, force: true});
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
