function setupReferencePages(rows) {
  const byId = (id) => document.getElementById(id);
  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  const currencyForm = byId("inventory-currency");
  if (currencyForm) {
    const [filename, template] = JSON.parse(byId("aurora-currency-file").textContent);
    const fields = [...currencyForm.querySelectorAll("input")];
    const imported = fields.map((field) => field.valueAsNumber);
    const status = byId("currency-save-status");
    currencyForm.addEventListener("input", () => { status.textContent = ""; });
    currencyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const balances = fields.map((field) => field.valueAsNumber);
      const parts = template.map((part) => {
        if (typeof part === "string") return part;
        const [coin, original] = part;
        return balances[coin] === imported[coin] && original !== undefined
          ? original : String(balances[coin]);
      });
      const file = new Blob(parts, {type: "application/xml"});
      const url = URL.createObjectURL(file);
      const link = node("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      status.textContent = "Download started.";
    });
  }

  const inventory = byId("inventory-content");
  const items = new Map();
  for (const row of rows) {
    const body = row.querySelector(".option-body");
    if (body.dataset.inventoryIndex === undefined || items.has(body.dataset.inventoryIndex)) continue;
    items.set(body.dataset.inventoryIndex, row);
  }
  for (const [index, row] of [...items].sort(([left], [right]) => Number(left) - Number(right))) {
    const body = row.querySelector(".option-body");
    const item = node("details");
    item.dataset.viewDisclosure = "inventory:" + index + ":" + row.dataset.pin;
    const summary = node("summary");
    const title = node("strong", row.querySelector(".option-title").textContent);
    const liveQuantity = row.querySelector("[data-stack-count]");
    const quantity = liveQuantity?.cloneNode(true)
      || node("span", body.dataset.inventoryQuantity === undefined ? "Qty unknown" : "Qty " + body.dataset.inventoryQuantity);
    quantity.className = "inventory-quantity";
    summary.append(title, quantity);
    item.append(summary);
    const facts = body.querySelector(".option-facts");
    const description = body.querySelector(".description");
    if (facts) item.append(facts.cloneNode(true));
    if (description) item.append(description.cloneNode(true));
    if (!facts && !description) item.append(node("p", "No item details were available in the import."));
    sheetReference.addOptionLinks(item, row.dataset.sheetEntry);
    inventory.append(item);
  }
  if (!items.size) inventory.append(node("p", "No inventory items in this sheet."));

  for (const [page, title, labelText] of [["journal", "Journal", "Session journal"], ["notes", "Notes", "Session notes"]]) {
    const content = byId(page + "-content");
    const editor = node("div");
    editor.className = "session-editor";
    const label = node("label", labelText);
    label.htmlFor = page + "-writing";
    const area = node("textarea");
    area.id = label.htmlFor;
    area.rows = 8;
    const key = JSON.stringify(["aurora-session-writing", document.body.dataset.profile || location.pathname, title]);
    const status = node("p");
    status.setAttribute("role", "status");
    try { area.value = localStorage.getItem(key) || ""; } catch { status.textContent = "Local storage unavailable."; }
    area.addEventListener("input", () => {
      try { localStorage.setItem(key, area.value); status.textContent = "Saved locally"; }
      catch { status.textContent = "Could not save locally."; }
    });
    editor.append(label, area, status);
    content.append(editor);
    for (const field of byId("full-sheet").querySelectorAll("dt")) {
      const isNote = field.textContent === "Notes";
      const isLore = field.closest("section")?.querySelector("h2")?.textContent === "Lore";
      if (page === "notes" ? !isNote : isNote || !isLore) continue;
      const section = node("section");
      section.className = "imported-reference";
      section.append(node("h3", field.textContent), node("p", field.nextElementSibling.textContent));
      content.append(section);
    }
  }
}
