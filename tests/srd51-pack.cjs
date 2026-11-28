const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function reviewBundledPack({launch,pageFor,open,api,distribution,pkg}) {
  const packId = "srd-5.1-monsters";
  const wolfId = "ID_SRD51_MONSTER_WOLF";
  const notices = "SRD-5.1-NOTICES.txt";
  assert.deepEqual(distribution,["Aurora Combat Tracker.exe",notices,"SRD-5.2.1-NOTICES.txt","aurora-party.exe","combat-sheet.exe"]);
  const shippedNotice = fs.readFileSync(path.join(pkg,notices),"utf8");
  const published = require("../content/monster-packs/srd-5.1-monsters.json");
  assert.ok(shippedNotice.includes(published.info.attribution));
  assert.match(shippedNotice,/Borealis SRD 5\.1 monster pack notice/);
  assert.match(shippedNotice,/https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/legalcode/);

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

  await button("Monster library").click();
  await preview.getByText(/2014 · System Reference Document 5\.1/).waitFor();
  assert.equal(await page.locator("#monster-pack").inputValue(),packId);
  const installed = await packs();
  assert.deepEqual(installed.map(({info,count})=>[info.id,count]),[[packId,317],["srd-5.2.1-monsters",330]]);
  await page.locator("#monster-search").fill("wolf");
  await page.locator("#monster-matches").selectOption(wolfId);
  await preview.getByText("Wolf",{exact:true}).waitFor();
  await preview.getByText(/Armor Class · 13/).waitFor();
  await preview.getByText(/Page 393/).waitFor();
  await preview.getByText(/7 \(2d4 \+ 2\).*DC 11 Strength saving throw or be knocked prone/).waitFor();

  const credits = page.locator("#monster-pack-credits");
  await credits.getByText("Pack credits",{exact:true}).click();
  await credits.getByText(/This work includes material taken from the System Reference Document 5\.1/).waitFor();
  const credit = await credits.innerText();
  assert.ok(credit.includes(published.info.attribution));
  assert.ok(credit.includes(published.info.license.url));
  const download = page.waitForEvent("download");
  await button("Export pack JSON").click();
  const exported = JSON.parse(fs.readFileSync(await (await download).path(),"utf8"));
  assert.deepEqual(exported.info,published.info);
  assert.equal(exported.monsters.length,317);

  await library.locator("#monster-add [name=score]").fill("12");
  await button("Add to encounter").click();
  await library.waitFor({state:"hidden"});
  const saved = (await (await api(dm,"state")).json()).combat.rows[0];
  assert.equal(saved.enemy.hp,11);
  assert.equal(saved.enemy.ac,13);
  assert.equal(saved.score,12);
  assert.equal(saved.enemy.template.revision,installed[0].revision);
  assert.equal(saved.enemy.template.pack.edition,"2014");
  assert.equal(saved.enemy.template.monster.id,wolfId);

  await dm.stop();
  dm = await launch("dm","resume-dm");
  await open(page,dm);
  await button("Monster library").click();
  await preview.getByText(/2014 · System Reference Document 5\.1/).waitFor();
  assert.deepEqual(await packs(),installed);
  assert.deepEqual((await (await api(dm,"state")).json()).combat.rows[0],saved);

  const replacement = {
    schema_version:2,
    info:{id:packId,edition:"2014",source:"Synthetic replacement",source_version:"1",attribution:"Synthetic test fixture"},
    monsters:[{id:"paper-cricket",name:"Paper Cricket",stats:{hp:3}}]
  };
  const edited = await fetch(dm.url+"/monsters/save",{
    method:"POST",headers:{origin:"null"},body:JSON.stringify({pack:replacement,expected_revision:installed[0].revision})
  });
  assert.equal(edited.status,200,await edited.text());
  assert.equal((await packs())[0].info.source,"Synthetic replacement");
  assert.deepEqual((await (await api(dm,"state")).json()).combat.rows[0],saved);
  assert.ok(requests.some(request=>request.hostname==="127.0.0.1"));
  assert.deepEqual(requests.filter(request=>request.protocol!=="file:" && request.hostname!=="127.0.0.1"),[]);
  assert.deepEqual(errors,[]);
  console.log("P08A package passed offline SRD search, Wolf preview and add, credits and export, restart, and distribution inventory.");
};
