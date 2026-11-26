// Character portrait in the sheet header. Stored per character in this browser only.
;(() => {
  const button = document.getElementById("portrait-button");
  const dialog = document.getElementById("portrait-dialog");
  if (!button || !dialog) return;
  const image = button.querySelector("img");
  const preview = document.getElementById("portrait-preview");
  const file = document.getElementById("portrait-file");
  const remove = document.getElementById("portrait-remove");
  const status = document.getElementById("portrait-status");
  const profile = document.body.dataset.profile;
  const key = profile && "aurora-portrait-v1:" + profile;
  const size = 192;

  function read() {
    try { return key ? localStorage.getItem(key) : null; } catch { return null; }
  }
  function paint(url) {
    for (const node of [image, preview]) {
      node.hidden = !url;
      if (url) node.src = url; else node.removeAttribute("src");
    }
    button.classList.toggle("has-portrait", Boolean(url));
    document.body.classList.toggle("has-portrait", Boolean(url));
    remove.hidden = !url;
    button.title = url ? "Character portrait" : "Add a character portrait";
  }
  function store(url) {
    if (!key) throw new Error("Portraits need a saved character profile.");
    if (url) localStorage.setItem(key, url); else localStorage.removeItem(key);
  }
  async function crop(source) {
    const bitmap = await createImageBitmap(source);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    // Centre crop, slightly favouring the top where faces usually are.
    const x = (bitmap.width - side) / 2, y = Math.max(0, (bitmap.height - side) / 3);
    context.drawImage(bitmap, x, y, side, side, 0, 0, size, size);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", .86);
  }
  button.onclick = () => { status.textContent = ""; dialog.showModal(); };
  file.onchange = async () => {
    const chosen = file.files[0];
    file.value = "";
    if (!chosen) return;
    try {
      if (!chosen.type.startsWith("image/")) throw new Error("Choose an image file.");
      if (chosen.size > 20 * 1024 * 1024) throw new Error("Choose an image under 20 MB.");
      const url = await crop(chosen);
      store(url);
      paint(url);
      status.textContent = "Portrait saved.";
    } catch (error) {
      status.textContent = error?.name === "QuotaExceededError" ? "This browser has no room to save the portrait." : error.message || "Could not read that image.";
    }
  };
  remove.onclick = () => {
    try { store(null); paint(null); status.textContent = "Portrait removed."; }
    catch (error) { status.textContent = error.message; }
  };
  paint(read());
})();
