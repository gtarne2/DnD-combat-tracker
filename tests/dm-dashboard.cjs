const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function reviewDashboard({launch, pageFor, open, api}) {
  const rawMarker = "PrivateRawSaveP05-5023";
  const journalMarker = "PrivateJournalP05-8371";
  const privateMarkers = new RegExp(rawMarker + "|" + journalMarker);
  const dm = await launch("dm","dm");
  assert.equal(fs.existsSync(path.join(dm.data,"review.dnd5e")),false);
  const dmPage = await pageFor("dm",dm);
  await dmPage.getByRole("heading",{name:"DM dashboard"}).waitFor();
  const published = [];
  const diagnostics = [];
  const views = [];
  dmPage.on("response", response => {
    if (response.url() === dm.url + "/state") views.push(response.text().catch(() => ""));
  });
  const invite = (await (await api(dm,"invite")).json()).invite;
  let guest = await launch("guest","join",invite);
  const other = await launch("observer","join",invite);
  const guestPage = await pageFor("guest",guest);
  const otherPage = await pageFor("observer",other);
  for (const page of [dmPage,guestPage,otherPage]) {
    page.setDefaultTimeout(18000);
    page.on("pageerror", error => { diagnostics.push(error.stack); console.error(error.stack); });
    page.on("console", message => diagnostics.push(message.text()));
  }
  guestPage.on("request", request => {
    if (request.url().endsWith("/publish")) published.push(request.postData());
  });
  const state = async helper => (await api(helper,"state")).json();
  const id = (await state(guest)).self_id;
  const otherId = (await state(other)).self_id;
  const row = member => dmPage.locator('#dm-party-list [data-member="' + member + '"]');
  const inspect = member => row(member).getByRole("button",{name:/Inspect/});
  const dialog = dmPage.locator("#dm-inspector");
  const role = page => page.getByLabel("Share with this DM");
  const closeParty = page => page.locator("#session-files").getByRole("button",{name:"Close",exact:true}).click();
  const showParty = async page => {
    await page.getByRole("button",{name:"Session",exact:true}).click();
    const details = page.locator("#party-controls details").first();
    if (!await details.evaluate(el=>el.open)) await details.locator("summary").click();
  };
  const fact = (name, value) => dialog.locator("dl > div").filter({has:dmPage.getByText(name,{exact:true})})
    .getByText(String(value),{exact:true}).waitFor();
  await row(id).getByText("Name only").waitFor();
  await row(otherId).getByText("Name only").waitFor();
  assert.equal(await role(guestPage).inputValue(),"party_name_only");
  assert.equal(await role(otherPage).inputValue(),"party_name_only");
  await closeParty(guestPage);
  await guestPage.getByRole("button",{name:"Journal",exact:true}).click();
  await guestPage.getByLabel("Session journal").fill(journalMarker);
  assert.match(fs.readFileSync(guest.preview,"utf8"),new RegExp(rawMarker));
  await showParty(guestPage);
  await role(guestPage).selectOption("character_details");
  await role(otherPage).selectOption("vitals");
  try {
    await inspect(id).waitFor({timeout:8000});
    await inspect(otherId).waitFor({timeout:8000});
  } catch (error) {
    const statuses = await Promise.all([guestPage,otherPage].map(page=>page.locator("#party-controls fieldset p").textContent()));
    throw new Error(statuses.join(" | "), {cause:error});
  }

  await inspect(otherId).click();
  await dialog.getByRole("heading",{name:"Vitals"}).waitFor();
  assert.equal(await dialog.getByRole("heading",{name:"Inventory"}).count(),0);
  await dialog.getByRole("button",{name:"Close"}).click();

  await inspect(id).click();
  for (const heading of ["Ability scores","Saving throws","Skills","Attacks","Spells","Features","Inventory","Resources remaining"]) {
    await dialog.getByRole("heading",{name:heading,exact:true}).waitFor();
  }
  for (const attack of ["Signal Bow","Copper Sling","Glass Staff"]) {
    await dialog.getByRole("heading",{name:attack,exact:true}).waitFor();
  }
  await dialog.getByText(/Mark where the arrow lands/).waitFor();

  await closeParty(guestPage);
  await guestPage.locator("#combat-nav").click();
  await guestPage.getByRole("button",{name:"Set HP",exact:true}).click();
  const hpForm = guestPage.locator("#encounter-hp-form");
  await hpForm.locator("[name=current]").fill("11");
  await hpForm.locator("[name=max]").fill("25");
  await hpForm.locator("[name=temporary]").fill("4");
  await hpForm.locator("button[type=submit], button:not([type])").last().click();
  await fact("HP","11 / 25");
  await fact("Temp HP",4);
  await guestPage.getByRole("button",{name:"Layout",exact:true}).click();
  const stats = guestPage.locator("#stat-settings");
  await stats.locator("[name=ac]").fill("19");
  await stats.locator("[name=dex]").fill("+8");
  await stats.getByRole("button",{name:"Save stat overrides"}).click();
  await guestPage.locator("#layout-dialog").getByRole("button",{name:"Close",exact:true}).click();
  await fact("AC",19);
  await fact("Dexterity",8);
  const pools = guestPage.locator("#all-resources");
  await guestPage.getByRole("button",{name:"All pools"}).click();
  await pools.getByRole("button",{name:"Spend: Level 1 Spell slot",exact:true}).click();
  await pools.getByRole("button",{name:"Close",exact:true}).click();
  await fact("Level 1 Spell slot",2);
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  await row(id).getByText("11 / 25",{exact:true}).waitFor();
  await row(id).getByText("19",{exact:true}).waitFor();
  await dmPage.getByLabel("Show AC in overview").uncheck();
  assert.equal(await row(id).getByText("19",{exact:true}).count(),0);
  await dmPage.reload();
  assert.equal(await dmPage.getByLabel("Show AC in overview").isChecked(),false);
  await inspect(id).click();
  await fact("AC",19);

  const before = await state(dm);
  assert.equal(before.members.find(m=>m.member_id===id).inspection.sharing,"character_details");
  assert.equal(before.members.find(m=>m.member_id===otherId).inspection.sharing,"vitals");
  assert.doesNotMatch(JSON.stringify(await state(other)),/inspection|Signal Bow|effective_ac/);
  assert.doesNotMatch(JSON.stringify(await state(guest)),/inspection|Signal Bow|effective_ac/);
  const count = published.length;
  await guestPage.evaluate(() => {
    for (let n=0;n<20;n++) document.dispatchEvent(new Event("preview-encounter-change"));
  });
  await guestPage.waitForTimeout(500);
  assert.equal(published.length,count);

  await showParty(guestPage);
  await role(guestPage).selectOption("party_name_only");
  await dialog.waitFor({state:"hidden"});
  assert.equal(await dmPage.locator("#dm-inspector-content").textContent(),"");
  await row(id).getByText("Name only").waitFor();
  const after = await state(dm);
  assert.equal(after.members.find(m=>m.member_id===id).inspection,undefined);
  assert.doesNotMatch(JSON.stringify(after),/Signal Bow|"effective_ac":19/);
  assert.equal(after.members.find(m=>m.member_id===otherId).inspection.sharing,"vitals");
  assert.doesNotMatch(JSON.stringify([before,after,...published,...await Promise.all(views)]),privateMarkers);

  await role(guestPage).selectOption("character_details");
  await inspect(id).waitFor();
  await guest.stop();
  diagnostics.push(guest.logs());
  await row(id).getByText("Offline · stale",{exact:true}).waitFor();
  guest = await launch("guest","resume");
  await open(guestPage,guest);
  await row(id).getByText("Online",{exact:true}).waitFor();
  await inspect(id).click();
  await fact("AC",19);
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  guestPage.on("dialog", prompt=>prompt.accept());
  await guestPage.getByRole("button",{name:"Leave party"}).click();
  await row(id).waitFor({state:"detached"});
  assert.equal((await state(dm)).members.some(member=>member.member_id === id),false);

  await Promise.all([guest.stop(),other.stop(),dm.stop()]);
  for (const launcher of [dm,guest,other]) diagnostics.push(launcher.logs());
  assert.doesNotMatch(diagnostics.join("\n"),privateMarkers);
  const appData = path.join(dm.data,"Aurora Combat Tracker");
  const databases = fs.readdirSync(appData).filter(name=>name.startsWith("party.sqlite3"));
  assert.ok(databases.includes("party.sqlite3"));
  for (const file of databases) {
    assert.doesNotMatch(fs.readFileSync(path.join(appData,file)).toString(),/PrivateRawSaveP05|PrivateJournalP05|Signal Bow|effective_ac/);
  }
  console.log("Standalone DM dashboard, sharing tiers, live HP, overrides and resources, AC preference, redraw coalescing, downgrade, stale presence, resume, leave and privacy passed.");
};
