const assert = require("node:assert/strict");

module.exports = async function reviewActions({host, hostPage, guest, guestPage, invite, launch, pageFor, open, api}) {
  const third = await launch("observer", "join", invite);
  const thirdPage = await pageFor("observer", third);
  const state = async helper => (await api(helper, "state")).json();
  const guestId = (await state(guest)).self_id;
  const thirdId = (await state(third)).self_id;
  const room = (await state(host)).room_id;
  const remote = id => "party:" + room + ":" + id;
  const closeSession = page => page.locator("#session-files").getByRole("button", {name:"Close", exact:true}).click();
  const showSession = async page => {
    await page.getByRole("button", {name:"Session", exact:true}).click();
    if (!await page.locator("#party-controls details").first().evaluate(el => el.open)) await page.locator("#party-controls summary").click();
  };
  const offer = (page, source) => page.locator("#party-controls article").filter({hasText:source});
  const row = (page, name) => page.locator("#action-groups .option-row").filter({has:page.locator(".option-title", {hasText:name})}).first();
  const progress = page => page.evaluate(() => previewEncounter.current().progress);
  for (const page of [hostPage, guestPage, thirdPage]) {
    page.setDefaultTimeout(12000);
    page.on("pageerror", error => console.error("Sheet script:", error.message));
    await page.evaluate(() => previewEncounter.transact(draft => {
      const p = draft.progress ||= previewEncounter.emptyProgress();
      p.hp = {max:20, current:10, temporary:0};
      return true;
    }));
  }
  await hostPage.waitForFunction(() => partyActions.members().length === 2);
  await closeSession(hostPage);
  await hostPage.evaluate(() => previewEncounter.transact(draft => {
    draft.companions = {cards:[{id:1, name:"Eldritch Cannon - Protector", currentHp:12, maxHp:12,
      remaining:10, timerUnit:"rounds", turn:"owner"}], sequence:1, seen:[], owner:null};
    draft.progress.economyEnabled = {owner:true};
    return true;
  }));

  let holdThird = true;
  const tempRoute = route => {
    const cmd = route.request().postDataJSON().command;
    return holdThird && cmd.recipient === thirdId && cmd.effect?.kind === "temporary_hp" ? route.abort() : route.continue();
  };
  await hostPage.context().route("**/offer",tempRoute);
  const protector = hostPage.locator("#quick-items").getByRole("button", {name:"Activate Protector", exact:true});
  await protector.click();
  const form = hostPage.locator("#protector-form");
  await form.locator("[value='1']").check();
  for (const id of [guestId, thirdId]) await form.locator("input[value='" + remote(id) + "']").check();
  await form.getByLabel("Rolled temporary HP").fill("7");
  await form.getByRole("button", {name:"Activate and apply HP"}).click();
  await offer(guestPage,"Protector").getByRole("button",{name:"Accept"}).click();
  await offer(guestPage,"Protector").getByText(/Accepted$/).waitFor();
  assert.equal((await state(third)).offers.length,0);
  await hostPage.waitForFunction(() => Object.keys(previewEncounter.delivery().outbox || {}).length === 1);
  holdThird = false;
  await hostPage.context().unroute("**/offer",tempRoute);
  await offer(thirdPage,"Protector").getByRole("button",{name:"Decline"}).click();
  await showSession(hostPage);
  await offer(hostPage,"Protector").getByText(/Accepted$/).waitFor();
  await offer(hostPage,"Protector").getByText(/Declined$/).waitFor();
  await offer(hostPage,"Protector").getByRole("button",{name:"Request reversal"}).click();
  await offer(guestPage,"Protector").getByText(/sender requests a correction/).waitFor();
  const protectOffers = (await state(host)).offers.filter(o => o.source.includes("Protector"));
  assert.equal(protectOffers.length,2);
  assert.equal(new Set(protectOffers.map(o => o.action_id)).size,1);
  assert.equal((await progress(hostPage)).economyUsed.owner["bonus-action"],true);
  assert.equal(await hostPage.evaluate(() => previewEncounter.current().companions.cards[0].temporary),7);
  assert.equal((await progress(guestPage)).hp.temporary,7);
  assert.equal((await progress(thirdPage)).hp.temporary,0);
  console.log("Quick Actions Protector spent one bonus action for a companion and two independent decisions.");

  await closeSession(hostPage);
  const sendIds = [];
  let release = false;
  await hostPage.context().route("**/offer", async route => {
    const body = route.request().postDataJSON();
    if (body.command.source === "Mend Wounds") {
      sendIds.push(body.command_id);
      if (!release) {
        await route.fetch();
        return route.abort();
      }
    }
    return route.continue();
  });
  const cast = hostPage.locator("#cast-form");
  async function openHeal() {
    await row(hostPage,"Mend Wounds").locator("[data-cast-spell]").click();
    await cast.locator("input[value='" + remote(guestId) + "']").check();
    await cast.getByLabel("HP per selected target").fill("4");
  }
  await openHeal();
  await hostPage.evaluate(() => {
    window.savedWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("aurora-combat-encounter-v1:")) throw new DOMException("Storage unavailable","QuotaExceededError");
      return window.savedWrite.call(this,key,value);
    };
  });
  await cast.getByRole("button",{name:"Confirm cast"}).click();
  await hostPage.waitForFunction(() => document.querySelector("#encounter-status").textContent.includes("Could not save the party action"));
  assert.equal((await progress(hostPage)).used["Spell slot:1"] || 0,0);
  assert.equal((await progress(hostPage)).economyUsed.owner.action,undefined);
  assert.equal((await state(host)).offers.filter(o=>o.source === "Mend Wounds").length,0);
  await hostPage.evaluate(() => {Storage.prototype.setItem = window.savedWrite;});
  await row(hostPage,"Mend Wounds").locator("[data-cast-spell]").click();
  await cast.locator("input[value='" + remote(guestId) + "']").check();
  await cast.getByLabel("HP per selected target").fill("4");
  await cast.getByRole("button",{name:"Confirm cast"}).click();
  await offer(guestPage,"Mend Wounds").getByRole("button",{name:"Accept"}).click();
  await guestPage.waitForFunction(() => previewEncounter.current().progress.hp.current === 14);
  await hostPage.reload();
  release = true;
  await hostPage.waitForFunction(() => !Object.keys(previewEncounter.delivery().outbox || {}).length);
  assert.ok(sendIds.length >= 2);
  assert.equal(new Set(sendIds).size,1);
  assert.equal((await state(host)).offers.filter(o=>o.source === "Mend Wounds").length,1);
  assert.equal((await progress(hostPage)).used["Spell slot:1"],1);
  console.log("Combat healing cast survived response loss and reload with one slot and one heal.");

  await hostPage.evaluate(() => encounterTracker.update(p => {p.economyEnabled.owner = false; return true;}));
  await row(hostPage,"Restoring Touch").locator("[data-feature-use]").click();
  const pool = hostPage.locator("#feature-amount-form");
  await pool.locator("[name=recipient]").selectOption(remote(guestId));
  await pool.getByLabel("Points to spend").fill("3");
  await pool.getByRole("button",{name:"Record use"}).click();
  await offer(guestPage,"Restoring Touch").getByRole("button",{name:"Accept"}).click();
  await guestPage.waitForFunction(() => previewEncounter.current().progress.hp.current === 17);
  assert.equal((await progress(hostPage)).used["Feature:ID_TEST_FEATURE_HEALING_POOL"],3);
  console.log("Restoring Touch spent the selected points and healed its party recipient.");

  await hostPage.evaluate(() => previewEncounter.transact(draft => {
    const p = draft.progress;
    (p.abilities ||= []).push({id:++p.sequence, name:"Ember rune", kind:"imbuement", active:true, attackBonus:2, damageBonus:1, reset:"short"});
    return true;
  }));
  const source = hostPage.locator("#ability-list article").filter({hasText:"Ember rune"});
  const assign = source.getByRole("combobox",{name:"Party assignment for Ember rune"});
  await source.locator("summary").click();
  await assign.selectOption(remote(guestId) + "/weapon");
  const incoming = offer(guestPage,"Ember rune");
  await incoming.getByLabel("Your weapon attack").selectOption({label:"Copper Blade"});
  await incoming.getByRole("button",{name:"Accept"}).click();
  await incoming.getByText(/Accepted$/).waitFor();
  const adjusted = name => row(guestPage,name).locator(".option-roll").textContent();
  assert.match(await adjusted("Copper Blade"),/\+8.*1d8\+4/);
  assert.match(await adjusted("Spare Hammer"),/\+4.*1d6\+1/);
  const wire = JSON.stringify(await state(host));
  assert.doesNotMatch(wire,/Copper Blade|Spare Hammer|copper-blade|spare-hammer/);
  // Replace the existing assignment. The new recipient chooses a single spell.
  await assign.selectOption(remote(thirdId) + "/spell");
  const newGrant = offer(thirdPage,"Ember rune");
  await newGrant.getByLabel("Your spell attack").selectOption({label:"Lens Ray"});
  await newGrant.getByRole("button",{name:"Accept"}).click();
  await newGrant.getByText(/Accepted$/).waitFor();
  assert.match(await row(thirdPage,"Lens Ray").locator(".option-roll").textContent(),/\+9/);
  assert.match(await row(thirdPage,"Wizard Bolt").locator(".option-roll").textContent(),/\+5/);
  await incoming.getByText(/Ended$/).waitFor();
  await guestPage.waitForFunction(() => !Object.keys(previewEncounter.current().progress.partyGrants).length);
  assert.match(await adjusted("Copper Blade"),/\+6.*1d8\+3/);
  await hostPage.locator("[data-dialog=rest-picker]").first().click();
  await hostPage.locator("#rest-picker [data-rest=short]").click();
  await hostPage.locator("#rest-form button:not([type=button])").last().click();
  await newGrant.getByText(/Ended$/).waitFor();
  await thirdPage.waitForFunction(() => !Object.keys(previewEncounter.current().progress.partyGrants || {}).length);
  assert.match(await row(thirdPage,"Lens Ray").locator(".option-roll").textContent(),/\+7/);
  await guestPage.reload();
  assert.equal((await progress(guestPage)).activity.filter(e=>e.label === "Ember rune ended").length,1);
  console.log("Custom grant changed only the privately selected weapon, ended once, and disclosed no inventory.");

  // The third player grants an imported infusion while the guest helper is offline.
  await guest.stop();
  await closeSession(thirdPage);
  const infusionPanel = thirdPage.locator("#known-infusion-panel");
  await infusionPanel.locator(":scope > summary").click();
  await infusionPanel.getByRole("button",{name:"Activate Enhanced Arcane Focus"}).click();
  const focus = infusionPanel.getByLabel("Party assignment for Enhanced Arcane Focus");
  await infusionPanel.locator("summary").filter({hasText:"Enhanced Arcane Focus"}).click();
  await focus.selectOption(remote(guestId) + "/spell");
  await showSession(thirdPage);
  await offer(thirdPage,"Enhanced Arcane Focus").getByText(/Pending$/).waitFor();
  await closeSession(thirdPage);
  await infusionPanel.getByRole("button",{name:"Deactivate Enhanced Arcane Focus"}).click();
  await showSession(thirdPage);
  await offer(thirdPage,"Enhanced Arcane Focus").getByText(/Ended$/).waitFor();
  guest = await launch("guest","resume");
  await open(guestPage,guest);
  await offer(guestPage,"Enhanced Arcane Focus").getByText(/Ended$/).waitFor();
  assert.equal(await offer(guestPage,"Enhanced Arcane Focus").getByRole("button",{name:"Accept"}).count(),0);
  assert.equal(Object.keys((await progress(guestPage)).partyGrants || {}).length,0);
  console.log("Offline recipient resumed with the ended infusion and no stale acceptance control.");
};
