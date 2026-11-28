// Character portrait in the sheet header, with a crop editor. Stored per character in this
// browser. The original picture is kept (scaled down) with the crop, so the crop can be
// changed later. A small round copy can go to the DM's tracker as the player's Owlbear token.
;(() => {
  const button = document.getElementById("portrait-button");
  const dialog = document.getElementById("portrait-dialog");
  if (!button || !dialog) return;
  const image = button.querySelector("img");
  const preview = document.getElementById("portrait-preview");
  const file = document.getElementById("portrait-file");
  const remove = document.getElementById("portrait-remove");
  const adjust = document.getElementById("portrait-adjust");
  const status = document.getElementById("portrait-status");
  const current = document.getElementById("portrait-current");
  const cropper = document.getElementById("portrait-crop");
  const stage = document.getElementById("portrait-stage");
  const canvas = document.getElementById("portrait-canvas");
  const zoom = document.getElementById("portrait-zoom");
  const save = document.getElementById("portrait-save");
  const cancel = document.getElementById("portrait-cancel");
  const tokenBox = document.getElementById("portrait-token");
  const profile = document.body.dataset.profile;
  const key = profile && "aurora-portrait-v1:" + profile;
  const sourceKey = profile && "aurora-portrait-source-v1:" + profile;
  const tokenKey = profile && "aurora-portrait-token-v1:" + profile;
  const size = 192;
  const sourceSide = 900;
  const tokenSide = 160;
  // Ring colours for the round map token, matching the extension's class icons.
  const CLASS_COLOURS = {
    artificer: "#d59139", barbarian: "#e7623e", bard: "#ab6dac", "blood hunter": "#b8292f",
    cleric: "#91a1b2", druid: "#7a9a3b", fighter: "#a0674e", monk: "#51a5c5",
    paladin: "#c9ad57", ranger: "#4f9a6c", rogue: "#8d8f8a", sorcerer: "#c33b3b",
    warlock: "#8b52b0", wizard: "#4a76d0",
  };
  const changeListeners = new Set();

  const get = k => { try { return k ? localStorage.getItem(k) : null; } catch { return null; } };
  function read() { return get(key); }
  function paint(url) {
    for (const node of [image, preview]) {
      node.hidden = !url;
      if (url) node.src = url; else node.removeAttribute("src");
    }
    button.classList.toggle("has-portrait", Boolean(url));
    document.body.classList.toggle("has-portrait", Boolean(url));
    remove.hidden = !url;
    adjust.hidden = !url || !get(sourceKey);
    button.title = url ? "Character portrait" : "Add a character portrait";
  }
  function store(url, source) {
    if (!key) throw new Error("Portraits need a saved character profile.");
    if (url) localStorage.setItem(key, url); else localStorage.removeItem(key);
    if (source) {
      // The source is a convenience for re-cropping. Without room for it, keep the portrait.
      try { localStorage.setItem(sourceKey, JSON.stringify(source)); } catch { localStorage.removeItem(sourceKey); }
    } else if (!url) localStorage.removeItem(sourceKey);
    for (const listener of changeListeners) listener();
  }

  // Crop editor state: the picture, its zoom and the picture point at the circle's centre.
  let editing = null;
  const view = canvas.width;
  const circle = view * 0.42;
  function cover(bitmap) { return view / Math.min(bitmap.width, bitmap.height); }
  function clamp() {
    const {bitmap} = editing;
    const scale = cover(bitmap) * editing.zoom;
    const halfW = view / 2 / scale, halfH = view / 2 / scale;
    editing.cx = Math.min(bitmap.width - halfW, Math.max(halfW, editing.cx));
    editing.cy = Math.min(bitmap.height - halfH, Math.max(halfH, editing.cy));
  }
  function draw() {
    const context = canvas.getContext("2d");
    const {bitmap} = editing;
    const scale = cover(bitmap) * editing.zoom;
    context.clearRect(0, 0, view, view);
    context.drawImage(bitmap, editing.cx - view / 2 / scale, editing.cy - view / 2 / scale, view / scale, view / scale, 0, 0, view, view);
    // Dim everything outside the token circle.
    context.save();
    context.fillStyle = "rgb(8 11 16 / .6)";
    context.beginPath();
    context.rect(0, 0, view, view);
    context.arc(view / 2, view / 2, circle, 0, Math.PI * 2, true);
    context.fill("evenodd");
    context.strokeStyle = "#e3c27a";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(view / 2, view / 2, circle, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  // The saved square is the circle's bounding box, so the round token shows exactly the circle.
  function cropTo(bitmap, crop, side) {
    const out = document.createElement("canvas");
    out.width = out.height = side;
    const scale = cover(bitmap) * crop.zoom;
    const half = circle / scale;
    out.getContext("2d").drawImage(bitmap, crop.cx - half, crop.cy - half, half * 2, half * 2, 0, 0, side, side);
    return out;
  }
  async function loadBitmap(source) {
    const bitmap = await createImageBitmap(source);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= sourceSide) return bitmap;
    // Keep a smaller copy, so the original fits in browser storage for later re-cropping.
    const ratio = sourceSide / longest;
    const small = document.createElement("canvas");
    small.width = Math.round(bitmap.width * ratio);
    small.height = Math.round(bitmap.height * ratio);
    small.getContext("2d").drawImage(bitmap, 0, 0, small.width, small.height);
    bitmap.close?.();
    return createImageBitmap(small);
  }
  function openEditor(bitmap, crop) {
    // A new picture starts centred, slightly favouring the top where faces usually are.
    editing = {bitmap, zoom: crop?.zoom || 1, cx: crop?.cx ?? bitmap.width / 2, cy: crop?.cy ?? Math.min(bitmap.height / 2, bitmap.height * 0.4)};
    zoom.value = String(editing.zoom);
    clamp();
    draw();
    current.hidden = true;
    cropper.hidden = false;
    stage.focus();
  }
  function closeEditor() {
    editing?.bitmap.close?.();
    editing = null;
    cropper.hidden = true;
    current.hidden = false;
  }
  function setZoom(value) {
    if (!editing) return;
    editing.zoom = Math.min(4, Math.max(1, value));
    zoom.value = String(editing.zoom);
    clamp();
    draw();
  }
  function move(dx, dy) {
    const scale = cover(editing.bitmap) * editing.zoom * (canvas.getBoundingClientRect().width / view || 1);
    editing.cx -= dx / scale;
    editing.cy -= dy / scale;
    clamp();
    draw();
  }
  let drag = null;
  stage.addEventListener("pointerdown", event => {
    if (!editing) return;
    drag = {x: event.clientX, y: event.clientY};
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", event => {
    if (!drag || !editing) return;
    move(event.clientX - drag.x, event.clientY - drag.y);
    drag = {x: event.clientX, y: event.clientY};
  });
  stage.addEventListener("pointerup", () => { drag = null; });
  stage.addEventListener("pointercancel", () => { drag = null; });
  stage.addEventListener("wheel", event => {
    if (!editing) return;
    event.preventDefault();
    setZoom(editing.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08));
  }, {passive: false});
  stage.addEventListener("keydown", event => {
    if (!editing) return;
    const step = event.shiftKey ? 40 : 10;
    const moves = {ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step]};
    if (moves[event.key]) { event.preventDefault(); move(...moves[event.key]); }
    if (event.key === "+" || event.key === "=") setZoom(editing.zoom * 1.1);
    if (event.key === "-") setZoom(editing.zoom / 1.1);
  });
  zoom.oninput = () => setZoom(Number(zoom.value));
  cancel.onclick = () => { closeEditor(); status.textContent = ""; };
  save.onclick = () => {
    if (!editing) return;
    try {
      const url = cropTo(editing.bitmap, editing, size).toDataURL("image/jpeg", .88);
      const original = document.createElement("canvas");
      original.width = editing.bitmap.width;
      original.height = editing.bitmap.height;
      original.getContext("2d").drawImage(editing.bitmap, 0, 0);
      const source = {image: original.toDataURL("image/jpeg", .85), crop: {zoom: editing.zoom, cx: editing.cx, cy: editing.cy}};
      store(url, source);
      paint(url);
      closeEditor();
      status.textContent = "Portrait saved.";
    } catch (error) {
      status.textContent = error?.name === "QuotaExceededError" ? "This browser has no room to save the portrait." : error.message || "Could not save the portrait.";
    }
  };

  button.onclick = () => { status.textContent = ""; dialog.showModal(); };
  dialog.addEventListener("close", () => { if (editing) closeEditor(); });
  file.onchange = async () => {
    const chosen = file.files[0];
    file.value = "";
    if (!chosen) return;
    try {
      if (!chosen.type.startsWith("image/")) throw new Error("Choose an image file.");
      if (chosen.size > 20 * 1024 * 1024) throw new Error("Choose an image under 20 MB.");
      openEditor(await loadBitmap(chosen));
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message || "Could not read that image.";
    }
  };
  adjust.onclick = async () => {
    try {
      const source = JSON.parse(get(sourceKey) || "null");
      if (!source?.image) throw new Error("Choose the image again to change its crop.");
      const blob = await (await fetch(source.image)).blob();
      openEditor(await createImageBitmap(blob), source.crop);
    } catch (error) {
      status.textContent = error.message || "Could not open the portrait.";
    }
  };
  remove.onclick = () => {
    try { store(null); paint(null); status.textContent = "Portrait removed."; }
    catch (error) { status.textContent = error.message; }
  };
  tokenBox.checked = get(tokenKey) !== "off";
  tokenBox.onchange = () => {
    try { if (tokenBox.checked) localStorage.removeItem(tokenKey); else localStorage.setItem(tokenKey, "off"); } catch {}
    for (const listener of changeListeners) listener();
  };
  paint(read());

  function classColour(text) {
    const words = String(text || "").toLowerCase();
    let best = null;
    for (const [name, colour] of Object.entries(CLASS_COLOURS)) {
      const at = words.indexOf(name);
      if (at >= 0 && (!best || at < best.at)) best = {at, colour};
    }
    return best?.colour || "#4f8cff";
  }

  /** The round portrait for the map token, with a ring in the class colour. */
  async function tokenImage(url) {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const out = document.createElement("canvas");
    out.width = out.height = tokenSide;
    const context = out.getContext("2d");
    const middle = tokenSide / 2, ring = 9;
    context.save();
    context.beginPath();
    context.arc(middle, middle, middle - ring / 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(picture, 0, 0, tokenSide, tokenSide);
    context.restore();
    context.lineWidth = ring;
    context.strokeStyle = classColour(document.body.dataset.class);
    context.beginPath();
    context.arc(middle, middle, middle - ring / 2, 0, Math.PI * 2);
    context.stroke();
    context.lineWidth = 2;
    context.strokeStyle = "rgb(0 0 0 / .55)";
    context.beginPath();
    context.arc(middle, middle, middle - 1, 0, Math.PI * 2);
    context.stroke();
    for (const [type, quality] of [["image/webp", .82], ["image/webp", .6], ["image/jpeg", .7]]) {
      const data = out.toDataURL(type, quality);
      if (data.startsWith("data:" + type) && data.length <= 46 * 1024) return data;
    }
    return null;
  }

  /** What the DM's tracker gets for this player's map token: the class and the portrait, if shared. */
  async function look() {
    const url = read();
    const portrait = url && tokenBox.checked ? await tokenImage(url).catch(() => null) : null;
    return {class: (document.body.dataset.class || "").slice(0, 40), portrait};
  }

  window.portraitToken = {
    look,
    onChange(listener) { changeListeners.add(listener); },
  };
})();
