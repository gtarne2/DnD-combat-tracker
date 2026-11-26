const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawn,execFileSync} = require("node:child_process");
const {once} = require("node:events");
const {createInterface} = require("node:readline");
const {pathToFileURL} = require("node:url");
const https = require("node:https");
const {randomUUID} = require("node:crypto");
const {chromium} = require("playwright");

const root = path.resolve(__dirname,"..");
const pkg = fs.mkdtempSync(path.join(root,"target","p02-package-"));
execFileSync("cmd.exe",["/d","/c","launcher\\build.cmd",path.relative(root,pkg)],{cwd:root});
const distribution=fs.readdirSync(pkg).sort();
const csc=path.join(process.env.SystemRoot,"Microsoft.NET","Framework64","v4.0.30319","csc.exe");
const harness=path.join(pkg,"PartyHarness.exe");
const dmAssets=["html","js","css"].map(ext=>"/resource:"+path.join(root,"launcher","dm-dashboard."+ext)+",dm-dashboard."+ext);
for (const file of ["dm-initiative.js","dm-monsters.js","dm-monster-actions.js"]) dmAssets.push("/resource:"+path.join(root,"launcher",file)+","+file);
execFileSync(csc,["/nologo","/main:PartyHarness","/out:"+harness,"/reference:System.Windows.Forms.dll","/reference:System.Drawing.dll","/reference:System.Web.Extensions.dll","/resource:"+path.join(root,"src","combat","party.js")+",party.js",...dmAssets,...["tests/PartyHarness.cs","launcher/TrackerLauncher.cs","launcher/RefreshBridge.cs","launcher/PartySession.cs"].map(f=>path.join(root,f))],{cwd:root});
const processes=new Set(), profiles=[];
async function launch(profile,mode,invite="") {
  const data=path.join(pkg,profile);
  fs.mkdirSync(data,{recursive:true});
  const save=path.join(data,"review.dnd5e"),xml=path.join(data,"review.xml");
  const isDm = mode === "dm" || mode === "resume-dm";
  if(!isDm && !fs.existsSync(save)){
    let fixture = "combat-sheet";
    if (process.argv.includes("--actions")) fixture = profile === "host" ? "progression" : "infusion-attacks";
    if (process.argv.includes("--initiative") && profile === "guest") fixture = "combat-options";
    fs.copyFileSync(path.join(__dirname,"fixtures",fixture+".dnd5e"),save);
    fs.copyFileSync(path.join(__dirname,"fixtures",fixture+".xml"),xml);
    if (process.argv.includes("--monster-damage") && profile === "observer") {
      fs.writeFileSync(xml,fs.readFileSync(xml,"utf8").replace('<set name="hd">d8</set>', ""));
    }
    if (process.argv.includes("--dashboard") && profile === "guest") {
      const original = fs.readFileSync(save,"utf8");
      fs.writeFileSync(save,original.replace("<backstory>", "<backstory>PrivateRawSaveP05-5023 ")
        .replace("</attacks>", '<attack name="Copper Sling" attack="+2 vs AC" displayed="true" />' +
          '<attack name="Glass Staff" attack="+3 vs AC" displayed="true" /></attacks>'));
    }
  }
  const p=spawn(harness,isDm ? [] : [save,xml],{env:{...process.env,LOCALAPPDATA:data},windowsHide:true});
  processes.add(p);
  const finished=once(p,"exit").then(()=>processes.delete(p));
  let errors="";
  p.stderr.on("data",d=>errors+=d);
  const lines=createInterface({input:p.stdout});
  const ready=once(lines,"line").then(([line])=>JSON.parse(line));
  ready.then(() => lines.on("line", line => {errors += line + "\n";}), () => {});
  p.stdin.write(JSON.stringify({profile:isDm ? "dm" : save,mode:mode==="resume-dm"?"resume":mode,name:profile==="host"?"Warden":"Lark",bind:mode==="host"||mode==="dm"?"127.0.0.1":null,invite})+"\n");
  const info=await Promise.race([ready,finished.then(()=>{throw Error(errors.trim() || "helper stopped");})]);
  return {...info,data,logs:()=>errors,stop:async()=>{p.stdin.end(); await finished;}};
}
async function api(info,action,origin="null") {
  return fetch(info.url+"/"+action,{method:"POST",headers:{origin}});
}
async function pageFor(name,info,{localOnly=false}={}) {
  const profile=await chromium.launchPersistentContext(path.join(pkg,name+"-chrome"),{executablePath:process.env.AURORA_TEST_CHROME});
  profiles.push(profile);
  if (localOnly) {
    await profile.route("**/*", route => {
      const url=new URL(route.request().url());
      if (url.protocol === "file:" || url.protocol === "http:" && url.hostname === "127.0.0.1")
        return route.continue();
      return route.abort("internetdisconnected");
    });
  }
  if (process.argv.includes("--fallback-writer") && (name === "guest"
    || name === "observer" && process.argv.includes("--monster-damage"))) {
    await profile.addInitScript(() => Object.defineProperty(navigator, "locks", {value: undefined}));
  }
  const page=await profile.newPage();
  // Exercise the copy button without replacing the Windows user's clipboard.
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{window.copiedInvitation=text;}}}));
  await open(page,info);
  return page;
}

async function reviewOffers(host, hostPage, guest, guestPage, invite) {
  const context = guestPage.context();
  const third = await launch("observer", "join", invite);
  const thirdPage = await pageFor("observer", third);
  const otherTab = await context.newPage();
  await open(otherTab, guest);
  const state = async helper => (await api(helper, "state")).json();
  const recipient = (await state(guest)).self_id;
  const row = (page, source) => page.getByRole("region", {name:"Party offers"}).locator("article").filter({hasText:source});
  const waitStatus = (page, source, status) => row(page, source).getByText(new RegExp(" · " + status + "$")).waitFor();
  const party = page => page.locator("#party-controls");
  const session = page => page.locator("#session-files");
  const hp = page => page.evaluate(() => encounterTracker.hp(previewEncounter.current()));
  const expectHp = (page, current, temporary) => page.waitForFunction(
    ([current, temporary]) => {
      const hp = encounterTracker.hp(previewEncounter.current());
      return hp.current === current && hp.max === 20 && (hp.temporary || 0) === temporary;
    }, [current, temporary]);
  const reopen = async page => {
    await page.getByRole("button", {name:"Session", exact:true}).click();
    if (!await party(page).locator("details").evaluate(el => el.open)) await party(page).locator("summary").click();
  };
  const undo = async page => {
    await session(page).getByRole("button", {name:"Close", exact:true}).click();
    await page.locator("#undo-turn").click();
    await reopen(page);
  };
  async function send(page, kind, amount, source) {
    const form = party(page).locator("form");
    await form.locator("select[name=recipient]").selectOption(recipient);
    await form.locator("select[name=kind]").selectOption(kind);
    await form.getByLabel("Amount", {exact:true}).fill(String(amount));
    await form.getByLabel("Source", {exact:true}).fill(source);
    await form.getByRole("button", {name:"Send to party member"}).click();
    await waitStatus(page, source, "Pending");
  }
  async function command(helper, room, kind, offer_id) {
    const response = await fetch(helper.url + "/offer", {method:"POST",headers:{origin:"null"},
      body:JSON.stringify({room_id:room,command_id:randomUUID(),command:{kind,offer_id}})});
    assert.ok(response.ok, await response.text());
  }
  await session(guestPage).getByRole("button", {name:"Close",exact:true}).click();
  await guestPage.getByRole("button", {name:"Set HP", exact:true}).click();
  const hpForm = guestPage.locator("#hp-settings form").filter({has:guestPage.locator("input[name=current]")});
  await hpForm.locator("[name=current]").fill("17");
  await hpForm.locator("[name=max]").fill("20");
  await hpForm.locator("[name=temporary]").fill("9");
  await hpForm.locator('button[type=submit], button:not([type])').click();
  await expectHp(guestPage,17,9);
  await reopen(guestPage);

  const download = guestPage.waitForEvent("download");
  await session(guestPage).getByRole("button", {name:"Export tracker backup"}).click();
  const baseline = fs.readFileSync(await (await download).path());

  let ack = "blocked";
  let acknowledgmentAttempts = 0;
  let forwarded = false;
  let releaseClaim;
  const firstClaim = new Promise(resolve => { releaseClaim = resolve; });
  await context.route("**/offer", async route => {
    const body = route.request().postDataJSON();
    if (body.command.kind === "claim") await firstClaim;
    if (body.command.kind !== "accept") return route.continue();
    acknowledgmentAttempts++;
    if (ack === "blocked") return route.abort();
    if (ack === "lost" && !forwarded) {
      forwarded = true;
      await route.fetch();
      return route.abort();
    }
    return route.continue();
  });
  await send(hostPage, "healing", 8, "Ceiling balm");
  await Promise.all([guestPage, otherTab].map(page => waitStatus(page,"Ceiling balm","Pending")));
  try {
    await Promise.all([guestPage, otherTab].map(page =>
      row(page,"Ceiling balm").getByRole("button",{name:"Accept",exact:true}).dispatchEvent("click")));
  } finally { releaseClaim(); }
  await expectHp(guestPage,20,9);
  await expectHp(otherTab,20,9);
  await waitStatus(hostPage,"Ceiling balm","Claimed");
  const receiptId = (await state(host)).offers.find(offer => offer.source === "Ceiling balm").offer_id;
  const readEnvelope = page => page.evaluate(() => JSON.parse(localStorage.getItem("aurora-combat-encounter-v1:" + document.body.dataset.profile)));
  let envelope = await readEnvelope(guestPage);
  assert.equal(Object.keys(envelope.partyDelivery.receipts).length, 1);
  assert.equal(envelope.partyDelivery.receipts[receiptId], true);
  assert.equal(envelope.progress.activity.filter(entry => entry.label.includes("Ceiling balm")).length, 1);
  await open(guestPage, guest);
  await expectHp(guestPage,20,9);
  const exportAfter = guestPage.waitForEvent("download");
  await session(guestPage).getByRole("button", {name:"Export tracker backup"}).click();
  const portable = fs.readFileSync(await (await exportAfter).path(), "utf8");
  assert.doesNotMatch(portable, /partyDelivery|offer_id|127\.0\.0\.1/);
  assert.ok(!portable.includes(receiptId));
  await undo(guestPage);
  await expectHp(guestPage,17,9);
  await expectHp(otherTab,17,9);
  await otherTab.close();
  ack = "lost";
  await waitStatus(hostPage,"Ceiling balm","Accepted");
  assert.ok(forwarded && acknowledgmentAttempts >= 2);
  assert.deepEqual(await hp(guestPage), {current:17,max:20,temporary:9});

  // Two senders offer at once. The smaller temporary HP offer still gets a receipt.
  ack = "normal";
  await Promise.all([send(hostPage,"temporary_hp",6,"Smaller ward"), send(thirdPage,"healing",2,"Declined draught")]);
  await row(guestPage,"Smaller ward").getByRole("button",{name:"Accept",exact:true}).click();
  await row(guestPage,"Declined draught").getByRole("button",{name:"Decline",exact:true}).click();
  await waitStatus(hostPage,"Smaller ward","Accepted");
  await waitStatus(thirdPage,"Declined draught","Declined");
  await expectHp(guestPage,17,9);
  assert.equal((await readEnvelope(guestPage)).undo.length,envelope.undo.length-1);
  const senderView = await state(host), observerView = await state(third);
  assert.ok(!observerView.offers.some(offer => offer.offer_id === receiptId));
  assert.ok(!senderView.offers.some(offer => offer.source === "Declined draught"));
  for (const response of [senderView,observerView]) {
    assert.doesNotMatch(JSON.stringify(response), /"current_hp"|"max_hp"|"temporary_hp":|"progress"|"hp":/);
  }

  await send(hostPage,"healing",2,"Retry balm");
  await waitStatus(guestPage,"Retry balm","Pending");
  await guestPage.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) {
      if (key.startsWith("aurora-combat-encounter") && JSON.parse(value).partyDelivery?.receipts) throw Error("Synthetic write failure");
      return set.call(this,key,value);
    };
  });
  await row(guestPage,"Retry balm").getByRole("button",{name:"Accept",exact:true}).click();
  await party(guestPage).getByText(/Could not save the offer/).waitFor();
  await waitStatus(hostPage,"Retry balm","Claimed");
  await expectHp(guestPage,17,9);
  await open(guestPage,guest);
  await row(guestPage,"Retry balm").getByRole("button",{name:"Apply offer"}).click();
  await waitStatus(hostPage,"Retry balm","Accepted");
  await expectHp(guestPage,19,9);

  for (const source of ["Saved-table cure","Restore and apply","Restore and decline"]) {
    await send(hostPage,"healing",1,source);
  }
  const active = await state(guest);
  const stale = (await state(host)).offers.filter(offer =>
    ["Saved-table cure","Restore and apply","Restore and decline"].includes(offer.source));
  for (const offer of stale) await command(guest,active.room_id,"claim",offer.offer_id);
  await session(guestPage).locator("#import-session").setInputFiles({name:"baseline.json",mimeType:"application/json",buffer:baseline});
  await session(guestPage).getByRole("button",{name:"Replace current tracker session"}).click();
  await guestPage.waitForLoadState();
  if (!await session(guestPage).evaluate(el=>el.open)) await reopen(guestPage);
  await party(guestPage).getByText(/Party detached/).waitFor();
  await expectHp(guestPage,17,9);
  assert.equal((await readEnvelope(guestPage)).partyDelivery.receipts[receiptId],true);
  await guest.stop();
  guest = await launch("guest","resume");
  await open(guestPage,guest);
  await row(guestPage,"Saved-table cure").getByRole("button",{name:"Already handled"}).click();
  await waitStatus(hostPage,"Saved-table cure","Accepted");
  await expectHp(guestPage,17,9);
  await row(guestPage,"Restore and apply").getByRole("button",{name:"Apply offer"}).click();
  await waitStatus(hostPage,"Restore and apply","Accepted");
  await expectHp(guestPage,18,9);
  await row(guestPage,"Restore and decline").getByRole("button",{name:"Decline",exact:true}).click();
  await waitStatus(hostPage,"Restore and decline","Declined");
  await expectHp(guestPage,18,9);
  await third.stop();
  console.log("Party offers passed capped healing, smaller temp HP, simultaneous offers, decline, two tabs, write failure, reload, dropped acknowledgment, undo, backup reconciliation and privacy.");
  return guest;
}
async function open(page,info){
  await page.goto(pathToFileURL(info.preview).href);
  if(await page.locator("#session-files").count()){
    await page.getByRole("button",{name:"Session",exact:true}).click();
    await page.locator("#party-controls summary").click();
  }
}
function encode(invite){return "aurora-party."+Buffer.from(JSON.stringify(invite)).toString("base64url");}
function lanPath(invite,route,body){
  const [hostname,port]=invite.endpoint.split(":");
  return new Promise((resolve,reject)=>{
    const der=Buffer.from(invite.certificate,"base64url");
    const ca="-----BEGIN CERTIFICATE-----\n"+der.toString("base64")+"\n-----END CERTIFICATE-----";
    const req=https.request({hostname,port,servername:"aurora-party.invalid",ca,path:route,method:"POST",headers:{"content-type":"application/json"}},res=>{res.resume();resolve(res.statusCode);});
    req.on("error",reject);req.end(body && JSON.stringify(body));
  });
}

async function main(){
  if (process.argv.includes("--monster-damage")) {
    await require("./monster-damage.cjs")({launch,pageFor,open,api});
    return;
  }
  if (process.argv.includes("--monster-actions")) {
    await require("./monster-actions.cjs")({launch,pageFor,open,api,pkg});
    return;
  }
  if (process.argv.includes("--srd521")) {
    await require("./srd521-pack.cjs")({launch,pageFor,open,api,distribution,pkg});
    return;
  }
  if (process.argv.includes("--srd51")) {
    await require("./srd51-pack.cjs")({launch,pageFor,open,api,distribution,pkg});
    return;
  }
  if (process.argv.includes("--monsters")) {
    await require("./monster-library.cjs")({launch,pageFor,open,api});
    return;
  }
  if (process.argv.includes("--initiative")) {
    await require("./shared-initiative.cjs")({launch,pageFor,open,api});
    return;
  }
  if (process.argv.includes("--dashboard")) {
    await require("./dm-dashboard.cjs")({launch,pageFor,open,api});
    return;
  }
  let host=await launch("host","host");
  const hostPage=await pageFor("host",host);
  await hostPage.getByText("Hosting",{exact:true}).waitFor();
  await hostPage.getByRole("button",{name:"Copy invite"}).click();
  await hostPage.getByText("Invitation copied.").waitFor();
  const invite=await hostPage.evaluate(()=>window.copiedInvitation);
  const parsed=JSON.parse(Buffer.from(invite.split(".")[1],"base64url"));
  assert.equal(await lanPath(parsed,"/stage"),404);
  assert.equal(await lanPath(parsed,"/end"),404);
  assert.equal((await api(host,"state","https://example.invalid")).status,403);
  assert.equal((await api({url:host.url.replace(/[^/]+$/,"invalid")},"state")).status,403);
  await assert.rejects(launch("wrong-version","join",encode({...parsed,version:9})),/Incompatible/);
  await assert.rejects(launch("unreachable","join",encode({...parsed,endpoint:"127.0.0.1:1"})),/unreachable/);
  let guest=await launch("guest","join",invite);
  const guestPage=await pageFor("guest",guest);
  await guestPage.getByText("Lark (you)",{exact:true}).waitFor();
  await hostPage.locator("#party-controls li").filter({hasText:/^Lark$/}).waitFor();
  if(process.argv.includes("--actions")) {
    await require("./party-actions.cjs")({host,hostPage,guest,guestPage,invite,launch,pageFor,open,api});
    return;
  }
  if(process.argv.includes("--review-refresh")){
    execFileSync(process.execPath,[path.join(__dirname,"browser-review.cjs")],{cwd:root,stdio:"inherit",env:{
      ...process.env,AURORA_TEST_LAUNCHER_WORKSPACE:path.join(pkg,"host"),AURORA_TEST_IMPORTER:path.join(pkg,"combat-sheet.exe")
    }});
  }
  const original=(await (await api(guest,"state")).json()).self_id;
  if(process.argv.includes("--offers")) guest=await reviewOffers(host,hostPage,guest,guestPage,invite);
  assert.equal((await api(guest,"end")).ok,false);
  assert.equal((await api(guest,"invite")).ok,false);
  await guestPage.reload(); await guestPage.getByRole("button",{name:"Session",exact:true}).click();
  await guestPage.locator("#party-controls summary").click();
  await guestPage.getByText("Lark (you)",{exact:true}).waitFor();

  const refresh=await guestPage.evaluate(async()=>{
    const url=document.body.dataset.refreshUrl;
    const stage=await fetch(url+"/stage",{method:"POST"});
    const html=new DOMParser().parseFromString(await stage.text(),"text/html");
    if(html.body.dataset.partyUrl!==document.body.dataset.partyUrl)throw Error("lost party attachment");
    return (await fetch(url+"/apply/"+html.body.dataset.refreshRevision,{method:"POST"})).status;
  });
  assert.equal(refresh,200);

  await hostPage.getByRole("button",{name:"Close invitations"}).click();
  await hostPage.getByRole("button",{name:"Open invitations"}).waitFor();
  await assert.rejects(launch("late","join",invite),/Invitation closed/);
  await host.stop();
  await guestPage.getByText(/Reconnecting/).waitFor();
  host=await launch("host","resume");
  await open(hostPage,host);
  await guestPage.getByText("Lark (you)",{exact:true}).waitFor();
  assert.equal((await (await api(guest,"state")).json()).self_id,original);
  await guest.stop();
  await hostPage.locator("#party-controls li").filter({hasText:/^Lark · Offline$/}).first().waitFor();
  guest=await launch("guest","resume");
  await open(guestPage,guest);
  await guestPage.getByText("Lark (you)",{exact:true}).waitFor();
  assert.equal((await (await api(guest,"state")).json()).self_id,original);
  const dm=await launch("dm","dm");
  const dmPage=await pageFor("dm",dm);
  await dmPage.getByText("Hosting as DM",{exact:true}).waitFor();
  const different=JSON.parse(Buffer.from((await (await api(dm,"invite")).json()).invite.split(".")[1],"base64url"));
  const id=()=>require("node:crypto").randomUUID();
  const hostCommand={version:1,room:different.room,command_id:id(),credential:id(),request:{kind:"create",mode:"dm"}};
  assert.equal(await lanPath(different,"/v1/party",hostCommand),422);
  await assert.rejects(launch("guest","join",encode({...different,room:parsed.room})),/identity changed/i);
  await assert.rejects(launch("fresh","join",encode({...parsed,endpoint:different.endpoint})),/identity/i);
  guestPage.on("dialog",d=>d.accept());await guestPage.getByRole("button",{name:"Leave party"}).click();
  await guestPage.getByText("Left party",{exact:true}).waitFor();
  await hostPage.getByRole("button",{name:"Open invitations"}).click();
  await hostPage.getByRole("button",{name:"Copy invite"}).waitFor();
  const replacement=(await (await api(host,"invite")).json()).invite;
  assert.notEqual(replacement,invite);
  await assert.rejects(launch("still-closed","join",invite),/Invitation closed/);
  await guest.stop();
  guest=await launch("guest","join",replacement);
  await open(guestPage,guest);
  await guestPage.getByText("Lark (you)",{exact:true}).waitFor();
  assert.notEqual((await (await api(guest,"state")).json()).self_id,original);
  hostPage.on("dialog",d=>d.accept());await hostPage.getByRole("button",{name:"End room"}).click();
  await hostPage.getByText("Room closed",{exact:true}).waitFor();
  await guestPage.getByText("Room closed",{exact:true}).waitFor();
  console.log("Packaged launcher components, TLS, scoped loopback controls, refresh, separate profiles, invite errors, reconnect, DM lobby, leave and close passed.");
  console.log("Checked package:",pkg);
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  for(const p of processes)p.stdin.end();
  await Promise.all(profiles.map(p=>p.close()));
});
