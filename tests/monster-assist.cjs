const assert = require("node:assert/strict");
const {randomUUID} = require("node:crypto");
const {setTimeout:delay} = require("node:timers/promises");

module.exports = async function monsterAssist({launch,pageFor,api}) {
  const dm = await launch("dm","dm");
  const dashboard = await pageFor("dm",dm,{localOnly:true});
  const invite = (await (await api(dm,"invite")).json()).invite;
  const guest = await launch("guest","join",invite);
  const observer = await launch("observer","join",invite);
  const player = await pageFor("guest",guest,{localOnly:true});
  const errors = [];
  [dashboard,player].forEach(page=>page.on("pageerror",error=>errors.push(error.message)));
  async function state(helper = dm) { return (await api(helper,"state")).json(); }
  async function wait(read, check, label) {
    const deadline = Date.now()+15000;
    let value;
    do {
      value = await read();
      if (check(value)) return value;
      await delay(100);
    } while (Date.now()<deadline);
    assert.fail(label + " · " + JSON.stringify(value) + " · " + errors.join(", "));
  }
  const playerId = (await state(guest)).self_id, observerId = (await state(observer)).self_id;
  const share = player.getByLabel("Share with this DM");
  await share.selectOption("vitals");
  await wait(state,s=>Number.isInteger(s.members.find(m=>m.member_id===playerId)?.inspection?.vitals?.effective_ac),"Live AC");
  const button = name => dashboard.getByRole("button",{name,exact:true});
  const dialog = dashboard.locator("#dm-action-dialog");
  const setDice = (...values) => dashboard.evaluate(values=>{
    let position = 0;
    const original = Math.random;
    Math.random = () => position < values.length ? values[position++] : original();
  }, values);
  const chooseOutcome = (host, value) => host.getByLabel("Table outcome").selectOption(value);
  const entry = async () => (await state()).combat.rows.find(row=>row.enemy).actions.history[0];
  const history = id => dashboard.locator('#dm-action-history li[data-action-id="' + id + '"]');
  async function preview(id) {
    await dashboard.locator("#dm-action-rule").selectOption("pack:"+id);
    await button("Preview action").click();
  }
  async function damage(record, index) {
    await history(record.input.id).getByRole("button",{name:"Resolve damage for strike "+index,exact:true}).click();
  }
  async function loseResponse(kind) {
    const calls = [];
    await dashboard.route("**/initiative",async route=>{
      const data = route.request().postDataJSON();
      const {edit} = data.command;
      if (edit.kind !== kind && edit.action?.kind !== kind) return route.continue();
      calls.push(data);
      if (calls.length!==1) return route.continue();
      const result = await route.fetch();
      assert.ok(result.ok(),await result.text());
      return route.abort();
    });
    return calls;
  }
  async function rollAttack(box, adjustment) {
    await box.getByLabel("Enable digital attack roll").check();
    await box.getByLabel("Confirm printed attack bonus and adjustment").check();
    await box.getByLabel("Situational attack adjustment").fill(String(adjustment));
    await box.getByRole("button",{name:"Roll d20",exact:true}).click();
  }
  const pack = {schema_version:2,info:{id:"assist-test",edition:"Fixture",source:"Paper Rules",attribution:"Synthetic validation rules"},monsters:[{
    id:"paper-tower",name:"Private Paper Tower",stats:{hp:120,defenses:{ac:13},actions:[
      {id:"needle",name:"Needle",text:"A needle attack. Determine varnish resistance at the table.",
        attack_bonus:4,damage:[{damage_type:"piercing",dice:"1d6 + 2",average:5}],
        resolution:{manual_note:"Conditional varnish resistance requires a table ruling."}},
      {id:"triple",name:"Triple Needles",text:"Make three Needle strikes.",multiattack:["needle","needle","needle"]},
      {id:"wind",name:"Paper Wind",text:"Each target saves against the same wind.",
        damage:[{damage_type:"force",dice:"2d6+1",average:6}],
        resolution:{save:{ability:"dexterity",dc:14,on_success:"half",on_failure:"full"}}}
    ]}
  }]};
  assert.equal(await dashboard.getByLabel("Action mode").inputValue(),"manual");
  await button("Monster library").click();
  await dashboard.waitForFunction(()=>!document.querySelector("#monster-import").disabled);
  await dashboard.locator("#monster-import").setInputFiles({name:"assist.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(pack))});
  await button("Import pack").click();
  await dashboard.getByText("Imported Paper Rules.",{exact:true}).waitFor();
  await dashboard.locator("#monster-matches").selectOption("paper-tower");
  await button("Add to encounter").click();
  await dashboard.locator("#dm-monster-library").waitFor({state:"hidden"});
  await button("Start / resume encounter").click();
  await dashboard.getByLabel("Action mode").selectOption("assist");
  await preview("triple");
  const [first, second, third] = [0,1,2].map(i=>dialog.locator("fieldset").nth(i));
  await first.getByLabel("Target",{exact:true}).selectOption(observerId);
  await first.getByLabel("Compare with available AC").check();
  await setDice(.98);
  await rollAttack(first,-1);
  await first.getByText(/No permitted armor class/).waitFor();
  assert.equal(await first.getByLabel("Table outcome").inputValue(),"table");
  await first.getByLabel("Target",{exact:true}).selectOption(playerId);
  await first.getByRole("button",{name:"Use suggested outcome"}).click();
  await first.getByLabel("Suggest damage after ruling").check();
  await dialog.getByLabel("Resolution mode").selectOption("manual");
  assert.equal(await first.getByLabel("Physical roll total").inputValue(),"23");
  await dialog.getByLabel("Resolution mode").selectOption("assist");
  assert.equal(await first.getByLabel("Natural d20").inputValue(),"20");
  assert.ok(await first.getByRole("button",{name:"Roll d20",exact:true}).isDisabled());
  await second.getByLabel("Target",{exact:true}).selectOption(playerId);
  await third.getByLabel("Target",{exact:true}).selectOption(playerId);
  await third.getByLabel("Physical roll total").fill("20");
  await third.getByLabel("Compare with available AC").check();
  await third.getByRole("button",{name:"Use suggested outcome"}).click();
  await share.selectOption("party_name_only");
  await third.getByText(/No permitted armor class/).waitFor();
  assert.equal(await third.getByLabel("Table outcome").inputValue(),"table");
  await share.selectOption("vitals");
  await first.getByRole("button",{name:"Use suggested outcome"}).click();
  await third.getByRole("button",{name:"Use suggested outcome"}).click();
  assert.equal(await third.getByLabel("Natural d20").inputValue(),"");
  assert.equal(await third.getByText(/critical hit candidate/).count(),0);

  const records = await loseResponse("record");
  await button("Record action").click();
  await dialog.getByText(/Retry the same entry/).waitFor();
  await button("Record action").click();
  await dialog.waitFor({state:"hidden"});
  assert.deepEqual(records[0],records[1]);
  await dashboard.unroute("**/initiative");
  let multi = await entry();
  assert.deepEqual(multi.input.strikes[0].attack_roll,{natural:20,digital:true,digital_total:23});
  assert.equal(multi.input.strikes[1].outcome,"table");
  assert.equal(multi.input.strikes[2].total,20);
  assert.equal(multi.input.strikes[2].attack_roll,undefined);
  assert.equal((await state()).combat.rows.find(row=>row.enemy).actions.action,false);

  await history(multi.input.id).getByRole("button",{name:"Ask player for strike 1",exact:true}).click();
  await button("Send question").click();
  await dialog.waitFor({state:"hidden"});
  await history(multi.input.id).getByText(/Waiting for reply/).waitFor();
  assert.equal(await history(multi.input.id).getByRole("button",{name:"Resolve damage for strike 1",exact:true}).count(),0);
  await history(multi.input.id).getByRole("button",{name:"Review strike 2",exact:true}).click();
  await dialog.getByLabel("Compare with available AC").check();
  await setDice(.01);
  await rollAttack(dialog,50);
  await dialog.getByText(/Natural 1.*Suggested miss/).waitFor();
  await dialog.getByRole("button",{name:"Use suggested outcome"}).click();
  await button("Save strike ruling").click();
  await dialog.waitFor({state:"hidden"});
  const reviewed = await entry();
  assert.equal(reviewed.input.id,multi.input.id);
  assert.equal(reviewed.input.strikes[1].id,multi.input.strikes[1].id);
  assert.deepEqual(reviewed.input.strikes[1].attack_roll,{natural:1,digital:true,digital_total:55});
  assert.equal(reviewed.input.strikes[1].outcome,"miss");
  multi = reviewed;
  const prompt = player.getByRole("region",{name:"DM questions"});
  await prompt.getByLabel("Table answer").selectOption("hit");
  await prompt.getByRole("button",{name:"Send reply"}).click();
  await history(multi.input.id).getByRole("button",{name:"Use reply on strike 1"}).click();
  await damage(multi,1);
  await dialog.getByText("Conditional varnish resistance requires a table ruling.",{exact:true}).waitFor();
  assert.ok(await button("Use critical average").isDisabled());
  assert.equal(await dialog.getByLabel("Final damage amount").inputValue(),"");
  const rolls = await loseResponse("store_damage_roll");
  await setDice(.2,.8);
  await button("Roll damage").click();
  await dialog.getByText(/Rolled suggestion 9/).waitFor();
  assert.equal(rolls.length,1);
  assert.ok(await button("Use rolled damage").isDisabled());
  await dashboard.unroute("**/initiative");
  await dialog.getByLabel("I checked resistance, other modifiers and conditional riders").check();
  await button("Use rolled damage").click();
  await dialog.getByLabel("Damage mode").selectOption("manual");
  await dialog.getByLabel("Damage mode").selectOption("assist");
  assert.equal(await dialog.getByLabel("Final damage amount").inputValue(),"9");
  assert.ok(await button("Roll damage").isDisabled());
  const sends = await loseResponse("finalize_damage");
  await button("Confirm damage result").click();
  await dialog.getByText(/Retry the same entry/).waitFor();
  await button("Confirm damage result").click();
  await dialog.waitFor({state:"hidden"});
  assert.deepEqual(sends[0],sends[1]);
  await dashboard.unroute("**/initiative");
  const beforeArea = await state();
  assert.deepEqual(beforeArea.combat.damage_rolls[multi.input.strikes[0].id],{normal:4,critical:9});
  assert.equal(beforeArea.offers.length,1);
  assert.equal(beforeArea.offers[0].effect.amount,9);
  assert.equal(beforeArea.offers[0].action_id,multi.input.strikes[0].id);

  await damage(multi,3);
  assert.equal(await dialog.getByLabel("Damage mode").inputValue(),"manual");
  await dialog.getByLabel("Final damage amount").fill("2");
  await button("Confirm damage result").click();
  await dialog.waitFor({state:"hidden"});
  assert.deepEqual((await state()).offers.find(offer => offer.action_id === multi.input.strikes[2].id).effect,
    {kind:"damage",amount:2});

  await button("Next Turn").click();
  await preview("wind");
  await dialog.getByRole("button",{name:"Add strike or target"}).click();
  const [passed, failed] = [0,1].map(i=>dialog.locator("fieldset").nth(i));
  await passed.getByLabel("Target",{exact:true}).selectOption(playerId);
  await failed.getByLabel("Target",{exact:true}).selectOption(observerId);
  await passed.getByText(/dexterity save DC 14.*Success: half damage.*Failure: full damage/).waitFor();
  await chooseOutcome(passed,"save_success");
  await chooseOutcome(failed,"save_failure");
  for (const target of [passed,failed]) await target.getByLabel("Suggest damage after ruling").check();
  await button("Record action").click();
  await dialog.waitFor({state:"hidden"});
  const area = await entry();
  for (const [index, amount] of [[1,"4"],[2,"9"]]) {
    await damage(area,index);
    if (index===1) {
      await setDice(.4,.8);
      await button("Roll damage").click();
    }
    await dialog.getByText(new RegExp("Rolled suggestion "+amount)).waitFor();
    assert.ok(await button("Roll damage").isDisabled());
    await dialog.getByLabel("I checked resistance, other modifiers and conditional riders").check();
    if (index===1) {
      await button("Use printed average").click();
      assert.equal(await dialog.getByLabel("Final damage amount").inputValue(),"3");
    }
    await button("Use rolled damage").click();
    assert.equal(await dialog.getByLabel("Final damage amount").inputValue(),amount);
    await button("Confirm damage result").click();
    await dialog.waitFor({state:"hidden"});
  }
  const finished = await state();
  assert.equal(Object.keys(finished.combat.damage_rolls).length,2);
  const delivered = area.input.strikes.map(s=>finished.offers.find(o=>o.action_id===s.id));
  assert.deepEqual(delivered.map(o=>[o.recipient,o.effect.amount]),[[playerId,4],[observerId,9]]);
  assert.doesNotMatch(JSON.stringify(await state(guest)),/damage_rolls|digital_total|Private Paper Tower|Conditional varnish resistance/);
  assert.deepEqual(errors,[]);
  console.log("Assist passed natural dice, permitted AC, manual switching, an interrupted multiattack, stored rolls, critical and area damage branches, and exactly-once delivery.");
};
