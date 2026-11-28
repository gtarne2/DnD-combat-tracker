const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {setTimeout:delay} = require("node:timers/promises");

function fixturePack(edition) {
  const action = (id, name, text, mechanics = {}) => ({id,name,text,...mechanics});
  const stats = {
    creature_type:"Beast",size:"Medium",challenge:"1/4",hp:14,hit_dice:"3d8 + 1",
    speed:"35 ft., climb 10 ft.",senses:"Darkvision 30 ft.",languages:"Understands chimes",
    defenses:{ac:13,armor:"Mosaic hide",vulnerabilities:"thunder",resistances:"cold",
      immunities:"poison",condition_immunities:"poisoned"},
    abilities:{strength:12,dexterity:11},saves:{dexterity:0},skills:{perception:3},
    notes:"A synthetic creature.\nSecond line.",
    traits:[action("scent","Glass Scent","Tracks echoes across glass.")],
    actions:[
      action("nip","Facet Nip","First line.\nSecond line: bite for 0 piercing.",{
        attack_bonus:0,reach_ft:5,range_ft:{normal:5,long:15},
        damage:[{damage_type:"piercing",dice:null,average:0},{damage_type:"cold",dice:"1d4",average:2}],
        save_dc:11,uses:{count:0,reset:"dawn"},recharge:{die:6,minimum:5}
      }),
      action("rush","Double Nip","Makes two Facet Nip attacks.",{multiattack:["nip","nip"]})
    ],
    bonus_actions:[action("skip","Skip","Move two mosaic tiles.")],
    reactions:[action("turn","Turn Aside","Turns when a bell sounds.")],
    legendary_actions:[action("ring","Ring","An extra chime.\nOnce the board settles, stop.")]
  };
  return {schema_version:1,info:{id:"mosaic-"+edition,edition,source:"Mosaic Bestiary",
    source_version:"1.0",attribution:"Original synthetic monsters for the tracker tests."},monsters:[
    {id:"mosaic-wolf",name:"Mosaic Wolf",stats},
    {id:"silent-chip",name:"Silent Chip",stats:{...stats,creature_type:"Construct",hp:null,defenses:{...stats.defenses,ac:0}}}
  ]};
}

function fixturePackV2() {
  const pack = fixturePack("2024");
  pack.schema_version = 2;
  pack.info.license = {name:"Synthetic test license",url:"https://example.invalid/license"};
  const [wolf,chip] = pack.monsters;
  wolf.stats = structuredClone(wolf.stats);
  wolf.source_locator = {entry_id:"mosaic-wolf-2024",page:42,section:"Imaginary quarry",source_version:"Quarry printing"};
  wolf.stats.size = null;
  wolf.stats.details = {
    sizes:["Small","Medium"],alignment:"Unaligned",
    initiative:{modifier:0,score:14,qualifier:"At the start of a concert"},
    proficiency_bonus:2,xp:50,challenge_notes:"100 XP in the quarry",
    gear:"A cracked bell (during a concert)",
    saves_text:"Dexterity only in the open",skills_text:"Perception while listening",
    legendary_preamble:"In the quarry, Ring can be used twice.\nElsewhere it can be used once.",
    sections:[{title:"Lair rules",text:"At dusk, the quarry turns violet.\nThe wolves can still see."},
      {title:"Table notes",text:"The bell can be heard from the stairs."}]
  };
  wolf.stats.defenses = {...wolf.stats.defenses,ac:null,armor:null,
    conditional_ac:[{ac:15,qualifier:"While the bell rings"},{ac:null,qualifier:"Add the conductor's level in the quarry"}],
    resistances:"cold; thunder only during a concert"};
  const [nip] = wolf.stats.actions;
  delete nip.save_dc;
  nip.text += "\nOn a failed save, it rings once more if the target is holding a bell.";
  nip.resolution = {save:{ability:"dexterity",dc:11,on_failure:"full",on_success:"half"},
    manual_note:"Resolve the bell rider at the table."};
  wolf.stats.legendary_actions[0].resolution = {legendary_cost:2};
  chip.stats.challenge = "1/8";
  return pack;
}

module.exports = async function monsterLibrary({launch,pageFor,open,api}) {
  let dm = await launch("dm","dm");
  const page = await pageFor("dm",dm);
  const errors = [];
  page.on("pageerror", error=>errors.push(error.message));
  const board = async () => (await (await api(dm,"state")).json()).combat;
  const all = async () => (await (await api(dm,"monsters/list")).json());
  const readPack = async id => (await post(dm,"monsters/get",id)).json();
  const post = (helper,action,data,origin="null") => fetch(helper.url+"/"+action,{
    method:"POST",headers:{origin},body:JSON.stringify(data)
  });
  const el = selector => page.locator(selector);
  const library = el("#dm-monster-library");
  const preview = el("#monster-preview");
  const button = name => page.getByRole("button",{name,exact:true});
  async function wait(check, message) {
    const until = Date.now()+15000;
    do {
      if (await check()) return;
      await delay(100);
    } while (Date.now()<until);
    assert.fail(message + " · " + errors.join(", "));
  }
  async function stage(pack, target = page) {
    const json = typeof pack === "string" ? pack : JSON.stringify(pack);
    await target.locator("#monster-import").setInputFiles({name:"fixture.json",mimeType:"application/json",buffer:Buffer.from(json)});
  }
  async function importPack(pack, label="Import pack") {
    await stage(pack);
    await button(label).click();
    await el("#monster-import-preview").waitFor({state:"hidden"});
    await wait(async () => (await all()).some(p=>p.info.id===pack.info.id && p.info.source_version===pack.info.source_version),"Pack persisted");
    await preview.waitFor();
  }
  async function addMonsters(count, score) {
    await el("#monster-add [name=count]").fill(String(count));
    if (score != null) await el("#monster-add [name=score]").fill(String(score));
    await button("Add to encounter").click();
    await library.waitFor({state:"hidden"});
  }
  async function saveRoster(name) {
    await el("#dm-save [name=name]").fill(name);
    await button("Save current roster").click();
    await el("#dm-saves option").filter({hasText:name}).waitFor({state:"attached"});
  }
  async function loadRoster(name, rows) {
    await el("#dm-saves").selectOption(name);
    await button("Load roster").click();
    await wait(async () => JSON.stringify((await board()).rows) === JSON.stringify(rows),"Named roster restored");
  }
  async function newEncounter() {
    await button("New encounter").click();
    await wait(async () => (await board()).rows.length===0,"New encounter is empty");
  }

  await button("Add enemy").click();
  await el("#dm-enemy-form").getByLabel("Private name").fill("Paper sentinel");
  await el("#dm-enemy-form").getByLabel("Action notes").fill("Folds its arms.");
  await button("Save enemy").click();
  await el("#dm-enemy").waitFor({state:"hidden"});
  const handEntered = (await board()).rows;
  assert.equal(handEntered.length,1);
  assert.equal(handEntered[0].enemy.template,undefined);
  await saveRoster("P06 sentinel");
  await newEncounter();

  await button("Monster library").click();
  await preview.waitFor();
  const bundledPacks = await el("#monster-pack option").count();
  const old = fixturePack("2014");
  await importPack(old);
  await el("#monster-search").fill("wolf");
  await el("#monster-type").selectOption("Beast");
  await el("#monster-size").selectOption("Medium");
  await el("#monster-challenge").selectOption("1/4");
  assert.equal(await el("#monster-matches option").count(),1);
  await preview.getByText("Double Nip",{exact:true}).waitFor();
  await preview.getByText(/0 piercing/).first().waitFor();
  await addMonsters(3,15);
  const wolves = (await board()).rows;
  assert.equal(wolves.length,3);
  assert.equal(new Set(wolves.map(row=>row.id)).size,3);
  assert.deepEqual(wolves.map(row=>row.enemy.hp),[14,14,14]);
  assert.equal(wolves[0].enemy.template.schema_version,undefined);
  assert.equal(wolves[0].enemy.template.monster.stats.actions[0].text,old.monsters[0].stats.actions[0].text);
  await el("#dm-order").selectOption(wolves[0].id);
  await button("Edit enemy").click();
  await el("#dm-enemy-form").getByLabel("Current HP").fill("4");
  await button("Save enemy").click();
  await el("#dm-enemy").waitFor({state:"hidden"});
  assert.equal((await board()).rows[0].enemy.hp,4);
  await saveRoster("P07A wolves");
  const legacyRows = (await board()).rows;
  await el("#dm-instance-stat-block summary").click();
  await el("#dm-instance-stat-block").getByText("Glass Scent",{exact:true}).waitFor();

  const invite = (await (await api(dm,"invite")).json()).invite;
  const guest = await launch("guest","join",invite);
  await wait(async()=> (await (await api(guest,"state")).json()).combat?.rows.length===3,"Guest sees public order");
  const projection = await (await api(guest,"state")).text();
  for (const text of ["Mosaic Wolf","Mosaic Bestiary","Facet Nip","Mosaic hide","\"template\":"]) assert.ok(!projection.includes(text));
  assert.equal((await api(guest,"monsters/list")).status,403);
  assert.equal((await api(dm,"monsters/list","https://example.invalid")).status,403);

  await button("Monster library").click();
  await preview.waitFor();
  const upgraded = fixturePack("2014");
  upgraded.info.source_version = "2.0";
  upgraded.monsters[0].stats.hp = 22;
  upgraded.monsters[0].stats.defenses.ac = 17;
  upgraded.monsters[0].stats.actions[0].text = "A revised bite.";
  const before = await readPack(old.info.id);
  await stage(upgraded);
  const conflict = el("#monster-import-preview");
  await conflict.getByText(/This replaces.*1.0.*2.0/).waitFor();
  assert.equal((await readPack(old.info.id)).revision,before.revision);
  await conflict.getByRole("button",{name:"Cancel"}).click();
  assert.equal((await readPack(old.info.id)).revision,before.revision);
  const otherTab = await page.context().newPage();
  await open(otherTab,dm);
  await otherTab.getByRole("button",{name:"Monster library",exact:true}).click();
  await otherTab.locator("#monster-pack").selectOption(old.info.id);
  await otherTab.locator("#monster-preview").getByText("Facet Nip",{exact:true}).waitFor();
  const alternate = structuredClone(upgraded);
  alternate.info.source_version = "2.1";
  await stage(alternate,otherTab);
  await otherTab.locator("#monster-import-preview").getByText(/This replaces.*1.0.*2.1/).waitFor();
  await importPack(upgraded,"Replace pack");
  await otherTab.getByRole("button",{name:"Replace pack",exact:true}).click();
  await otherTab.locator("#monster-confirm [role=status]").getByText(/This pack changed/).waitFor();
  assert.equal((await readPack(old.info.id)).pack.info.source_version,"2.0");
  await otherTab.close();
  const original = (await board()).rows;
  assert.deepEqual(original.map(row=>row.enemy.hp),[4,14,14]);
  for (const row of original) {
    assert.equal(row.enemy.max_hp,14);
    assert.equal(row.enemy.ac,13);
    assert.deepEqual(row.enemy.template,wolves[0].enemy.template);
  }

  const invalid = structuredClone(upgraded);
  invalid.monsters.push({id:"broken",name:"Broken",stats:{actions:[
    {id:"bad",name:"Bad link",text:"Broken reference.",multiattack:["missing"]}
  ]}});
  const installed = await readPack(old.info.id);
  await stage("{\"schema_version\":");
  await el("#monster-status").getByText(/JSON|position|input/i).waitFor();
  assert.deepEqual(await readPack(old.info.id),installed);
  await stage(invalid);
  await el("#monster-status").getByText(/Unresolved multiattack/).waitFor();
  assert.equal(await conflict.isVisible(),false);
  assert.deepEqual(await readPack(old.info.id),installed);
  const stale = await post(dm,"monsters/save",{pack:old,expected_revision:before.revision});
  assert.equal(stale.status,409);
  assert.deepEqual(await readPack(old.info.id),installed);
  const badSave = await post(dm,"monsters/save",{pack:invalid,expected_revision:installed.revision});
  assert.equal(badSave.status,409);
  assert.deepEqual(await readPack(old.info.id),installed);

  const newerEdition = fixturePackV2();
  await importPack(newerEdition);
  assert.equal(await el("#monster-pack option").count(),bundledPacks+2);
  await el("#monster-pack").selectOption("mosaic-2014");
  await preview.getByText(/2014 · Mosaic Bestiary · 2.0/).waitFor();
  const download = page.waitForEvent("download");
  await button("Export pack JSON").click();
  const exported = JSON.parse(fs.readFileSync(await (await download).path(),"utf8"));
  assert.deepEqual(exported,installed.pack);
  assert.deepEqual(exported.monsters[0].stats,upgraded.monsters[0].stats);
  assert.equal(exported.monsters[1].stats.hp,null);
  assert.equal(exported.monsters[1].stats.defenses.ac,0);
  await importPack(exported,"Replace pack");
  assert.deepEqual((await readPack(old.info.id)).pack,exported);
  await el("#monster-pack").selectOption("mosaic-2024");
  await preview.getByText(/2024 · Mosaic Bestiary · 1.0/).waitFor();
  await el("#monster-search").fill("wolf");
  await el("#monster-size").selectOption("Small");
  assert.equal(await el("#monster-matches option").count(),1);
  await el("#monster-size").selectOption("Medium");
  assert.equal(await el("#monster-matches option").count(),1);
  await el("#monster-challenge").selectOption("1/4");
  assert.deepEqual(await el("#monster-challenge option").evaluateAll(options=>options.map(o=>o.value)),["","1/8","1/4"]);
  for (const text of ["Saves · dexterity +0","Armor Class · Unknown","15 · While the bell rings",
    "Initiative · +0 (14)","Mosaic Bestiary","Synthetic test license","Page 42","Gear · A cracked bell",
    "In the quarry, Ring can be used twice.","Lair rules","half damage on success",
    "Resolve the bell rider at the table.","Facet Nip, Facet Nip"]) {
    await preview.getByText(text,{exact:false}).first().waitFor();
  }
  await preview.getByText("Small or Medium Beast",{exact:false}).waitFor();
  assert.equal(await el("#monster-add [name=score]").inputValue(),"14");
  const editionDownload = page.waitForEvent("download");
  await button("Export pack JSON").click();
  const v2Export = JSON.parse(fs.readFileSync(await (await editionDownload).path(),"utf8"));
  assert.equal(v2Export.schema_version,2);
  assert.deepEqual(v2Export, (await readPack(newerEdition.info.id)).pack);
  assert.deepEqual(v2Export.monsters[0],newerEdition.monsters[0]);
  await importPack(v2Export,"Replace pack");
  const v2Installed = await readPack(newerEdition.info.id);
  const cyclic = structuredClone(v2Export);
  cyclic.monsters[0].stats.actions[0].multiattack = ["rush"];
  await stage(cyclic);
  await el("#monster-status").getByText(/Cyclic multiattack/).waitFor();
  assert.deepEqual(await readPack(newerEdition.info.id),v2Installed);
  for (const [mutate,error] of [
    [p => p.monsters[0].stats.actions[1].multiattack.push("missing"),/Unresolved multiattack/],
    [p => p.monsters[0].stats.actions[0].damage[1].dice = "1000d4",/damage dice/],
    [p => p.schema_version = 3,/Unsupported monster pack schema/]
  ]) {
    const malformed = structuredClone(v2Export);
    mutate(malformed);
    const rejected = await post(dm,"monsters/save",{pack:malformed,expected_revision:v2Installed.revision});
    assert.equal(rejected.status,409);
    assert.match(await rejected.text(),error);
    assert.deepEqual(await readPack(newerEdition.info.id),v2Installed);
  }
  await addMonsters(1);
  const editionRow = (await board()).rows.find(r=>r.score===14);
  assert.equal(editionRow.enemy.template.pack.edition,"2024");
  assert.equal(editionRow.enemy.template.schema_version,2);
  assert.equal(editionRow.enemy.ac,null);
  await el("#dm-order").selectOption(wolves[0].id);
  await button("Group initiative by name").click();
  assert.equal((await board()).rows.find(r=>r.id===editionRow.id).score,14);

  await el("#dm-order").selectOption(wolves[1].id);
  await button("Edit enemy").click();
  await el("#dm-enemy-form").getByLabel("Private name").fill("Mosaic Beta");
  await el("#dm-enemy-form").getByLabel("Player alias").fill("Copper shadow");
  await button("Save enemy").click();
  await el("#dm-enemy").waitFor({state:"hidden"});
  await button("Move up in tie").click();
  await wait(async () => (await board()).rows[0].id === wolves[1].id,"Tie order updated without changing IDs");
  await button("Reveal").click();
  await wait(async () => (await (await api(guest,"state")).text()).includes("Copper shadow"),"Guest sees only the revealed alias");
  await button("Hide").click();
  await wait(async () => !(await (await api(guest,"state")).text()).includes("Copper shadow"),"Guest no longer sees the alias");
  const laterProjection = await (await api(guest,"state")).text();
  for (const text of ["Mosaic Beta","Facet Nip","While the bell rings","mosaic-wolf-2024"]) assert.ok(!laterProjection.includes(text));
  await button("Start / resume encounter").click();
  await wait(async () => (await board()).running,"Encounter started");
  await button("Next Turn").click();
  await wait(async () => (await board()).current === wolves[0].id,"Second tied wolf took its turn");
  await saveRoster("Both editions");
  const savedBoth = await board();
  await button("End encounter").click();
  await wait(async () => !(await board()).running,"Encounter ended");

  await button("Monster library").click();
  await preview.getByText("Facet Nip",{exact:true}).waitFor();
  const newerUpdate = structuredClone(v2Export);
  newerUpdate.info.source_version = "2.0";
  newerUpdate.monsters[0].stats.details.initiative.score = 16;
  await importPack(newerUpdate,"Replace pack");
  assert.deepEqual((await board()).rows.find(r=>r.id===editionRow.id),editionRow);

  await button("Import Aurora folder").click();
  await el("#monster-pack-form [name=folder]").setInputFiles(path.join(__dirname,"fixtures","monster-library"));
  await el("#monster-pack-form").getByRole("button",{name:"Continue"}).click();
  await button("Import pack").click();
  await el("#monster-import-preview").waitFor({state:"hidden"});
  await el("#monster-search").fill("");
  await preview.getByText("Copper Needle",{exact:true}).waitFor();
  await preview.getByText(/Ranged attack \+0 at 20 feet/).waitFor();
  await preview.getByText("Glide Aside",{exact:true}).waitFor();
  await preview.getByText("Quiet Hum",{exact:true}).waitFor();
  await preview.getByText(/Unresolved Aurora reference · ID_TEST_KITE_MISSING/).waitFor();
  await preview.getByText(/Unresolved Aurora constitution · owner:constitution/).waitFor();
  const aurora = (await readPack("aurora-local")).pack;
  assert.deepEqual(aurora.monsters.map(m=>m.name),["Copper Kite"]);
  const kite = aurora.monsters[0];
  assert.equal(kite.stats.hp,9);
  assert.equal(kite.stats.hit_dice,"2d4 + 4");
  assert.equal(kite.stats.defenses.ac,13);
  assert.equal(kite.source_locator.source_version,"synthetic-1.3");
  assert.equal(kite.stats.details.alignment,"Unaligned");
  assert.equal(kite.stats.saves.Dexterity,0);
  assert.equal(kite.stats.actions[0].id,"ID_TEST_KITE_NEEDLE");
  assert.equal(kite.stats.actions[0].text,"Ranged attack +0 at 20 feet.\nHit: 2 piercing damage.");

  await button("Create pack").click();
  await el("#monster-pack-form [name=id]").fill("test-homebrew");
  await el("#monster-pack-form").getByRole("button",{name:"Continue"}).click();
  const editor = el("#monster-template-form");
  await editor.getByLabel("Name",{exact:true}).fill("Paper Dart");
  await editor.getByLabel("HP",{exact:true}).fill("0");
  await editor.getByLabel("AC",{exact:true}).fill("10");
  const text = "Cut a crease.\nSlide to a new square.";
  await editor.getByText("Add a rule or action",{exact:true}).click();
  await editor.getByLabel("Category",{exact:true}).selectOption("actions");
  await editor.getByLabel("Rule name",{exact:true}).fill("Crease");
  await editor.getByLabel("Rules text",{exact:true}).fill(text);
  await editor.getByRole("button",{name:"Add rule",exact:true}).click();
  await button("Save template").click();
  await preview.getByText("Crease",{exact:true}).waitFor();
  const manual = await readPack("test-homebrew");
  await button("Edit template").click();
  await editor.getByLabel("HP",{exact:true}).fill("6");
  await button("Save template").click();
  await wait(async()=> (await readPack("test-homebrew")).pack.monsters[0].stats.hp===6,"Manual edit persisted");
  const edited = (await readPack("test-homebrew")).pack.monsters[0];
  assert.equal(edited.id,manual.pack.monsters[0].id);
  assert.equal(edited.stats.actions[0].text,text);

  const checkpoint = await board();
  await dm.stop();
  dm = await launch("dm","resume-dm");
  await open(page,dm);
  await button("Monster library").click();
  await wait(async()=> await el("#monster-pack option").count()===bundledPacks+4,"Library survived helper restart");
  assert.deepEqual(await board(),checkpoint);
  await library.getByRole("button",{name:"Close",exact:true}).click();
  await loadRoster("P06 sentinel",handEntered);
  await loadRoster("P07A wolves",legacyRows);
  await loadRoster("Both editions",savedBoth.rows);
  assert.equal((await board()).current,savedBoth.current);
  assert.equal((await board()).round,savedBoth.round);
  assert.deepEqual((await board()).rows.map(r=>r.id),savedBoth.rows.map(r=>r.id));
  assert.deepEqual(errors,[]);
  console.log("P07A/P07B passed v1/v2 pack round-trip and atomic validation, template-free and edition-specific roster resume, stable private snapshots, edition filters, Aurora linked XML and manual editing.");
};
