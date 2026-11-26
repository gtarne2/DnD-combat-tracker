// O2 Owlbear token sync: tokens.js and players.js against a stand-in Owlbear SDK.
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
const pick = (filter) => [...scene.values()].filter((item) => Array.isArray(filter) ? filter.includes(item.id) : filter ? filter(item) : true);
export default {
  scene: {
    isReady: async () => true,
    grid: { getDpi: async () => 150, snapPosition: async (p) => ({ x: Math.round(p.x / 75) * 75, y: Math.round(p.y / 75) * 75 }) },
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
    for (const name of ["tokens.js", "players.js"]) fs.copyFileSync(path.join(extension, name), path.join(dir, name));
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
      { id: "w1", kind: "enemy", revealed: false, name: null, down: false, template: wolf },
      { id: "o1", kind: "enemy", revealed: true, name: "Ogre A", down: false, template: ogre },
      { id: "p1", kind: "player", member_id: "m1", name: "Lark" },
      { id: "c1", kind: "companion", member_id: "m1", local_id: 1, name: "Steel Defender" },
    ];
    t.saveArt(t.artKey(rows[1]), { image: { url: "https://example.test/ogre.png", mime: "image/png", width: 300, height: 300 }, grid: { dpi: 300, offset: { x: 150, y: 150 } } });
    assert((await t.addTokens(table(rows), ["w1", "o1", "p1", "c1"])) === 4, "four tokens added");
    assert((await t.addTokens(table(rows), ["w1"])) === 0, "a row with a token is not added twice");

    const hidden = tokenFor("w1");
    assert(hidden.visible === false && hidden.name === "Enemy" && hidden.text.plainText === "Enemy", "unrevealed enemy goes in hidden and unnamed");
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
    const down = items().filter((i) => i.metadata[t.MARKER] === "down");
    assert(down.length === 1 && down[0].attachedTo === tokenFor("o1").id && down[0].layer === "ATTACHMENT", "down marker attached");
    await t.syncTokens(table(rows));
    assert(items().filter((i) => i.metadata[t.MARKER]).length === 1, "sync is idempotent");

    scene.set("mine", { id: "mine", type: "IMAGE", name: "My goblin", visible: true, metadata: { other: 1 }, position: { x: 0, y: 0 } });
    rows.push({ id: "g1", kind: "enemy", revealed: false, name: null, down: false, template: null });
    await t.linkToken("mine", ROOM, rows[4]);
    await t.syncTokens(table(rows));
    assert(scene.get("mine").name === "My goblin" && scene.get("mine").visible, "a hand-placed token keeps its name and is not hidden");

    // Hiding again only hides tokens this extension placed.
    rows[0] = { ...rows[0], revealed: false, name: null };
    await t.syncTokens(table(rows));
    assert(!tokenFor("w1").visible && tokenFor("w1").name === "Enemy", "re-hidden enemy hidden again");

    // A downed hidden enemy's marker hides and shows with its token.
    rows[0] = { ...rows[0], down: true };
    await t.syncTokens(table(rows));
    const marker = () => items().find((i) => i.metadata[t.MARKER] && i.attachedTo === tokenFor("w1").id);
    assert(marker() && marker().visible === false, "marker on a hidden token is hidden");
    rows[0] = { ...rows[0], revealed: true, name: "Wolf A" };
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
    console.log("owlbear-tokens: all checks passed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
