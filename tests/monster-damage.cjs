const assert = require("node:assert/strict");
const fs = require("node:fs");
const {randomUUID} = require("node:crypto");
const {setTimeout:delay} = require("node:timers/promises");

module.exports = async function monsterDamage({launch,pageFor,open,api}) {
  const dm = await launch("dm","dm");
  const dashboard = await pageFor("dm",dm,{localOnly:true});
  const invite = (await (await api(dm,"invite")).json()).invite;
  let guest = await launch("guest","join",invite);
  const observer = await launch("observer","join",invite);
  let sheet = await pageFor("guest",guest,{localOnly:true});
  const other = await pageFor("observer",observer,{localOnly:true});
  const context = sheet.context();
  const button = name => dashboard.getByRole("button",{name,exact:true});
  const state = async helper => {
    const response = await api(helper,"state");
    assert.ok(response.ok,await response.clone().text());
    return response.json();
  };
  const errors = [];
  const watch = page => page.on("pageerror", error => errors.push(error.message));
  [dashboard,sheet,other].forEach(watch);
  async function waitFor(read,check,label) {
    const end = Date.now()+18000;
    do {
      const value = await read();
      if (check(value)) return value;
      await delay(100);
    } while (Date.now() < end);
    assert.fail(label + " · " + errors.join(", "));
  }
  const post = (helper, route, body) => fetch(helper.url+"/"+route,{
    method:"POST",headers:{origin:"null"},body:JSON.stringify(body)
  });
  async function editBody(edit) {
    const view = await state(dm);
    return {room_id:view.room_id,command_id:randomUUID(),
      command:{encounter_id:view.combat.id,expected_revision:view.combat.revision,edit}};
  }
  const offerCommand = (helper,room,kind,id) => post(helper,"offer",{
    room_id:room,command_id:randomUUID(),command:{kind,offer_id:id}
  });
  const offerRow = (page, id) => page.locator('#party-controls article[data-offer-id="' + id + '"]');
  const act = (page, id, name) => offerRow(page,id).getByRole("button",{name,exact:true}).click();
  const status = (id, expected) => waitFor(()=>state(dm),s=>s.offers.find(o=>o.offer_id===id)?.status===expected,expected);
  const current = page => page.evaluate(() => {
    const state = previewEncounter.current();
    const hp = encounterTracker.hp(state);
    return {hp:hp ? [hp.current,hp.temporary || 0] : null,active:state.focus.active?.name || null,
      pending:state.focus.pending.map(p=>[p.damage,p.dc]),
      receiptIds:Object.keys(previewEncounter.delivery().receipts),
      damageLogs:(state.progress?.activity || []).filter(entry=>entry.kind==="damage").length};
  });
  async function prepare(page, hp, temp, rules = "2014") {
    await page.evaluate(async ({hp,temp,rules}) => {
      await previewEncounter.transact(state => {
        const progress = state.progress ||= previewEncounter.emptyProgress();
        progress.hp = {current:hp,max:100,temporary:temp};
        state.focus.sequence += 1;
        state.focus.rules = rules;
        state.focus.active = {id:state.focus.sequence,name:"Synthetic Ward",label:"Concentration",remaining:null};
        state.focus.pending = [];
        return true;
      });
    }, {hp,temp,rules});
  }
  async function expect(page, hp, pending, active = "Synthetic Ward") {
    const value = await waitFor(()=>current(page),v=>JSON.stringify([v.hp,v.pending,v.active])===
      JSON.stringify([hp,pending,active]),"Expected " + JSON.stringify({hp,pending,active}));
    return value;
  }
  const playerId = (await state(guest)).self_id;
  const observerId = (await state(observer)).self_id;
  const fallback = process.argv.includes("--fallback-writer");
  assert.equal(await sheet.evaluate(()=>Boolean(navigator.locks)),!fallback);
  const submit = await post(observer,"initiative",await editBody({kind:"submit",score:10,companions:[]}));
  assert.equal(submit.status,200,await submit.text());
  const observerRow = (await state(dm)).combat.rows[0].id;

  await button("Add enemy").click();
  const enemy = dashboard.locator("#dm-enemy-form");
  await enemy.getByLabel("Private name").fill("Private Juniper Mill");
  await enemy.getByLabel("Player alias").fill("Gray silhouette");
  await enemy.locator("[name=score]").fill("30");
  await button("Save enemy").click();
  await enemy.waitFor({state:"hidden"});
  const enemyId = (await state(dm)).combat.rows.find(row=>row.enemy).id;
  await dashboard.locator("#dm-order").selectOption(enemyId);
  await button("Add hand-entered action").click();
  const dialog = dashboard.locator("#dm-action-dialog");
  await dialog.getByLabel("Action name").fill("Secret Roller Needles");
  await dialog.getByLabel("Rules text").fill("Throws individual paper needles.");
  await button("Add action").click();
  await dialog.waitFor({state:"hidden"});
  await button("Start / resume encounter").click();
  await button("Preview action").click();

  const cases = [
    {amount:8}, {amount:7}, {amount:8}, {amount:70}, {amount:70}, {amount:13,target:observerRow},
    {miss:true}, {amount:0}, {handled:true}, {amount:16}, {amount:11}, {amount:3}, {amount:4}, {amount:2}
  ];
  for (const [i, test] of cases.entries()) {
    if (i) await dialog.getByRole("button",{name:"Add strike or target"}).click();
    const strike = dialog.locator("fieldset").nth(i);
    await strike.getByLabel("Target",{exact:true}).selectOption(test.target || playerId);
    await strike.getByLabel("Physical roll total").fill("68311");
    await strike.getByLabel("Table outcome").selectOption(test.miss?"miss":"hit");
  }
  await dialog.getByLabel("Private note or ruling override").fill("Private table note for the damage test.");
  await button("Record action").click();
  await dialog.waitFor({state:"hidden"});
  const enemyRow = view => view.combat.rows.find(r=>r.id===enemyId);
  const recorded = enemyRow(await state(dm)).actions.history[0];
  const actionId = recorded.input.id;
  const strikes = recorded.input.strikes.map(s=>s.id);
  assert.equal(new Set(strikes).size,cases.length);
  assert.equal(recorded.recipients[strikes[0]],playerId);
  assert.equal(recorded.recipients[strikes[5]],observerId);
  const history = dashboard.locator('#dm-action-history li[data-action-id="' + actionId + '"]');
  await dashboard.locator("#dm-save [name=name]").fill("Recorded before delivery");
  await button("Save current roster").click();
  await dashboard.locator("#dm-saves option").filter({hasText:"Recorded before delivery"}).waitFor({state:"attached"});
  const finalize = (i, decision) => ({kind:"finalize_damage",action_id:actionId,strike_id:strikes[i],decision});
  async function resolve(i) {
    const {amount,handled} = cases[i];
    await history.getByRole("button",{name:"Resolve damage for strike " + (i+1),exact:true}).click();
    if (handled) await dialog.getByLabel("Damage result").selectOption("handled");
    else await dialog.getByLabel("Final damage amount").fill(String(amount));
    await button("Confirm damage result").click();
    if (i===0) {
      await dialog.getByText(/Retry the same entry/).waitFor();
      await button("Confirm damage result").click();
    }
    await dialog.waitFor({state:"hidden"});
    const host = await state(dm);
    const result = host.combat.damage[strikes[i]];
    assert.equal(result.action_id,actionId);
    assert.equal(result.result.kind,handled?"handled":amount===0?"no_damage":"sent");
    if (!amount) return;
    const offer = host.offers.find(offer=>offer.offer_id===result.result.offer_id);
    assert.equal(offer.action_id,strikes[i]);
    assert.equal(offer.effect.amount,amount);
    assert.equal(offer.source,"DM damage");
    return offer.offer_id;
  }

  await prepare(sheet,100,5);
  const backupEvent = sheet.waitForEvent("download");
  await sheet.getByRole("button",{name:"Export tracker backup"}).click();
  const baseline = fs.readFileSync(await (await backupEvent).path());

  let original, finalizeAttempts = 0;
  await dashboard.route("**/initiative",async route => {
    const body = route.request().postDataJSON();
    if (body.command.edit.kind !== "finalize_damage") return route.continue();
    if (!finalizeAttempts++) {
      original = body;
      const response = await route.fetch();
      assert.equal(response.status(),200,await response.text());
      return route.abort();
    }
    assert.deepEqual(body,original);
    return route.continue();
  });
  const first = await resolve(0);
  assert.equal(finalizeAttempts,2);
  await dashboard.unroute("**/initiative");
  const duplicate = await post(dm,"initiative",await editBody(finalize(0,{kind:"final",amount:8})));
  assert.ok(!duplicate.ok);
  const wrongSender = await post(guest,"initiative",await editBody(finalize(1,{kind:"final",amount:7})));
  assert.ok(!wrongSender.ok);
  const rawGuest = await post(guest,"offer",{room_id:(await state(dm)).room_id,command_id:randomUUID(),
    command:{kind:"send",recipient:observerId,source:"Raw damage",effect:{kind:"damage",amount:1}}});
  assert.ok(!rawGuest.ok);

  const otherTab = await context.newPage();
  watch(otherTab);
  await open(otherTab,guest);
  let ack = "blocked", ackAttempts = 0, ackLost = false;
  await context.route("**/offer", async route => {
    const request = route.request().postDataJSON().command;
    if (request.kind !== "accept" || request.offer_id !== first) return route.continue();
    ackAttempts++;
    if (ack === "blocked") return route.abort();
    if (!ackLost) {
      ackLost = true;
      const response = await route.fetch();
      assert.equal(response.status(),200,await response.text());
      return route.abort();
    }
    return route.continue();
  });
  for (const page of [sheet,otherTab]) {
    await offerRow(page,first).getByRole("button",{name:"Accept",exact:true}).waitFor();
  }
  await Promise.all([sheet,otherTab].map(page=>offerRow(page,first).getByRole("button",{name:"Accept",exact:true}).dispatchEvent("click")));
  const applied = await expect(sheet,[97,0],[[8,10]]);
  await expect(otherTab,[97,0],[[8,10]]);
  assert.equal(applied.damageLogs,1);
  assert.deepEqual(applied.receiptIds,[first]);
  assert.equal(await sheet.locator("#concentration-save-prompt").textContent(),"Constitution save DC 10 · 8 damage");
  await status(first,"claimed");
  ack = "allow";
  await status(first,"accepted");
  assert.ok(ackLost && ackAttempts>=2);
  await context.unroute("**/offer");
  await otherTab.close();

  await dashboard.getByText("Damage offers",{exact:true}).click();
  await act(dashboard,first,"Request reversal");
  await offerRow(sheet,first).getByText(/The sender requests a correction/).waitFor();
  await expect(sheet,[97,0],[[8,10]]);
  await sheet.locator("#session-files").getByRole("button",{name:"Close",exact:true}).click();
  await sheet.locator("#undo-turn").click();
  const undone = await expect(sheet,[100,5],[]);
  assert.deepEqual(undone.receiptIds,[first]);
  assert.equal(undone.damageLogs,0);
  await sheet.getByRole("button",{name:"Session",exact:true}).click();
  await openOffers(sheet);

  async function openOffers(page) {
    if (!await page.locator("#party-controls details").evaluate(el=>el.open)) {
      await page.locator("#party-controls summary").click();
    }
  }

  const second = await resolve(1);
  assert.notEqual(first,second);
  await prepare(sheet,100,10);
  await act(sheet,second,"Accept");
  await status(second,"accepted");
  await expect(sheet,[100,3],[[7,10]]);

  const lethal = await resolve(2);
  await prepare(sheet,3,0);
  await act(sheet,lethal,"Accept");
  await status(lethal,"accepted");
  await expect(sheet,[0,0],[],null);

  for (const [index,rules,dc] of [[3,"2014",35],[4,"2024",30]]) {
    const id = await resolve(index);
    await prepare(sheet,100,0,rules);
    await act(sheet,id,"Accept");
    await status(id,"accepted");
    await expect(sheet,[30,0],[[70,dc]]);
  }

  const unavailable = await resolve(5);
  assert.equal((await current(other)).hp,null);
  await act(other,unavailable,"Accept");
  await other.locator("#party-controls").getByText(/Set your HP/).waitFor();
  await status(unavailable,"pending");
  assert.deepEqual((await current(other)).receiptIds,[]);
  const observerView = await state(observer);
  const playerView = await state(guest);
  assert.deepEqual(observerView.offers.map(o=>o.offer_id),[unavailable]);
  assert.ok(playerView.offers.every(o=>o.recipient===playerId));
  for (const view of [observerView,playerView]) {
    assert.doesNotMatch(JSON.stringify(view),/Private Juniper Mill|Secret Roller Needles|68311|Private table note|legendary_left|damage_recipient|current_hp|temporary_hp/);
    assert.ok(!JSON.stringify(view).includes(actionId));
  }
  assert.ok(!JSON.stringify(observerView).includes(first));
  assert.ok(!JSON.stringify(playerView).includes(unavailable));
  await other.locator("#session-files").getByRole("button",{name:"Close",exact:true}).click();
  await other.getByRole("button",{name:"Set HP",exact:true}).click();
  const hpForm = other.locator("#hp-settings form").filter({has:other.locator("input[name=current]")});
  await hpForm.locator("[name=current]").fill("20");
  await hpForm.locator("[name=max]").fill("20");
  await hpForm.locator("button").click();
  await other.getByRole("button",{name:"Session",exact:true}).click();
  await openOffers(other);
  await act(other,unavailable,"Accept");
  await status(unavailable,"accepted");
  await expect(other,[7,0],[],null);

  const miss = await post(dm,"initiative",await editBody(finalize(6,{kind:"final",amount:4})));
  assert.ok(!miss.ok);
  const before = (await state(dm)).offers.length;
  await resolve(7);
  await resolve(8);
  assert.equal((await state(dm)).offers.length,before);
  assert.equal(await history.getByText(/No damage/).count(),2);
  await history.getByText(/Handled at table/).waitFor();
  const decline = await resolve(9);
  await act(sheet,decline,"Decline");
  await status(decline,"declined");

  const failed = await resolve(10);
  const beforeFailure = await current(sheet);
  await sheet.evaluate(id => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) {
      if (key.startsWith("aurora-combat-encounter") && JSON.parse(value).partyDelivery?.receipts?.[id]) throw Error("Synthetic write failure");
      return set.call(this,key,value);
    };
  },failed);
  await act(sheet,failed,"Accept");
  await sheet.locator("#party-controls").getByText(/Could not save the offer/).waitFor();
  await status(failed,"claimed");
  assert.deepEqual(await current(sheet),beforeFailure);
  await sheet.close();
  sheet = await context.newPage();
  watch(sheet);
  await open(sheet,guest);
  await act(sheet,failed,"Apply offer");
  await status(failed,"accepted");
  await expect(sheet,[19,0],[[70,30],[11,10]]);

  const room = (await state(dm)).room_id;
  const alreadyHandled = await resolve(11), restoreApply = await resolve(12);
  for (const id of [alreadyHandled,restoreApply]) {
    const claim = await offerCommand(guest,room,"claim",id);
    assert.equal(claim.status,200,await claim.text());
  }
  await sheet.locator("#import-session").setInputFiles({name:"baseline.json",mimeType:"application/json",buffer:baseline});
  await Promise.all([
    sheet.waitForEvent("domcontentloaded"),
    sheet.getByRole("button",{name:"Replace current tracker session"}).click()
  ]);
  if (!await sheet.locator("#session-files").evaluate(el=>el.open)) {
    await sheet.getByRole("button",{name:"Session",exact:true}).click();
  }
  await openOffers(sheet);
  await sheet.locator("#party-controls").getByText(/Party detached/).waitFor();
  assert.ok((await expect(sheet,[100,5],[])).receiptIds.includes(first));
  await guest.stop();
  guest = await launch("guest","resume");
  await open(sheet,guest);
  await act(sheet,alreadyHandled,"Already handled");
  await status(alreadyHandled,"accepted");
  await expect(sheet,[100,5],[]);
  await act(sheet,restoreApply,"Apply offer");
  await status(restoreApply,"accepted");
  await expect(sheet,[100,1],[[4,10]]);

  await button("End encounter").click();
  await dashboard.locator("#dm-round").getByText("Encounter inactive",{exact:true}).waitFor();
  const revision = (await state(dm)).combat.revision;
  await dashboard.locator("#dm-saves").selectOption("Recorded before delivery");
  await button("Load roster").click();
  await waitFor(()=>state(dm),view=>view.combat.revision===revision+1,"Named roster restored");
  await history.getByText(/Strike 1 · .*8 damage · accepted/).waitFor();
  const restoredDuplicate = await post(dm,"initiative",await editBody(finalize(0,{kind:"final",amount:8})));
  assert.ok(!restoredDuplicate.ok);
  assert.equal((await state(dm)).combat.damage[strikes[0]].result.offer_id,first);

  const afterClose = await resolve(13);
  const claim = await offerCommand(guest,room,"claim",afterClose);
  assert.equal(claim.status,200,await claim.text());
  const end = await api(dm,"end");
  assert.equal(end.status,200,await end.text());
  await act(sheet,afterClose,"Apply offer");
  await status(afterClose,"accepted");
  await expect(sheet,[99,0],[[4,10],[2,10]]);
  assert.deepEqual(errors,[]);
  console.log("P09B damage passed finalization, owner damage and concentration, distinct strikes, retry, write failure, reload and close, backup reconciliation, Undo, and privacy (" + (fallback?"IndexedDB":"Web Locks") + ").");
};
