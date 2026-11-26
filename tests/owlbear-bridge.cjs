// O1 Owlbear bridge rehearsal: DM helper bridge window, pairing, reload recovery and the
// request checks, with Owlbear and the extension host stood in by routed pages.
//
//   AURORA_PARTY=target/debug/aurora-party node tests/owlbear-bridge.cjs
//
// On Windows point AURORA_PARTY at the built aurora-party.exe. Elsewhere the helper must be
// a preview build (RUSTFLAGS="--cfg aurora_preview"), because the runtime is Windows-only.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const helperPath = path.resolve(process.env.AURORA_PARTY || path.join(root, "target", "debug", process.platform === "win32" ? "aurora-party.exe" : "aurora-party"));
const extension = path.join(root, "owlbear");
const OWLBEAR = "https://www.owlbear.rodeo";
const EXT = "https://raw.githack.com/test/owlbear";

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

function startHelper(appData) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, ["serve"], {
      env: { ...process.env, LOCALAPPDATA: appData },
      stdio: ["pipe", "pipe", "inherit"],
    });
    child.on("error", reject);
    child.on("exit", (code) => code && reject(new Error("helper exited " + code)));
    createInterface({ input: child.stdout }).once("line", (line) => resolve({ child, ...JSON.parse(line) }));
    child.stdin.write(JSON.stringify({ mode: "dm", profile: "owlbear-test", name: "Warden", bind: "127.0.0.1" }) + "\n");
  });
}

async function local(url, action) {
  const response = await fetch(url + "/" + action, { method: "POST", headers: { Origin: "null" } });
  assert(response.ok, action + " " + response.status);
  return response.json();
}

function raw(port, { method = "GET", pathname, host, origin, body }) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    if (body) headers["Content-Type"] = "application/json";
    const req = http.request({ host: "127.0.0.1", port, method, path: pathname, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const page = (body) => `<!doctype html><meta charset="utf-8"><body>${body}</body>`;

async function main() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-obr-"));
  const helper = await startHelper(appData);
  let browser;
  try {
    const link = await local(helper.url, "owlbear");
    const port = link.port;
    const bridge = `http://127.0.0.1:${port}/obr/bridge`;
    assert(/^[A-HJ-NP-Z2-9]{6}$/.test(link.code), "pairing code shape " + link.code);
    assert(link.sessions === 0, "no sessions before pairing");

    // Request checks, without a browser.
    const okHost = `127.0.0.1:${port}`;
    const self = `http://127.0.0.1:${port}`;
    assert((await raw(port, { pathname: "/obr/bridge", host: okHost })).status === 200, "bridge page served");
    const served = await raw(port, { pathname: "/obr/bridge", host: okHost });
    assert(served.headers["x-frame-options"] === "DENY", "bridge cannot be framed");
    assert(/frame-ancestors 'none'/.test(served.headers["content-security-policy"]), "bridge CSP");
    assert((await raw(port, { pathname: "/obr/bridge", host: `rebound.example:${port}` })).status === 403, "DNS rebinding host refused");
    const api = (action, origin, payload) => raw(port, { method: "POST", pathname: "/obr/api/" + action, host: okHost, origin, body: JSON.stringify(payload) });
    assert((await api("table", OWLBEAR, { token: "x" })).status === 403, "foreign origin refused");
    assert((await api("table", "null", { token: "x" })).status === 403, "file origin refused");
    assert((await api("table", self, { token: "x" })).status === 401, "unknown token refused");
    assert((await api("pair", self, { code: "WRONG2" })).status === 401, "wrong code refused");

    // Browser rehearsal: a stand-in Owlbear tab with the extension background nested two
    // frames deep, the popover beside it, and a frame from another origin that must stay deaf.
    browser = await chromium.launch();
    const context = await browser.newContext();
    await context.route(`${OWLBEAR}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/room") {
        return route.fulfill({ contentType: "text/html", body: page(`<iframe id="wrap" src="/wrapper"></iframe><iframe id="popover" src="${EXT}/popover-test.html"></iframe><iframe id="spy" src="https://spy.example/spy.html"></iframe>`) });
      }
      return route.fulfill({ contentType: "text/html", body: page(`<iframe id="background" src="${EXT}/background-test.html"></iframe>`) });
    });
    await context.route(`${EXT}/**`, (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop();
      if (name === "bridge-client.js") {
        return route.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(extension, name), "utf8") });
      }
      if (name === "background-test.html") {
        return route.fulfill({ contentType: "text/html", body: page(`<script type="module">
          import { BridgeClient } from "./bridge-client.js";
          window.events = [];
          window.client = new BridgeClient({ onChange: (e) => window.events.push(e), timeoutMs: 5000 });
        </script>`) });
      }
      return route.fulfill({ contentType: "text/html", body: page(`<button id="open" onclick="window.open('${bridge}','aurora-obr-bridge','popup,width=440,height=220')">Open bridge window</button>`) });
    });
    await context.route("https://spy.example/**", (route) => route.fulfill({ contentType: "text/html", body: page(`<script>
      window.heard = []; addEventListener("message", (e) => window.heard.push(e.data && e.data.type));
    </script>`) }));

    const tab = await context.newPage();
    await tab.goto(`${OWLBEAR}/room`);
    const frameByUrl = (part) => tab.frames().find((f) => f.url().includes(part));
    const waitFor = async (fn, what, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await fn()) return;
        await tab.waitForTimeout(200);
      }
      throw new Error("Timed out waiting for " + what);
    };
    await waitFor(() => frameByUrl("background-test") && frameByUrl("background-test").evaluate(() => Boolean(window.client)), "background frame");

    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      frameByUrl("popover-test").click("#open"),
    ]);
    await popup.waitForLoadState();
    assert(popup.url() === bridge, "bridge window at " + popup.url());
    const background = () => frameByUrl("background-test");
    await waitFor(() => background().evaluate(() => window.client.connected), "bridge claim");
    assert((await popup.textContent("#state")).includes("Connected"), "bridge shows connected");

    const failed = await background().evaluate(() => window.client.pair("AAAAAA").then(() => "paired", (e) => e.message));
    assert(/not right/.test(failed), "wrong code message: " + failed);
    const fresh = await local(helper.url, "owlbear");
    const paired = await background().evaluate((code) => window.client.pair(code).then((r) => r.room_id), fresh.code.toLowerCase());
    assert(/^[0-9a-f-]{36}$/.test(paired), "paired into room " + paired);
    const table = await background().evaluate(() => window.client.table());
    assert(table.room_id === paired && Array.isArray(table.encounter.rows), "table view through the bridge");
    const after = await local(helper.url, "owlbear");
    assert(after.sessions === 1 && after.last_seen <= 2 && after.code !== fresh.code, "dashboard sees the session and a new code");
    const spyHeard = await frameByUrl("spy.example").evaluate(() => window.heard);
    assert(!spyHeard.includes("aurora-obr-hello"), "a frame on another origin never hears the bridge");

    // An Owlbear reload replaces the extension frames. The bridge says hello again and the
    // new background reconnects with the saved token, without another click.
    await tab.reload();
    await waitFor(() => background() && background().evaluate(() => Boolean(window.client)), "background after reload");
    await waitFor(() => background().evaluate(() => window.client.connected), "reconnect after reload", 20000);
    const again = await background().evaluate(() => window.client.table().then((t) => t.room_id));
    assert(again === paired, "saved token still works after reload");

    // Unpair from the dashboard: the extension's token stops working and it forgets it.
    await local(helper.url, "owlbear_disconnect");
    const refused = await background().evaluate(() => window.client.table().then(() => "ok", (e) => e.status));
    assert(refused === 401, "revoked token refused: " + refused);
    assert(await background().evaluate(() => !window.client.paired), "extension forgets a refused token");

    // Closing the bridge window disconnects; requests fail fast with a clear message.
    await popup.close();
    const closed = await background().evaluate(() => window.client.table().then(() => "ok", (e) => e.message));
    assert(/bridge window/.test(closed), "closed bridge message: " + closed);
    console.log("owlbear-bridge: all checks passed");
  } finally {
    if (browser) await browser.close();
    helper.child.stdin.end();
    helper.child.kill();
    fs.rmSync(appData, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
