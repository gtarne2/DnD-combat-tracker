// P10 packaged rehearsal: export an encounter from one DM room and import it into a fresh room.
// Not yet run on Windows. Run with `node tests/party-launcher.cjs --encounters`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {randomUUID} = require("node:crypto");
const {setTimeout:delay} = require("node:timers/promises");

module.exports = async function encounterPortability({launch,pageFor,api,pkg}) {
  const errors = [];
  const state = async info => (await api(info,"state")).json();
  const post = (info,route,data) => fetch(info.url+"/"+route,{method:"POST",headers:{origin:"null"},body:JSON.stringify(data)});
  async function edit(dm, edit, helper = dm) {
    const current = await state(dm);
    const result = await post(helper,"initiative",{room_id:current.room_id,command_id:randomUUID(),
      command:{encounter_id:current.combat.id,expected_revision:current.combat.revision,edit}});
    assert.equal(result.status,200,await result.text());
  }
  async function eventually(read, test, label) {
    const limit = Date.now()+20000;
    do {
      const value = await read();
      if (test(value)) return value;
      await delay(100);
    } while (Date.now()<limit);
    assert.fail(label + " · " + errors.join(", "));
  }

  // Source room: two guests named Lark, one hand-entered enemy, a running turn pointer.
  const source = await launch("dm","dm");
  const sourcePage = await pageFor("dm",source);
  sourcePage.on("pageerror", error => errors.push(error.message));
  const invite = (await (await api(source,"invite")).json()).invite;
  const first = await launch("guest","join",invite), second = await launch("observer","join",invite);
  const firstId = (await state(first)).self_id, secondId = (await state(second)).self_id;
  await edit(source,{kind:"submit",score:15,companions:[]},first);
  await edit(source,{kind:"submit",score:9,companions:[]},second);
  await edit(source,{kind:"enemy",id:null,score:12,enemy:{name:"Glass Ogre",alias:"Big shape",revealed:false,
    hp:30,max_hp:40,ac:11,conditions:"Prone",notes:"Synthetic P10 enemy"}});
  await edit(source,{kind:"start"});
  await edit(source,{kind:"next"});
  const before = (await state(source)).combat;
  const ogre = before.rows.find(row => row.name === "Glass Ogre");
  assert.equal(before.current,ogre.id);

  // Export through the dashboard button. The file carries no member identity.
  const download = sourcePage.waitForEvent("download");
  await sourcePage.getByRole("button",{name:"Export encounter",exact:true}).click();
  const file = path.join(pkg,"p10-encounter.json");
  await (await download).saveAs(file);
  const text = fs.readFileSync(file,"utf8");
  const exported = JSON.parse(text);
  assert.equal(exported.format,"aurora-encounter");
  assert.equal(exported.current,ogre.id);
  for (const id of [firstId,secondId]) assert.ok(!text.includes(id),"member ID leaked into export");
  assert.ok(!/history"\s*:\s*\[\s*\{/.test(text));
  assert.equal((await post(first,"export_encounter")).status,409);
  await edit(source,{kind:"end"});

  // Destination room on a separate profile with one new player.
  const target = await launch("dm2","dm");
  const targetPage = await pageFor("dm2",target);
  targetPage.on("pageerror", error => errors.push(error.message));
  const targetInvite = (await (await api(target,"invite")).json()).invite;
  const rejoin = await launch("rejoin","join",targetInvite);
  const rejoinId = (await state(rejoin)).self_id;
  await targetPage.locator("#dm-initiative").waitFor();
  await targetPage.setInputFiles("#dm-import-encounter",file);
  const dialog = targetPage.locator("#dm-encounter-import");
  await dialog.waitFor();
  const seats = dialog.locator("#dm-encounter-seats select");
  assert.equal(await seats.count(),2);
  await seats.nth(0).selectOption(rejoinId);
  await seats.nth(1).selectOption("");
  await dialog.getByRole("button",{name:"Replace current encounter"}).click();
  await dialog.waitFor({state:"hidden"});
  const imported = await eventually(async () => (await state(target)).combat, board => board.rows.length === 2, "import");
  assert.equal(imported.running,false);
  assert.equal(imported.current,ogre.id);
  const enemy = imported.rows.find(row => row.id === ogre.id).enemy;
  assert.deepEqual([enemy.hp,enemy.max_hp,enemy.conditions],[30,40,"Prone"]);
  assert.equal(imported.rows.find(row => row.name === "Lark").damage_recipient,rejoinId);
  await targetPage.getByRole("button",{name:"Start / resume encounter"}).click();
  await eventually(async () => (await state(target)).combat, board => board.running && board.current === ogre.id, "resume");
  assert.deepEqual(errors,[]);
  for (const helper of [first,second,rejoin,source,target]) await helper.stop();
  console.log("P10 encounter export omitted member IDs and imported into a fresh room with explicit pairing, enemy state and pointer.");
};
