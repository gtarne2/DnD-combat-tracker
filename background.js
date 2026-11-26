// Background page: owns the DM's connection to the tracker for as long as the room is open.
// The popover talks to it over a BroadcastChannel, because the popover closes often.
import OBR from "./obr-sdk-3.1.0.js";
import { BridgeClient } from "./bridge-client.js";

const POLL_MS = 2000;
const channel = new BroadcastChannel("aurora-obr");
const state = { role: null, connected: false, paired: false, table: null, error: null, checkedAt: null };
let client = null;
let badge = null;

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

async function refresh() {
  if (client && client.connected && client.paired) {
    try {
      state.table = await client.table();
      state.error = null;
    } catch (error) {
      state.error = error.message;
      if (!client.paired) state.table = null;
    }
    state.checkedAt = new Date().toISOString();
  }
  publish();
}

channel.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === "get") publish();
  if (msg.type === "pair" && client) {
    try {
      await client.pair(String(msg.code || ""));
      state.error = null;
      channel.postMessage({ type: "pair-result", id: msg.id, ok: true });
      await refresh();
    } catch (error) {
      channel.postMessage({ type: "pair-result", id: msg.id, ok: false, error: error.message });
    }
  }
  if (msg.type === "forget" && client) {
    client.forget();
    state.table = null;
    state.error = null;
    publish();
  }
};

OBR.onReady(async () => {
  state.role = await OBR.player.getRole();
  if (state.role === "GM") {
    client = new BridgeClient({ onChange: () => refresh() });
    setInterval(refresh, POLL_MS);
  }
  publish();
  OBR.player.onChange((player) => {
    if (player.role !== state.role) location.reload();
  });
});
