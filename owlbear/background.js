// Background page: owns the DM's connection to the tracker for as long as the room is open,
// and keeps linked tokens in step with the encounter. The popover and the link picker talk to
// it over a BroadcastChannel, because they close often.
import OBR from "./obr-sdk-3.1.0.js";
import { BridgeClient } from "./bridge-client.js";
import { LINK, addTokens, adoptPlayerTokens, linkToken, linkedRows, removeTokens, syncTokens, unlinkToken } from "./tokens.js";
import { autoMatch } from "./players.js";
import { insideReports, listenForDraws, syncTemplates } from "./template-sync.js";

// Send inside reports when they change, and now and then in case the helper restarted.
const RESEND_MS = 10000;
let lastInside = { key: "", at: 0 };
let insideTimer = null;

const POLL_MS = 2000;
const BASE = new URL(".", import.meta.url).href;
const channel = new BroadcastChannel("aurora-obr");
const state = { role: null, connected: false, paired: false, table: null, onMap: {}, error: null, mapError: null, mapNotes: [], checkedAt: null, startedAt: Date.now() };
let client = null;
let badge = null;
let syncing = false;
// Rows seen in this encounter, so a monster or companion added mid-fight gets a token.
let seen = null;

function publish() {
  state.connected = Boolean(client && client.connected);
  state.paired = Boolean(client && client.paired);
  channel.postMessage({ type: "state", state });
  if (state.role !== "GM") return;
  // A small badge on the toolbar icon says the link needs attention.
  const next = state.connected && state.paired && !state.error ? "" : "!";
  if (next !== badge) {
    badge = next;
    OBR.action.setBadgeText(next || undefined).catch(() => {});
    if (next) OBR.action.setBadgeBackgroundColor("#c0392b").catch(() => {});
  }
}

async function syncMap() {
  if (!state.table || syncing) return;
  syncing = true;
  try {
    await placeNewRows(state.table);
    await syncTokens(state.table);
    state.onMap = await linkedRows(state.table.room_id);
    const matches = autoMatch(state.table.room_id, await OBR.party.getPlayers(), state.table.encounter.rows);
    if (await adoptPlayerTokens(state.table, matches)) state.onMap = await linkedRows(state.table.room_id);
    state.mapNotes = await syncTemplates(state.table);
    await reportInside();
    state.mapError = null;
  } catch (error) {
    state.mapError = error.message || String(error);
  } finally {
    syncing = false;
  }
}

// Once the encounter is running, a monster added to the tracker is put on the map, hidden
// until the DM reveals it, and a companion summoned mid-fight (such as an Eldritch Cannon) is
// put beside its owner's token. Rows that were there when the link started are left to the DM.
async function placeNewRows(table) {
  const encounter = table.encounter;
  const key = `${table.room_id}/${encounter.id}`;
  const ids = encounter.rows.filter((row) => row.kind !== "player").map((row) => row.id);
  if (!seen || seen.key !== key) {
    seen = { key, ids: new Set(ids) };
    return;
  }
  const fresh = encounter.rows.filter((row) => row.kind !== "player" && !seen.ids.has(row.id));
  if (!fresh.length) return;
  for (const row of fresh) seen.ids.add(row.id);
  if (!encounter.running || !(await OBR.scene.isReady())) return;
  const enemies = fresh.filter((row) => row.kind === "enemy").map((row) => row.id);
  if (enemies.length) await addTokens(table, enemies, { hidden: true });
  const onMap = await linkedRows(table.room_id);
  for (const row of fresh.filter((r) => r.kind === "companion")) {
    const owner = encounter.rows.find((r) => r.kind === "player" && r.member_id === row.member_id);
    const token = owner && onMap[owner.id] ? (await OBR.scene.items.getItems([onMap[owner.id]]))[0] : null;
    await addTokens(table, [row.id], { near: token?.position });
  }
}

async function reportInside() {
  if (!state.table || !client || !client.paired) return;
  const { reports, note } = await insideReports(state.table);
  if (note) state.mapNotes = [...state.mapNotes, note];
  const key = JSON.stringify(reports);
  if (key === lastInside.key && Date.now() - lastInside.at < RESEND_MS) return;
  await client.request("inside", { reports });
  lastInside = { key, at: Date.now() };
}

// A template or token moved: update the suggestion once a drag pauses.
function insideSoon() {
  clearTimeout(insideTimer);
  insideTimer = setTimeout(() => reportInside().catch(() => {}), 150);
}

async function refresh() {
  if (client && client.connected && client.paired) {
    try {
      state.table = await client.table();
      state.error = null;
      await syncMap();
    } catch (error) {
      state.error = error.message;
      if (!client.paired) state.table = null;
    }
    state.checkedAt = new Date().toISOString();
  }
  publish();
}

async function answer(msg, work) {
  try {
    const result = await work();
    channel.postMessage({ type: "result", id: msg.id, ok: true, result });
  } catch (error) {
    channel.postMessage({ type: "result", id: msg.id, ok: false, error: error.message || String(error) });
  }
  await syncMap();
  publish();
}

function needTable() {
  if (!state.table) throw new Error("Link the tracker first.");
  return state.table;
}

channel.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === "get") publish();
  if (!client) return;
  if (msg.type === "pair") {
    try {
      await client.pair(String(msg.code || ""));
      state.error = null;
      channel.postMessage({ type: "pair-result", id: msg.id, ok: true });
      await refresh();
    } catch (error) {
      channel.postMessage({ type: "pair-result", id: msg.id, ok: false, error: error.message });
    }
  }
  if (msg.type === "forget") {
    client.forget();
    state.table = null;
    state.error = null;
    publish();
  }
  if (msg.type === "add") await answer(msg, () => addTokens(needTable(), msg.rows || []));
  if (msg.type === "remove") await answer(msg, () => removeTokens(needTable().room_id, msg.rows || []));
  if (msg.type === "link") {
    await answer(msg, async () => {
      const table = needTable();
      const row = table.encounter.rows.find((r) => r.id === msg.row);
      if (!row) throw new Error("That row is no longer in the encounter.");
      if ((await linkedRows(table.room_id))[row.id]) throw new Error(`${row.name || "That row"} already has a token.`);
      await linkToken(msg.item, table.room_id, row);
      await OBR.popover.close("com.aurora-tracker/link-picker");
    });
  }
};

function createMenus() {
  OBR.contextMenu.create({
    id: "com.aurora-tracker/link",
    icons: [{
      icon: `${BASE}icon-link.svg`,
      label: "Link to tracker row",
      filter: { roles: ["GM"], max: 1, every: [{ key: "layer", value: "CHARACTER" }, { key: ["metadata", LINK], value: undefined }] },
    }],
    onClick(context, elementId) {
      const item = context.items[0];
      OBR.popover.open({
        id: "com.aurora-tracker/link-picker",
        url: `${BASE}link.html?item=${encodeURIComponent(item.id)}`,
        width: 300,
        height: 360,
        anchorElementId: elementId,
      });
    },
  });
  OBR.contextMenu.create({
    id: "com.aurora-tracker/unlink",
    icons: [{
      icon: `${BASE}icon-link.svg`,
      label: "Unlink from tracker",
      filter: { roles: ["GM"], max: 1, every: [{ key: ["metadata", LINK], value: undefined, operator: "!=" }] },
    }],
    async onClick(context) {
      const link = context.items[0].metadata[LINK];
      await unlinkToken(context.items[0].id, link.room);
      await syncMap();
      publish();
    },
  });
}

OBR.onReady(async () => {
  state.role = await OBR.player.getRole();
  if (state.role === "GM") {
    client = new BridgeClient({ onChange: () => refresh() });
    createMenus();
    setInterval(refresh, POLL_MS);
    OBR.scene.items.onChange(insideSoon);
  } else {
    // Players' extensions draw the templates they cast, so they own them.
    listenForDraws();
  }
  publish();
  OBR.player.onChange((player) => {
    if (player.role !== state.role) location.reload();
  });
});
