// Stage O2: tracker rows as Owlbear tokens. Runs in the DM's background page only.
//
// Each token carries LINK metadata naming the tracker room and row. Metadata is visible to
// every player, so it holds IDs and the last applied reveal state, never names or stats.
// Token names are the player-facing alias even while hidden: Owlbear does not show hidden
// items to players, and the name is what they will see on reveal.
import OBR, { buildImage, buildShape } from "./obr-sdk-3.1.0.js";

export const LINK = "com.aurora-tracker/link";
export const MARKER = "com.aurora-tracker/marker";
const BASE = new URL(".", import.meta.url).href;
const ART_KEY = "aurora-obr-art";
const HIDDEN_NAME = "Enemy";
/** Ring markers, in the style of Owlbear's own Colored Rings extension: whose turn it is
 * (outermost) and down. Colours come from that extension's palette. */
export const TURN = "ring-turn";
export const DOWN = "ring-down";
export const RINGS = [
  { kind: TURN, colour: "#ffd433", name: "Current turn" },
  { kind: DOWN, colour: "#ff4d4d", name: "Down" },
];
const CELLS = { tiny: 0.5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };

/** Art is remembered per monster template, player or companion. */
export function artKey(row) {
  if (row.kind === "enemy") return row.template ? `template:${row.template.key}` : `enemy:${row.id}`;
  if (row.kind === "player") return `member:${row.member_id}`;
  return `companion:${row.member_id}:${row.local_id}`;
}

/** Classes with a bundled default token, by the slug in token-class-<slug>.png. */
export const CLASS_TOKENS = ["artificer", "barbarian", "bard", "blood-hunter", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"];

/** The first known class in an Aurora class field such as "Artificer (Battle Smith) / Wizard". */
export function classSlug(text) {
  const words = String(text || "").toLowerCase().replace(/[^a-z]+/g, " ");
  let best = null;
  for (const slug of CLASS_TOKENS) {
    const at = words.indexOf(slug.replace("-", " "));
    if (at >= 0 && (!best || at < best.at)) best = { slug, at };
  }
  return best?.slug || null;
}

/** A shared default for every row of the same kind: creature type for monsters, class for players. */
export function groupKey(row) {
  if (row.kind === "enemy") {
    const type = String(row.template?.type || "").trim().toLowerCase();
    return type ? `type:${type}` : null;
  }
  if (row.kind === "player") {
    const slug = classSlug(row.look?.class);
    return slug ? `class:${slug}` : null;
  }
  return null;
}

/** What Owlbear's asset picker searches for first: the creature type or class, which match its built-in art. */
export function artSearch(row) {
  if (row.kind === "enemy") return row.template?.type || row.template?.name || "";
  if (row.kind === "player") {
    const slug = classSlug(row.look?.class);
    return slug ? slug.replace("-", " ") : row.name || "";
  }
  return row.name || "";
}

/** Remember art the DM picked for a row; it also becomes the default for its type or class if there is none. */
export function chooseArt(row, download) {
  saveArt(artKey(row), download);
  const group = groupKey(row);
  if (group && !loadArt()[group]) saveArt(group, download);
}

function portraitArt(url) {
  const mime = url.slice(5, url.indexOf(";"));
  return {
    image: { url, mime, width: 160, height: 160 },
    grid: { dpi: 160, offset: { x: 80, y: 80 } },
    scale: { x: 1, y: 1 },
    portrait: true,
  };
}

/**
 * The art a row's token should have, best first: the DM's pick for this row, the player's own
 * portrait, the DM's pick for its creature type or class, the bundled class icon, a placeholder.
 */
export function artFor(row, art = loadArt()) {
  if (art[artKey(row)]) return art[artKey(row)];
  if (row.kind === "player" && row.look?.portrait && !refused.portraits.has(row.member_id)) return portraitArt(row.look.portrait);
  const group = groupKey(row);
  if (group && art[group]) return art[group];
  if (row.kind === "player" && group) return placeholder(group.slice("class:".length), `token-class-`);
  return placeholder(row.kind);
}

/** A short fingerprint of an image URL, kept in token metadata to notice art changes. */
export function artTag(url) {
  let hash = 5381;
  for (let i = 0; i < url.length; i += 1) hash = ((hash * 33) ^ url.charCodeAt(i)) >>> 0;
  return `${url.length.toString(36)}-${hash.toString(36)}`;
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

/** The name players see on a token once it is visible. */
export function publicName(row) {
  if (row.kind === "enemy") return row.name || HIDDEN_NAME;
  return row.name || "Unknown";
}

function textFor(name) {
  return { plainText: name, richText: [{ type: "paragraph", children: [{ text: name }] }] };
}

function placeholder(kind, prefix = "token-") {
  return {
    image: { url: `${BASE}${prefix}${kind}.png`, mime: "image/png", width: 256, height: 256 },
    grid: { dpi: 256, offset: { x: 128, y: 128 } },
    scale: { x: 1, y: 1 },
  };
}

function buildToken(row, room, position, art, forceHidden = false) {
  const chosen = artFor(row, art);
  const cells = row.kind === "enemy" ? cellsFor(row.template?.size) : 1;
  const base = chosen.scale || { x: 1, y: 1 };
  const name = publicName(row);
  const hidden = row.kind === "enemy" && (forceHidden || !row.revealed);
  return buildImage(chosen.image, chosen.grid)
    .name(name)
    .plainText(name)
    .textItemType("LABEL")
    .position(position)
    .scale({ x: base.x * cells, y: base.y * cells })
    .layer("CHARACTER")
    .visible(!hidden)
    .locked(false)
    .metadata({ [LINK]: { room, row: row.id, kind: row.kind, created: true, revealed: !hidden, art: artTag(chosen.image.url) } })
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

/** The owner's token for a companion row, when it is on the map. */
async function ownerToken(table, row, onMap) {
  if (row.kind !== "companion") return null;
  const owner = table.encounter.rows.find((r) => r.kind === "player" && r.member_id === row.member_id);
  const id = owner && onMap[owner.id];
  return id ? (await OBR.scene.items.getItems([id]))[0] || null : null;
}

// Cells around a token, nearest first: right, left, below, above, then the diagonals.
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];

/**
 * Put tokens for the given rows on the map. A companion goes in a free cell beside its owner's
 * token when that token is on the map; the rest go in a row of cells around the DM's view centre.
 */
export async function addTokens(table, rowIds, { hidden = false, near = null } = {}) {
  if (!(await OBR.scene.isReady())) throw new Error("Open a scene in Owlbear first.");
  const room = table.room_id;
  const onMap = await linkedRows(room);
  const rows = table.encounter.rows.filter((row) => rowIds.includes(row.id) && !onMap[row.id]);
  if (!rows.length) return 0;
  const dpi = await OBR.scene.grid.getDpi();
  const art = loadArt();
  const items = [];
  const loose = [];
  // Spots already taken by a character token or one placed in this call.
  const characters = await OBR.scene.items.getItems((item) => item.layer === "CHARACTER");
  const taken = characters.map((item) => item.position);
  const free = (spot) => !taken.some((p) => Math.abs(p.x - spot.x) < dpi / 2 && Math.abs(p.y - spot.y) < dpi / 2);
  for (const row of rows) {
    const owner = await ownerToken(table, row, onMap);
    if (!owner) {
      loose.push(row);
      continue;
    }
    let spot = null;
    for (const [dx, dy] of AROUND) {
      const at = await OBR.scene.grid.snapPosition({ x: owner.position.x + dx * dpi, y: owner.position.y + dy * dpi }, 1, false, true);
      if (free(at)) { spot = at; break; }
    }
    spot ||= await OBR.scene.grid.snapPosition({ x: owner.position.x + dpi, y: owner.position.y }, 1, false, true);
    taken.push(spot);
    items.push(buildToken(row, room, spot, art, hidden));
  }
  if (loose.length) {
    const width = await OBR.viewport.getWidth();
    const height = await OBR.viewport.getHeight();
    // Beside a given token (one square to its right), or in the middle of the DM's view.
    const centre = near ? { x: near.x + dpi, y: near.y } : await OBR.viewport.inverseTransformPoint({ x: width / 2, y: height / 2 });
    const sizes = loose.map((row) => (row.kind === "enemy" ? cellsFor(row.template?.size) : 1));
    const span = sizes.reduce((sum, cells) => sum + Math.max(1, cells), 0) * dpi;
    let x = centre.x - span / 2;
    for (const [index, row] of loose.entries()) {
      const cells = Math.max(1, sizes[index]);
      const odd = cells % 2 === 1;
      const spot = await OBR.scene.grid.snapPosition({ x: x + (cells * dpi) / 2, y: centre.y }, 1, !odd, odd);
      items.push(buildToken(row, room, spot, art, hidden));
      x += cells * dpi;
    }
  }
  await addWithFallback(items, rows, room, art, hidden);
  return items.length;
}

/**
 * Owlbear may refuse an inline portrait. Then the tokens go in with the class icon instead,
 * and the error is kept so the popover can say so.
 */
export const refused = { portraits: new Set() };
async function addWithFallback(items, rows, room, art, hidden) {
  try {
    await OBR.scene.items.addItems(items);
  } catch (error) {
    const portraits = items.filter((item) => item.image?.url?.startsWith("data:"));
    if (!portraits.length) throw error;
    for (const item of portraits) {
      const row = rows.find((r) => r.id === item.metadata[LINK].row);
      refused.portraits.add(row.member_id);
      const chosen = artFor({ ...row, look: { ...row.look, portrait: null } }, art);
      item.image = chosen.image;
      item.grid = chosen.grid;
      item.metadata[LINK].art = artTag(chosen.image.url);
    }
    await OBR.scene.items.addItems(items);
  }
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

/** Link a token the DM already placed to a tracker row. A hidden enemy's token is hidden. */
export async function linkToken(itemId, room, row) {
  const revealed = row.kind !== "enemy" || Boolean(row.revealed);
  await OBR.scene.items.updateItems([itemId], (drafts) => {
    for (const draft of drafts) {
      draft.metadata[LINK] = { room, row: row.id, kind: row.kind, created: false, revealed };
      if (row.kind === "enemy") draft.visible = revealed;
    }
  });
}

/**
 * Link each tracker player's own token without a click: an unlinked character token created
 * by the Owlbear player matched to that tracker player. Skipped when there are several.
 */
export async function adoptPlayerTokens(table, matches) {
  if (!(await OBR.scene.isReady())) return 0;
  const room = table.room_id;
  const onMap = await linkedRows(room);
  const waiting = table.encounter.rows.filter((row) => row.kind === "player" && !onMap[row.id]);
  if (!waiting.length) return 0;
  const free = await OBR.scene.items.getItems((item) => item.layer === "CHARACTER" && !item.metadata?.[LINK]);
  let linked = 0;
  for (const row of waiting) {
    const owners = Object.keys(matches).filter((player) => matches[player] === row.member_id);
    const mine = free.filter((item) => owners.includes(item.createdUserId));
    if (mine.length !== 1) continue;
    await linkToken(mine[0].id, room, row);
    free.splice(free.indexOf(mine[0]), 1);
    linked += 1;
  }
  return linked;
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
 * gets a small badge attached to it.
 */
export async function syncTokens(table) {
  if (!(await OBR.scene.isReady())) return;
  const room = table.room_id;
  const rows = new Map(table.encounter.rows.map((row) => [row.id, row]));
  const linked = await OBR.scene.items.getItems((item) => Boolean(linkOf(item, room)));
  if (!linked.length) return;

  const gone = linked.filter((item) => !rows.has(linkOf(item, room).row));
  if (gone.length) await unlinkOrDelete(gone, room);

  await syncArt(linked, rows, room);

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
        // Reveal and hide follow the tracker for every linked token, placed or adopted.
        if (change.reveal) draft.visible = change.revealed;
        draft.metadata[LINK] = { ...draft.metadata[LINK], revealed: change.revealed };
      }
    });
  }

  // Read the tokens again: the updates above may have changed their visibility.
  const kept = await OBR.scene.items.getItems(linked.filter((item) => rows.has(linkOf(item, room).row)).map((item) => item.id));
  await syncRings(kept, rows, room, table.encounter);
  await syncConditions(kept, rows, room);
}

// Condition markers use art the DM picks once per condition from Owlbear's asset library
// (its default Attachments, such as Poisoned or Prone), kept in this browser.
const CONDITION_ART_KEY = "aurora-obr-condition-art";
const CONDITION = "condition:";
/** The conditions of the rules, offered in the popover even before any enemy has them. */
export const STANDARD_CONDITIONS = ["Blinded", "Charmed", "Deafened", "Exhaustion", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious", "Concentration", "Blessed", "Hasted"];

export function conditionKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s*\(.*\)\s*$/, "").replace(/\s+\d+$/, "");
}

export function loadConditionArt() {
  try { return JSON.parse(localStorage.getItem(CONDITION_ART_KEY) || "{}"); } catch { return {}; }
}

export function saveConditionArt(name, download) {
  const art = loadConditionArt();
  if (download) art[conditionKey(name)] = { image: download.image, grid: download.grid, scale: download.scale };
  else delete art[conditionKey(name)];
  try { localStorage.setItem(CONDITION_ART_KEY, JSON.stringify(art)); } catch {}
}

function buildCondition(token, key, chosen, dpi) {
  // Owlbear's attachments are drawn to fit one cell; grow them with the token's footprint.
  const cells = Math.abs(token.scale?.x || 1) * ((token.image?.width || dpi) / (token.grid?.dpi || dpi));
  const base = chosen.scale || { x: 1, y: 1 };
  const footprint = Math.max(1, Math.round(cells));
  return buildImage(chosen.image, chosen.grid)
    .position(token.position)
    .scale({ x: base.x * footprint, y: base.y * footprint })
    .attachedTo(token.id)
    .layer("ATTACHMENT")
    .locked(true)
    .disableHit(true)
    .name(key)
    .visible(token.visible)
    .metadata({ [MARKER]: CONDITION + key })
    .build();
}

/** Enemy tokens carry a marker for each condition that has art; the rest show nothing. */
async function syncConditions(tokens, rows, room) {
  const art = loadConditionArt();
  const markers = (await markersFor(tokens.map((t) => t.id))).filter((m) => String(m.metadata[MARKER]).startsWith(CONDITION));
  const dpi = await OBR.scene.grid.getDpi();
  const add = [];
  const remove = [];
  const show = [];
  for (const token of tokens) {
    const row = rows.get(linkOf(token, room).row);
    const wanted = new Set((row.kind === "enemy" ? row.conditions || [] : []).map(conditionKey).filter((key) => art[key]));
    const mine = markers.filter((m) => m.attachedTo === token.id);
    for (const marker of mine) {
      const key = marker.metadata[MARKER].slice(CONDITION.length);
      if (!wanted.has(key) || mine.find((m) => m.metadata[MARKER] === marker.metadata[MARKER]) !== marker) remove.push(marker.id);
      else if (marker.visible !== token.visible) show.push({ id: marker.id, visible: token.visible });
      wanted.delete(key);
    }
    for (const key of wanted) add.push(buildCondition(token, key, art[key], dpi));
  }
  if (remove.length) await OBR.scene.items.deleteItems(remove);
  if (show.length) {
    const byId = new Map(show.map((s) => [s.id, s.visible]));
    await OBR.scene.items.updateItems(show.map((s) => s.id), (drafts) => {
      for (const draft of drafts) draft.visible = byId.get(draft.id);
    });
  }
  if (add.length) await OBR.scene.items.addItems(add);
}

/** Condition names on enemies in the encounter, for the popover's art list. */
export function encounterConditions(table) {
  const names = new Map();
  for (const row of table?.encounter?.rows || []) {
    for (const name of row.conditions || []) if (!names.has(conditionKey(name))) names.set(conditionKey(name), name);
  }
  return [...names.values()];
}

function applyArt(draft, row, chosen) {
  const cells = row.kind === "enemy" ? cellsFor(row.template?.size) : 1;
  const base = chosen.scale || { x: 1, y: 1 };
  draft.image = { ...chosen.image };
  draft.grid = { ...chosen.grid };
  draft.scale = { x: base.x * cells, y: base.y * cells };
  draft.metadata[LINK] = { ...draft.metadata[LINK], art: artTag(chosen.image.url) };
}

/**
 * Tokens this extension placed follow art changes: a new pick in the popover, a player's new
 * portrait, or a new class or type default. A token whose image was replaced in Owlbear itself
 * (its image no longer matches the art we last set) is left as the DM made it.
 */
async function syncArt(linked, rows, room) {
  const art = loadArt();
  const stale = [];
  for (const item of linked) {
    const link = linkOf(item, room);
    const row = rows.get(link.row);
    if (!row || !link.created || !item.image?.url) continue;
    const ours = !link.art || link.art === artTag(item.image.url);
    const chosen = artFor(row, art);
    if (ours && artTag(chosen.image.url) !== artTag(item.image.url)) stale.push({ id: item.id, row, chosen });
  }
  if (!stale.length) return;
  const byId = new Map(stale.map((s) => [s.id, s]));
  const update = (list) => OBR.scene.items.updateItems(list.map((s) => s.id), (drafts) => {
    for (const draft of drafts) applyArt(draft, byId.get(draft.id).row, byId.get(draft.id).chosen);
  });
  try {
    await update(stale);
  } catch (error) {
    const portraits = stale.filter((s) => s.chosen.portrait);
    if (!portraits.length) throw error;
    for (const s of portraits) refused.portraits.add(s.row.member_id);
    const rest = stale.filter((s) => !s.chosen.portrait);
    for (const s of portraits) rest.push({ ...s, chosen: artFor(s.row, art) });
    for (const s of rest) byId.set(s.id, s);
    await update(rest);
  }
}

/** Put the art the DM just picked on that row's token now, even on a token the DM placed. */
export async function applyPickedArt(table, rowId) {
  const room = table.room_id;
  const row = table.encounter.rows.find((r) => r.id === rowId);
  const id = row && (await linkedRows(room))[row.id];
  if (!id) return false;
  const chosen = artFor(row);
  await OBR.scene.items.updateItems([id], (drafts) => {
    for (const draft of drafts) if (draft.type === "IMAGE") applyArt(draft, row, chosen);
  });
  return true;
}

// One ring per state, concentric and 10% smaller each, centred on the token's grid footprint.
function buildRing(token, ring, index, dpi) {
  const dpiScale = dpi / (token.grid?.dpi || dpi);
  const width = (token.image?.width || dpi) * dpiScale;
  const height = (token.image?.height || dpi) * dpiScale;
  const diameter = Math.min(width, height);
  const offsetX = token.grid?.offset && token.image?.width ? (token.grid.offset.x / token.image.width) * width : width / 2;
  const offsetY = token.grid?.offset && token.image?.height ? (token.grid.offset.y / token.image.height) * height : height / 2;
  const scale = Math.abs(token.scale?.x || 1) * (1 - index * 0.1);
  return buildShape()
    .width(diameter)
    .height(diameter)
    .scale({ x: scale, y: scale })
    .position({ x: token.position.x - offsetX + width / 2, y: token.position.y - offsetY + height / 2 })
    .fillOpacity(0)
    .strokeColor(ring.colour)
    .strokeOpacity(1)
    .strokeWidth(5)
    .shapeType("CIRCLE")
    .attachedTo(token.id)
    .locked(true)
    .name(ring.name)
    .metadata({ [MARKER]: ring.kind })
    .layer("ATTACHMENT")
    .disableHit(true)
    .visible(token.visible)
    .build();
}

/** Rings follow the tracker: the current turn while the encounter runs, and down rows. */
async function syncRings(tokens, rows, room, encounter) {
  const ids = tokens.map((item) => item.id);
  const markers = await markersFor(ids);
  // Older versions drew a text label or a skull badge. Those go.
  const known = new Set(RINGS.map((ring) => ring.kind));
  const stale = markers.filter((marker) => !known.has(marker.metadata[MARKER]) && !String(marker.metadata[MARKER]).startsWith(CONDITION));
  const dpi = await OBR.scene.grid.getDpi();
  const add = [];
  const remove = stale.map((marker) => marker.id);
  const restyle = [];
  for (const token of tokens) {
    const row = rows.get(linkOf(token, room).row);
    const wanted = RINGS.filter((ring) => (ring.kind === TURN ? encounter.running && encounter.current === row.id : Boolean(row.down)));
    const mine = markers.filter((marker) => marker.attachedTo === token.id && known.has(marker.metadata[MARKER]));
    for (const marker of mine) if (!wanted.some((ring) => ring.kind === marker.metadata[MARKER])) remove.push(marker.id);
    wanted.forEach((ring, index) => {
      const have = mine.filter((marker) => marker.metadata[MARKER] === ring.kind);
      if (!have.length) {
        add.push(buildRing(token, ring, index, dpi));
        return;
      }
      const scale = Math.abs(token.scale?.x || 1) * (1 - index * 0.1);
      for (const [n, marker] of have.entries()) {
        if (n > 0) remove.push(marker.id);
        else if (marker.visible !== token.visible || Math.abs((marker.scale?.x || 0) - scale) > 1e-6) restyle.push({ id: marker.id, visible: token.visible, scale });
      }
    });
  }
  if (remove.length) await OBR.scene.items.deleteItems(remove);
  if (restyle.length) {
    const byId = new Map(restyle.map((r) => [r.id, r]));
    // A ring shows only when its token does, and keeps its place in the stack.
    await OBR.scene.items.updateItems(restyle.map((r) => r.id), (drafts) => {
      for (const draft of drafts) {
        const change = byId.get(draft.id);
        draft.visible = change.visible;
        draft.scale = { x: change.scale, y: change.scale };
      }
    });
  }
  if (add.length) await OBR.scene.items.addItems(add);
}
