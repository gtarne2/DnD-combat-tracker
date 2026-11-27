// Default Owlbear player tokens, one per class: a dark disc, a ring in the class colour and a
// simple emblem. Rendered with the pre-installed Playwright Chromium.
//
//   node tools/build-class-tokens.cjs
//
// Writes owlbear/token-class-<class>.png and owlbear/token-player.png (256 px). The class list
// and colours must match CLASS_TOKENS in owlbear/tokens.js and CLASS_COLOURS in
// src/combat/portrait.js.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const out = path.resolve(__dirname, "..", "owlbear");
const INK = "#f3e9d2";

const star = (points, outer, inner, turn = -90) => {
  const pts = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 ? inner : outer;
    const a = ((turn + (i * 180) / points) * Math.PI) / 180;
    pts.push(`${(128 + r * Math.cos(a)).toFixed(1)},${(128 + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
};

function gear() {
  const pts = [];
  const teeth = 10;
  for (let i = 0; i < teeth * 4; i += 1) {
    const r = i % 4 < 2 ? 60 : 47;
    const a = ((i + 0.5) / (teeth * 4)) * Math.PI * 2;
    pts.push(`${(128 + r * Math.cos(a)).toFixed(1)} ${(128 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<path fill-rule="evenodd" d="M${pts.join(" L")} Z M146 128 A18 18 0 1 0 110 128 A18 18 0 1 0 146 128 Z"/>`;
}

const sword = `<path d="M128 50 L137 64 L137 158 L119 158 L119 64 Z"/><rect x="98" y="158" width="60" height="11" rx="4"/><rect x="123" y="169" width="10" height="26"/><circle cx="128" cy="201" r="8"/>`;
const dagger = `<path d="M128 62 L140 80 L138 150 L118 150 L116 80 Z"/><rect x="100" y="150" width="56" height="11" rx="5"/><rect x="122" y="161" width="12" height="28"/><circle cx="128" cy="196" r="8"/>`;

const EMBLEMS = {
  artificer: gear(),
  barbarian: `<rect x="122" y="58" width="12" height="144" rx="5"/><path d="M120 80 L120 136 C102 130 84 136 70 150 C56 120 60 86 82 64 C92 76 104 80 120 80 Z"/><path d="M136 80 L136 136 C154 130 172 136 186 150 C200 120 196 86 174 64 C164 76 152 80 136 80 Z"/>`,
  bard: `<ellipse cx="96" cy="170" rx="19" ry="15" transform="rotate(-20 96 170)"/><ellipse cx="164" cy="152" rx="19" ry="15" transform="rotate(-20 164 152)"/><rect x="108" y="82" width="9" height="88"/><rect x="176" y="66" width="9" height="86"/><path d="M108 82 L185 64 L185 88 L108 106 Z"/>`,
  "blood-hunter": `<path d="M128 56 C150 98 178 128 178 158 C178 186 156 202 128 202 C100 202 78 186 78 158 C78 128 106 98 128 56 Z"/>`,
  cleric: `<polygon points="${star(4, 70, 16)}"/><polygon points="${star(4, 38, 12, -45)}"/>`,
  druid: `<path d="M128 56 C186 88 190 152 128 202 C66 152 70 88 128 56 Z"/><path d="M128 78 L128 196" stroke="#1b1f27" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M128 120 L152 100 M128 150 L156 128 M128 120 L104 100 M128 150 L100 128" stroke="#1b1f27" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  fighter: `<g transform="rotate(38 128 128)">${sword}</g><g transform="rotate(-38 128 128)">${sword}</g>`,
  monk: `<path d="M128 70 C152 100 152 150 128 184 C104 150 104 100 128 70 Z"/><path d="M128 184 C96 176 74 148 72 112 C100 120 118 146 128 184 Z"/><path d="M128 184 C160 176 182 148 184 112 C156 120 138 146 128 184 Z"/><rect x="82" y="188" width="92" height="9" rx="4"/>`,
  paladin: `<path d="M128 58 L186 78 C186 140 164 178 128 202 C92 178 70 140 70 78 Z"/><rect x="120" y="86" width="16" height="92" rx="3" fill="#1b1f27"/><rect x="96" y="110" width="64" height="16" rx="3" fill="#1b1f27"/>`,
  ranger: `<path d="M98 60 C178 92 178 164 98 196" stroke="${INK}" stroke-width="11" fill="none" stroke-linecap="round"/><path d="M98 60 L98 196" stroke="${INK}" stroke-width="3"/><path d="M70 128 L176 128" stroke="${INK}" stroke-width="7"/><polygon points="174,114 200,128 174,142"/><path d="M70 128 L58 114 L80 114 Z M70 128 L58 142 L80 142 Z"/>`,
  rogue: `<g transform="rotate(35 128 128)">${dagger}</g>`,
  sorcerer: `<path d="M128 54 C150 92 180 108 174 152 C170 184 150 202 128 202 C106 202 84 184 82 152 C80 122 100 108 106 84 C116 106 122 114 128 118 C138 98 136 76 128 54 Z"/><path d="M128 132 C142 152 152 162 148 178 C146 190 138 196 128 196 C118 196 110 190 108 178 C106 166 116 156 128 132 Z" fill="#1b1f27"/>`,
  warlock: `<path d="M58 128 C92 80 164 80 198 128 C164 176 92 176 58 128 Z"/><circle cx="128" cy="128" r="28" fill="#1b1f27"/><ellipse cx="128" cy="128" rx="7" ry="22"/>`,
  wizard: `<path d="M140 52 C128 80 110 120 84 170 L172 170 C160 128 150 100 168 74 C156 74 146 66 140 52 Z"/><ellipse cx="128" cy="174" rx="70" ry="14"/><polygon points="${star(5, 14, 6).split(" ").map((p) => { const [x, y] = p.split(",").map(Number); return `${x + 4},${y + 18}`; }).join(" ")}" fill="#1b1f27"/>`,
  player: `<circle cx="128" cy="98" r="30"/><path d="M68 196 C68 154 94 136 128 136 C162 136 188 154 188 196 Z"/>`,
};

const COLOURS = {
  artificer: "#d59139", barbarian: "#e7623e", bard: "#ab6dac", "blood-hunter": "#b8292f",
  cleric: "#91a1b2", druid: "#7a9a3b", fighter: "#a0674e", monk: "#51a5c5",
  paladin: "#c9ad57", ranger: "#4f9a6c", rogue: "#8d8f8a", sorcerer: "#c33b3b",
  warlock: "#8b52b0", wizard: "#4a76d0", player: "#4f8cff",
};

function svg(kind) {
  const colour = COLOURS[kind];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="${colour}" stop-opacity=".55"/><stop offset=".55" stop-color="#232833"/><stop offset="1" stop-color="#12151c"/></radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".6"/></filter>
  </defs>
  <circle cx="128" cy="128" r="120" fill="url(#bg)"/>
  <circle cx="128" cy="128" r="117" fill="none" stroke="${colour}" stroke-width="10"/>
  <circle cx="128" cy="128" r="108" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="2"/>
  <circle cx="128" cy="128" r="124" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="3"/>
  <g fill="${INK}" filter="url(#shadow)" transform="translate(128 128) scale(.86) translate(-128 -128)">${EMBLEMS[kind]}</g>
</svg>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  for (const kind of Object.keys(EMBLEMS)) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(kind)}</body></html>`);
    const file = path.join(out, kind === "player" ? "token-player.png" : `token-class-${kind}.png`);
    await page.locator("svg").screenshot({ path: file, omitBackground: true });
  }
  // A contact sheet for review, outside the extension.
  if (process.argv[2]) {
    const cells = Object.keys(EMBLEMS).map((kind) => `<figure style="margin:8px;text-align:center;color:#ddd;font:14px sans-serif">${svg(kind)}<figcaption>${kind}</figcaption></figure>`).join("");
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.setContent(`<html><body style="margin:0;background:#3b4a3a;display:flex;flex-wrap:wrap">${cells}</body></html>`);
    await page.screenshot({ path: process.argv[2] });
  }
  await browser.close();
})();
