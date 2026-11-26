# Owlbear bridge spike (Stage O0)

Throwaway tools that answer one question: how can an Owlbear Rodeo extension running in Chrome talk to the Aurora Combat Tracker on the same PC? Nothing here ships. Delete this folder once the results are recorded in the plan.

| File | Purpose |
| --- | --- |
| `server.cjs` | Test server on `127.0.0.1:47800` only. Answers `/ping`, serves the pop-up bridge page and a localhost copy of the extension, and appends findings to `target/tmp/obr-spike/results.jsonl`. Requests from other origins get 403. |
| `run-spike.cmd` | Starts the server on Windows. Needs Node.js 18 or later. |
| `bridge.html` | Option 2, the pop-up bridge window. It only talks to the extension origins on its allowlist. |
| `extension/` | The test extension. `obr-sdk-3.1.0.js` is `@owlbear-rodeo/sdk` 3.1.0 (MIT) bundled with esbuild, so nothing loads from a third-party CDN at runtime. |

## What it tests

1. Whether Owlbear's extension iframe is allowed `loopback-network` (Chrome Local Network Access).
2. Option 1: a direct `fetch` from the HTTPS-hosted extension to `127.0.0.1` and `localhost`.
3. Option 1b: the same extension served from `http://localhost:47800/ext/manifest.json`.
4. Option 2: a pop-up window on `127.0.0.1` that relays with `postMessage`.
5. Whether the DM can add a circle and a cone, and whether a player can move the DM's circle by hand and by code, and add their own template.
6. Whether `OBR.broadcast` reaches each player.

## Steps

DM's PC:

1. Double-click `tools\obr-spike\run-spike.cmd`. Leave the window open.
2. In Chrome, open Owlbear Rodeo, open a test room with a map, and select Extensions in the room menu. Add a custom extension with this manifest URL:
   `https://raw.githack.com/gtarne2/DnD-combat-tracker/claude/project-thread-k0i2u2/tools/obr-spike/extension/manifest.json`
3. Open the spike from the toolbar. Click **Run direct tests**. If Chrome asks to let the site access apps and services on this device, choose **Allow**.
4. Click **Open pop-up bridge**. If Chrome blocks the pop-up, allow pop-ups for the site and click again.
5. Select a token on the map, then click **Add test circle and cone**.
6. Ask the players to open the spike panel, then click **Ping players**.
7. Each player clicks **Move the DM's circle**, then **Add my own template**, and drags the orange circle by hand.
8. Click **Save results to this PC**. If saving fails, copy the raw results text into the project thread.
9. Optional, option 1b: add a second custom extension with `http://localhost:47800/ext/manifest.json` and repeat steps 3 and 8 from it.
10. Click **Remove test items**, remove the spike extensions, and close the server window.
