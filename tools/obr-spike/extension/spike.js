// Stage O0 spike for the Aurora Combat Tracker Owlbear integration.
// Throwaway code: it only records what Chrome and Owlbear allow.
import OBR, { buildShape, buildCurve } from "./obr-sdk-3.1.0.js";

const PORT = 47800;
const LOOPBACK = `http://127.0.0.1:${PORT}`;
const LOCALHOST = `http://localhost:${PORT}`;
const CHANNEL = "com.aurora-tracker.spike/msg";
const META = "com.aurora-tracker.spike/test";

const results = {
  spikeVersion: 1,
  startedAt: new Date().toISOString(),
  env: {},
  owlbear: {},
  direct: {},
  popup: {},
  scene: {},
  players: {},
};
const $ = (id) => document.getElementById(id);
let popup = null;
let popupWaiters = new Map();
let me = { id: null, name: null, role: null };
let lastSeen = new Map();
let selfMoving = false;

function verdict(value) {
  if (value === undefined) return ["wait", "not run"];
  if (value && typeof value === "object" && "ok" in value) return value.ok ? ["pass", "yes"] : ["fail", "no"];
  if (value === true) return ["pass", "yes"];
  if (value === false) return ["fail", "no"];
  return ["wait", String(value)];
}

function render() {
  const rows = [
    ["Embedding allows loopback-network", results.env.policyLoopback],
    ["Embedding allows local-network-access", results.env.policyLocalNetworkAccess],
    ["Direct fetch 127.0.0.1", results.direct.loopback],
    ["Direct fetch localhost", results.direct.localhost],
    ["Pop-up window opened", results.popup.opened],
    ["Pop-up kept window.opener", results.popup.ready],
    ["Pop-up round trip", results.popup.roundTrip],
    ["DM can add templates", results.scene.added],
    ["Broadcast reached players", Object.keys(results.players).length ? true : undefined],
  ];
  for (const [name, report] of Object.entries(results.players)) {
    rows.push([`${name}: moved DM circle by code`, report.programmaticMove]);
    rows.push([`${name}: dragged DM circle by hand`, report.manualDrag]);
    rows.push([`${name}: added own template`, report.ownTemplate]);
  }
  $("results").innerHTML = "";
  for (const [label, value] of rows) {
    const [cls, text] = verdict(value);
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span></span><span class="${cls}"></span>`;
    row.children[0].textContent = label;
    row.children[1].textContent = text;
    $("results").append(row);
  }
  $("raw").value = JSON.stringify(results, null, 2);
}

function describeError(error) {
  return `${error?.name || "Error"}: ${error?.message || error}`;
}

async function timedFetch(url, options = {}, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const started = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store", ...options, signal: controller.signal });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, error: describeError(error), ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

async function collectEnvironment() {
  results.env.userAgent = navigator.userAgent;
  results.env.origin = location.origin;
  results.env.inIframe = window.top !== window;
  const policy = document.featurePolicy;
  results.env.policyLoopback = policy ? policy.allowsFeature("loopback-network") : "featurePolicy missing";
  results.env.policyLocalNetwork = policy ? policy.allowsFeature("local-network") : "featurePolicy missing";
  results.env.policyLocalNetworkAccess = policy ? policy.allowsFeature("local-network-access") : "featurePolicy missing";
  results.env.allowedFeatures = policy ? policy.allowedFeatures() : null;
  for (const name of ["loopback-network", "local-network", "local-network-access"]) {
    try {
      const status = await navigator.permissions.query({ name });
      results.env[`permission:${name}`] = status.state;
    } catch (error) {
      results.env[`permission:${name}`] = describeError(error);
    }
  }
}

async function collectOwlbear() {
  me.id = await OBR.player.getId();
  me.name = await OBR.player.getName();
  me.role = await OBR.player.getRole();
  results.owlbear.role = me.role;
  results.owlbear.playerName = me.name;
  results.owlbear.permissions = await OBR.room.getPermissions();
  results.owlbear.sceneReady = await OBR.scene.isReady();
  if (results.owlbear.sceneReady) {
    results.owlbear.grid = {
      dpi: await OBR.scene.grid.getDpi(),
      scale: await OBR.scene.grid.getScale(),
      type: await OBR.scene.grid.getType(),
      measurement: await OBR.scene.grid.getMeasurement(),
    };
  }
}

async function runDirect() {
  results.direct.loopback = "running";
  results.direct.localhost = "running";
  render();
  results.direct.loopback = await timedFetch(`${LOOPBACK}/ping`, { targetAddressSpace: "loopback" });
  render();
  results.direct.localhost = await timedFetch(`${LOCALHOST}/ping`, { targetAddressSpace: "loopback" });
  render();
}

function popupRequest(type, extra = {}) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      popupWaiters.delete(id);
      resolve({ ok: false, error: "timed out waiting for the pop-up" });
    }, 15000);
    popupWaiters.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    popup.postMessage({ type, id, ...extra }, LOOPBACK);
  });
}

function openPopup() {
  results.popup = { opened: "running" };
  render();
  try {
    popup = window.open(
      `${LOOPBACK}/bridge.html?origin=${encodeURIComponent(location.origin)}`,
      "aurora-bridge-spike",
      "popup,width=480,height=320",
    );
  } catch (error) {
    results.popup.opened = { ok: false, error: describeError(error) };
    render();
    return;
  }
  results.popup.opened = Boolean(popup);
  if (!popup) results.popup.note = "window.open returned null: pop-ups blocked or the iframe sandbox lacks allow-popups";
  results.popup.ready = popup ? "waiting" : false;
  render();
  if (popup) {
    setTimeout(() => {
      if (results.popup.ready === "waiting") {
        results.popup.ready = { ok: false, error: "no message from the pop-up within 20 s (opener cut, or the page did not load)" };
        render();
      }
    }, 20000);
  }
}

window.addEventListener("message", async (event) => {
  if (event.origin !== LOOPBACK || !popup || event.source !== popup) return;
  const msg = event.data || {};
  if (msg.type === "bridge-ready") {
    results.popup.ready = { ok: true, pingFromPopup: msg.ping };
    render();
    results.popup.roundTrip = await popupRequest("ping");
    render();
  } else if (popupWaiters.has(msg.id)) {
    popupWaiters.get(msg.id)(msg.result);
    popupWaiters.delete(msg.id);
  }
});

async function templateAnchor() {
  const selection = await OBR.player.getSelection();
  if (selection && selection.length) {
    const box = await OBR.scene.items.getItemBounds(selection);
    return box.center;
  }
  const width = await OBR.viewport.getWidth();
  const height = await OBR.viewport.getHeight();
  return OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
}

async function makeTemplates() {
  try {
    const dpi = await OBR.scene.grid.getDpi();
    const scale = await OBR.scene.grid.getScale();
    const feetPerCell = scale.parsed?.multiplier || 5;
    const px = (feet) => (feet / feetPerCell) * dpi;
    const anchor = await templateAnchor();
    const circle = buildShape()
      .shapeType("CIRCLE")
      .width(px(40))
      .height(px(40))
      .position({ x: anchor.x + px(30), y: anchor.y })
      .fillColor("#ff7043")
      .fillOpacity(0.25)
      .strokeColor("#ff7043")
      .strokeWidth(4)
      .name("Spike: Fireball, 20 ft radius")
      .layer("DRAWING")
      .locked(false)
      .metadata({ [META]: { kind: "circle", radiusFeet: 20 } })
      .build();
    const length = px(15);
    const cone = buildCurve()
      .points([{ x: 0, y: 0 }, { x: length, y: -length / 2 }, { x: length, y: length / 2 }])
      .closed(true)
      .tension(0)
      .fillColor("#42a5f5")
      .fillOpacity(0.25)
      .strokeColor("#42a5f5")
      .strokeWidth(4)
      .position(anchor)
      .name("Spike: Burning Hands, 15 ft cone")
      .layer("DRAWING")
      .locked(false)
      .metadata({ [META]: { kind: "cone", lengthFeet: 15 } })
      .build();
    await OBR.scene.items.addItems([circle, cone]);
    results.scene.added = { ok: true, circleId: circle.id, coneId: cone.id, dpi, scale: scale.raw };
  } catch (error) {
    results.scene.added = { ok: false, error: describeError(error) };
  }
  render();
}

async function clearTemplates() {
  const items = await OBR.scene.items.getItems((item) => item.metadata?.[META]);
  await OBR.scene.items.deleteItems(items.map((item) => item.id));
}

function report(field, value) {
  OBR.broadcast.sendMessage(CHANNEL, { type: "report", from: me.name, playerId: me.id, field, value }, { destination: "REMOTE" });
}

async function playerMove() {
  const items = await OBR.scene.items.getItems((item) => item.metadata?.[META]?.kind === "circle");
  if (!items.length) return report("programmaticMove", { ok: false, error: "no DM circle found" });
  try {
    selfMoving = true;
    const dpi = await OBR.scene.grid.getDpi();
    await OBR.scene.items.updateItems(items.map((item) => item.id), (drafts) => {
      for (const draft of drafts) draft.position = { x: draft.position.x + dpi, y: draft.position.y };
    });
    // Read back: if Owlbear refused the change, the position is unchanged.
    const [after] = await OBR.scene.items.getItems([items[0].id]);
    const moved = after && after.position.x !== items[0].position.x;
    report("programmaticMove", moved ? { ok: true } : { ok: false, error: "update ignored" });
  } catch (error) {
    report("programmaticMove", { ok: false, error: describeError(error) });
  } finally {
    setTimeout(() => { selfMoving = false; }, 1000);
  }
}

async function playerOwn() {
  try {
    const dpi = await OBR.scene.grid.getDpi();
    const anchor = await templateAnchor();
    const own = buildShape()
      .shapeType("CIRCLE").width(dpi * 2).height(dpi * 2)
      .position(anchor)
      .fillColor("#ab47bc").fillOpacity(0.25).strokeColor("#ab47bc").strokeWidth(4)
      .name(`Spike: ${me.name}'s template`).layer("DRAWING").locked(false)
      .metadata({ [META]: { kind: "player-own" } })
      .build();
    await OBR.scene.items.addItems([own]);
    const [back] = await OBR.scene.items.getItems([own.id]);
    report("ownTemplate", back ? { ok: true } : { ok: false, error: "item not found after add" });
  } catch (error) {
    report("ownTemplate", { ok: false, error: describeError(error) });
  }
}

function watchScene() {
  OBR.scene.items.onChange((items) => {
    for (const item of items) {
      if (!item.metadata?.[META]) continue;
      const before = lastSeen.get(item.id);
      const now = `${item.position.x},${item.position.y},${item.rotation}`;
      lastSeen.set(item.id, now);
      if (!before || before === now) continue;
      if (me.role === "PLAYER" && item.lastModifiedUserId === me.id && !selfMoving && item.metadata[META].kind === "circle") {
        report("manualDrag", { ok: true });
      }
      if (me.role === "GM" && item.lastModifiedUserId !== me.id) {
        results.scene.movedByOthers = (results.scene.movedByOthers || 0) + 1;
        render();
      }
    }
  });
}

async function savePayload() {
  return { ...results, savedAt: new Date().toISOString() };
}

async function save() {
  const body = JSON.stringify(await savePayload());
  let outcome = await timedFetch(`${LOOPBACK}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    targetAddressSpace: "loopback",
  });
  if (!outcome.ok && popup && !popup.closed) {
    outcome = await popupRequest("results", { body: JSON.parse(body) });
    outcome.via = "pop-up";
  }
  results.saved = outcome;
  render();
  await OBR.notification.show(outcome.ok ? "Spike results saved on this PC." : "Saving failed. Copy the raw results instead.", outcome.ok ? "SUCCESS" : "ERROR");
}

OBR.onReady(async () => {
  await collectEnvironment();
  await collectOwlbear();
  $("who").textContent = `${me.name} (${me.role === "GM" ? "DM" : "player"}) in ${location.origin}`;
  $(me.role === "GM" ? "gm" : "player").hidden = false;
  render();
  watchScene();

  OBR.broadcast.onMessage(CHANNEL, async (event) => {
    const msg = event.data || {};
    if (me.role === "PLAYER" && msg.type === "ping") {
      OBR.broadcast.sendMessage(CHANNEL, {
        type: "pong", from: me.name, playerId: me.id,
        env: { userAgent: navigator.userAgent }, permissions: results.owlbear.permissions,
      }, { destination: "REMOTE" });
    }
    if (me.role === "GM" && (msg.type === "pong" || msg.type === "report")) {
      const entry = results.players[msg.from] ||= { playerId: msg.playerId };
      if (msg.type === "pong") Object.assign(entry, { pong: true, env: msg.env, permissions: msg.permissions });
      else entry[msg.field] = msg.value;
      render();
    }
  });

  if (me.role === "GM") {
    $("run-direct").onclick = runDirect;
    $("run-popup").onclick = openPopup;
    $("make-templates").onclick = makeTemplates;
    $("ping-players").onclick = () => OBR.broadcast.sendMessage(CHANNEL, { type: "ping" }, { destination: "REMOTE" });
    $("clear-templates").onclick = clearTemplates;
    $("save").onclick = save;
  } else {
    $("player-move").onclick = playerMove;
    $("player-own").onclick = playerOwn;
  }
});
