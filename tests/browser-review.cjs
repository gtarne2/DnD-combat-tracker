const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require("playwright");

const root = path.resolve(__dirname, "..");
const fixture = (name) => path.join(__dirname, "fixtures", name);
const importer = process.env.AURORA_TEST_IMPORTER || path.join(root, "target", "debug", "combat-sheet.exe");
const directory = fs.mkdtempSync(path.join(root, "target", "review-"));

function generate(save, ...content) {
  return pathToFileURL(execFileSync(importer, ["--preview-dir", directory, save, ...content], {encoding: "utf8"}).trim()).href;
}

async function main() {
  const browser = await chromium.launch({executablePath: process.env.AURORA_TEST_CHROME});
  const errors = [];
  const viewport = {width: 1536, height: 745};
  const overrides = [];
  async function newProfile(profileDirectory) {
    const context = profileDirectory
      ? await chromium.launchPersistentContext(profileDirectory, {viewport, executablePath: process.env.AURORA_TEST_CHROME})
      : await browser.newContext({viewport});
    if (profileDirectory) overrides.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  async function encounterExtras(page) {
    const fold = page.locator("#encounter .encounter-extras");
    if (!await fold.evaluate(node => node.open)) await fold.locator("summary").click();
  }
  async function expectText(locator, value) {
    await locator.filter({hasText: value}).first().waitFor({state: "visible"});
  }
  try {
    const page = await newProfile();
    const companionsSave = path.join(directory,"companions.dnd5e");
    const companionsXml = path.join(directory,"companions.xml");
    fs.copyFileSync(fixture("companions.dnd5e"),companionsSave);
    fs.copyFileSync(fixture("companions.xml"),companionsXml);
    const companionsUrl = generate(companionsSave,companionsXml);
    await page.goto(companionsUrl);
    await page.getByRole("button", {name: "Create Force Ballista", exact: true}).click();
    const cannon = page.locator(".companion-card").filter({hasText: "Force Ballista"});
    const quick = page.getByRole("button", {name: "Activate Force Ballista", exact: true});
    await quick.waitFor();
    const rail = page.locator("#companion-roster-content");
    const railWidth = await rail.evaluate((node) => node.clientWidth);
    await cannon.locator("summary").first().click();
    assert.equal(await rail.evaluate((node) => node.clientWidth), railWidth);
    const turnActions = await cannon.locator('[data-companion-action="economy"]').boundingBox();
    const remove = await cannon.locator('[data-companion-action="remove"]').boundingBox();
    assert.equal(turnActions.y, remove.y);
    const hp = Number((await cannon.locator("meter").getAttribute("value")));
    assert.ok(hp > 0);
    await cannon.getByLabel("HP adjustment").fill(String(hp));
    await cannon.getByRole("button", {name: "Damage", exact: true}).click();
    await expectText(cannon.locator("summary").first(), "Destroyed");
    await quick.waitFor({state: "detached"});
    await page.locator("#undo-turn").click();
    await quick.waitFor();
    await page.locator("#next-turn").click();
    await expectText(cannon.locator("summary").first(), "59 min 54 sec left");
    await page.locator("#undo-turn").click();
    await expectText(cannon.locator("summary").first(), "1 h left");
    await page.getByText("Advance game time", {exact: true}).filter({visible: true}).first().click();
    await page.locator("#effect-clock [name=elapsed]").fill("2");
    await page.locator("#effect-clock [name=unit]").selectOption("3600");
    await page.locator("#effect-clock button").click();
    await expectText(cannon.locator("summary").first(), "Expired");
    await quick.waitFor({state: "detached"});
    await page.locator("#undo-turn").click();
    await quick.waitFor();
    console.log("Cannon destruction, elapsed time, initiative rollover, and undo passed.");

    await page.locator("#manage-initiative").click();
    await page.locator("#combatant-panel summary").click();
    await page.getByLabel("Combatant name").fill("Synthetic Goblin");
    await page.getByLabel("Initiative score").fill("11");
    await page.getByRole("button", {name: "Save combatant"}).click();
    await page.locator("#encounter-settings").getByRole("button", {name: "Close"}).click();
    async function effect(name, target, kind, anchor) {
      await page.locator("#add-effect").click();
      const form = page.locator("#effect-form");
      await form.getByLabel("Effect name").fill(name);
      await form.getByLabel("Applies to").selectOption({label: target});
      await form.getByLabel("Ends after").selectOption(kind);
      if (anchor) await form.getByLabel("Whose turn").selectOption({label: anchor});
      await form.getByRole("button", {name: "Save effect"}).click();
      await expectText(page.locator("#effect-list article"), name);
    }
    const owner = await page.locator("h1").innerText();
    await effect("Targeted effect", "Synthetic Goblin", "manual");
    await effect("Anchored effect", owner, "end", "Synthetic Goblin");
    await page.locator("#manage-initiative").click();
    await page.getByRole("button", {name: "Remove: Synthetic Goblin"}).click();
    await page.locator("#removed-turn-effects select").selectOption("owner");
    await page.getByRole("button", {name: "Remove participant", exact: true}).click();
    await page.locator("#encounter-settings").getByRole("button", {name: "Close"}).click();
    await expectText(page.locator("#effect-list article"), "End of turn: " + owner);
    await page.locator("#effect-list").getByText("Targeted effect").waitFor({state: "detached"});
    await page.locator("#undo-turn").click();
    await expectText(page.locator("#effect-list article"), "Targeted effect");
    await expectText(page.locator("#effect-list article"), "End of turn: Synthetic Goblin");
    console.log("Combatant removal, effect reassignment, and compound undo passed.");

    await page.locator("#option-search").fill("nonsuch query");
    await page.locator("#no-options").waitFor();
    await page.locator("#bonus-followups").waitFor({state: "hidden"});
    await page.locator("#option-search").fill("Force Ballista");
    await expectText(page.locator("#bonus-followup-list article"), "Force Ballista");
    await page.locator("#no-options").waitFor({state: "hidden"});

    await page.locator("#option-search").fill("");
    await page.locator("#companion-template").selectOption("custom");
    await page.getByRole("button", {name: "Add companion", exact: true}).click();
    const companionForm = page.locator("#edit-companion");
    await companionForm.getByLabel("Name", {exact: true}).fill("Round owl");
    await companionForm.getByLabel("Current HP").fill("6");
    await companionForm.getByLabel("Maximum HP").fill("6");
    await companionForm.getByLabel("Remaining duration").fill("2");
    await companionForm.getByLabel("Turn", {exact: true}).selectOption("separate");
    await companionForm.getByLabel("Companion initiative").fill("9");
    await companionForm.getByRole("button", {name: "Save companion"}).click();
    const owl = page.locator(".companion-card").filter({hasText: "Round owl"});
    await expectText(owl.locator("summary").first(), "2 rounds left");
    await page.locator("#effect-clock [name=elapsed]").fill("1");
    await page.locator("#effect-clock [name=unit]").selectOption("3600");
    await page.locator("#effect-clock button").click();
    await expectText(owl.locator("summary").first(), "2 rounds left");
    await page.locator("#effect-clock [name=unit]").selectOption("rounds");
    await page.locator("#effect-clock button").click();
    await expectText(owl.locator("summary").first(), "1 round left");
    await page.locator("#undo-turn").click();
    await expectText(owl.locator("summary").first(), "2 rounds left");

    await page.locator("#add-effect").click();
    const preset = page.locator("#effect-form");
    await preset.getByLabel("Effect name").fill("Owl ward");
    await preset.getByLabel("Applies to").selectOption({label: "Round owl"});
    await preset.getByLabel("Ends after").selectOption("end");
    await preset.getByLabel("Whose turn").selectOption({label: "Synthetic Goblin"});
    await preset.getByLabel("Condition, modifier, or notes").fill("+2 to saves");
    await preset.getByRole("button", {name: "Save as preset"}).click();
    await preset.getByRole("button", {name: "Cancel"}).click();
    await page.locator("#add-effect").click();
    await preset.getByLabel("Effect preset").selectOption("Owl ward");
    assert.equal(await preset.getByLabel("Condition, modifier, or notes").inputValue(), "+2 to saves");
    await preset.getByRole("button", {name: "Save effect"}).click();
    await expectText(page.locator("#effect-list article"), "Owl ward");
    await encounterExtras(page); await page.getByRole("button", {name: "Rosters and archive"}).click();
    const library = page.locator("#encounter-library");
    await library.getByLabel("Roster name").fill("Owl and goblin");
    await library.getByRole("button", {name: "Save current roster"}).click();
    await library.getByRole("button", {name: "Close"}).click();
    await owl.locator("summary").first().click();
    await owl.getByRole("button", {name: "Remove Round owl"}).click();
    await owl.waitFor({state: "detached"});
    await page.locator("#effect-list").getByText("Owl ward").waitFor({state: "detached"});
    await encounterExtras(page); await page.getByRole("button", {name: "Rosters and archive"}).click();
    await library.getByRole("button", {name: "Load roster"}).click();
    await library.getByRole("button", {name: "Close"}).click();
    await owl.waitFor();
    console.log("Separate round timers, companion effect cleanup, effect presets, and roster reuse passed.");

    await page.locator("#companion-template").selectOption("ID_TEST_WARDEN_HOUND");
    await page.getByRole("button",{name:"Add companion",exact:true}).click();
    await companionForm.getByRole("button",{name:"Save companion"}).click();
    const hound = page.locator(".companion-card").filter({hasText:"Warden Hound"});
    const houndSummary = hound.locator("summary").first();
    const houndId = await hound.getAttribute("data-companion-id");
    const cannonId = await cannon.getAttribute("data-companion-id");
    await houndSummary.click();
    await hound.getByText("With owner",{exact:true}).waitFor();
    await hound.getByRole("button",{name:"Edit Warden Hound",exact:true}).click();
    await companionForm.getByLabel("Command costs").fill("Uses the owner's action (table note)");
    await companionForm.getByRole("button",{name:"Save companion"}).click();
    await hound.getByText("Uses the owner's action (table note)").first().waitFor();
    await hound.getByLabel("HP adjustment").fill("11");
    await hound.getByRole("button",{name:"Damage",exact:true}).click();
    await expectText(houndSummary,"HP 0 / 11");
    await hound.getByRole("button",{name:"Track turn actions: Warden Hound"}).waitFor();
    await page.locator("#undo-turn").click();
    await expectText(houndSummary,"HP 11 / 11");
    fs.writeFileSync(companionsXml,fs.readFileSync(companionsXml,"utf8")
      .replace("Action to command","Revised import command")
      .replace('<set name="hp">11</set>','<set name="hp">13</set>'));
    assert.equal(generate(companionsSave,companionsXml),companionsUrl);
    await page.reload();
    await expectText(houndSummary,"HP 11 / 11");
    assert.equal(await hound.getAttribute("data-companion-id"),houndId);
    assert.equal(await cannon.getAttribute("data-companion-id"),cannonId);
    assert.equal(await hound.getByText("Uses the owner's action (table note)",{exact:true}).count(),1);
    await expectText(cannon.locator("summary").first(),"Expired");
    await quick.waitFor({state:"detached"});
    console.log("Imported companion re-import, owner turn, zero HP, local edits and undo passed.");

    const save = path.join(directory, "synthetic.dnd5e");
    const xml = fixture("combat-sheet.xml");
    const original = fs.readFileSync(fixture("combat-sheet.dnd5e"), "utf8");
    fs.writeFileSync(save, original);
    const url = generate(save, xml);
    await page.goto(url);
    const row = (page, name) => page.locator("#action-groups .option-row").filter({has: page.locator(".option-title", {hasText: name})}).first();
    await page.locator("#option-search").fill("Scroll of Flare");
    const scroll = row(page, "Scroll of Flare");
    await scroll.locator("[data-use]").press("Enter");
    await expectText(scroll.locator("[data-stack-count]"), "1 left");
    fs.writeFileSync(save, original.replace('identifier="flare-scrolls" amount="2"', 'identifier="flare-scrolls" amount="1"'));
    assert.equal(generate(save, xml), url);
    await page.reload();
    await page.locator("#review-consumables").click();
    await expectText(page.locator("#consumable-changes label"), "Previous import 2 · New import 1 · Pending tracker use 1");
    await page.locator("#consumable-changes input").fill("1");
    await page.getByRole("button", {name: "Reconcile quantities"}).click();
    await page.locator("#review-consumables").waitFor({state: "hidden"});
    await expectText(scroll.locator("[data-stack-count]"), "1 left");
    generate(save, xml);
    await page.reload();
    await expectText(scroll.locator("[data-stack-count]"), "1 left");
    await page.locator("#review-consumables").waitFor({state: "hidden"});

    await page.locator("#option-search").fill("Signal Rod");
    const rod = row(page, "Signal Rod");
    await expectText(rod.locator("[data-option-badge]"), "3 uses left");
    await rod.locator("[data-charge-key]").press("Enter");
    await expectText(rod.locator("[data-option-badge]"), "2 uses left");
    const spendSlot = page.locator("#encounter-resources").getByRole("button", {name: "Spend: Level 1 Spell slot", exact: true});
    await spendSlot.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Spend: Level 1 Spell slot");
    await spendSlot.press("Enter");
    await spendSlot.press("Enter");
    await page.waitForFunction(() => document.activeElement.getAttribute("aria-label") === "Restore: Level 1 Spell slot");
    await page.getByRole("button", {name: "Inventory", exact: true}).click();
    await page.getByLabel("Filter inventory").selectOption("charged");
    assert.equal(await page.locator("#inventory-content > details:visible").count(), 1);
    await page.locator("#inventory-content > details:visible > summary").click();
    await expectText(page.locator("#inventory-content [data-charge-count]"), "2 uses left");
    await page.locator("#gold-amount").fill("27");
    await page.reload();
    assert.equal(await page.locator("#gold-amount").inputValue(), "27");

    await page.getByRole("button", {name: "Journal", exact: true}).click();
    await page.getByLabel("Session notes").fill("Synthetic table note");
    await page.getByRole("button", {name: "Add journal entry"}).click();
    const journal = page.locator("#journal-entry-form");
    await journal.getByLabel("Title").fill("Harbor encounter");
    await journal.getByLabel("Date").fill("2026-11-24");
    await journal.getByLabel("Entry", {exact: true}).fill("Signals used.");
    await journal.getByLabel("Link to activity or a sheet reference").selectOption({label: "Spent 1 · Signal Rod charges"});
    await journal.getByRole("button", {name: "Save entry"}).click();
    await page.getByLabel("Search journal").fill("Harbor");
    await page.locator("#journal-entries").getByRole("button", {name: "Spent 1 · Signal Rod charges"}).click();
    await expectText(page.locator("#encounter-log li"), "Signal Rod charges");
    await page.locator("#encounter-activity").getByRole("button", {name: "Close"}).click();

    const backup = path.join(directory, "backup.json");
    await page.getByRole("button", {name: "Session", exact: true}).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", {name: "Export tracker backup"}).click();
    await (await download).saveAs(backup);
    const moved = path.join(directory, "moved-save.dnd5e");
    fs.copyFileSync(save, moved);
    const fresh = await newProfile(path.join(directory, "fresh-chrome-profile"));
    await fresh.goto(generate(moved, xml));
    await fresh.getByRole("button", {name: "Session", exact: true}).click();
    await fresh.locator("#import-session").setInputFiles({name: "broken.json", mimeType: "application/json", buffer: Buffer.from('{"version":42}')});
    await expectText(fresh.locator("#session-file-status"), "not a valid version 1 tracker backup");
    await fresh.locator("#import-session").setInputFiles(backup);
    await expectText(fresh.locator("#restore-session-summary"), "Current session");
    await fresh.getByRole("button", {name: "Replace current tracker session"}).click();
    await fresh.locator("#journal-page").waitFor();
    assert.equal(await fresh.getByLabel("Session notes").inputValue(), "Synthetic table note");
    await expectText(fresh.locator("#journal-entries"), "Harbor encounter");
    await fresh.getByRole("button", {name: "Inventory", exact: true}).click();
    assert.equal(await fresh.locator("#gold-amount").inputValue(), "27");
    console.log("Search, reconciliation, charged inventory, currency persistence, and backup relinking in a fresh profile passed.");

    const castPage = await newProfile();
    await castPage.goto(generate(fixture("infusion-attacks.dnd5e"), fixture("infusion-attacks.xml")));
    await castPage.locator(".settings-trigger").click();
    await castPage.getByLabel("Also track them in solo encounters").check();
    await castPage.locator("#sheet-settings").getByRole("button", {name: "Close"}).click();
    const ray = row(castPage, "Lens Ray").locator("[data-cast-spell]");
    await ray.press("Enter");
    await ray.waitFor();
    await castPage.waitForFunction(() => document.querySelector('[data-cast-spell][aria-label="Cast Lens Ray"]').disabled);
    await castPage.locator('#economy-chips [data-economy-chip="action"]').click();
    await ray.click();
    await encounterExtras(castPage); await castPage.getByRole("button", {name: "Activity", exact: true}).click();
    assert.equal(await castPage.locator("#encounter-log").getByText("Cast Lens Ray · cantrip").count(), 2);
    await castPage.locator("#encounter-activity").getByRole("button", {name: "Close"}).click();
    await castPage.locator("#undo-turn").click();
    await encounterExtras(castPage); await castPage.getByRole("button", {name: "Activity", exact: true}).click();
    assert.equal(await castPage.locator("#encounter-log").getByText("Cast Lens Ray · cantrip").count(), 1);
    await castPage.locator("#encounter-activity").getByRole("button", {name: "Close"}).click();
    await castPage.locator("#end-encounter").click();
    await castPage.getByLabel("Encounter title").fill("The Beacon Fight");
    await castPage.locator("#confirm-end-encounter").click();
    await castPage.locator("#start-encounter").click();
    await encounterExtras(castPage); await castPage.getByRole("button", {name: "Rosters and archive"}).click();
    await castPage.getByRole("button", {name: "The Beacon Fight"}).click();
    await expectText(castPage.locator("#encounter-log li"), "Cast Lens Ray · cantrip");
    console.log("Action economy, explicit override, zero-cost casting, undo, and archived activity passed.");

    const casting = await newProfile();
    await casting.goto(generate(fixture("combat-sheet.dnd5e"), xml));
    await row(casting, /^Flare$/).locator("[data-cast-spell]").click();
    const castForm = casting.locator("#cast-form");
    const chooseMethod = castForm.getByLabel("Casting method");
    await chooseMethod.selectOption("Spell slot:1");
    await expectText(casting.locator("#cast-cost"), "Cost: one Level 1 Spell slot");
    await castForm.getByRole("button", {name: "Confirm cast"}).click();
    await expectText(casting.locator("#active-concentration"), "Flare");
    const concentrationScroll = row(casting, "Scroll of Flare");
    await concentrationScroll.locator("[data-use]").click();
    await casting.getByRole("button", {name: "Keep current"}).click();
    await expectText(concentrationScroll.locator("[data-stack-count]"), "2 left");
    await concentrationScroll.locator("[data-use]").click();
    await casting.getByRole("button", {name: "Replace concentration"}).click();
    await expectText(concentrationScroll.locator("[data-stack-count]"), "1 left");
    await casting.locator("#show-unprepared").check();
    await casting.locator("#option-search").fill("Beacon Ritual");
    await row(casting, "Beacon Ritual").locator("[data-cast-spell]").click();
    assert.equal(await chooseMethod.inputValue(), "ritual");
    await expectText(casting.locator("#cast-cost"), "No slot or tracked uses");
    await castForm.getByRole("button", {name: "Confirm cast"}).click();
    await casting.locator("#option-search").fill("Flare");
    await row(casting, /^Flare$/).locator("[data-cast-spell]").click();
    await chooseMethod.selectOption("free");
    await castForm.getByLabel("Free-use pool").selectOption({label: "Signal Rod charges"});
    await expectText(casting.locator("#cast-cost"), "Cost: one use of Signal Rod charges");
    await castForm.getByRole("button", {name: "Confirm cast"}).click();
    await casting.locator("#option-search").fill("Signal Rod");
    await expectText(row(casting, "Signal Rod").locator("[data-option-badge]"), "2 uses left");
    const levelOneSlot = casting.locator("#encounter-resources li").filter({hasText: "Level 1 Spell slot"});
    await expectText(levelOneSlot, "2 / 3");
    console.log("Slot, ritual, free-use pool, and concentration replacement costs passed.");

    const progression = await newProfile();
    await progression.goto(generate(fixture("progression.dnd5e"), fixture("progression.xml")));
    await expectText(row(progression, "Static Arc").locator(".option-roll"), "3d8 lightning");
    await expectText(row(progression, "Cobalt Rays").locator(".option-roll"), "3 beams · 1d10 cold per beam");
    await row(progression, "Lantern Burst").locator("[data-cast-spell]").click();
    const slot = progression.locator("#cast-form [name=slot]");
    await expectText(progression.locator("#cast-roll-preview"), "Damage: 6d6 radiant");
    await slot.selectOption("Spell slot:4");
    await expectText(progression.locator("#cast-roll-preview"), "Damage: 7d6 radiant");
    await progression.locator("#cancel-cast").click();
    await row(progression, "Mend Wounds").locator("[data-cast-spell]").click();
    await slot.selectOption("Spell slot:3");
    await expectText(progression.locator("#cast-roll-preview"), "Healing: 6d4 + 3");
    await progression.locator("#cancel-cast").click();
    await progression.locator("#option-search").fill("Gust Step");
    await row(progression, "Gust Step").locator("[data-feature-use]").click();
    await progression.locator("#option-search").fill("Forceful Press");
    await row(progression, "Forceful Press").locator("[data-feature-use]").click();
    await expectText(progression.locator("#encounter-status"), "2 from Ki");
    const openPools = () => progression.locator("#show-all-resources").click();
    const poolsDialog = progression.locator("#all-resources");
    const closePools = () => poolsDialog.getByRole("button", {name: "Close"}).click();
    const resource = (name) => poolsDialog.locator("li").filter({has: progression.getByText(name, {exact: true})});
    await openPools();
    await expectText(resource("Ki"), "2 / 5");
    await closePools();
    await progression.locator("#undo-turn").click();
    await openPools();
    await expectText(resource("Ki"), "4 / 5");
    await closePools();
    await progression.locator("#option-search").fill("Restoring Touch");
    await row(progression, "Restoring Touch").locator("[data-feature-use]").click();
    await progression.getByLabel("Points to spend").fill("4");
    await progression.locator("#feature-amount-form").getByRole("button", {name: "Record use"}).click();
    await openPools();
    await expectText(resource("Restoring Touch"), "2 / 6");
    await closePools();
    console.log("Character-level cantrips, slot previews, shared Ki, and variable healing-pool spending passed.");

    const tactics = await newProfile();
    await tactics.goto(generate(fixture("combat-options.dnd5e"), fixture("combat-options.xml")));
    await tactics.locator(".settings-trigger").click();
    await tactics.getByLabel("Also track them in solo encounters").check();
    await tactics.locator("#sheet-settings").getByRole("button", {name: "Close"}).click();
    const blade = row(tactics, "Practice Blade").locator("[data-record-attack]");
    const bow = row(tactics, "Practice Bow").locator("[data-record-attack]");
    await blade.click();
    await expectText(tactics.locator("#attack-sequence"), "Attack 1 of 2");
    await tactics.getByRole("button", {name: "Record hit"}).click();
    await tactics.getByRole("button", {name: "Add Sneak Attack · 3d6"}).click();
    await tactics.getByRole("button", {name: "Drive Back", exact: true}).click();
    await expectText(tactics.locator("#undo-label"), "recording Drive Back");
    await bow.click();
    await expectText(tactics.locator("#last-attack"), "Practice Bow");
    await expectText(tactics.locator("#attack-sequence"), "Attack 2 of 2");
    await tactics.getByRole("button", {name: "Record hit"}).click();
    assert.equal(await tactics.getByRole("button", {name: "Sneak Attack used"}).isDisabled(), true);
    assert.equal(await blade.isDisabled(), true);
    await tactics.locator("#next-turn").click();
    await tactics.getByRole("button", {name: "Record damage"}).click();
    await tactics.getByLabel("Incoming event").selectOption("attack");
    await tactics.locator("#reaction-reminders").getByRole("button", {name: "Cast Sudden Ward"}).click();
    await tactics.locator("#cast-form").getByRole("button", {name: "Confirm cast"}).click();
    await tactics.locator("#damage-dialog").getByRole("button", {name: "Cancel"}).click();
    await expectText(tactics.locator("#effect-list"), "+5 AC");
    await tactics.locator("#option-search").fill("Sudden Ward");
    await expectText(row(tactics, "Sudden Ward").locator(".reaction-trigger"), "hit by an attack");
    await tactics.locator("#option-search").fill("Guard Step");
    await expectText(row(tactics, "Guard Step").locator(".reaction-trigger"), "When a creature within 5 feet moves away from you");
    await tactics.locator("#next-turn").click();
    await tactics.locator("#effect-list").getByText("Sudden Ward").waitFor({state: "detached"});
    await tactics.locator("#option-search").fill("Charged Touch");
    await row(tactics, "Charged Touch").locator("[data-cast-spell]").click();
    await tactics.getByLabel("Target wears metal armor").check();
    await expectText(tactics.locator("#cast-roll-preview"), "Advantage on this attack");
    await tactics.locator("#cast-form").getByRole("button", {name: "Confirm cast"}).click();
    await expectText(tactics.locator("#encounter-status"), "Advantage on this attack");
    await tactics.locator("#next-turn").click();
    await tactics.locator("#option-search").fill("");

    await tactics.getByRole("button", {name: "Spell filters", exact: true}).click();
    await tactics.getByLabel("School", {exact: true}).selectOption("Enchantment");
    await tactics.getByLabel("Materials", {exact: true}).selectOption("yes");
    await tactics.getByRole("button", {name: "Done"}).click();
    assert.equal(await tactics.locator("#action-groups .option-row:visible").count(), 1);
    await row(tactics, "Rallying Light").locator("[data-cast-spell]").click();
    const tacticalCast = tactics.locator("#cast-form");
    await tacticalCast.getByLabel("Casting method").selectOption("Spell slot:2");
    await expectText(tactics.locator("#cast-roll-preview"), "Up to 4 targets");
    await expectText(tactics.locator("#cast-material-notice"), "10 gp");
    await tacticalCast.getByLabel("Combat Options Fixture", {exact: true}).check();
    await tacticalCast.getByRole("button", {name: "Confirm cast"}).click();
    await expectText(tactics.locator("#effect-list"), "+1d4 to attack rolls and saving throws");
    await tactics.locator("#effect-end-concentration").click();
    await tactics.locator("#effect-list").getByText("Rallying Light").waitFor({state: "detached"});
    await tactics.getByRole("button", {name: /Spell filters · On/}).click();
    await tactics.getByRole("button", {name: "Clear filters"}).click();
    await tactics.getByRole("button", {name: "Done"}).click();
    await tactics.locator("#next-turn").click();
    await row(tactics, "Radiant Column").locator("[data-cast-spell]").click();
    await tacticalCast.getByLabel("Combat Options Fixture", {exact: true}).check();
    await tacticalCast.getByRole("button", {name: "Confirm cast"}).click();
    await tactics.locator("#next-turn").click();
    await expectText(tactics.locator("#spell-turn-reminder"), "Radiant Column · Combat Options Fixture");
    await expectText(tactics.locator("#spell-turn-reminder"), "DC 15");

    await tactics.getByRole("button", {name: "Inventory", exact: true}).click();
    await tactics.locator("#inventory-content summary").filter({hasText: "Ember Wand"}).click();
    const wand = tactics.locator("#inventory-content details").filter({hasText: "Ember Wand"});
    const activateWand = wand.getByRole("button", {name: "Activate Ember Wand"});
    assert.equal(await activateWand.isDisabled(), true);
    await wand.getByLabel("Attuned", {exact: true}).check();
    await activateWand.click();
    await expectText(wand.locator("[data-charge-count]"), "2 uses left");
    const clock = tactics.locator(".effect-time-controls");
    await clock.locator("summary").click();
    await clock.getByRole("button", {name: "Advance to dawn"}).click();
    await tactics.getByLabel("Hours until dawn").fill("1");
    await tactics.getByRole("button", {name: "Record dawn"}).click();
    await expectText(wand.locator("[data-charge-count]"), "3 uses left");
    await tactics.locator("#combat-nav").click();
    await tactics.locator("#undo-turn").click();
    await tactics.getByRole("button", {name: "Inventory", exact: true}).click();
    await expectText(wand.locator("[data-charge-count]"), "2 uses left");
    console.log("Extra Attack and riders, reaction prompts, situational advantages, spell filters and targets, attunement, and dawn recharge passed.");

    const referencePage = await newProfile();
    await referencePage.goto(generate(fixture("pugilist-reference.dnd5e"), fixture("pugilist-reference.xml")));
    await referencePage.getByRole("button", {name: "Inventory", exact: true}).click();
    await referencePage.getByLabel("Filter inventory").selectOption("equipped");
    await referencePage.locator("#inventory-content > details:visible > summary").click();
    await referencePage.getByRole("button", {name: "Table notes · Sparring Strike", exact: true}).click();
    const notes = referencePage.locator("#reference-notes-form");
    await notes.locator("textarea").fill("Check the wraps before sparring.");
    await notes.getByRole("button", {name: /save/i}).click();
    await referencePage.locator("#combat-nav").click();
    await row(referencePage, "Sparring Strike").locator("[data-inspect]").click();
    await expectText(referencePage.locator("#option-inspector .reference-note"), "Check the wraps before sparring.");
    await referencePage.getByRole("button", {name: "Features & Traits", exact: true}).click();
    const featureEditor = referencePage.locator("#feature-group-editor");
    for (const name of ["First custom group", "Second custom group"]) {
      await referencePage.getByRole("button", {name: "Organize groups"}).click();
      await featureEditor.locator("#feature-group-choice").selectOption("");
      await featureEditor.getByLabel("Group name").fill(name);
      await featureEditor.getByRole("button", {name: "Save group"}).click();
    }
    await referencePage.getByRole("button", {name: "Organize groups"}).click();
    await featureEditor.getByRole("button", {name: "Move group up"}).click();
    const ordered = await featureEditor.locator("#feature-group-choice option").allTextContents();
    assert.deepEqual(ordered.slice(1), ["Second custom group", "First custom group"]);
    console.log("Linked gear and attack notes, equipped filtering, and custom feature group order passed.");

    const reportPage = await newProfile();
    await reportPage.goto(generate(fixture("versioned.dnd5e")));
    await reportPage.getByRole("button", {name: "Session", exact: true}).click();
    await reportPage.getByRole("button", {name: "Import report", exact: true}).click();
    await expectText(reportPage.locator("#import-sources-summary"), "0 definition sources");
    await expectText(reportPage.locator("#import-missing-summary"), /[1-9]\d* unresolved definitions/);
    await reportPage.goto(generate(fixture("versioned.dnd5e"), fixture("versioned-base.xml"), fixture("versioned-custom.xml")));
    await reportPage.getByRole("button", {name: "Session", exact: true}).click();
    await reportPage.getByRole("button", {name: "Import report", exact: true}).click();
    await reportPage.locator("#import-sources-summary").click();
    await expectText(reportPage.locator("#import-sources li"), "versioned-custom.xml · version 2.1");
    assert.ok((await row(reportPage, "Beacon").textContent()).includes("60 feet"));

    if (process.env.AURORA_TEST_LAUNCHER_WORKSPACE) {
      const isolated = path.resolve(process.env.AURORA_TEST_LAUNCHER_WORKSPACE);
      const previews = path.join(isolated, "Aurora Combat Tracker", "Previews");
      const previewFiles = fs.readdirSync(previews).filter((file) => file.endsWith(".html"));
      assert.equal(previewFiles.length, 1, "Use the launcher with a single isolated synthetic preview");
      const preview = path.join(previews, previewFiles[0]);
      const stagedSave = path.join(isolated, "review.dnd5e");
      const stagedXml = path.join(isolated, "review.xml");
      const saveBefore = fs.readFileSync(stagedSave, "utf8");
      const xmlBefore = fs.readFileSync(stagedXml, "utf8");
      assert.match(saveBefore, /Clockwork Kin/);
      assert.match(xmlBefore, /Synthetic Test Content/);
      const launched = await newProfile();
      const session = launched.locator("#session-files");
      const openSession = () => launched.getByRole("button", {name: "Session", exact: true}).click();
      try {
        await launched.goto(pathToFileURL(preview).href);
        await launched.locator("#next-turn").click();
        await expectText(launched.locator("#round-number"), "Round 2");
        const beforeName = await launched.locator("h1").innerText();
        const nextName = beforeName === "Rowan Refresh Fixture" ? "Rowan Second Refresh" : "Rowan Refresh Fixture";
        const nextCharges = nextName === "Rowan Refresh Fixture" ? 5 : 6;
        fs.writeFileSync(stagedSave, saveBefore.replace("Rowan &amp; Co.", nextName));
        fs.writeFileSync(stagedXml, xmlBefore.replace("</elements>", `<element id="ID_TEST_ITEM_ROD" type="Magic Item" name="Signal Rod"><description><p>As an action, spend one charge for a custom light.</p></description><sheet usage="${nextCharges}/Day" /></element></elements>`));
        const beforeStage = fs.readFileSync(preview, "utf8");
        await openSession();
        await session.getByRole("button", {name: "Refresh from Aurora"}).click();
        await expectText(launched.locator("#import-changes li"), `Character name: ${beforeName} → ${nextName}`);
        await expectText(launched.locator("#import-changes li"), "Definition changed: Signal Rod");
        assert.equal(fs.readFileSync(preview, "utf8"), beforeStage);
        await launched.locator("#apply-aurora-refresh").click();
        await expectText(launched.locator("h1"), nextName);
        await expectText(launched.locator("#round-number"), "Round 2");
        const applied = fs.readFileSync(preview, "utf8");
        fs.writeFileSync(stagedXml, "<elements>");
        await openSession();
        await session.getByRole("button", {name: "Refresh from Aurora"}).click();
        await expectText(launched.locator("#aurora-refresh-status"), "Refresh failed");
        assert.equal(fs.readFileSync(preview, "utf8"), applied);
        await session.getByRole("button", {name: "Close"}).click();
        await launched.locator("#next-turn").click();
        await expectText(launched.locator("#round-number"), "Round 3");
        console.log("Launcher-backed refresh staged and applied changed save and XML, and malformed XML preserved the sheet and progress.");
      } finally {
        fs.writeFileSync(stagedSave, saveBefore);
        fs.writeFileSync(stagedXml, xmlBefore);
      }
    }

    const layoutSave = path.join(directory, "populated.dnd5e");
    fs.writeFileSync(layoutSave, original);
    const layoutUrl = generate(layoutSave, xml);
    const layoutKey = path.basename(new URL(layoutUrl).pathname, ".html");
    const legacy = {
      focus: {sequence: 2, active: {id: 1, name: "Flare", label: "1 minute", remaining: 42}, pending: [{id: 2, damage: 6, dc: 10}]},
      companions: {sequence: 4, seen: [], owner: 12, cards: [
        {id: 1, name: "Eldritch Cannon — Force Ballista", maxHp: 15, currentHp: 15, duration: "1 hour", rounds: 600, turn: "owner"},
        {id: 2, name: "Spectral owl", currentHp: 4, maxHp: 4, turn: "separate", initiative: 10},
        {id: 3, name: "Moth", currentHp: 6, maxHp: 6, turn: "owner"},
      ]},
      progress: {round: 3, current: "owner", sequence: 8, hp: {current: 12, max: 24}, used: {},
        actors: [{id: 1, name: "Layout opponent", score: 7, hp: 20}],
        resources: Array.from({length: 9}, (_, index) => ({key: "Custom:" + index, name: "Synthetic resource " + index, capacity: 4, recovery: "short"})),
        effects: Array.from({length: 4}, (_, index) => ({id: index + 2, name: "Pending effect " + index, target: "owner", kind: "rounds", remaining: 10})),
      },
    };
    const seedLegacy = (page) => page.addInitScript(({key, legacy}) => {
      if (location.protocol !== "file:" || localStorage.getItem("review-fixture-seeded")) return;
      localStorage.setItem("review-fixture-seeded", "yes");
      localStorage.setItem(`aurora-combat-encounter-v1:${key}`, JSON.stringify(legacy));
      localStorage.setItem(JSON.stringify(["aurora-session-writing", key, "Journal"]), "Legacy journal text");
    }, {key: layoutKey, legacy});
    const compact = await newProfile();
    await seedLegacy(compact);
    await compact.goto(layoutUrl);
    await expectText(compact.locator("#round-number"), "Round 3");
    await expectText(compact.locator("#concentration-save-prompt"), "Constitution save DC 10");
    // The pending check also pops up as a reminder with the DC; Later leaves it in the box.
    await expectText(compact.locator("#concentration-reminder-dc"), "Constitution save DC 10");
    await compact.locator("#concentration-reminder").getByRole("button", {name: "Later", exact: true}).click();
    await expectText(compact.locator("#companion-cards summary").filter({hasText: "Force Ballista"}), "1 h left");
    const actionList = compact.locator("#all-options");
    const beforeManage = await actionList.boundingBox();
    const manage = compact.locator("#concentration-actions summary");
    const duration = await compact.locator("#concentration-duration").boundingBox();
    const managePosition = await manage.boundingBox();
    assert.ok(Math.abs(duration.y - managePosition.y) < duration.height);
    await manage.press("Enter");
    await compact.locator("#concentration-time").waitFor();
    assert.deepEqual(await actionList.boundingBox(), beforeManage);
    await manage.press("Escape");
    await compact.locator("#concentration-time").waitFor({state: "hidden"});
    const attackSize = await row(compact, /^Signal Bow$/).locator("[data-record-attack]").boundingBox();
    const castSize = await row(compact, /^Flare$/).locator("[data-cast-spell]").boundingBox();
    assert.equal(attackSize.width, castSize.width);
    assert.equal(attackSize.height, castSize.height);
    const headerTools = await compact.locator(".command-tools").boundingBox();
    const layoutButton = await compact.getByRole("button", {name: "Layout", exact: true}).boundingBox();
    // Find, Session, the Settings gear and Layout fit in a narrow group at the right.
    assert.ok(headerTools.x > 1000 && headerTools.width < 340);
    assert.equal(headerTools.x + headerTools.width, layoutButton.x + layoutButton.width);
    const height = await compact.locator("#all-options").evaluate((list) => list.clientHeight);
    assert.ok(height > 203, `Expected more than 203px of actions, saw ${height}px`);
    await compact.screenshot({path: path.join(directory, "compact-1536x745.png")});
    await compact.getByRole("button", {name: "Journal", exact: true}).click();
    assert.equal(await compact.getByLabel("Session journal").inputValue(), "Legacy journal text");
    await compact.locator("#combat-nav").click();
    await compact.locator("#key-stats [data-dialog=heal-owner]").click();
    await compact.getByLabel("Healing", {exact: true}).fill("6");
    await compact.getByRole("button", {name: "Apply healing"}).click();
    await expectText(compact.locator("#key-stats [data-stat=hp]"), "18 / 24");
    await compact.locator("#undo-turn").click();
    await expectText(compact.locator("#key-stats [data-stat=hp]"), "12 / 24");
    await compact.locator("#combat-turn-order").getByRole("button", {name: "HP: Layout opponent"}).click();
    await compact.locator("#combatant-hp").getByLabel("HP adjustment").fill("4");
    await compact.locator("#combatant-hp").getByRole("button", {name: "Damage", exact: true}).click();
    await expectText(compact.locator("#combat-turn-order"), "16 HP");
    await compact.locator("#undo-turn").click();
    await expectText(compact.locator("#combat-turn-order"), "20 HP");
    const divider = compact.locator("#inspector-divider");
    await divider.press("ArrowLeft");
    const width = await compact.locator("#all-options").evaluate((list) => list.clientWidth);
    await compact.reload();
    assert.equal(await compact.locator("#all-options").evaluate((list) => list.clientWidth), width);
    console.log(`Legacy encounter and journal, HP controls, and inspector persistence passed. Compact action list at 1536 × 745: ${height}px.`);

    for (const [displayWidth, displayHeight] of [[1920, 1080], [2560, 1440]]) {
      for (const scale of [1, 1.25]) {
        const viewport = {width: Math.floor(displayWidth / scale), height: Math.floor(displayHeight / scale)};
        const context = await browser.newContext({viewport, deviceScaleFactor: scale});
        try {
          const vp = await context.newPage();
          vp.on("pageerror", (error) => errors.push(error.message));
          await seedLegacy(vp);
          await vp.goto(layoutUrl);
          const measurements = await vp.evaluate(() => Object.fromEntries([
            "#key-stats", "#concentration-save", "#current-turn", "#next-turn", "#undo-turn", "#all-options", "#inspector-divider",
          ].map((selector) => {
            const {top, right, bottom, width, height} = document.querySelector(selector).getBoundingClientRect();
            return [selector, {fits: top >= 0 && right <= innerWidth && bottom <= innerHeight && width > 0 && height > 0, height}];
          })));
          for (const [selector, {fits}] of Object.entries(measurements)) assert.equal(fits, true, `${selector} must fit ${displayWidth}×${displayHeight} at ${scale}`);
          console.log(`${displayWidth} × ${displayHeight} at ${scale * 100}% viewport approximation: ${Math.round(measurements["#all-options"].height)}px action list.`);
        } finally { await context.close(); }
      }
    }

    assert.deepEqual(errors, []);
  } finally {
    for (const context of overrides) await context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
