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
    const edits = {...sessionView.get("currencyEdits")};
    fields.forEach((field, index) => {
      if (Object.hasOwn(edits, field.id) && edits[field.id] === String(imported[index])) delete edits[field.id];
      if (Object.hasOwn(edits, field.id)) field.value = edits[field.id];
    });
    currencyForm.addEventListener("input", (event) => {
      status.textContent = "";
      const field = event.target;
      if (!fields.includes(field)) return;
      if (field.value === String(imported[fields.indexOf(field)])) delete edits[field.id];
      else edits[field.id] = field.value;
      sessionView.set("currencyEdits", {...edits});
      sessionView.save();
    });
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
  const filter = node("select");
  filter.setAttribute("aria-label", "Filter inventory");
  for (const [label, value] of [["All items", "all"], ["Equipped gear", "equipped"], ["Consumables", "consumable"], ["Charged items", "charged"], ["Requires attunement", "attunement"]]) {
    filter.add(new Option(label, value));
  }
  inventory.before(filter);
  const items = new Map();
  for (const row of rows) {
    const body = row.querySelector(".option-body");
    if (body.dataset.inventoryIndex === undefined || items.has(body.dataset.inventoryIndex)) continue;
    items.set(body.dataset.inventoryIndex, row);
  }
  for (const [index, row] of [...items].sort(([left], [right]) => Number(left) - Number(right))) {
    const body = row.querySelector(".option-body");
    const item = node("details");
    item.dataset.sheetEntry = row.dataset.sheetEntry;
    item.dataset.viewDisclosure = "inventory:" + index + ":" + row.dataset.pin;
    if (body.hasAttribute("data-equipped")) item.dataset.equipped = "";
    const summary = node("summary");
    const title = node("strong", row.querySelector(".option-title").textContent);
    const liveQuantity = row.querySelector("[data-stack-count]");
    if (liveQuantity) item.dataset.consumableItem = "";
    const quantity = liveQuantity?.cloneNode(true)
      || node("span", body.dataset.inventoryQuantity === undefined ? "Qty unknown" : "Qty " + body.dataset.inventoryQuantity);
    quantity.className = "inventory-quantity";
    summary.append(title, quantity);
    item.append(summary);
    const facts = body.querySelector(".option-facts");
    const description = body.querySelector(".description");
    if (facts) item.append(facts.cloneNode(true));
    if (description) item.append(description.cloneNode(true));
    const sourceTools = row.querySelector(".option-execute");
    if (sourceTools.hasAttribute("data-attunement-key")) {
      item.dataset.requiresAttunement = "";
      combatTools.inventoryAttunement(item, sourceTools);
    }
    const charge = row.querySelector("[data-charge-key]");
    if (charge || [...(facts?.querySelectorAll("dt") || [])].some((fact) => fact.textContent === "Recharge")) item.dataset.charged = "";
    if (charge) {
      const tools = row.querySelector(".option-execute").cloneNode(true);
      chargedItems.render(tools, previewEncounter.current());
      item.append(tools);
    }
    if (!facts && !description) item.append(node("p", "No item details were available in the import."));
    sheetReference.addOptionLinks(item, row.dataset.sheetEntry);
    inventory.append(item);
  }
  const empty = node("p", "No inventory items match this filter.");
  inventory.append(empty);
  const inventorySelectors = {all: "details", equipped: "[data-equipped]", consumable: "[data-consumable-item]", charged: "[data-charged]", attunement: "[data-requires-attunement]"};
  filter.value = Object.hasOwn(inventorySelectors, sessionView.get("inventoryFilter")) ? sessionView.get("inventoryFilter") : "all";
  function filterInventory() {
    for (const item of inventory.querySelectorAll(":scope > details")) item.hidden = !item.matches(inventorySelectors[filter.value]);
    empty.hidden = Boolean(inventory.querySelector(":scope > details:not([hidden])"));
    sessionView.set("inventoryFilter", filter.value);
  }
  filter.onchange = filterInventory;
  filterInventory();

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
