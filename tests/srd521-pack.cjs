const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function reviewEditions({launch,pageFor,open,api,distribution,pkg}) {
  const editions = [
    {edition:"2014",version:"5.1",prefix:"SRD51",ac:13,score:15,count:317,page:393,
      bite:/7 \(2d4 \+ 2\).*DC 11 Strength saving throw or be knocked prone/},
    {edition:"2024",version:"5.2.1",prefix:"SRD521",ac:12,score:12,count:330,page:364,
      bite:/5 \(1d6 \+ 2\).*Medium or smaller creature, it has the Prone condition/}
  ];
  assert.deepEqual(distribution,[
    "Aurora Combat Tracker.exe","SRD-5.1-NOTICES.txt","SRD-5.2.1-NOTICES.txt","aurora-party.exe","combat-sheet.exe"
  ]);
  for (const edition of editions) {
    edition.id = "srd-" + edition.version + "-monsters";
    edition.published = require("../content/monster-packs/" + edition.id + ".json").info;
    const notices = fs.readFileSync(path.join(pkg,"SRD-" + edition.version + "-NOTICES.txt"),"utf8");
    assert.ok(notices.includes(edition.published.attribution));
    assert.ok(notices.includes("monster pack notice (as published)"));
    assert.ok(notices.includes(edition.published.license.url));
  }

  let dm = await launch("dm","dm");
  const page = await pageFor("dm",dm,{localOnly:true});
  const errors = [];
  page.on("pageerror",error=>errors.push(error.message));
  const requests = [];
  page.on("request",request=>requests.push(new URL(request.url())));
  const button = name => page.getByRole("button",{name,exact:true});
  const library = page.locator("#dm-monster-library");
  const preview = page.locator("#monster-preview");
  const packs = async () => (await (await api(dm,"monsters/list")).json());
  const rows = async () => (await (await api(dm,"state")).json()).combat.rows;
  const title = ed => ed.edition + " · System Reference Document " + ed.version + " · " + ed.version;

  async function select(ed,name,slug) {
    if (!(await library.isVisible())) await button("Monster library").click();
    await page.locator("#monster-pack").selectOption(ed.id);
    await preview.getByText(title(ed),{exact:true}).waitFor();
    await page.locator("#monster-search").fill(name);
    const selection = "ID_" + ed.prefix + "_MONSTER_" + slug;
    const matches = page.locator("#monster-matches");
    await matches.selectOption(selection);
    await matches.locator("option:checked").getByText(new RegExp(" · " + ed.edition + " · ")).waitFor({state:"attached"});
    await preview.getByRole("heading",{name,exact:true}).waitFor();
  }

  async function checkCredits(ed) {
    const credits = page.locator("#monster-pack-credits");
    if (!(await credits.evaluate(node=>node.open))) await credits.getByText("Pack credits",{exact:true}).click();
    const text = await credits.innerText();
    assert.ok(text.includes(ed.published.attribution));
    assert.ok(text.includes(ed.published.license.url));
  }

  await button("Monster library").click();
  await preview.getByText(title(editions[0]),{exact:true}).waitFor();
  assert.equal(await page.locator("#monster-pack").inputValue(),editions[0].id);
  const installed = await packs();
  assert.deepEqual(installed.map(({info,count})=>[info.id,count]),editions.map(ed=>[ed.id,ed.count]));
  for (const ed of editions) {
    await select(ed,"Wolf","WOLF");
    await preview.getByText("Armor Class · " + ed.ac,{exact:ed.edition==="2024"}).waitFor();
    await preview.getByText("Page " + ed.page,{exact:false}).waitFor();
    await preview.getByText(ed.bite).waitFor();
    const score = library.locator("#monster-add [name=score]");
    if (ed.edition === "2014") await score.fill(String(ed.score));
    else {
      await preview.getByText("Initiative · +2 (12)",{exact:true}).waitFor();
      assert.equal(await score.inputValue(),"12");
    }
    await button("Add to encounter").click();
    await library.waitFor({state:"hidden"});
  }
  const wolves = await rows();
  assert.equal(new Set(wolves.map(row=>row.id)).size,2);
  for (const [i,ed] of editions.entries()) {
    const row = wolves[i];
    const savedPack = row.enemy.template;
    assert.equal(row.name,"Wolf");
    assert.equal(row.score,ed.score);
    assert.equal(row.enemy.ac,ed.ac);
    assert.equal(row.enemy.hp,11);
    assert.equal(savedPack.revision,installed[i].revision);
    assert.deepEqual(savedPack.pack,ed.published);
    assert.match(savedPack.monster.stats.actions.find(rule=>rule.name==="Bite").text,ed.bite);
    assert.match(await page.locator("#dm-order option").nth(i).textContent(),new RegExp("Wolf · " + ed.edition));
  }

  const modern = editions[1];
  await select(modern,"Adult Red Dragon","ADULT_RED_DRAGON");
  for (const text of [
    /replace one attack with a use of Spellcasting to cast Scorching Ray/,
    /Failure: 59 \(17d6\) Fire damage\. Success: Half damage/,
    /Legendary Resistance \(3\/Day, or 4\/Day in Lair\)/,
    /Legendary Action Uses: 3 \(4 in Lair\)/,
    /20,000 XP in lair/
  ]) await preview.getByText(text).waitFor();
  await select(modern,"Archmage","ARCHMAGE");
  await preview.getByText("Creature · Medium or Small Humanoid",{exact:true}).waitFor();
  await preview.getByText("Gear · Wand",{exact:true}).waitFor();
  await page.locator("#monster-size").selectOption("Small");
  await preview.getByRole("heading",{name:"Archmage",exact:true}).waitFor();
  await page.locator("#monster-size").selectOption("Medium");
  await preview.getByRole("heading",{name:"Archmage",exact:true}).waitFor();
  const download = page.waitForEvent("download");
  await button("Export pack JSON").click();
  const exported = JSON.parse(fs.readFileSync(await (await download).path(),"utf8"));
  assert.deepEqual(exported.info,modern.published);
  assert.equal(exported.monsters.length,modern.count);

  await dm.stop();
  dm = await launch("dm","resume-dm");
  await open(page,dm);
  for (const ed of editions) {
    await select(ed,"Wolf","WOLF");
    await checkCredits(ed);
  }
  assert.deepEqual(await packs(),installed);
  assert.deepEqual(await rows(),wolves);
  const replacement = {schema_version:2,
    info:{id:modern.id,edition:"2024",source:"Synthetic 2024 replacement",source_version:"test-2",attribution:"Synthetic fixture"},
    monsters:[{id:"paper-moth",name:"Paper Moth",stats:{defenses:{ac:3},hp:2}}]};
  const file = Buffer.from(JSON.stringify(replacement));
  await page.locator("#monster-import").setInputFiles({name:"replacement.json",mimeType:"application/json",buffer:file});
  await page.locator("#monster-import-description").getByText(/5\.2\.1.*Synthetic 2024 replacement/).waitFor();
  await button("Replace pack").click();
  await preview.getByRole("heading",{name:"Paper Moth",exact:true}).waitFor();
  const after = await packs();
  assert.deepEqual(after[0],installed[0]);
  assert.notEqual(after[1].revision,installed[1].revision);
  assert.deepEqual(await rows(),wolves);
  await library.getByRole("button",{name:"Close",exact:true}).click();
  await page.locator("#dm-order").selectOption(wolves[1].id);
  const snapshot = page.locator("#dm-instance-stat-block");
  await snapshot.locator("summary").click();
  await snapshot.getByText(title(modern),{exact:true}).waitFor();
  await snapshot.getByText(modern.bite).waitFor();
  assert.ok(requests.some(request=>request.hostname==="127.0.0.1"));
  assert.deepEqual(requests.filter(request=>request.protocol!=="file:" && request.hostname!=="127.0.0.1"),[]);
  assert.deepEqual(errors,[]);
  console.log("P08B passed two official Wolf snapshots, 2024 rules and gear, dual offline credits and restart, atomic pack replacement, and distribution inventory.");
};
