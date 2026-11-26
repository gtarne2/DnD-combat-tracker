const assert = require("node:assert/strict");
const path = require("node:path");
const {DatabaseSync} = require("node:sqlite");
const {randomUUID} = require("node:crypto");
const {setTimeout:delay} = require("node:timers/promises");

module.exports = async function strikeWindows({launch,pageFor,open,api,lanPath}) {
  let dm = await launch("dm","dm");
  const dashboard = await pageFor("dm",dm,{localOnly:true});
  const invite = (await (await api(dm,"invite")).json()).invite;
  const nativeInvite = JSON.parse(Buffer.from(invite.split(".")[1],"base64url"));
  assert.equal(nativeInvite.version,2);
  assert.equal(await lanPath(nativeInvite,"/v1/party",{version:1,room:nativeInvite.room,
    credential:randomUUID(),command_id:randomUUID(),request:{kind:"resume"}}),400);
  const v1Invite = "aurora-party." + Buffer.from(JSON.stringify({...nativeInvite,version:1})).toString("base64url");
  await assert.rejects(launch("old-version","join",v1Invite),/Incompatible party version/);
  const guest = await launch("guest","join",invite);
  let observer = await launch("observer","join",invite);
  const sheet = await pageFor("guest",guest,{localOnly:true});
  const fallback = process.argv.includes("--fallback-writer");
  assert.equal(await sheet.evaluate(()=>Boolean(navigator.locks)),!fallback);
  const other = await pageFor("observer",observer,{localOnly:true});
  const tab = await sheet.context().newPage();
  await open(tab,guest);
  const errors = [];
  for (const page of [dashboard,sheet,other,tab]) page.on("pageerror",error=>errors.push(error.message));
  const state = async helper => (await api(helper,"state")).json();
  const host = () => state(dm);
  const post = (helper, route, data) => fetch(helper.url+"/"+route,{
    method:"POST",headers:{origin:"null"},body:JSON.stringify(data)
  });
  async function wait(read,test,label) {
    const limit = Date.now()+22000;
    let value;
    do {
      value = await read();
      if (test(value)) return value;
      await delay(100);
    } while (Date.now()<limit);
    assert.fail(label + " · " + JSON.stringify(value) + " · " + errors.join(", "));
  }
  async function edit(edit, who=dm, allowed=true) {
    const view = await host();
    const response = await post(who,"initiative",{room_id:view.room_id,command_id:randomUUID(),
      command:{encounter_id:view.combat.id,expected_revision:view.combat.revision,edit}});
    assert.equal(response.ok,allowed,await response.text());
  }
  const reply = (who, reference, answer="miss") => post(who,"window",{room_id:nativeInvite.room,
    command_id:randomUUID(),command:{kind:"reply",window:reference,reply:{answer,reacted:false}}});
  const button = name => dashboard.getByRole("button",{name,exact:true});
  const dialog = dashboard.locator("#dm-action-dialog");
  const clock = page => page.evaluate(() => {
    const state = previewEncounter.current();
    return {current:state.progress?.current, slot:state.progress?.used["Spell slot:1"] || 0,
      reaction:Boolean(state.progress?.economyUsed?.owner?.reaction),
      shield:(state.progress?.effects || []).filter(e=>e.shield && effectControls.active(e)).length,
      expired:(state.progress?.activity || []).filter(e=>e.kind==="expiration" && e.label.includes("Sudden Ward")).length};
  });
  const guestID = (await state(guest)).self_id, observerID = (await state(observer)).self_id;
  await edit({kind:"submit",score:20,companions:[]},guest);
  await edit({kind:"submit",score:10,companions:[]},observer);
  const [owner,second] = (await host()).combat.rows.map(r=>r.id);

  await button("Add enemy").click();
  const enemy = dashboard.locator("#dm-enemy-form");
  await enemy.getByLabel("Private name").fill("Private Midnight Tern");
  await enemy.getByLabel("Player alias").fill("Concealed");
  await enemy.locator("[name=score]").fill("30");
  await button("Save enemy").click();
  await enemy.waitFor({state:"hidden"});
  const source = (await host()).combat.rows[0].id;
  const order = dashboard.locator("#dm-order");
  await order.selectOption(source);
  await button("Add hand-entered action").click();
  await dialog.getByLabel("Action name").fill("Secret Paper Gust");
  await dialog.getByLabel("Rules text").fill("Private trigger and secret target defense.");
  await button("Add action").click();
  await dialog.waitFor({state:"hidden"});
  await button("Duplicate").click();
  const tied = (await wait(host,s=>s.combat.rows.filter(r=>r.enemy).length===2,"Tied enemy added"))
    .combat.rows.find(row=>row.enemy && row.id!==source).id;
  await button("Start / resume encounter").click();
  if (process.argv.includes("--assist")) await dashboard.getByLabel("Action mode").selectOption("assist");
  await button("Preview action").click();
  for (const [index, target] of [owner,owner,second,owner,second,owner].entries()) {
    if (index) await dialog.getByRole("button",{name:"Add strike or target"}).click();
    const strike = dialog.locator("fieldset").nth(index);
    await strike.getByLabel("Target",{exact:true}).selectOption(target);
    if (!index && process.argv.includes("--assist")) {
      await strike.getByLabel("Enable digital attack roll").check();
      await strike.getByRole("button",{name:"Roll d20",exact:true}).click();
    }
    await strike.getByLabel("Physical roll total").fill("69333");
    await strike.getByLabel("Table outcome").selectOption("hit");
  }
  await dialog.getByLabel("Private note or ruling override").fill("Private adjudication marker");
  await button("Record action").click();
  await dialog.waitFor({state:"hidden"});
  const entry = (await host()).combat.rows.find(r=>r.id===source).actions.history[0];
  if (process.argv.includes("--assist")) assert.equal(entry.input.strikes[0].attack_roll.digital,true);
  const actionId = entry.input.id;
  const strikes = entry.input.strikes.map(s=>s.id);
  const currentWindow = async i => (await host()).combat.windows[strikes[i]];
  const phase = (i,kind) => wait(()=>currentWindow(i),v=>v?.resolution.kind===kind,kind + " on strike " + (i+1));
  const history = dashboard.locator('#dm-action-history li[data-action-id="' + actionId + '"]');
  async function showHistory() {
    await order.selectOption(source);
    if (!await dashboard.locator("#dm-action-history").evaluate(el=>el.open)) {
      await dashboard.locator("#dm-action-history summary").click();
    }
    await history.waitFor();
  }
  async function ask(i,type,announcement="",again=false) {
    await showHistory();
    await history.getByRole("button",{name:(again?"Ask again for strike ":"Ask player for strike ") + (i+1),exact:true}).click();
    await dialog.getByLabel("Question",{exact:true}).selectOption(type);
    if (announcement) await dialog.getByLabel("Optional announcement to everyone").fill(announcement);
    await button("Send question").click();
    await dialog.waitFor({state:"hidden"});
    return (await phase(i,"pending")).reference;
  }
  const prompt = (page, ref) => page.locator('form[data-window-id="' + ref.id + '"]');
  async function choose(page,ref,answer,reaction=false) {
    const form = prompt(page,ref);
    await form.getByLabel("Table answer").selectOption(answer);
    if (reaction) await form.getByLabel("Use reaction").selectOption({index:1});
    return form.getByRole("button",{name:"Send reply",exact:true});
  }
  async function override(i,ruling) {
    await showHistory();
    const state = await currentWindow(i);
    const label = {stale:"Trigger stale",answered:"Reply received",canceled:"Question canceled"}[state.resolution.kind];
    if (label) await history.getByText(new RegExp("Strike " + (i+1) + " · .*" + label)).waitFor();
    await history.getByRole("button",{name:"Record spoken ruling for strike "+(i+1),exact:true}).click();
    await dialog.getByLabel("Final ruling").selectOption(ruling);
    await dialog.getByLabel("Private override reason").fill("Private adjudication marker");
    await button("Save override").click();
    await dialog.waitFor({state:"hidden",timeout:10000}).catch(async error => {
      throw Error((await dialog.locator("[role=status]").textContent()) || error.message);
    });
    assert.equal((await phase(i,"final")).resolution.outcome,ruling);
  }
  const windowEdit = (i,edit) => ({kind:"strike_window",action_id:actionId,strike_id:strikes[i],edit});

  const announcement = "An attack is being reviewed.";
  const first = await ask(0,"attack",announcement);
  await wait(()=>state(observer),v=>v.announcements?.includes(announcement),"Public message");
  let observerView = await state(observer);
  assert.deepEqual(observerView.questions,[]);
  assert.deepEqual(observerView.announcements,[announcement]);
  const ownerView = await wait(()=>state(guest),v=>v.questions?.some(q=>q.window.id===first.id),"Addressed question");
  assert.deepEqual(ownerView.questions,[{window:first,question:"attack"}]);
  assert.equal((await reply(observer,first)).ok,false);
  for (const view of [ownerView,observerView]) {
    assert.doesNotMatch(JSON.stringify(view),/Private Midnight Tern|Secret Paper Gust|69333|Private adjudication marker|effective_ac|Sudden Ward/);
  }
  await edit({kind:"finalize_damage",action_id:actionId,strike_id:strikes[0],decision:{kind:"final",amount:3}},dm,false);

  const context = sheet.context();
  let bodies = [];
  await context.route("**/window",async route => {
    const body = route.request().postDataJSON();
    if (body.command.kind !== "reply" || body.command.window.id !== first.id) return route.continue();
    bodies.push(body);
    if (bodies.length === 1) {
      const response = await route.fetch();
      assert.equal(response.status(),200,await response.text());
      return route.abort();
    }
    return route.continue();
  });
  const submit = await Promise.all([sheet,tab].map(page=>choose(page,first,"miss",true)));
  await Promise.all(submit.map(control=>control.dispatchEvent("click")));
  const answered = await phase(0,"answered");
  assert.deepEqual(answered.reply,{answer:"miss",reacted:true});
  await wait(()=>bodies.length,n=>n>=2,"Durable reply retry");
  assert.deepEqual(bodies[0],bodies[1]);
  assert.deepEqual(bodies[0].command,{kind:"reply",window:first,reply:{answer:"miss",reacted:true}});
  await context.unroute("**/window");
  await tab.close();
  assert.deepEqual(await clock(sheet),{current:"party:"+source,slot:1,reaction:true,shield:1,expired:0});
  await showHistory();
  await history.getByRole("button",{name:"Use reply on strike 1",exact:true}).click();
  assert.equal((await phase(0,"final")).resolution.outcome,"miss");
  assert.equal((await host()).offers.length,0);

  const stale = await ask(1,"attack");
  await edit({kind:"move_up",id:tied});
  await edit({kind:"correct",id:tied});
  await edit({kind:"correct",id:source});
  await phase(1,"pending");
  await edit({kind:"next"});
  await phase(1,"stale");
  assert.equal((await reply(guest,stale)).ok,false);
  await wait(()=>clock(sheet),v=>v.current==="owner" && !v.reaction && v.shield===0 && v.expired===1,"Shield expired once on owner's start");
  await override(1,"hit");
  await history.getByRole("button",{name:"Resolve damage for strike 2",exact:true}).click();
  await dialog.getByLabel("Final damage amount").fill("3");
  await button("Confirm damage result").click();
  await dialog.waitFor({state:"hidden"});
  assert.deepEqual((await host()).offers.map(o=>[o.action_id,o.effect.amount]),[[strikes[1],3]]);

  await other.getByLabel("Share with this DM").selectOption("character_details");
  await wait(host,s=>s.members.find(m=>m.member_id===observerID)?.inspection?.sharing==="character_details","Observer shared details");
  await observer.stop();
  const offline = await ask(2,"save");
  const canceled = await ask(3,"save");
  await showHistory();
  await history.getByRole("button",{name:"Cancel question on strike 4",exact:true}).click();
  await phase(3,"canceled");
  const replacement = await ask(3,"save","",true);
  assert.notEqual(replacement.id,canceled.id);
  assert.equal(replacement.version,canceled.version+1);
  assert.equal((await reply(guest,canceled,"save_failure")).ok,false);
  await phase(3,"pending");
  await (await choose(sheet,replacement,"pass")).click();
  assert.equal((await phase(3,"answered")).reply.answer,"pass");
  await override(3,"miss");
  await edit({kind:"next"});
  await phase(2,"pending");
  await wait(host,s=>s.members.find(m=>m.member_id===observerID)?.online===false,"Recipient offline");

  await dm.stop();
  dm = await launch("dm","resume-dm");
  await open(dashboard,dm);
  await phase(2,"pending");
  assert.equal((await currentWindow(3)).resolution.outcome,"miss");
  observer = await launch("observer","resume");
  await open(other,observer);
  await wait(host,s=>s.members.find(m=>m.member_id===observerID)?.inspection?.sharing==="character_details",
    "Reconnected observer published details while the save was open");
  await other.getByLabel("Share with this DM").selectOption("party_name_only");
  observerView = await wait(()=>state(observer),v=>v.questions?.some(q=>q.window.id===offline.id),"Offline question restored");
  assert.deepEqual(observerView.questions,[{window:offline,question:"save"}]);
  await wait(host,s=>!s.members.find(m=>m.member_id===observerID)?.inspection,"Sharing downgrade purged inspection");
  await (await choose(other,offline,"save_success")).click();
  await phase(2,"answered");
  await showHistory();
  await history.getByRole("button",{name:"Use reply on strike 3",exact:true}).click();
  assert.equal((await phase(2,"final")).resolution.outcome,"save_success");

  const removed = await ask(4,"attack");
  await edit({kind:"leave"},observer);
  await phase(4,"stale");
  assert.equal((await reply(observer,removed)).ok,false);
  await order.locator('option[value="' + second + '"]').waitFor({state:"detached"});
  await override(4,"miss");

  const race = await ask(5,"attack");
  let release, started;
  const held = new Promise(done=>{release=done;});
  const replyStarted = new Promise(done=>{started=done;});
  await context.route("**/window",async route=>{
    const command=route.request().postDataJSON().command;
    if (command.kind!=="reply" || command.window.id!==race.id) return route.continue();
    started();
    await held;
    return route.continue();
  });
  try {
    await (await choose(sheet,race,"miss",true)).click();
    await Promise.race([replyStarted,delay(12000).then(()=>assert.fail("Reaction reply did not start"))]);
    const spent = await clock(sheet);
    assert.deepEqual([spent.slot,spent.reaction,spent.shield],[2,true,1]);
    await showHistory();
    await history.getByRole("button",{name:"Cancel question on strike 6",exact:true}).click();
    await phase(5,"canceled");
  } finally { release(); }
  await sheet.getByText(/reaction reply arrived after its window closed/).waitFor();
  await context.unroute("**/window");
  await sheet.locator("#session-files").getByRole("button",{name:"Close",exact:true}).click();
  await sheet.locator("#undo-turn").click();
  await wait(()=>clock(sheet),v=>v.slot===1 && !v.reaction && v.shield===0,"Owner corrected local spend");
  assert.equal((await currentWindow(5)).resolution.kind,"canceled");

  const db = new DatabaseSync(path.join(dm.data,"Aurora Combat Tracker","party.sqlite3"),{readOnly:true});
  try {
    const room = JSON.parse(db.prepare("SELECT state FROM rooms").get().state);
    assert.deepEqual(room.announcements,[announcement]);
    const windowFields = JSON.stringify(room.windows);
    assert.doesNotMatch(windowFields,/Private Midnight Tern|Secret Paper Gust|69333|effective_ac|Sudden Ward/);
    const audit = db.prepare("SELECT request FROM commands").all().map(r=>JSON.parse(r.request));
    const replies = audit.filter(row=>row.kind==="window_reply");
    assert.ok(replies.length>=5);
    assert.doesNotMatch(JSON.stringify(replies),/effective_ac|Private Midnight Tern|Secret Paper Gust|69333|Sudden Ward|Spell slot/);
    const events = db.prepare("SELECT * FROM deliveries").all().filter(r=>JSON.stringify(r).includes("windows_changed"));
    assert.ok(events.length>=5);
    assert.doesNotMatch(JSON.stringify(events),/effective_ac|Private Midnight Tern|Secret Paper Gust|69333|Sudden Ward|Private adjudication marker/);
  } finally { db.close(); }
  assert.deepEqual(errors,[]);
  console.log("P09C passed Shield, owner correction, separate offline save and reaction windows, cancellation, restart, protocol, and privacy (" + (fallback?"IndexedDB":"Web Locks") + ").");
};
