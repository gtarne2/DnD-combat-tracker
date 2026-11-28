// Popover UI. The background page owns the connection; this page only shows its state and
// opens the bridge window, which needs a click from the DM.
import OBR from "./obr-sdk-3.1.0.js";
import { DEFAULT_PORT, bridgeUrl, savePort, savedPort } from "./bridge-client.js";
import { STANDARD_CONDITIONS, artKey, artSearch, chooseArt as rememberArt, conditionKey, encounterConditions, groupKey, loadArt, loadConditionArt, saveArt, saveConditionArt } from "./tokens.js";
import { loadMatches, saveMatch } from "./players.js";
import { KIND, rowLabel } from "./labels.js";

const $ = (id) => document.getElementById(id);
const channel = new BroadcastChannel("aurora-obr");
let state = null;
let pairing = null;
let players = [];
const waiting = new Set();
let note = null;

/** Show an action error until the next action; the tracker's own error wins. */
function showError(text) {
  note = text || null;
  const shown = state?.error || note;
  $("error").hidden = !shown;
  $("error").textContent = shown || "";
}

/** Ask the background page to do something with tokens; it answers with a result message. */
function ask(type, fields) {
  const id = crypto.randomUUID();
  waiting.add(id);
  note = null;
  channel.postMessage({ type, id, ...fields });
  render();
}

function button(label, onClick, title) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "small";
  b.textContent = label;
  if (title) b.title = title;
  b.disabled = waiting.size > 0;
  b.addEventListener("click", onClick);
  return b;
}

// Owlbear's asset picker opens on the creature type or class, which matches its built-in
// Characters art (Dragon, Beast, Artificer and so on).
async function chooseArt(row) {
  try {
    const picked = await OBR.assets.downloadImages(false, artSearch(row), "CHARACTER");
    if (picked && picked[0]) {
      rememberArt(row, picked[0]);
      ask("art", { row: row.id });
    }
  } catch (error) {
    showError(error.message || String(error));
  }
}

function forgetArt(row) {
  saveArt(artKey(row), null);
  ask("art", { row: row.id });
}

async function chooseConditionArt(name) {
  try {
    const picked = await OBR.assets.downloadImages(false, name, "ATTACHMENT");
    if (picked && picked[0]) {
      saveConditionArt(name, picked[0]);
      render();
    }
  } catch (error) {
    showError(error.message || String(error));
  }
}

function renderConditions(table) {
  const list = $("conditions");
  list.replaceChildren();
  const art = loadConditionArt();
  const inFight = encounterConditions(table);
  const names = [...inFight];
  for (const name of STANDARD_CONDITIONS) if (!names.some((n) => conditionKey(n) === conditionKey(name))) names.push(name);
  const missing = inFight.filter((name) => !art[conditionKey(name)]);
  // Open the list when an enemy has a condition without a marker yet.
  if (missing.length && !$("condition-art").dataset.seen) {
    $("condition-art").open = true;
    $("condition-art").dataset.seen = "1";
  }
  for (const name of names) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name + (inFight.includes(name) ? " · in this fight" : "");
    const actions = document.createElement("span");
    actions.className = "actions";
    const has = Boolean(art[conditionKey(name)]);
    actions.append(button(has ? "Marker ✓" : "Pick…", () => chooseConditionArt(name), `Pick the ${name} marker from Owlbear's attachments`));
    if (has) actions.append(button("Clear", () => { saveConditionArt(name, null); render(); }));
    item.append(label, actions);
    list.append(item);
  }
}

function setSummary(text, tone) {
  $("summary").textContent = text;
  $("summary").dataset.tone = tone || "";
}

function renderRows(table) {
  const list = $("rows");
  list.replaceChildren();
  const encounter = table?.encounter;
  const rows = encounter?.rows || [];
  const onMap = state.onMap || {};
  const art = loadArt();
  $("encounter-title").textContent = encounter?.running ? `Encounter · round ${encounter.round}` : "Encounter (not started)";
  $("rows-empty").hidden = rows.length > 0;
  const missing = rows.filter((row) => !onMap[row.id]).map((row) => row.id);
  $("add-all").disabled = !missing.length || waiting.size > 0;
  $("add-all").onclick = () => ask("add", { rows: missing });
  for (const row of rows) {
    const item = document.createElement("li");
    item.dataset.current = String(row.id === encounter.current);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = rowLabel(row) + (row.down ? " · down" : "");
    name.title = KIND[row.kind] || row.kind;
    const actions = document.createElement("span");
    actions.className = "actions";
    const hasArt = Boolean(art[artKey(row)]);
    const group = groupKey(row);
    const shared = group ? ` New ${group.slice(group.indexOf(":") + 1)} tokens use it too, until you pick another.` : "";
    const artTitle = (row.kind === "enemy" && row.template ? `Art for every ${row.template.name}.` : "Token art.") + shared;
    actions.append(button(hasArt ? "Art ✓" : "Art…", () => chooseArt(row), artTitle));
    if (hasArt) actions.append(button("×", () => forgetArt(row), "Go back to the default art"));
    if (onMap[row.id]) {
      const mark = document.createElement("span");
      mark.className = "on-map";
      mark.textContent = "on map";
      actions.append(mark, button("Remove", () => ask("remove", { rows: [row.id] }), "Remove its token, or unlink a token you placed"));
    } else {
      actions.append(button("Add", () => ask("add", { rows: [row.id] })));
    }
    item.append(name, actions);
    list.append(item);
  }
}

function renderPlayers(table) {
  const list = $("players");
  list.replaceChildren();
  const members = table.encounter.rows.filter((row) => row.kind === "player");
  const matches = loadMatches(table.room_id);
  if (!players.length) {
    const item = document.createElement("li");
    item.textContent = "No players have joined this Owlbear room.";
    list.append(item);
    return;
  }
  for (const player of players) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = player.name;
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Tracker character for ${player.name}`);
    select.append(new Option("Not matched", ""));
    for (const member of members) select.append(new Option(member.name || "Unnamed", member.member_id));
    select.value = matches[player.id] || "";
    select.addEventListener("change", () => saveMatch(table.room_id, player.id, select.value));
    item.append(name, select);
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
  if (state.table) {
    renderRows(state.table);
    renderPlayers(state.table);
    renderConditions(state.table);
  }
  const mapText = state.mapError ? `Map: ${state.mapError}` : (state.mapNotes || []).join(" ");
  $("map-error").hidden = !mapText;
  $("map-error").textContent = mapText;
  // After an Owlbear reload the open bridge window finds the extension again within a few seconds.
  if (!state.connected && Date.now() - (state.startedAt || 0) < 8000) setSummary("Reconnecting to the bridge window…");
  else if (!state.connected) setSummary("Not connected. Open the bridge window.", "bad");
  else if (!state.paired) setSummary("Bridge open. Enter the pairing code.");
  else if (state.error) setSummary("Linked, but the last update failed.", "bad");
  else setSummary("Linked to the tracker.", "ok");
  showError(note);
}

channel.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "state") {
    state = msg.state;
    render();
  }
  if (msg.type === "result" && waiting.delete(msg.id)) {
    render();
    if (!msg.ok) showError(msg.error);
  }
  if (msg.type === "pair-result" && msg.id === pairing) {
    pairing = null;
    $("pair-form").querySelector("button").disabled = false;
    if (msg.ok) $("code").value = "";
    else {
      showError(msg.error);
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
    showError("Chrome blocked the window. Allow pop-ups for owlbear.rodeo and try again.");
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
    showError("No answer from the tracker. Check that the bridge window is open.");
  }, 15000);
});

$("forget").addEventListener("click", () => channel.postMessage({ type: "forget" }));

OBR.onReady(async () => {
  try {
    document.documentElement.dataset.theme = (await OBR.theme.getTheme()).mode;
    OBR.theme.onChange((theme) => { document.documentElement.dataset.theme = theme.mode; });
  } catch {}
  const party = async () => {
    try { players = await OBR.party.getPlayers(); } catch { players = []; }
    render();
  };
  OBR.party.onChange(party);
  await party();
  channel.postMessage({ type: "get" });
});
