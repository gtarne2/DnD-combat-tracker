// Stage O3: keeps Owlbear's template drawings in step with the room's templates.
import OBR from "./obr-sdk-3.1.0.js";
import { CHANNEL, TEMPLATE, buildTemplate, drawSpec, isShape, pixelsPerFoot, placement, tokenCells, validSpec } from "./templates.js";
import { loadMatches } from "./players.js";

const DRAWN = "aurora-obr-drawn:";
/** How long the caster's extension has to draw a template before the DM's extension does. */
export const ANSWER_MS = 4000;
const asked = new Map();

function loadDrawn(room) {
  try { return new Set(JSON.parse(localStorage.getItem(DRAWN + room) || "[]")); } catch { return new Set(); }
}

function saveDrawn(room, drawn) {
  try { localStorage.setItem(DRAWN + room, JSON.stringify([...drawn])); } catch {}
}

/**
 * DM side. Draws new templates, removes ones the room dropped, and never redraws a template
 * someone deleted by hand. Returns notes for the popover, such as a caster with no token.
 */
export async function syncTemplates(table, now = Date.now()) {
  if (!(await OBR.scene.isReady())) return [];
  const room = table.room_id;
  const wanted = (table.encounter.templates || []).filter((t) => isShape(t.shape));
  const ids = new Set(wanted.map((t) => t.id));
  const items = await OBR.scene.items.getItems((item) => item.metadata?.[TEMPLATE]?.room === room);
  const present = new Set(items.map((item) => item.metadata[TEMPLATE].id));
  const stale = items.filter((item) => !ids.has(item.metadata[TEMPLATE].id)).map((item) => item.id);
  if (stale.length) await OBR.scene.items.deleteItems(stale);

  const drawn = loadDrawn(room);
  for (const id of [...drawn]) if (!ids.has(id)) drawn.delete(id);
  for (const id of present) if (ids.has(id)) drawn.add(id);
  for (const id of [...asked.keys()]) if (!ids.has(id) || present.has(id)) asked.delete(id);

  const notes = [];
  const todo = wanted.filter((t) => !drawn.has(t.id));
  if (todo.length) {
    const tokens = await OBR.scene.items.getItems((item) => item.metadata?.["com.aurora-tracker/link"]?.room === room);
    const byRow = new Map(tokens.map((item) => [item.metadata["com.aurora-tracker/link"].row, item]));
    const dpi = await OBR.scene.grid.getDpi();
    const perFoot = pixelsPerFoot(dpi, await OBR.scene.grid.getScale());
    const matches = loadMatches(room);
    const players = await OBR.party.getPlayers();
    const mine = [];
    for (const template of todo) {
      const token = byRow.get(template.caster);
      if (!token) {
        notes.push(`${template.spell} waits for its caster's token on the map.`);
        continue;
      }
      const aimToken = template.aim ? byRow.get(template.aim) : null;
      const place = placement(template, { id: token.id, position: token.position, cells: tokenCells(token) }, aimToken?.position || null, dpi, perFoot);
      const spec = drawSpec(room, template, place);
      const player = players.find((p) => matches[p.id] === template.member_id);
      const since = asked.get(template.id);
      if (player && since === undefined) {
        asked.set(template.id, now);
        await OBR.broadcast.sendMessage(CHANNEL, { type: "draw", to: player.id, spec }, { destination: "REMOTE" });
      } else if (!player || now - since >= ANSWER_MS) {
        mine.push(buildTemplate(spec));
        drawn.add(template.id);
        asked.delete(template.id);
      }
    }
    if (mine.length) await OBR.scene.items.addItems(mine);
  }
  saveDrawn(room, drawn);
  return notes;
}

/** Player side. Draw templates the DM's extension asks this player to own. */
export function listenForDraws() {
  return OBR.broadcast.onMessage(CHANNEL, async (event) => {
    const msg = event.data || {};
    if (msg.type !== "draw" || msg.to !== (await OBR.player.getId()) || !validSpec(msg.spec)) return;
    const sender = (await OBR.party.getPlayers()).find((p) => p.connectionId === event.connectionId);
    if (!sender || sender.role !== "GM") return;
    if (!(await OBR.scene.isReady())) return;
    const spec = msg.spec;
    const existing = await OBR.scene.items.getItems((item) => item.metadata?.[TEMPLATE]?.room === spec.room && item.metadata[TEMPLATE].id === spec.id);
    if (existing.length) return;
    await OBR.scene.items.addItems([buildTemplate(spec)]);
  });
}
