const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawn,execFileSync} = require("node:child_process");
const {once} = require("node:events");
const {createInterface} = require("node:readline");
const {pathToFileURL} = require("node:url");
const https = require("node:https");
const {chromium} = require("playwright");

const root = path.resolve(__dirname,"..");
const pkg = fs.mkdtempSync(path.join(root,"target","p02-package-"));
execFileSync("cmd.exe",["/d","/c","launcher\\build.cmd",path.relative(root,pkg)],{cwd:root});
const csc=path.join(process.env.SystemRoot,"Microsoft.NET","Framework64","v4.0.30319","csc.exe");
const harness=path.join(pkg,"PartyHarness.exe");
execFileSync(csc,["/nologo","/main:PartyHarness","/out:"+harness,"/reference:System.Windows.Forms.dll","/reference:System.Drawing.dll","/reference:System.Web.Extensions.dll","/resource:"+path.join(root,"src","combat","party.js")+",party.js",...["tests/PartyHarness.cs","launcher/TrackerLauncher.cs","launcher/RefreshBridge.cs","launcher/PartySession.cs"].map(f=>path.join(root,f))],{cwd:root});
const processes=new Set(), profiles=[];
async function launch(profile,mode,invite="") {
  const data=path.join(pkg,profile);
  fs.mkdirSync(data,{recursive:true});
  const save=path.join(data,"review.dnd5e"),xml=path.join(data,"review.xml");
  if(!fs.existsSync(save)){
    fs.copyFileSync(path.join(__dirname,"fixtures","combat-sheet.dnd5e"),save);
    fs.copyFileSync(path.join(__dirname,"fixtures","combat-sheet.xml"),xml);
  }
  const p=spawn(harness,[save,xml],{env:{...process.env,LOCALAPPDATA:data},windowsHide:true});
  processes.add(p);
  const finished=once(p,"exit").then(()=>processes.delete(p));
  let errors="";
  p.stderr.on("data",d=>errors+=d);
  const lines=createInterface({input:p.stdout});
  const ready=once(lines,"line").then(([line])=>JSON.parse(line));
  p.stdin.write(JSON.stringify({profile:save,mode,name:profile==="host"?"Warden":"Lark",bind:mode==="host"||mode==="dm"?"127.0.0.1":null,invite})+"\n");
  const info=await Promise.race([ready,finished.then(()=>{throw Error(errors.trim() || "helper stopped");})]);
  return {...info,stop:async()=>{p.stdin.end(); await finished;}};
}
async function api(info,action,origin="null") {
  return fetch(info.url+"/"+action,{method:"POST",headers:{origin}});
}
async function pageFor(name,info) {
  const profile=await chromium.launchPersistentContext(path.join(pkg,name+"-chrome"),{executablePath:process.env.AURORA_TEST_CHROME});
  profiles.push(profile);
  const page=await profile.newPage();
  // Exercise the copy button without replacing the Windows user's clipboard.
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{window.copiedInvitation=text;}}}));
  await open(page,info);
  return page;
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
  await hostPage.getByText("Lark",{exact:true}).waitFor();
  if(process.argv.includes("--review-refresh")){
    execFileSync(process.execPath,[path.join(__dirname,"browser-review.cjs")],{cwd:root,stdio:"inherit",env:{
      ...process.env,AURORA_TEST_LAUNCHER_WORKSPACE:path.join(pkg,"host"),AURORA_TEST_IMPORTER:path.join(pkg,"combat-sheet.exe")
    }});
  }
  const original=(await (await api(guest,"state")).json()).self_id;
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
  await hostPage.getByText("Lark · Offline",{exact:true}).waitFor();
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
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
  for(const p of processes)p.stdin.end();
  await Promise.all(profiles.map(p=>p.close()));
});
