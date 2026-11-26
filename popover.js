// Popover UI. The background page owns the connection; this page only shows its state and
// opens the bridge window, which needs a click from the DM.
import OBR from "./obr-sdk-3.1.0.js";
import { DEFAULT_PORT, bridgeUrl, savePort, savedPort } from "./bridge-client.js";

const $ = (id) => document.getElementById(id);
const channel = new BroadcastChannel("aurora-obr");
let state = null;
let pairing = null;

const KIND = { enemy: "Enemy", player: "Player", companion: "Companion" };

function setSummary(text, tone) {
  $("summary").textContent = text;
  $("summary").dataset.tone = tone || "";
}

function renderRows(table) {
  const list = $("rows");
  list.replaceChildren();
  const encounter = table?.encounter;
  const rows = encounter?.rows || [];
  $("encounter-title").textContent = encounter?.running ? `Encounter · round ${encounter.round}` : "Encounter (not started)";
  $("rows-empty").hidden = rows.length > 0;
  for (const row of rows) {
    const item = document.createElement("li");
    item.dataset.current = String(row.id === encounter.current);
    const name = document.createElement("span");
    name.textContent = row.name || "Hidden enemy";
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = KIND[row.kind] || row.kind;
    item.append(name, kind);
    list.append(item);
  }
}

function render() {
  if (!state || !state.role) return;
  const gm = state.role === "GM";
  $("gm-view").hidden = !gm;
  $("player-view").hidden = gm;
  if (!gm) {
    setSummary("Player view");
    return;
  }
  $("step-bridge").dataset.done = String(state.connected);
  $("step-pair").hidden = !state.connected || state.paired;
  $("linked").hidden = !(state.connected && state.paired && state.table);
  if (state.table) renderRows(state.table);
  if (!state.connected) setSummary("Not connected. Open the bridge window.", "bad");
  else if (!state.paired) setSummary("Bridge open. Enter the pairing code.");
  else if (state.error) setSummary("Linked, but the last update failed.", "bad");
  else setSummary("Linked to the tracker.", "ok");
  $("error").hidden = !state.error;
  $("error").textContent = state.error || "";
}

channel.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "state") {
    state = msg.state;
    render();
  }
  if (msg.type === "pair-result" && msg.id === pairing) {
    pairing = null;
    $("pair-form").querySelector("button").disabled = false;
    if (msg.ok) $("code").value = "";
    else {
      $("error").hidden = false;
      $("error").textContent = msg.error;
    }
  }
};

$("port").value = String(savedPort());
$("port").addEventListener("change", () => {
  const port = Number($("port").value);
  if (Number.isInteger(port) && port > 0 && port < 65536) savePort(port);
  else $("port").value = String(DEFAULT_PORT);
});

$("open-bridge").addEventListener("click", () => {
  const popup = window.open(bridgeUrl(), "aurora-obr-bridge", "popup,width=440,height=220");
  if (!popup) {
    $("error").hidden = false;
    $("error").textContent = "Chrome blocked the window. Allow pop-ups for owlbear.rodeo and try again.";
  }
});

$("pair-form").addEventListener("submit", (event) => {
  event.preventDefault();
  pairing = crypto.randomUUID();
  $("pair-form").querySelector("button").disabled = true;
  channel.postMessage({ type: "pair", id: pairing, code: $("code").value });
  const mine = pairing;
  setTimeout(() => {
    if (pairing !== mine) return;
    pairing = null;
    $("pair-form").querySelector("button").disabled = false;
    $("error").hidden = false;
    $("error").textContent = "No answer from the tracker. Check that the bridge window is open.";
  }, 15000);
});

$("forget").addEventListener("click", () => channel.postMessage({ type: "forget" }));

OBR.onReady(async () => {
  try {
    document.documentElement.dataset.theme = (await OBR.theme.getTheme()).mode;
    OBR.theme.onChange((theme) => { document.documentElement.dataset.theme = theme.mode; });
  } catch {}
  channel.postMessage({ type: "get" });
});
