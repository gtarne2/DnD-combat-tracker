const assert = require("node:assert/strict");
const fs = require("node:fs");
const {randomUUID} = require("node:crypto");
const {setTimeout:delay} = require("node:timers/promises");

module.exports = async function sharedInitiative({launch,pageFor,open,api}) {
  let dm = await launch("dm","dm");
  const dashboard = await pageFor("dm",dm);
  const errors = [];
  const watch = page => page.on("pageerror", error => errors.push(error.message));
  watch(dashboard);
  dashboard.on("pageerror",e=>console.error("Dashboard",e.message));
  const state = async info => (await api(info,"state")).json();
  const board = async () => (await state(dm)).combat;
  const post = (info,route,data) => fetch(info.url+"/"+route,{method:"POST",headers:{origin:"null"},body:JSON.stringify(data)});
  async function eventually(read, test, label) {
    const limit = Date.now()+20000;
    do {
      const value = await read();
      if (test(value)) return value;
      await delay(100);
    } while (Date.now()<limit);
    assert.fail(label + " · " + errors.join(", "));
  }
  async function edit(edit, helper = dm, retry = false) {
    const current = await state(dm);
    const body = {room_id:current.room_id,command_id:randomUUID(),
      command:{encounter_id:current.combat.id,expected_revision:current.combat.revision,edit}};
    const result = await post(helper,"initiative",body);
    assert.equal(result.status,200,await result.text());
    if (retry) {
      const replay = await post(helper,"initiative",body);
      assert.equal(replay.status,200,await replay.text());
      assert.equal((await board()).revision,current.combat.revision+1);
    }
  }
  const dmButton = name => dashboard.getByRole("button",{name,exact:true});
  const invite = (await (await api(dm,"invite")).json()).invite;
  let first = await launch("guest","join",invite);
  const second = await launch("observer","join",invite);
  const a = await pageFor("guest",first), b = await pageFor("observer",second);
  watch(a); watch(b);
  async function prepare(page, companion) {
    await page.evaluate(async companion => {
      await previewEncounter.transact(s => {
        s.companions = {cards:companion ? [{id:1,name:"Opal moth",turn:"owner",timerUnit:"rounds",remaining:8,resources:[]}] : [],sequence:1,seen:s.companions?.seen || [],owner:3};
        s.progress = {...previewEncounter.emptyProgress(),round:4,current:"actor:1",actors:[{id:1,name:"Solo paper rook",score:12,hp:7}],
          sequence:5,economyUsed:{owner:{action:true},"companion:1":{reaction:true}},economyEnabled:{owner:true},
          effects:["start","end","rounds","seconds"].map((kind,i)=>({id:i+2,name:"Synthetic "+kind,kind,category:"effect",target:"owner",remaining:30}))};
        s.focus.sequence = 1;
        s.focus.active = {id:1,name:"Amber light",label:"Synthetic focus",remaining:24};
        return true;
      });
    }, companion);
    await page.locator("#session-files").getByRole("button",{name:"Close",exact:true}).click();
    await page.locator("#manage-initiative").click();
    await page.locator("#party-initiative").waitFor();
  }
  async function submit(page, score, size) {
    const panel = page.locator("#party-initiative");
    await panel.locator("[name=score]").fill(String(score));
    await panel.getByRole("button",{name:"Submit initiative"}).click();
    await eventually(board,s=>s.rows.length===size,"Player submission");
  }
  await prepare(a,true); await prepare(b,false);
  await a.locator("[data-companion='1']").waitFor();
  await submit(a,20,1);
  assert.deepEqual((await board()).rows[0].shared,["Opal moth"]);
  await eventually(()=>state(second),s=>s.combat?.rows.length===1,"Second player received roster");
  await delay(1400);
  await submit(b,15,2);
  await eventually(()=>state(first),s=>s.combat?.rows.length===2,"First player received roster");
  await delay(1400);
  await a.locator("[data-companion='1']").fill("17");
  await submit(a,20,3);

  const name = "Synthetic basalt sentinel", attack = "Quartz needle volley", alias = "Bronze mask";
  await eventually(()=>dashboard.locator("#dm-order option").count(),n=>n===3,"DM received both initiatives and the separate companion");
  await dmButton("Add enemy").click();
  const form = dashboard.locator("#dm-enemy-form");
  await form.getByLabel("Private name").fill(name);
  await form.getByLabel("Player alias").fill(alias);
  await form.getByLabel("Current HP").fill("81");
  await form.getByLabel("Maximum HP").fill("92");
  await form.getByLabel("AC",{exact:true}).fill("31");
  await form.getByLabel("Conditions").fill("Violet snare");
  await form.getByLabel("Action notes").fill(attack);
  await dmButton("Roll initiative (d20)").click();
  const die = Number(await form.locator("[name=score]").inputValue());
  assert.ok(die>=1 && die<=20);
  await form.locator("[name=score]").fill("10");
  await dmButton("Save enemy").click();
  await form.waitFor({state:"hidden",timeout:5000}).catch(async error=>{throw Error((await form.locator("[role=status]").textContent()) || error.message);});
  const monster = (await board()).rows.find(r=>r.enemy);
  const select = dashboard.locator("#dm-order");
  await select.selectOption(monster.id);
  await dmButton("Duplicate").click();
  await eventually(board,s=>s.rows.length===5,"Duplicate first instance");
  await dmButton("Duplicate").click();
  await eventually(board,s=>s.rows.length===6,"Duplicate second instance");
  const copies = (await board()).rows.filter(r=>r.enemy);
  const changed = copies[2];
  await select.selectOption(changed.id);
  await dmButton("Edit enemy").click();
  await form.getByLabel("Current HP").fill("4");
  await form.locator("[name=score]").fill("7");
  await dmButton("Save enemy").click();
  await form.waitFor({state:"hidden"});
  await select.selectOption(monster.id);
  await dmButton("Group initiative by name").click();
  await eventually(board,s=>s.rows.filter(r=>r.enemy).every(r=>r.score===10),"Group initiative");
  assert.deepEqual((await board()).rows.filter(r=>r.enemy).map(r=>r.enemy.hp),[81,81,4]);
  await dmButton("Reveal").click();
  await eventually(()=>state(first),s=>s.combat.rows.some(r=>r.name===alias),"Public alias");
  await dmButton("Hide").click();
  const scrubbed = await eventually(()=>state(first),s=>s.combat.rows.filter(r=>r.name==="DM turn").length===3,"Hidden enemy");
  assert.equal(scrubbed.combat.rows.filter(r=>r.name==="DM turn").every(r=>r.score===null && !r.enemy),true);
  for (const marker of [name,attack,alias,"Violet snare",'"max_hp":92','"ac":31']) assert.ok(!JSON.stringify(scrubbed).includes(marker));
  await dmButton("Start / resume encounter").click();
  const metrics = page => page.evaluate(()=>{
    const s = previewEncounter.current(), p = s.progress;
    return {bound:!!p.partyClock,current:p.current,round:p.round,elapsed:p.elapsedSeconds||0,sequence:p.turnSequence||0,
      effects:p.effects.map(e=>e.remaining),ownerSpent:!!p.economyUsed?.owner?.action,companionSpent:!!p.economyUsed?.["companion:1"],
      focus:s.focus.active?.remaining,companion:s.companions.cards[0]?.remaining,actors:p.actors};
  });
  const initial = await eventually(()=>metrics(a),s=>s.bound,"DM takes control");
  assert.deepEqual([initial.current,initial.elapsed,initial.ownerSpent,initial.companionSpent,initial.effects[0]],["owner",0,false,true,29]);
  await eventually(()=>metrics(b),s=>s.bound,"Second player starts");
  assert.equal((await metrics(b)).ownerSpent,true);
  assert.equal(await a.locator("#next-turn").isVisible(),false);
  await a.locator("#encounter-settings").getByRole("button",{name:"Close",exact:true}).click();
  const blade = a.locator("#action-groups .option-row").filter({has:a.locator(".option-title",{hasText:"Practice Blade"})}).first().locator("[data-record-attack]");
  await blade.click();
  await a.locator("#attack-sequence").filter({hasText:"Attack 1 of 2"}).waitFor();
  await blade.click();
  await a.locator("#attack-sequence").filter({hasText:"Attack 2 of 2"}).waitFor();
  assert.ok(await blade.isDisabled());

  // Drop the dashboard response after the host commits, then retry the same UI action.
  await dashboard.route("**/initiative", async route => {
    const response = await route.fetch();
    assert.equal(response.status(),200);
    await route.abort("failed");
  }, {times:1});
  await dmButton("Next Turn").click();
  await dashboard.waitForFunction(()=>document.querySelector("#dm-initiative-status").textContent.length>0);
  const afterLostReply = await board();
  await dmButton("Next Turn").click();
  await dashboard.waitForFunction(()=>!document.querySelector("#dm-initiative-status").textContent);
  assert.deepEqual(await board(),afterLostReply);
  await eventually(()=>metrics(a),s=>s.current==="companion:1","Separate companion turn");
  assert.equal((await metrics(a)).companionSpent,false);
  const before = await metrics(a);
  await edit({kind:"move_up",id:changed.id});
  await edit({kind:"correct",id:monster.id});
  await eventually(()=>metrics(a),s=>s.current==="party:"+monster.id,"Pointer correction");
  await edit({kind:"correct",id:(await board()).rows[1].id});
  await eventually(()=>metrics(a),s=>s.current==="companion:1","Restore pointer");
  assert.deepEqual(await metrics(a),before);
  await edit({kind:"next"},dm,true);
  await eventually(()=>metrics(b),s=>s.current==="owner","Second owner's start");
  assert.equal((await metrics(b)).ownerSpent,false);
  for (let i=0;i<4;i++) await edit({kind:"next"});
  const round2 = await eventually(()=>metrics(a),s=>s.round===2,"First rollover");
  assert.deepEqual([round2.elapsed,round2.focus,round2.companion,round2.effects],[6,18,7,[28,29,29,24]]);
  assert.equal(round2.ownerSpent,false);
  await blade.click();
  await a.locator("#attack-sequence").filter({hasText:"Attack 1 of 2"}).waitFor();
  await eventually(()=>metrics(b),s=>s.round===2,"Second player caught up");
  await first.stop();
  const checkpoint = await board();
  await dm.stop();
  dm = await launch("dm","resume-dm");
  await open(dashboard,dm);
  assert.deepEqual(await board(),checkpoint);
  for (let i=0;i<6;i++) await edit({kind:"next"});
  const round3 = await eventually(()=>metrics(b),s=>s.round===3,"Second rollover");
  assert.deepEqual([round3.sequence,round3.elapsed,round3.focus,round3.effects],[13,12,12,[28,28,28,18]]);
  first = await launch("guest","resume");
  await open(a,first);
  const recovered = await eventually(()=>metrics(a),s=>s.round===3,"Offline round replay");
  assert.deepEqual([recovered.sequence,recovered.elapsed,recovered.focus,recovered.companion,recovered.effects],[13,12,12,6,[27,28,28,18]]);
  assert.equal(recovered.ownerSpent,false);
  const other = await a.context().newPage();
  await open(other,first);
  await eventually(()=>metrics(other),s=>s.round===3,"Second tab cursor");
  assert.deepEqual(await metrics(other),recovered);
  const page = await post(first,"clock",0);
  const deliveries = await page.json();
  assert.equal(deliveries.filter(d=>d.event.tick.wrap).length,2);
  for (const marker of [name,attack,alias,"Violet snare",'"hp"','"ac"']) assert.ok(!JSON.stringify(deliveries).includes(marker));
  const f = dashboard.locator("#dm-advance");
  await f.locator("[name=amount]").fill("3");
  await f.getByRole("button").click();
  await eventually(()=>metrics(a),s=>s.elapsed===15,"Authorized game time");
  await eventually(()=>metrics(other),s=>s.focus===9,"Second tab sees single time advance");
  // The clock and its repair data stay in the live profile when a backup is exported.
  const session = a.locator("#session-files");
  const download = a.waitForEvent("download");
  await session.getByRole("button",{name:"Export tracker backup"}).click();
  const backup = fs.readFileSync(await (await download).path());
  const portable = JSON.parse(backup).data.encounter;
  assert.equal(portable.progress.current,"actor:1");
  assert.equal(portable.partyDelivery,undefined);
  assert.equal(portable.progress.partyClock,undefined);
  await session.locator("#import-session").setInputFiles({name:"round-three.json",mimeType:"application/json",buffer:backup});
  await session.getByRole("button",{name:"Replace current tracker session"}).click();
  await eventually(()=>state(first),s=>s.ended,"Backup detached the helper");
  await first.stop();
  first = await launch("guest","resume");
  await open(a,first);
  const aligned = await eventually(()=>metrics(a),s=>s.bound,"Resume from a restored backup");
  assert.deepEqual([aligned.elapsed,aligned.sequence,aligned.focus,aligned.current],[15,13,9,"owner"]);
  await dashboard.locator("#dm-save input").fill("Glass crossing");
  await dmButton("Save current roster").click();
  await eventually(board,s=>s.saves.includes("Glass crossing"),"Save roster");
  const saved = await board();
  await dmButton("End encounter").click();
  await eventually(()=>metrics(a),s=>!s.bound,"Release solo clock");
  await dmButton("New encounter").click();
  await eventually(board,s=>!s.rows.length,"New encounter");
  await dmButton("Load roster").click();
  await eventually(board,s=>s.rows.length===6,"Load saved roster");
  assert.deepEqual((await board()).rows,saved.rows);
  await dmButton("Start / resume encounter").click();
  await eventually(()=>metrics(a),s=>s.bound,"Resume saved position");
  assert.equal((await metrics(a)).sequence,13);
  // Expire concentration, then let this player explicitly repair their own timer.
  await edit({kind:"advance",rounds:false,amount:10});
  await eventually(()=>metrics(a),s=>s.elapsed===25 && s.focus===undefined,"Concentration expired");
  await a.locator("#session-files").getByRole("button",{name:"Close",exact:true}).click();
  await a.locator("#manage-initiative").click();
  await a.getByRole("button",{name:"Restore my last clock outcomes"}).click();
  await eventually(()=>metrics(a),s=>s.elapsed===15 && s.focus===9,"Owner correction");
  assert.equal((await metrics(a)).sequence,13);
  await eventually(()=>metrics(b),s=>s.elapsed===25 && s.focus===undefined,"Other player keeps the clock outcome");
  await select.selectOption(changed.id);
  await dmButton("Remove enemy").click();
  await eventually(board,s=>s.rows.length===5,"Remove instance");
  await eventually(()=>state(first),s=>s.combat?.rows.length===5,"Player receives new order");
  await delay(1300);
  await a.locator(".party-leave").click();
  const solo = await eventually(()=>metrics(a),s=>!s.bound,"Leave encounter");
  assert.deepEqual([solo.round,solo.current,solo.actors[0].name,solo.elapsed],[4,"actor:1","Solo paper rook",15]);
  await a.locator("#encounter-settings").getByRole("button",{name:"Close",exact:true}).click();
  await a.locator("#next-turn").click();
  await eventually(()=>metrics(a),s=>s.current==="owner" && s.elapsed===15,"Solo Next Turn");
  assert.deepEqual(errors,[]);
  console.log("P06 passed two players, separate and shared companion initiative, three independent enemies, private projections, clock boundaries, retry, correction, offline replay, host restart, named resume and solo return.");
};
