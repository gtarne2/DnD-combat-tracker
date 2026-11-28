const sheetReference = (() => {
  const byId = (id) => document.getElementById(id);
  const dialog = byId("sheet-reference");
  const query = byId("sheet-reference-query");
  const resultList = byId("sheet-reference-results");
  const editor = byId("reference-notes");
  const notesForm = byId("reference-notes-form");
  const catalog = new Map();
  let trail = [];
  let currentId;
  let searching = false;
  let editing;
  let notes = sessionView.get("referenceNotes") || {};

  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function button(text, action) {
    const element = node("button", text);
    element.type = "button";
    if (action) element.addEventListener("click", action);
    return element;
  }
  function link(id, label) {
    const element = button(label);
    element.className = "reference-link";
    element.dataset.sheetReference = id;
    return element;
  }
  function contents(body) {
    const facts = [...body.querySelectorAll(".option-facts > div")];
    const description = body.querySelector(".description");
    let summary = body.dataset.featureSummary;
    if (!summary || summary.includes("{{")) summary = description?.querySelector("p, li")?.textContent || description?.textContent;
    summary = summary?.replace(/\s+/g, " ").trim();
    return {facts, description, summary};
  }

  function setup(rows) {
    for (const row of rows) {
      const body = row.querySelector(".option-body");
      const name = row.querySelector(".option-title").textContent.trim();
      const kind = body.querySelector("[data-kind]").dataset.kind;
      const id = body.dataset.inventoryKey || `option:${row.dataset.pin || `${kind}:${name}`}`;
      row.dataset.sheetEntry = id;
      if (!catalog.has(id)) catalog.set(id, {id, name, kind: body.dataset.inventoryKey && kind !== "Attack" ? "Gear" : kind,
        gear: Boolean(body.dataset.inventoryKey), pin: row.dataset.pin, row, ...contents(body), timings: new Set(),
        moxieAction: body.dataset.moxieAction, moxieCost: body.dataset.moxieCost,
        moxiePool: Object.hasOwn(body.dataset, "moxiePool"), linkedGear: body.dataset.linkedItem});
      const entry = catalog.get(id);
      if (body.dataset.actionGroup !== "other-options") entry.timings.add(body.querySelector(".kind span").textContent.replace(/^·\s*/, ""));
      for (const fact of contents(body).facts) {
        if (!entry.facts.some((known) => known.textContent === fact.textContent)) entry.facts.push(fact);
      }
    }
    for (const source of document.querySelectorAll("[data-ability-source]")) {
      const id = source.dataset.abilitySource;
      if (!catalog.has(id)) catalog.set(id, {id, name: source.querySelector("h3").textContent,
        kind: "Feature", pin: id.slice("option:".length), ...contents(source), timings: new Set(),
        moxiePool: Object.hasOwn(source.dataset, "moxiePool")});
    }
    for (const control of document.querySelectorAll("#character-dialog [data-open-roll]")) {
      const [group, name] = control.dataset.openRoll.split("|");
      const id = `roll:${control.dataset.openRoll}`;
      catalog.set(id, {id, name: group === "saves" ? `${name} saving throw` : name, kind: "Roll", roll: [group, name], control});
    }
    for (const control of document.querySelectorAll("#roll-checks [data-roll-name], #roll-other [data-roll-name]")) {
      const group = control.closest("[data-roll-section]").dataset.rollSection;
      const name = control.dataset.rollName;
      const id = `roll:${group}|${name}`;
      catalog.set(id, {id, name: group === "checks" ? `${name} ability check` : name, kind: "Roll", roll: [group, name], control});
    }
    for (const fact of document.querySelectorAll("[data-sheet-fact]")) {
      const name = fact.querySelector("dt").textContent;
      const id = `reference:${name}`;
      catalog.set(id, {id, name, kind: "Exploration", summary: fact.querySelector("dd").textContent});
    }
    const background = document.querySelector(".background-reference");
    if (background) {
      const name = background.querySelector("summary").firstChild.textContent.trim();
      const id = "reference:background";
      catalog.set(id, {id, name, kind: "Background feature", summary: background.querySelector("p").textContent});
    }
    for (const row of rows) addOptionLinks(row.querySelector(".option-body"), row.dataset.sheetEntry);
  }

  function linkedGear(entry) {
    return catalog.get(notes[entry.id]?.gear || entry.linkedGear);
  }
  function optionLinks(container, entry) {
    container.replaceChildren();
    if (entry.kind === "Attack" && !entry.gear) {
      const gear = linkedGear(entry);
      if (gear) {
        container.append(link(gear.id, `Gear · ${gear.name}`));
        container.append(button(`Table notes · ${gear.name}`, () => editNotes(gear)));
      }
    }
    if (entry.gear) {
      for (const attack of catalog.values()) {
        if (attack.kind === "Attack" && !attack.gear && linkedGear(attack)?.id === entry.id) {
          container.append(link(attack.id, `Attack · ${attack.name}`));
          container.append(button(`Table notes · ${attack.name}`, () => editNotes(attack)));
        }
      }
    }
    if (entry.gear || entry.kind === "Attack") {
      container.append(button("Table notes", () => editNotes(entry)));
      if (notes[entry.id]?.text) {
        const note = node("p", notes[entry.id].text);
        note.className = "reference-note";
        container.append(note);
      }
    }
  }
  function addOptionLinks(parent, id) {
    const entry = catalog.get(id);
    if (!entry || (!entry.gear && entry.kind !== "Attack")) return;
    let container = parent.querySelector("[data-option-reference]");
    if (!container) {
      container = node("div");
      container.dataset.optionReference = id;
      container.className = "reference-links";
      parent.append(container);
    }
    optionLinks(container, entry);
  }

  function editNotes(entry) {
    editing = entry;
    notesForm.elements.notes.value = notes[entry.id]?.text || "";
    const gear = notesForm.elements.gear;
    const canLink = entry.kind === "Attack" && !entry.gear;
    byId("reference-gear-label").hidden = !canLink;
    gear.disabled = !canLink;
    const imported = catalog.get(entry.linkedGear)?.name;
    gear.replaceChildren(new Option(imported ? `Use imported link · ${imported}` : "Use imported link", ""),
      new Option("No linked gear", "none"), ...[...catalog.values()].filter((item) => item.gear)
        .sort((a, b) => a.name.localeCompare(b.name)).map((item) => new Option(item.name, item.id)));
    gear.value = notes[entry.id]?.gear || "";
    byId("reference-notes-heading").textContent = `Table notes · ${entry.name}`;
    editor.showModal();
  }
  byId("cancel-reference-notes").onclick = () => editor.close();
  notesForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = notesForm.elements.notes.value.trim();
    const gear = notesForm.elements.gear.disabled ? "" : notesForm.elements.gear.value;
    notes = {...notes};
    if (text || gear) notes[editing.id] = {text, gear};
    else delete notes[editing.id];
    sessionView.set("referenceNotes", notes);
    editor.close();
    for (const container of document.querySelectorAll("[data-option-reference]")) optionLinks(container, catalog.get(container.dataset.optionReference));
    if (currentId && dialog.open) showDetail(currentId, false);
  });

  function renderResults() {
    const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const scores = [...catalog.values()].map((entry) => {
      const title = entry.name.toLowerCase();
      const text = `${title} ${entry.kind} ${entry.summary || ""} ${entry.facts?.map((fact) => fact.textContent).join(" ") || ""} ${notes[entry.id]?.text || ""}`.toLowerCase();
      if (!terms.every((term) => text.includes(term))) return null;
      const score = title === terms.join(" ") ? 3 : title.startsWith(terms.join(" ")) ? 2 : terms.some((term) => title.includes(term)) ? 1 : 0;
      return {entry, score};
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
    resultList.replaceChildren();
    for (const {entry} of scores.slice(0, 40)) {
      const result = link(entry.id, "");
      result.className = "sheet-search-result";
      const total = entry.control?.querySelector("strong")?.textContent;
      result.append(node("span", entry.name), node("small", entry.kind));
      if (total) result.append(node("strong", total));
      resultList.append(result);
    }
    byId("sheet-reference-empty").hidden = Boolean(resultList.childElementCount);
  }
  function openSearch() {
    searching = true;
    trail = [];
    currentId = undefined;
    byId("sheet-reference-heading").textContent = "Find on sheet";
    byId("sheet-reference-search").hidden = false;
    byId("sheet-reference-detail").hidden = true;
    renderResults();
    if (!dialog.open) dialog.showModal();
    query.focus();
    query.select();
  }
  function showDetail(id, focus = true) {
    const entry = catalog.get(id);
    if (!entry) return;
    if (entry.roll) {
      if (dialog.open) dialog.close();
      rollReference.open(...entry.roll);
      return;
    }
    currentId = id;
    byId("sheet-reference-heading").textContent = entry.name;
    byId("sheet-reference-search").hidden = true;
    byId("sheet-reference-detail").hidden = false;
    byId("sheet-reference-back").hidden = !searching && !trail.length;
    const content = byId("sheet-reference-body");
    content.replaceChildren();
    if (entry.timings?.size) {
      const timing = node("p", [...entry.timings].join(" · "));
      timing.className = "reference-meta";
      content.append(timing);
    }
    if (entry.facts?.length) {
      const facts = node("dl");
      facts.className = "option-facts";
      facts.append(...entry.facts.map((fact) => fact.cloneNode(true)));
      content.append(facts);
    }
    if (entry.description) content.append(entry.description.cloneNode(true));
    else if (entry.summary) {
      const summary = node("p", entry.summary);
      summary.className = "reference-note";
      content.append(summary);
    }
    addOptionLinks(content, id);
    if (entry.moxiePool) {
      const poolPanel = node("div");
      poolPanel.className = "reference-links";
      poolPanel.dataset.referencePool = "";
      poolPanel.append(node("strong"), button("Set up Moxie", () => byId("configure-moxie").click()));
      content.prepend(poolPanel);
    }
    if (!content.childElementCount) content.append(node("p", "No description was included in the import."));
    if (entry.pin && entry.kind === "Feature") {
      const actions = node("div", undefined);
      actions.className = "reference-links";
      actions.dataset.referenceActions = "";
      const use = button("Use feature", () => playbook.activateFeature(entry.pin));
      use.className = "gold-button";
      actions.append(use, node("small"));
      content.prepend(actions);
    }
    refreshActions();
    if (!dialog.open) dialog.showModal();
    if (focus) {
      dialog.scrollTop = 0;
      (byId("sheet-reference-back").hidden ? dialog.querySelector(".dialog-heading button") : byId("sheet-reference-back")).focus();
    }
  }
  function refreshActions() {
    const content = byId("sheet-reference-body");
    const state = previewEncounter.current();
    const poolPanel = content.querySelector("[data-reference-pool]");
    if (poolPanel) {
      const pool = encounterTracker.resources(state).find((pool) => pool.key === "Resource:moxie");
      const summary = poolPanel.querySelector("strong");
      summary.hidden = !pool;
      if (pool) {
        const remaining = Math.max(0, pool.capacity - (state.progress?.used[pool.key] || 0));
        summary.textContent = `${remaining} / ${pool.capacity} Moxie${pool.recovery ? ` · ${pool.recovery === "short" ? "Short or long" : "Long"} rest` : ""}`;
      }
      poolPanel.querySelector("button").textContent = pool ? "Edit Moxie pool" : "Set up Moxie";
    }
    const actions = content.querySelector("[data-reference-actions]");
    if (!actions || !currentId) return;
    const use = playbook.featureUse(catalog.get(currentId)?.pin, state);
    actions.hidden = !use;
    if (!use) return;
    const control = actions.querySelector("button");
    control.textContent = use.label;
    control.disabled = Boolean(use.reason);
    actions.querySelector("small").textContent = use.reason || use.summary;
  }
  document.addEventListener("preview-encounter-change", refreshActions);
  function open(id) {
    if (!dialog.open) { searching = false; trail = []; currentId = undefined; }
    else if (currentId && currentId !== id) trail.push(currentId);
    showDetail(id);
  }
  byId("sheet-find").onclick = openSearch;
  byId("sheet-reference-back").onclick = () => trail.length ? showDetail(trail.pop()) : openSearch();
  query.addEventListener("input", renderResults);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); dialog.close(); }
    if (byId("sheet-reference-search").hidden) return;
    const results = [...resultList.querySelectorAll("button")];
    const index = results.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      (results[index + direction] || query).focus();
    } else if (event.key === "Enter" && event.target === query) {
      event.preventDefault();
      results[0]?.click();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
    const slash = event.key === "/" && !event.target.closest("input, textarea, select, [contenteditable=true]");
    if (slash || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
      event.preventDefault();
      openSearch();
    }
  });
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-sheet-reference]");
    if (control) open(control.dataset.sheetReference);
  });
  return {setup, open, link, addOptionLinks, entries: () => [...catalog.values()]};
})();
