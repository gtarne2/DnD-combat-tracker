// Stage O2: tracker rows as Owlbear tokens. Runs in the DM's background page only.
//
// Each token carries LINK metadata naming the tracker room and row. Metadata is visible to
// every player, so it holds IDs and the last applied reveal state, never names or stats.
import OBR, { buildImage, buildLabel } from "./obr-sdk-3.1.0.js";

export const LINK = "com.aurora-tracker/link";
export const MARKER = "com.aurora-tracker/marker";
const BASE = new URL(".", import.meta.url).href;
const ART_KEY = "aurora-obr-art";
const HIDDEN_NAME = "Enemy";
const CELLS = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

/** Art is remembered per monster template, player or companion. */
export function artKey(row) {
  if (row.kind === "enemy") return row.template ? `template:${row.template.key}` : `enemy:${row.id}`;
  if (row.kind === "player") return `member:${row.member_id}`;
  return `companion:${row.member_id}:${row.local_id}`;
}

export function loadArt() {
  try { return JSON.parse(localStorage.getItem(ART_KEY) || "{}"); } catch { return {}; }
}

export function saveArt(key, download) {
  const art = loadArt();
  if (download) {
    art[key] = { image: download.image, grid: download.grid, scale: download.scale };
  } else {
    delete art[key];
  }
  try { localStorage.setItem(ART_KEY, JSON.stringify(art)); } catch {}
}

/** Grid cells across for a creature size such as "Large". Unknown sizes are one cell. */
export function cellsFor(size) {
  return CELLS[String(size || "").trim().toLowerCase()] || 1;
}

/** The name players may see on a token. */
export function publicName(row) {
  if (row.kind === "enemy") return row.revealed && row.name ? row.name : HIDDEN_NAME;
  return row.name || "Unknown";
}

function textFor(name) {
  return { plainText: name, richText: [{ type: "paragraph", children: [{ text: name }] }] };
}

function placeholder(kind) {
  return {
    image: { url: `${BASE}token-${kind}.png`, mime: "image/png", width: 256, height: 256 },
    grid: { dpi: 256, offset: { x: 128, y: 128 } },
    scale: { x: 1, y: 1 },
  };
}

function buildToken(row, room, position, art) {
  const chosen = art[artKey(row)] || placeholder(row.kind);
  const cells = row.kind === "enemy" ? cellsFor(row.template?.size) : 1;
  const base = chosen.scale || { x: 1, y: 1 };
  const name = publicName(row);
  const hidden = row.kind === "enemy" && !row.revealed;
  return buildImage(chosen.image, chosen.grid)
    .name(name)
    .plainText(name)
    .textItemType("LABEL")
    .position(position)
    .scale({ x: base.x * cells, y: base.y * cells })
    .layer("CHARACTER")
    .visible(!hidden)
    .locked(false)
    .metadata({ [LINK]: { room, row: row.id, kind: row.kind, created: true, revealed: !hidden } })
    .build();
}

function linkOf(item, room) {
  const link = item.metadata?.[LINK];
  return link && link.room === room ? link : null;
}

/** Linked token IDs by row ID, for the popover. */
export async function linkedRows(room) {
  const items = await OBR.scene.items.getItems((item) => Boolean(item.metadata?.[LINK]));
  const map = {};
  for (const item of items) {
    const link = linkOf(item, room);
    if (link) map[link.row] = item.id;
  }
  return map;
}

/** Put tokens for the given rows in a row of cells around the DM's view centre. */
export async function addTokens(table, rowIds) {
  if (!(await OBR.scene.isReady())) throw new Error("Open a scene in Owlbear first.");
  const room = table.room_id;
  const onMap = await linkedRows(room);
  const rows = table.encounter.rows.filter((row) => rowIds.includes(row.id) && !onMap[row.id]);
  if (!rows.length) return 0;
  const dpi = await OBR.scene.grid.getDpi();
  const width = await OBR.viewport.getWidth();
  const height = await OBR.viewport.getHeight();
  const centre = await OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
  const art = loadArt();
  const sizes = rows.map((row) => (row.kind === "enemy" ? cellsFor(row.template?.size) : 1));
  const span = sizes.reduce((sum, cells) => sum + Math.max(1, cells), 0) * dpi;
  let x = centre.x - span / 2;
  const items = [];
  for (const [index, row] of rows.entries()) {
    const cells = Math.max(1, sizes[index]);
    const odd = cells % 2 === 1;
    const spot = await OBR.scene.grid.snapPosition({ x: x + (cells * dpi) / 2, y: centre.y }, 1, !odd, odd);
    items.push(buildToken(row, room, spot, art));
    x += cells * dpi;
  }
  await OBR.scene.items.addItems(items);
  return items.length;
}

/** Remove the tokens this extension created for the rows; unlink the DM's own tokens. */
export async function removeTokens(room, rowIds) {
  const items = await OBR.scene.items.getItems((item) => {
    const link = linkOf(item, room);
    return Boolean(link && rowIds.includes(link.row));
  });
  await unlinkOrDelete(items, room);
}

async function unlinkOrDelete(items, room) {
  const created = items.filter((item) => linkOf(item, room)?.created).map((item) => item.id);
  const adopted = items.filter((item) => !linkOf(item, room)?.created).map((item) => item.id);
  if (created.length) {
    const markers = await markersFor(created);
    await OBR.scene.items.deleteItems([...created, ...markers.map((m) => m.id)]);
  }
  if (adopted.length) {
    const markers = await markersFor(adopted);
    if (markers.length) await OBR.scene.items.deleteItems(markers.map((m) => m.id));
    await OBR.scene.items.updateItems(adopted, (drafts) => {
      for (const draft of drafts) delete draft.metadata[LINK];
    });
  }
}

/** Link a token the DM already placed to a tracker row. */
export async function linkToken(itemId, room, row) {
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const draft of drafts) {
      draft.metadata[LINK] = { room, row: row.id, kind: row.kind, created: false, revealed: row.kind !== "enemy" || row.revealed };
    }
  });
}

export async function unlinkToken(itemId, room) {
  const items = await OBR.scene.items.getItems([itemId]);
  const adopted = items.map((item) => ({ ...item, metadata: { ...item.metadata, [LINK]: { ...item.metadata[LINK], created: false } } }));
  await unlinkOrDelete(adopted, room);
}

async function markersFor(ids) {
  return OBR.scene.items.getItems((item) => item.metadata?.[MARKER] && ids.includes(item.attachedTo));
}

/**
 * Bring linked tokens in line with the tracker: names and visibility follow reveals, a
 * removed row loses its token (or its link, for a token the DM placed), and a downed enemy
 * gets a small "Down" label attached under it.
 */
export async function syncTokens(table) {
  if (!(await OBR.scene.isReady())) return;
  const room = table.room_id;
  const rows = new Map(table.encounter.rows.map((row) => [row.id, row]));
  const linked = await OBR.scene.items.getItems((item) => Boolean(linkOf(item, room)));
  if (!linked.length) return;

  const gone = linked.filter((item) => !rows.has(linkOf(item, room).row));
  if (gone.length) await unlinkOrDelete(gone, room);

  const changes = [];
  for (const item of linked) {
    const link = linkOf(item, room);
    const row = rows.get(link.row);
    if (!row) continue;
    const revealed = row.kind !== "enemy" || Boolean(row.revealed);
    const name = publicName(row);
    const rename = link.created && item.name !== name;
    if (rename || link.revealed !== revealed) changes.push({ id: item.id, name, revealed, rename, reveal: link.revealed !== revealed });
  }
  if (changes.length) {
    const byId = new Map(changes.map((change) => [change.id, change]));
    await OBR.scene.items.updateItems(changes.map((change) => change.id), (drafts) => {
      for (const draft of drafts) {
        const change = byId.get(draft.id);
        if (change.rename || (change.reveal && draft.metadata[LINK].created)) {
          draft.name = change.name;
          if (draft.text) Object.assign(draft.text, textFor(change.name));
        }
        // A reveal shows the token; hiding again only hides tokens this extension placed.
        if (change.reveal && (change.revealed || draft.metadata[LINK].created)) draft.visible = change.revealed;
        draft.metadata[LINK] = { ...draft.metadata[LINK], revealed: change.revealed };
      }
    });
  }

  // Read the tokens again: the updates above may have changed their visibility.
  const kept = await OBR.scene.items.getItems(linked.filter((item) => rows.has(linkOf(item, room).row)).map((item) => item.id));
  const markers = await markersFor(kept.map((item) => item.id));
  const marked = new Set(markers.map((marker) => marker.attachedTo));
  const visibility = new Map(kept.map((item) => [item.id, item.visible]));
  const add = [];
  const remove = [];
  const restyle = markers.filter((marker) => visibility.has(marker.attachedTo) && marker.visible !== visibility.get(marker.attachedTo)).map((m) => m.id);
  for (const item of kept) {
    const row = rows.get(linkOf(item, room).row);
    if (!row) continue;
    if (row.down && !marked.has(item.id)) {
      add.push(
        buildLabel()
          .plainText("Down")
          .position({ x: item.position.x, y: item.position.y })
          .attachedTo(item.id)
          .layer("ATTACHMENT")
          .backgroundColor("#7f1d1d")
          .backgroundOpacity(0.85)
          .fillColor("#ffffff")
          .pointerHeight(0)
          .locked(true)
          .disableHit(true)
          .visible(item.visible)
          .metadata({ [MARKER]: "down" })
          .build(),
      );
    }
    if (!row.down && marked.has(item.id)) remove.push(...markers.filter((m) => m.attachedTo === item.id).map((m) => m.id));
  }
  if (restyle.length) {
    // A marker shows only when its token does.
    await OBR.scene.items.updateItems(restyle, (drafts) => {
      for (const draft of drafts) draft.visible = visibility.get(draft.attachedTo);
    });
  }
  if (add.length) await OBR.scene.items.addItems(add);
  if (remove.length) await OBR.scene.items.deleteItems(remove);
}
