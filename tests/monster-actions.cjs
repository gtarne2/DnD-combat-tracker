const assert = require("node:assert/strict");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {setTimeout:delay} = require("node:timers/promises");

module.exports = async function monsterActions({launch,pageFor,open,api,pkg}) {
  let dm = await launch("dm","dm");
  const page = await pageFor("dm",dm,{localOnly:true});
  await page.setViewportSize({width:1920,height:1080});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = async info => (await api(info,"state")).json();
  const board = async () => (await state(dm)).combat;
  const row = async id => (await board()).rows.find(r => r.id === id);
  const post = (helper, body) => fetch(helper.url+"/initiative", {
    method:"POST", headers:{origin:"null"}, body:JSON.stringify(body)
  });
  const button = name => page.getByRole("button",{name,exact:true});
  const panel = page.locator("#dm-monster-actions");
  const order = page.locator("#dm-order");
  const modal = page.locator("#dm-action-dialog");
  const pick = id => panel.getByLabel("Action",{exact:true}).selectOption(id);
  async function wait(read,test,label) {
    const end = Date.now()+12000;
    do {
      const value = await read();
      if (test(value)) return value;
      await delay(100);
    } while (Date.now() < end);
    assert.fail(label + " · " + errors.join(", "));
  }
  async function command(helper,edit) {
    const current = await state(dm);
    const body = {room_id:current.room_id,command_id:randomUUID(),
      command:{encounter_id:current.combat.id,expected_revision:current.combat.revision,edit}};
    const response = await post(helper,body);
    assert.equal(response.status,200,await response.text());
    return body;
  }
  async function clickAndWait(name) {
    const previous = (await board()).revision;
    await button(name).click();
    await wait(board,b=>b.revision > previous,name);
    await page.waitForFunction(() => !document.querySelector("#dm-save button").disabled);
  }
  const invite = (await (await api(dm,"invite")).json()).invite;
  const guest = await launch("guest","join",invite);
  const observer = await launch("observer","join",invite);
  await command(guest,{kind:"submit",score:10,companions:[]});
  await command(observer,{kind:"submit",score:8,companions:[]});
  const targets = (await board()).rows.map(r => r.id);

  await button("Add enemy").click();
  const enemy = page.locator("#dm-enemy-form");
  await enemy.getByLabel("Private name").fill("Private Copper Weaver");
  await enemy.getByLabel("Player alias").fill("Copper silhouette");
  await enemy.locator("[name=score]").fill("30");
  await button("Save enemy").click();
  await enemy.waitFor({state:"hidden"});
  const hand = (await board()).rows.find(r=>r.enemy).id;
  await order.selectOption(hand);
  await button("Add hand-entered action").click();
  await modal.getByLabel("Action name").fill("Copper thread");
  await modal.getByLabel("Rules text").fill("Hurls a copper thread across the room.");
  await button("Add action").click();
  await modal.waitFor({state:"hidden"});
  await clickAndWait("Start / resume encounter");
  await button("Preview action").click();
  await modal.getByLabel("Target",{exact:true}).selectOption(targets[0]);
  await modal.getByLabel("Physical roll total").fill("16");
  await modal.getByLabel("Table outcome").selectOption("miss");
  await modal.getByLabel("Private target detail").fill("Private target detail check");
  await modal.getByLabel("Private note or ruling override").fill("Does a 16 hit? The answer was no.");
  await button("Cancel").click();
  assert.equal((await row(hand)).actions.action,true);
  assert.equal((await row(hand)).actions.history.length,0);

  await button("Preview action").click();
  await modal.getByLabel("Target",{exact:true}).selectOption(targets[0]);
  await modal.getByLabel("Physical roll total").fill("16");
  await modal.getByLabel("Table outcome").selectOption("miss");
  await modal.getByLabel("Private target detail").fill("Private target detail check");
  await modal.getByLabel("Private note or ruling override").fill("Does a 16 hit? The answer was no.");
  await button("Record action").click();
  await modal.waitFor({state:"hidden"});
  const manual = (await row(hand)).actions.history[0];
  assert.equal(manual.input.strikes[0].total,16);
  assert.equal(manual.input.strikes[0].outcome,"miss");
  assert.equal(manual.input.strikes[0].target,targets[0]);

  const action = (id,name,text,mechanics={}) => ({id,name,text,...mechanics});
  const pack = {schema_version:2,info:{id:"synthetic-p09a",source:"Imaginary Orchard",
    attribution:"Original synthetic test creature",edition:"Test edition"},monsters:[{
    id:"orchard-beetle",name:"Orchard beetle",stats:{
      hp:23,defenses:{ac:14},actions:[
        action("nip","Foil Nip","One strike with a foil mandible."),
        action("rush","Double Nip","Makes exactly two Foil Nip strikes.",{multiattack:["nip","nip"]}),
        action("beam","Orchard Beam","Two uses, restored at round advance. Recharge 5–6.",
          {uses:{count:2,reset:"round"},recharge:{die:6,minimum:5}}),
        action("words","Etched Words","Read the orchard inscription aloud and adjudicate any effect.")
      ],
      reactions:[action("shield","Turn Foil","Turn a foil plate toward the sound.")],
      legendary_actions:[action("hum","Hum","Spend two legendary uses to make a low hum.",
        {resolution:{legendary_cost:2}})]
    }
  }]};
  await button("Monster library").click();
  await page.waitForFunction(() => !document.querySelector("#monster-import").disabled);
  await page.locator("#monster-import").setInputFiles({
    name:"orchard.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(pack))
  });
  await page.locator("#monster-import-preview").getByRole("button",{name:"Import pack",exact:true}).click({timeout:10000})
    .catch(async error => { throw Error((await page.locator("#monster-status").textContent()) || error.message); });
  await page.locator("#monster-status").getByText("Imported Imaginary Orchard.",{exact:true}).waitFor();
  await page.locator("#monster-matches").selectOption("orchard-beetle");
  await page.locator("#monster-add [name=count]").fill("2");
  await page.locator("#monster-add [name=score]").fill("20");
  await button("Add to encounter").click();
  const withBeetles = await wait(board,b=>b.rows.filter(r=>r.enemy?.template).length===2,"Add two templates");
  const [first, second] = withBeetles.rows.filter(r=>r.enemy?.template).map(r=>r.id);
  await page.locator("#dm-monster-library").waitFor({state:"hidden"});
  await clickAndWait("Next Turn");
  assert.equal((await board()).current,first);
  await panel.getByText("Orchard beetle · Current turn · Manual",{exact:true}).waitFor();
  await pick("pack:rush");
  await panel.getByText("Makes exactly two Foil Nip strikes.",{exact:true}).waitFor();

  const bounds = await Promise.all([order.boundingBox(),panel.locator("#dm-action-text").boundingBox(),
    button("Preview action").boundingBox()]);
  for (const box of bounds) assert.ok(box && box.x >= 0 && box.y >= 0 && box.x+box.width <= 1920 && box.y+box.height <= 1080,JSON.stringify(box));
  assert.ok(bounds[0].x+bounds[0].width < bounds[1].x,"Initiative and the rules are side-by-side.");
  await page.screenshot({path:path.join(pkg,"p09a-1920x1080.png")});

  await button("Preview action").click();
  const targetPicker = modal.locator("fieldset").first().getByLabel("Target",{exact:true});
  const targetLabels = await targetPicker.locator("option").evaluateAll(
    (options, ids) => options.filter(option => ids.includes(option.value)).map(option => option.label), targets);
  assert.equal(new Set(targetLabels).size,2);
  for (const [i, target] of targets.entries()) {
    const strike = modal.locator("fieldset").nth(i);
    await strike.getByLabel("Target",{exact:true}).selectOption(target);
    await strike.getByLabel("Physical roll total").fill(String(18-i));
    await strike.getByLabel("Table outcome").selectOption(i===0?"hit":"save_success");
  }
  let dropped, attempts = 0;
  await page.route("**/initiative",async route => {
    const body = route.request().postDataJSON();
    if (body.command.edit.action?.kind !== "record") return route.continue();
    attempts++;
    if (attempts===1) {
      dropped = body;
      const response = await route.fetch();
      assert.equal(response.status(),200,await response.text());
      return route.abort();
    }
    assert.deepEqual(body,dropped);
    return route.continue();
  });
  await button("Record action").click();
  await modal.getByText(/Retry the same entry/).waitFor();
  await button("Record action").click();
  await modal.waitFor({state:"hidden"});
  await page.unroute("**/initiative");
  assert.equal(attempts,2);
  const multi = (await row(first)).actions;
  assert.equal(multi.action,false);
  assert.equal(multi.history.length,1);
  assert.equal(multi.history[0].source.cost,"action");
  assert.deepEqual(multi.history[0].input.strikes.map(s=>s.target),targets);
  assert.equal(new Set([multi.history[0].input.id,...multi.history[0].input.strikes.map(s=>s.id)]).size,3);
  assert.equal((await row(second)).actions.action,true);

  await pick("pack:shield");
  await button("Preview action").click();
  await button("Record action").click();
  await modal.waitFor({state:"hidden"});
  assert.equal((await row(first)).actions.reaction,false);
  await clickAndWait("Next Turn");
  assert.equal((await board()).current,second);
  await pick("pack:words");
  await button("Preview action").click();
  await button("Add strike or target").click();
  await modal.locator("fieldset").nth(1).getByLabel("Target",{exact:true}).selectOption(targets[1]);
  await button("Record action").click();
  await modal.waitFor({state:"hidden"});
  assert.equal((await row(second)).actions.history[0].input.strikes.length,2);
  for (let i = 0; i < 4; i++) await clickAndWait("Next Turn");
  assert.equal((await board()).current,first);
  assert.equal((await row(first)).actions.reaction,true);
  await pick("pack:beam");
  await button("Preview action").click();
  await button("Record action").click();
  await modal.waitFor({state:"hidden"});
  const beam = r => r.actions.rules.find(rule=>rule.id==="pack:beam").counter;
  assert.equal(beam(await row(first)).remaining,1);
  assert.equal(beam(await row(first)).spent,true);
  assert.equal(beam(await row(second)).remaining,2);
  await panel.getByLabel("Recharge roll for next turn").fill("6");
  await clickAndWait("Queue recharge roll");
  assert.equal(beam(await row(first)).queued,6);

  await button("Correct action economy").click();
  await modal.getByLabel("Maximum legendary uses").fill("3");
  await modal.getByLabel("Remaining legendary uses").fill("3");
  await button("Save correction").click();
  await modal.waitFor({state:"hidden"});
  await pick("pack:hum");
  await button("Preview action").click();
  await button("Record action").click();
  await modal.waitFor({state:"hidden"});
  assert.equal((await row(first)).actions.legendary_left,1);
  assert.equal((await row(first)).actions.history[0].source.legendary,2);

  await order.selectOption(first);
  await clickAndWait("Duplicate");
  const clone = (await board()).rows.find(r=>r.enemy?.template && r.id!==first && r.id!==second);
  assert.equal(clone.actions.legendary_left,1);
  assert.equal(beam(clone).spent,true);
  assert.equal(beam(clone).remaining,1);
  assert.equal(beam(clone).queued,null);
  assert.deepEqual(clone.actions.history,[]);
  await order.selectOption(clone.id);
  await clickAndWait("Remove enemy");

  await page.locator("#dm-save [name=name]").fill("Orchard rehearsal");
  await clickAndWait("Save current roster");
  await clickAndWait("End encounter");
  await order.selectOption(second);
  await order.selectOption(first);
  await pick("pack:beam");
  await button("Correct power counters").click();
  await modal.getByLabel("Remaining limited uses").fill("2");
  await modal.getByLabel("Recharge ready").check();
  await button("Save correction").click();
  await modal.waitFor({state:"hidden"});
  assert.equal(beam(await row(first)).spent,false);
  await page.locator("#dm-saves").selectOption("Orchard rehearsal");
  await clickAndWait("Load roster");
  assert.equal(beam(await row(first)).queued,6);
  assert.equal((await row(first)).actions.legendary_left,1);
  await dm.stop();
  dm = await launch("dm","resume-dm");
  await open(page,dm);
  await clickAndWait("Start / resume encounter");
  assert.equal(beam(await row(first)).queued,6);
  assert.equal((await row(first)).actions.legendary_left,1);
  await order.selectOption(hand);
  await clickAndWait("Correct current turn");
  assert.equal(beam(await row(first)).queued,6);
  assert.equal(beam(await row(first)).last_roll,null);

  const next = await command(dm,{kind:"next"});
  assert.equal((await board()).current,first);
  assert.equal(beam(await row(first)).last_roll,6);
  assert.equal(beam(await row(first)).queued,null);
  assert.equal(beam(await row(first)).spent,false);
  assert.equal(beam(await row(first)).remaining,1);
  assert.equal((await row(first)).actions.legendary_left,3);
  assert.equal((await row(first)).actions.action,true);
  const revision = (await board()).revision;
  const replay = await post(dm,next);
  assert.equal(replay.status,200,await replay.text());
  assert.equal((await board()).revision,revision);
  assert.equal(beam(await row(first)).last_roll,6);
  await panel.getByText("Orchard beetle · Current turn · Manual",{exact:true}).waitFor();
  for (let i = 0; i < 4; i++) await clickAndWait("Next Turn");
  assert.equal(beam(await row(first)).remaining,2);
  await wait(()=>state(guest),s=>s.combat?.revision===(revision+4),"Guest received the final projection");
  const publicState = JSON.stringify(await state(guest));
  for (const token of ["Copper Weaver","Copper thread","Private target detail check","Orchard Beam",manual.input.id,
    multi.history[0].input.strikes[0].id,"last_roll","legendary_left"]) {
    assert.ok(!publicState.includes(token),token);
  }
  assert.deepEqual(errors,[]);
  console.log("Manual monster actions passed the physical-roll miss, separate strikes, cost and recovery, retry, correction, roster and restart persistence, privacy, and 1920×1080 layout.");
};
