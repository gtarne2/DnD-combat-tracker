// O2 and O3 Owlbear map sync: tokens, player matching and spell templates against a stand-in Owlbear SDK.
//
//   node tests/owlbear-tokens.cjs
//
// The extension modules are copied to a temporary folder with the SDK replaced by a small
// in-memory scene, so the checks need no browser and no Owlbear room.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const extension = path.join(root, "owlbear");

function assert(condition, message) {
  if (!condition) throw new Error("Assertion failed: " + message);
}

const SDK = `
let next = 1;
export const scene = new Map();
const copy = (v) => JSON.parse(JSON.stringify(v));
function builder(type, extra) {
  const item = { id: "item-" + next++, type, metadata: {}, visible: true, attachedTo: undefined, position: { x: 0, y: 0 }, ...extra };
  const api = new Proxy({}, {
    get(_, key) {
      if (key === "build") return () => item;
      return (value) => {
        if (key === "plainText") item.text = { plainText: value, richText: [] };
        else item[key] = value;
        return api;
      };
    },
  });
  return api;
}
export const buildImage = (image, grid) => builder("IMAGE", { image, grid });
export const buildLabel = () => builder("LABEL", {});
export const buildCurve = () => builder("CURVE", {});
export const buildShape = () => builder("SHAPE", {});
export const sent = [];
export const party = { players: [], me: "me" };
let listener = null;
export const deliver = (data, connectionId) => listener({ data, connectionId });
const pick = (filter) => [...scene.values()].filter((item) => Array.isArray(filter) ? filter.includes(item.id) : filter ? filter(item) : true);
export default {
  scene: {
    isReady: async () => true,
    grid: { getType: async () => party.gridType || "SQUARE", getScale: async () => ({ parsed: { multiplier: 5, unit: "ft" } }), getDpi: async () => 150, snapPosition: async (p) => ({ x: Math.round(p.x / 75) * 75, y: Math.round(p.y / 75) * 75 }) },
    items: {
      getItems: async (filter) => copy(pick(filter)),
      addItems: async (items) => { for (const item of items) scene.set(item.id, copy(item)); },
      deleteItems: async (ids) => { for (const id of ids) scene.delete(id); },
      updateItems: async (ids, fn) => {
        const drafts = pick(ids).map(copy);
        fn(drafts);
        for (const draft of drafts) scene.set(draft.id, draft);
      },
    },
  },
  party: { getPlayers: async () => party.players },
  player: { getId: async () => party.me },
  broadcast: { sendMessage: async (channel, data) => { sent.push({ channel, data }); }, onMessage: (channel, fn) => { listener = fn; return () => {}; } },
  viewport: { getWidth: async () => 1000, getHeight: async () => 800, inverseTransformPoint: async (p) => p },
};
`;

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

const ROOM = "11111111-1111-4111-8111-111111111111";
const wolf = { key: "srd-5.1-monsters/ID_SRD51_MONSTER_WOLF", name: "Wolf", size: "Medium" };
const ogre = { key: "srd-5.1-monsters/ID_SRD51_MONSTER_OGRE", name: "Ogre", size: "Large" };
const table = (rows) => ({ room_id: ROOM, encounter: { id: "e", revision: 1, running: true, round: 1, current: null, rows } });

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aurora-obr-tokens-"));
  try {
    for (const name of ["tokens.js", "players.js", "templates.js", "template-sync.js", "inside.js"]) fs.copyFileSync(path.join(extension, name), path.join(dir, name));
    fs.writeFileSync(path.join(dir, "obr-sdk-3.1.0.js"), SDK);
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
    const sdk = await import(pathToFileURL(path.join(dir, "obr-sdk-3.1.0.js")).href);
    const t = await import(pathToFileURL(path.join(dir, "tokens.js")).href);
    const p = await import(pathToFileURL(path.join(dir, "players.js")).href);
    const scene = sdk.scene;
    const items = () => [...scene.values()];
    const tokenFor = (row) => items().find((i) => i.metadata[t.LINK]?.row === row);

    assert(t.cellsFor("Large") === 2 && t.cellsFor("gargantuan") === 4 && t.cellsFor(undefined) === 1, "sizes");

    let rows = [
      { id: "w1", kind: "enemy", revealed: false, name: "Wolf A", down: false, template: wolf },
      { id: "o1", kind: "enemy", revealed: true, name: "Ogre A", down: false, template: ogre },
      { id: "p1", kind: "player", member_id: "m1", name: "Lark" },
      { id: "c1", kind: "companion", member_id: "m1", local_id: 1, name: "Steel Defender" },
    ];
    t.saveArt(t.artKey(rows[1]), { image: { url: "https://example.test/ogre.png", mime: "image/png", width: 300, height: 300 }, grid: { dpi: 300, offset: { x: 150, y: 150 } } });
    assert((await t.addTokens(table(rows), ["w1", "o1", "p1", "c1"])) === 4, "four tokens added");
    assert((await t.addTokens(table(rows), ["w1"])) === 0, "a row with a token is not added twice");

    const hidden = tokenFor("w1");
    assert(hidden.visible === false && hidden.name === "Wolf A" && hidden.text.plainText === "Wolf A", "unrevealed enemy goes in hidden, under the name players will see");
    assert(hidden.image.url.endsWith("/token-enemy.png"), "placeholder art for a template without art");
    const big = tokenFor("o1");
    assert(big.visible && big.name === "Ogre A" && big.scale.x === 2, "revealed large enemy named and two cells");
    assert(big.image.url === "https://example.test/ogre.png", "chosen art is used for the template");
    assert(tokenFor("p1").image.url.endsWith("/token-player.png") && tokenFor("c1").image.url.endsWith("/token-companion.png"), "player and companion placeholders");
    const metadata = JSON.stringify(items().map((i) => i.metadata));
    assert(!/Lark|Wolf|Steel|m1/.test(metadata), "metadata carries no names or member IDs: " + metadata);
    assert(Object.keys(await t.linkedRows(ROOM)).length === 4, "linked rows");

    // Reveal, then a downed enemy, then a hand-placed token linked to a new row.
    rows[0] = { ...rows[0], revealed: true, name: "Wolf A" };
    rows[1] = { ...rows[1], down: true };
    await t.syncTokens(table(rows));
    assert(tokenFor("w1").visible && tokenFor("w1").name === "Wolf A" && tokenFor("w1").text.plainText === "Wolf A", "reveal shows and names the token");
    const down = items().filter((i) => i.metadata[t.MARKER] === t.DOWN);
    assert(down.length === 1 && down[0].attachedTo === tokenFor("o1").id && down[0].layer === "ATTACHMENT", "down marker attached");
    assert(down[0].type === "SHAPE" && down[0].shapeType === "CIRCLE" && down[0].strokeColor === "#ff4d4d" && down[0].fillOpacity === 0 && down[0].disableHit, "down marker is a red ring");
    assert(down[0].width === 150 && down[0].scale.x === 2, "the ring fits the large token's footprint");
    // Markers from older versions (a text label, a skull badge) are replaced by the ring.
    scene.set("old-label", { id: "old-label", type: "LABEL", metadata: { [t.MARKER]: "down" }, attachedTo: tokenFor("o1").id, visible: true, position: { x: 0, y: 0 } });
    scene.set("old-badge", { id: "old-badge", type: "IMAGE", metadata: { [t.MARKER]: "down-badge" }, attachedTo: tokenFor("o1").id, visible: true, position: { x: 0, y: 0 } });
    await t.syncTokens(table(rows));
    assert(!scene.has("old-label") && !scene.has("old-badge"), "old markers removed");
    await t.syncTokens(table(rows));
    assert(items().filter((i) => i.metadata[t.MARKER]).length === 1, "sync is idempotent");
    // Whose turn it is: a yellow ring outside any other ring, which then moves inward.
    const turnTable = { ...table(rows), encounter: { ...table(rows).encounter, current: "o1" } };
    await t.syncTokens(turnTable);
    const ringsOn = (id) => items().filter((i) => i.metadata[t.MARKER] && i.attachedTo === tokenFor(id).id);
    const turn = ringsOn("o1").find((i) => i.metadata[t.MARKER] === t.TURN);
    assert(turn && turn.strokeColor === "#ffd433" && turn.scale.x === 2, "current turn gets the outer yellow ring");
    assert(Math.abs(ringsOn("o1").find((i) => i.metadata[t.MARKER] === t.DOWN).scale.x - 1.8) < 1e-9, "down ring moves inside the turn ring");
    await t.syncTokens({ ...turnTable, encounter: { ...turnTable.encounter, current: "p1" } });
    assert(!ringsOn("o1").some((i) => i.metadata[t.MARKER] === t.TURN) && ringsOn("p1").length === 1, "the turn ring follows the pointer");
    assert(ringsOn("o1").find((i) => i.metadata[t.MARKER] === t.DOWN).scale.x === 2, "down ring returns outward");
    await t.syncTokens({ ...turnTable, encounter: { ...turnTable.encounter, current: "p1", running: false } });
    assert(!ringsOn("p1").length, "no turn ring when the encounter is not running");

    scene.set("mine", { id: "mine", type: "IMAGE", name: "My goblin", visible: true, metadata: { other: 1 }, position: { x: 0, y: 0 } });
    rows.push({ id: "g1", kind: "enemy", revealed: false, name: "Goblin", down: false, template: null });
    await t.linkToken("mine", ROOM, rows[4]);
    await t.syncTokens(table(rows));
    assert(scene.get("mine").name === "My goblin" && !scene.get("mine").visible, "a hand-placed token keeps its name and hides with its hidden row");
    rows[4] = { ...rows[4], revealed: true };
    await t.syncTokens(table(rows));
    assert(scene.get("mine").visible, "a linked hand-placed token shows on reveal");
    rows[4] = { ...rows[4], revealed: false };
    await t.syncTokens(table(rows));
    assert(!scene.get("mine").visible, "and hides again");

    // Hiding again hides the token and keeps its name.
    rows[0] = { ...rows[0], revealed: false };
    await t.syncTokens(table(rows));
    assert(!tokenFor("w1").visible && tokenFor("w1").name === "Wolf A", "re-hidden enemy hidden again");

    // A downed hidden enemy's marker hides and shows with its token.
    rows[0] = { ...rows[0], down: true };
    await t.syncTokens(table(rows));
    const marker = () => items().find((i) => i.metadata[t.MARKER] && i.attachedTo === tokenFor("w1").id);
    assert(marker() && marker().visible === false, "marker on a hidden token is hidden");
    rows[0] = { ...rows[0], revealed: true };
    await t.syncTokens(table(rows));
    assert(marker().visible === true, "marker shows on reveal");
    rows[0] = { ...rows[0], down: false };

    // Removing rows: placed tokens and their markers go, the DM's own token is only unlinked.
    rows[1] = { ...rows[1], down: false };
    rows = rows.filter((r) => r.id !== "o1" && r.id !== "g1");
    rows[0] = { ...rows[0] };
    scene.get(tokenFor("o1").id); // still there before sync
    await t.syncTokens(table(rows));
    assert(!tokenFor("o1") && !items().some((i) => i.metadata[t.MARKER]), "removed row loses its token and marker");
    assert(scene.has("mine") && !scene.get("mine").metadata[t.LINK] && scene.get("mine").metadata.other === 1, "hand-placed token unlinked, not deleted");

    await t.removeTokens(ROOM, ["p1"]);
    assert(!tokenFor("p1") && tokenFor("c1"), "remove takes only the named rows");
    const other = { ...tokenFor("c1"), id: "other-room", metadata: { [t.LINK]: { room: "elsewhere", row: "c1", created: true } } };
    scene.set(other.id, other);
    await t.syncTokens(table([]));
    assert(scene.has("other-room"), "tokens linked to another tracker room are left alone");

    // Player matching by unique name, kept per room.
    const party = [{ id: "obr-1", name: "lark " }, { id: "obr-2", name: "Wren" }];
    const members = [{ id: "p1", kind: "player", member_id: "m1", name: "Lark" }, { id: "p2", kind: "player", member_id: "m2", name: "Ash" }];
    let matches = p.autoMatch(ROOM, party, members);
    assert(matches["obr-1"] === "m1" && !matches["obr-2"], "auto match by name");
    p.saveMatch(ROOM, "obr-2", "m2");
    assert(p.loadMatches(ROOM)["obr-2"] === "m2" && Object.keys(p.loadMatches("other")).length === 0, "manual match per room");
    p.saveMatch(ROOM, "obr-2", "");
    assert(!p.loadMatches(ROOM)["obr-2"], "clearing a match");

    // A matched player's own token is linked to their row without a click.
    const lark = { id: "p9", kind: "player", member_id: "m1", name: "Lark" };
    scene.set("lark-token", { id: "lark-token", type: "IMAGE", layer: "CHARACTER", createdUserId: "obr-1", name: "Lark", visible: true, metadata: {}, position: { x: 0, y: 0 } });
    scene.set("dm-token", { id: "dm-token", type: "IMAGE", layer: "CHARACTER", createdUserId: "dm", name: "Orc", visible: true, metadata: {}, position: { x: 0, y: 0 } });
    assert((await t.adoptPlayerTokens(table([lark]), p.loadMatches(ROOM))) === 1, "player token adopted");
    assert(scene.get("lark-token").metadata[t.LINK]?.row === "p9" && !scene.get("dm-token").metadata[t.LINK], "only the matched player's token is linked");
    assert((await t.adoptPlayerTokens(table([lark]), p.loadMatches(ROOM))) === 0, "adoption happens once");

    // Spell templates (O3).
    const tp = await import(pathToFileURL(path.join(dir, "templates.js")).href);
    const ts = await import(pathToFileURL(path.join(dir, "template-sync.js")).href);
    scene.clear();
    memory.clear();
    const casterRow = { id: "p1", kind: "player", member_id: "m1", name: "Lark" };
    const target = { id: "w1", kind: "enemy", revealed: true, name: "Wolf A", down: false, template: wolf };
    await t.addTokens(table([casterRow, target]), ["p1", "w1"]);
    const caster = tokenFor("p1");
    const wolfToken = tokenFor("w1");
    assert(tp.tokenCells(caster) === 1, "a placeholder token is one cell");

    // Geometry: 150 px per 5 ft, so 30 px per foot.
    const at = { id: caster.id, position: { x: 0, y: 0 }, cells: 1 };
    const cone = tp.placement({ shape: "cone", size: 15 }, at, { x: 300, y: 0 }, 150, 30);
    assert(cone.position.x === 75 && cone.rotation === 0 && cone.points[1].x === 450 && cone.points[2].y === 225, "15 ft cone from the token edge, pointing at the aim");
    const north = tp.placement({ shape: "line", size: 100, width: 5 }, at, null, 150, 30);
    assert(north.rotation === -90 && north.points[2].x === 3000 && north.points[2].y === 75, "100 by 5 ft line pointing north");
    const ball = tp.placement({ shape: "sphere", size: 20 }, at, { x: 900, y: 300 }, 150, 30);
    assert(ball.position.x === 900 && Math.round(ball.points[0].x) === 600 && ball.points.length === 48, "20 ft sphere centred on the aim");
    const aura = tp.placement({ shape: "emanation", size: 15 }, at, null, 150, 30);
    assert(aura.attachedTo === caster.id && Math.round(aura.points[0].x) === 525, "emanation surrounds the caster's space and moves with it");
    assert(tp.pixelsPerFoot(150, { parsed: { multiplier: 10, unit: "ft" } }) === 15 && tp.pixelsPerFoot(150, null) === 30, "grid scale");
    assert(!tp.validSpec({ room: "r", id: "x", name: "n", colour: "red", position: { x: 0, y: 0 }, rotation: 0, points: [] }), "bad specs are refused");

    const fireball = { id: "t1", caster: "p1", member_id: "m1", spell: "Fireball", shape: "sphere", size: 20, lasts: "turn", aim: "w1" };
    const withTemplates = (templates) => ({ ...table([casterRow, target]), encounter: { ...table([casterRow, target]).encounter, templates } });
    const templateItems = () => items().filter((i) => i.metadata[tp.TEMPLATE]);

    // No matched player: the DM's extension draws it at once, on the aimed token.
    await ts.syncTemplates(withTemplates([fireball]), 1000);
    assert(templateItems().length === 1 && templateItems()[0].position.x === wolfToken.position.x, "DM draws an unmatched caster's template at the aim");
    assert(JSON.stringify(templateItems()[0].metadata) === JSON.stringify({ [tp.TEMPLATE]: { room: ROOM, id: "t1" } }), "template metadata holds only IDs");
    await ts.syncTemplates(withTemplates([fireball]), 2000);
    assert(templateItems().length === 1, "drawn once");
    // Deleted by hand: not redrawn. Dropped by the room: removed.
    scene.delete(templateItems()[0].id);
    await ts.syncTemplates(withTemplates([fireball]), 3000);
    assert(templateItems().length === 0, "a template deleted by hand is not redrawn");

    // A matched player's extension is asked to draw it, and draws it when the DM asked.
    p.saveMatch(ROOM, "obr-lark", "m1");
    sdk.party.players = [{ id: "obr-lark", connectionId: "c-lark", role: "PLAYER", name: "Lark" }, { id: "obr-dm", connectionId: "c-dm", role: "GM" }];
    const guardians = { id: "t2", caster: "p1", member_id: "m1", spell: "Spirit Guardians", shape: "emanation", size: 15, lasts: "concentration" };
    await ts.syncTemplates(withTemplates([fireball, guardians]), 10000);
    assert(templateItems().length === 0 && sdk.sent.length === 1 && sdk.sent[0].data.to === "obr-lark", "caster's extension asked to draw");
    sdk.party.me = "obr-lark";
    ts.listenForDraws();
    await sdk.deliver(sdk.sent[0].data, "c-lark");
    assert(templateItems().length === 0, "a draw request from a player is ignored");
    await sdk.deliver({ ...sdk.sent[0].data, to: "someone-else" }, "c-dm");
    assert(templateItems().length === 0, "a request for another player is ignored");
    await sdk.deliver(sdk.sent[0].data, "c-dm");
    assert(templateItems().length === 1 && templateItems()[0].attachedTo === caster.id, "caster draws the emanation, attached to their token");
    await ts.syncTemplates(withTemplates([fireball, guardians]), 11000);
    assert(templateItems().length === 1 && sdk.sent.length === 1, "not asked twice");

    // Unanswered requests fall back to the DM after the wait.
    const bolt = { id: "t3", caster: "p1", member_id: "m1", spell: "Lightning Bolt", shape: "line", size: 100, width: 5, lasts: "turn" };
    await ts.syncTemplates(withTemplates([guardians, bolt]), 20000);
    assert(templateItems().length === 1, "waiting for the caster");
    await ts.syncTemplates(withTemplates([guardians, bolt]), 20000 + ts.ANSWER_MS);
    assert(templateItems().length === 2, "DM draws after the caster does not answer");

    // A caster with no token on the map waits, with a note.
    scene.delete(caster.id);
    const late = { ...bolt, id: "t4" };
    const notes = await ts.syncTemplates(withTemplates([guardians, bolt, late]), 30000);
    assert(notes.length === 1 && /token/.test(notes[0]), "note for a caster without a token");
    await ts.syncTemplates(withTemplates([]), 31000);
    assert(templateItems().length === 0, "templates the room dropped are removed");


    // Who is inside (O4): hand counts by the half-square rule on a 150 px, 5 ft grid.
    const ins = await import(pathToFileURL(path.join(dir, "inside.js")).href);
    const keys = (set) => [...set].sort();
    const circle20 = { position: { x: 0, y: 0 }, rotation: 0, points: tp.placement({ shape: "sphere", size: 20 }, at, { x: 0, y: 0 }, 150, 30).points };
    // A 20 ft radius on a grid intersection: 4, 4, 3 and 2 squares per quadrant row.
    assert(ins.countedSquares(ins.outline(circle20), 150).size === 52, "20 ft sphere on an intersection counts 52 squares");
    assert(ins.countedSquares(ins.outline(circle20), 150).has("3,0") && !ins.countedSquares(ins.outline(circle20), 150).has("3,2"), "sphere edge squares");
    // A 15 ft cone east from the edge of a creature in square 0,0: the first column is exactly
    // half covered, the second only in the middle, the third in three squares.
    const caster0 = { id: "c", position: { x: 75, y: 75 }, cells: 1 };
    const coneEast = { ...tp.placement({ shape: "cone", size: 15 }, caster0, { x: 600, y: 75 }, 150, 30) };
    assert(JSON.stringify(keys(ins.countedSquares(ins.outline(coneEast), 150))) === JSON.stringify(["1,0", "2,0", "3,-1", "3,0", "3,1"]), "15 ft cone hand count");
    // A 30 ft line east covers six squares in its row and none beside it.
    const lineEast = tp.placement({ shape: "line", size: 30, width: 5 }, caster0, { x: 900, y: 75 }, 150, 30);
    assert(JSON.stringify(keys(ins.countedSquares(ins.outline(lineEast), 150))) === JSON.stringify(["1,0", "2,0", "3,0", "4,0", "5,0", "6,0"]), "30 ft line hand count");
    // A 5 ft line along a diagonal counts the diagonal squares only (about 91% each; the
    // squares beside it are about 25% covered).
    const diagonal = { position: { x: 0, y: 0 }, rotation: 45, points: [{ x: 0, y: -75 }, { x: 4 * 150 * Math.SQRT2, y: -75 }, { x: 4 * 150 * Math.SQRT2, y: 75 }, { x: 0, y: 75 }] };
    assert(JSON.stringify(keys(ins.countedSquares(ins.outline(diagonal), 150))) === JSON.stringify(["0,0", "1,1", "2,2", "3,3"]), "diagonal line hand count");
    // Scale on the drawing is applied (a resized template).
    assert(ins.countedSquares(ins.outline({ ...circle20, scale: { x: 0.5, y: 0.5 } }), 150).size === 12, "a scaled template shrinks");
    // A 5 ft radius on the corner of four squares covers each by about 79%. A large creature
    // touching one of them is inside; a medium creature two squares away is not.
    const small = { position: { x: 750, y: 750 }, rotation: 0, points: tp.placement({ shape: "sphere", size: 5 }, at, { x: 0, y: 0 }, 150, 30).points };
    const creatures = [
      { row: "ogre", position: { x: 600, y: 600 }, cells: 2 },
      { row: "far", position: { x: 975, y: 975 }, cells: 1 },
      { row: "near", position: { x: 825, y: 825 }, cells: 1 },
      { row: "sprite", position: { x: 700, y: 700 }, cells: 0.5 },
    ];
    assert(JSON.stringify(ins.rowsInside(ins.outline(small), creatures, 150).sort()) === JSON.stringify(["near", "ogre", "sprite"]), "large and tiny creatures by their spaces");
    assert(JSON.stringify(ins.space({ x: 600, y: 600 }, 2, 150).sort()) === JSON.stringify(["3,3", "3,4", "4,3", "4,4"]), "a large creature's space");
    const ring = { position: { x: 75, y: 75 }, rotation: 0, points: tp.placement({ shape: "emanation", size: 5 }, caster0, null, 150, 30).points };
    const nearby = [{ row: "me", position: { x: 75, y: 75 }, cells: 1, caster: true }, { row: "ally", position: { x: 225, y: 75 }, cells: 1 }, { row: "out", position: { x: 375, y: 75 }, cells: 1 }];
    assert(JSON.stringify(ins.rowsInside(ins.outline(ring), nearby, 150, { skipCaster: true })) === JSON.stringify(["ally"]), "an emanation leaves out its caster");

    // Reports from the scene: drawn templates against linked tokens, square grids only.
    scene.clear();
    memory.clear();
    sdk.party.players = [];
    const tokensTable = table([casterRow, target]);
    await t.addTokens(tokensTable, ["p1", "w1"]);
    const aimed = { id: "t9", caster: "p1", member_id: "m1", spell: "Fireball", shape: "sphere", size: 20, lasts: "removed", aim: "w1" };
    const withAimed = { ...tokensTable, encounter: { ...tokensTable.encounter, templates: [aimed] } };
    await ts.syncTemplates(withAimed, 50000);
    const result = await ts.insideReports(withAimed);
    assert(result.reports.length === 1 && result.reports[0].template === "t9", "one report per drawn template");
    assert(JSON.stringify(result.reports[0].rows) === JSON.stringify(["p1", "w1"]), "a fireball on the adjacent wolf catches the caster too: " + JSON.stringify(result.reports[0].rows));
    sdk.party.gridType = "HEX_VERTICAL";
    const hex = await ts.insideReports(withAimed);
    assert(hex.reports.length === 0 && /square grids/.test(hex.note), "hex grids are not supported yet");
    sdk.party.gridType = "SQUARE";

    console.log("owlbear-tokens: all checks passed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
