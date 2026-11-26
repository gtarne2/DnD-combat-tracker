// Link picker: opened from the token context menu. Lists rows that have no token yet and
// asks the background page to link the chosen one.
import OBR from "./obr-sdk-3.1.0.js";
import { rowLabel } from "./labels.js";

const $ = (id) => document.getElementById(id);
const channel = new BroadcastChannel("aurora-obr");
const item = new URLSearchParams(location.search).get("item");
let pending = null;

function render(state) {
  const list = $("rows");
  list.replaceChildren();
  if (!state.table) {
    $("summary").textContent = "Link the tracker from the Aurora toolbar button first.";
    return;
  }
  const free = state.table.encounter.rows.filter((row) => !state.onMap[row.id]);
  $("summary").textContent = free.length ? "Choose the row this token stands for." : "Every row already has a token.";
  for (const row of free) {
    const entry = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = rowLabel(row);
    button.addEventListener("click", () => {
      pending = crypto.randomUUID();
      for (const b of list.querySelectorAll("button")) b.disabled = true;
      channel.postMessage({ type: "link", id: pending, item, row: row.id });
    });
    entry.append(button);
    list.append(entry);
  }
}

channel.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === "state" && !pending) render(msg.state);
  if (msg.type === "result" && msg.id === pending) {
    pending = null;
    if (!msg.ok) {
      $("error").hidden = false;
      $("error").textContent = msg.error;
      channel.postMessage({ type: "get" });
    }
  }
};

OBR.onReady(async () => {
  try { document.documentElement.dataset.theme = (await OBR.theme.getTheme()).mode; } catch {}
  channel.postMessage({ type: "get" });
});
