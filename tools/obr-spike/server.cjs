#!/usr/bin/env node
// Stage O0 spike: a throwaway loopback server that tells us which ways an
// Owlbear Rodeo extension running in Chrome can reach a local Windows app.
//
//   node tools/obr-spike/server.cjs
//
// It listens on 127.0.0.1 only, never on the Wi-Fi address. It serves:
//   GET  /ping           JSON, CORS-limited to the allowed origins below
//   GET  /bridge.html    the pop-up bridge page (option 2)
//   GET  /ext/...        the same test extension, served from localhost (option 1b)
//   POST /results        the extension's findings, appended to results.jsonl
// Nothing here is part of the shipped app. Delete the folder after the spike.

"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.OBR_SPIKE_PORT || 47800);
const HOST = "127.0.0.1";
const ORIGIN_SELF = `http://${HOST}:${PORT}`;
const ORIGIN_LOCALHOST = `http://localhost:${PORT}`;
const ALLOWED_ORIGINS = new Set([
  "https://raw.githack.com",
  "https://www.owlbear.rodeo",
  "https://owlbear.rodeo",
  ORIGIN_SELF,
  ORIGIN_LOCALHOST,
]);
const EXT_DIR = path.join(__dirname, "extension");
const OUT_DIR = process.env.OBR_SPIKE_OUT || path.join(process.cwd(), "target", "tmp", "obr-spike");
const RESULTS = path.join(OUT_DIR, "results.jsonl");
const MAX_BODY = 256 * 1024;
const startedAt = new Date().toISOString();
const serverId = crypto.randomBytes(4).toString("hex");

fs.mkdirSync(OUT_DIR, { recursive: true });

function log(line) {
  const stamp = new Date().toISOString().slice(11, 19);
  console.log(`[${stamp}] ${line}`);
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    // Harmless if ignored. Older Chrome builds used Private Network Access preflights.
    headers["Access-Control-Allow-Private-Network"] = "true";
  }
  return headers;
}

function send(req, res, status, type, body, extra = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...corsHeaders(req),
    ...extra,
  });
  res.end(body);
}

function json(req, res, status, value) {
  send(req, res, status, "application/json; charset=utf-8", JSON.stringify(value));
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
};

function serveExtensionFile(req, res, rel) {
  if (rel === "manifest.json") {
    // Absolute URLs so Owlbear resolves the popover and icon on localhost.
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
    manifest.name = "Aurora bridge spike (localhost)";
    manifest.icon = `${ORIGIN_LOCALHOST}/ext/icon.svg`;
    manifest.action.icon = `${ORIGIN_LOCALHOST}/ext/icon.svg`;
    manifest.action.popover = `${ORIGIN_LOCALHOST}/ext/index.html`;
    return json(req, res, 200, manifest);
  }
  const file = path.normalize(path.join(EXT_DIR, rel));
  if (!file.startsWith(EXT_DIR + path.sep) || !fs.existsSync(file)) {
    return json(req, res, 404, { error: "not found" });
  }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  send(req, res, 200, type, fs.readFileSync(file));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN_SELF);
  const origin = req.headers.origin || "(none)";
  log(`${req.method} ${url.pathname} origin=${origin}`);

  if (req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) {
    return json(req, res, 403, { error: "origin not allowed" });
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }
  if (req.method === "GET" && url.pathname === "/ping") {
    return json(req, res, 200, {
      ok: true,
      serverId,
      startedAt,
      now: new Date().toISOString(),
      sawOrigin: req.headers.origin || null,
    });
  }
  if (req.method === "GET" && url.pathname === "/bridge.html") {
    return send(req, res, 200, TYPES[".html"], fs.readFileSync(path.join(__dirname, "bridge.html")));
  }
  if (req.method === "GET" && url.pathname.startsWith("/ext/")) {
    return serveExtensionFile(req, res, url.pathname.slice("/ext/".length));
  }
  if (req.method === "POST" && url.pathname === "/results") {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        json(req, res, 413, { error: "too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return json(req, res, 400, { error: "bad json" });
      }
      const record = { receivedAt: new Date().toISOString(), via: req.headers.origin || null, body };
      fs.appendFileSync(RESULTS, JSON.stringify(record) + "\n");
      log(`saved results to ${RESULTS}`);
      json(req, res, 200, { ok: true, savedTo: RESULTS });
    });
    return;
  }
  json(req, res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("Aurora Owlbear bridge spike is running. Leave this window open.");
  console.log(`  Listening on ${ORIGIN_SELF} (this PC only)`);
  console.log(`  Localhost extension manifest: ${ORIGIN_LOCALHOST}/ext/manifest.json`);
  console.log(`  Results file: ${RESULTS}`);
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
