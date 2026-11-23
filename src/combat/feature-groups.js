function setupFeatureGroups() {
  const byId = (id) => document.getElementById(id);
  const host = byId("feature-groups");
  const editor = byId("feature-group-editor");
  const form = byId("feature-group-form");
  const choices = byId("feature-group-choice");
  const groupSearch = byId("group-picker-query");
  const features = new Map(sheetReference.entries().filter((entry) => entry.kind === "Feature" || entry.kind === "Background feature")
    .sort((a, b) => a.name.localeCompare(b.name)).map((entry) => [entry.id, entry]));
  const getFact = (entry, label) => entry.facts?.filter((fact) => fact.querySelector("dt").textContent === label)
    .map((fact) => fact.querySelector("dd").textContent) || [];
  const recommended = [
    ["all", "All features", () => true],
    ["moxie", "Moxie", (entry) => entry.moxiePool || entry.moxieAction],
    ["hit", "After a hit", (entry) => getFact(entry, "Trigger").includes("After dealing unarmed damage") || /^when you (?:hit|deal damage)/i.test(entry.summary || "")],
    ["rest", "Rest recovery", (entry) => entry.moxiePool || getFact(entry, "Uses").some((use) => /rest/i.test(use))],
    ["exploration", "Exploration", (entry) => entry.kind === "Background feature" || /street smart|darkvision/i.test(entry.name)],
  ].map(([id, name, predicate]) => ({id, name, entries: [...features.values()].filter(predicate).map((entry) => entry.id)}))
    .filter((group) => group.id === "all" || group.entries.length);
  const moxieGroup = recommended.find((group) => group.id === "moxie");
  const moxieOrder = (id) => {
    const entry = features.get(id);
    return entry.moxiePool ? 0 : entry.moxieAction === "spend" ? 1 : 2;
  };
  moxieGroup?.entries.sort((left, right) => moxieOrder(left) - moxieOrder(right));
  const previous = sessionView.get("featureGroups");
  let custom = Array.isArray(previous) ? previous.filter((group) => typeof group.id === "string" && typeof group.name === "string" && Array.isArray(group.entries)) : [];
  let selected = sessionView.get("selectedFeatureGroup") || "all";
  let draft;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, action, className) {
    const element = node("button", text, className);
    element.type = "button";
    if (action) element.addEventListener("click", action);
    return element;
  }
  const tabs = node("div", undefined, "feature-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Feature groups");
  const list = node("div", undefined, "feature-list");
  const filter = node("input");
  filter.type = "search";
  filter.placeholder = "Filter features";
  filter.setAttribute("aria-label", "Filter features");
  filter.className = "feature-filter";
  host.append(tabs, filter, list);
  filter.addEventListener("input", renderList);

  function featureRow(entry) {
    const row = node("article", undefined, "feature-row");
    row.dataset.featureEntry = entry.id;
    if (entry.pin) row.dataset.pin = entry.pin;
    const text = node("div");
    const title = node("h3");
    title.append(sheetReference.link(entry.id, entry.name));
    text.append(title);
    const chips = node("div", undefined, "feature-chips");
    const add = (label, kind) => chips.append(node("span", label, `feature-chip ${kind}`));
    for (const timing of entry.timings || []) add(timing, "feature-timing");
    if (entry.moxiePool) add("Shared resource", "feature-cost");
    if (entry.moxieAction === "spend") add(`${entry.moxieCost} Moxie`, "feature-cost");
    if (entry.moxieAction === "refill") add("Refill Moxie", "feature-cost");
    if (entry.moxieAction === "failed-save") add("+1 Moxie on failed save", "feature-cost");
    for (const uses of getFact(entry, "Uses")) add(uses, "feature-recovery");
    if (!chips.childElementCount) add(entry.kind, "feature-timing");
    text.append(chips);
    const trigger = getFact(entry, "Trigger").join(" · ");
    if (trigger) text.append(node("p", trigger, "feature-trigger"));
    if (entry.summary) text.append(node("p", entry.summary, "feature-summary"));
    const controls = node("div", undefined, "feature-controls");
    const use = button("Use feature", null, "gold-button");
    use.dataset.featureUse = "";
    const status = node("span", undefined, "feature-availability");
    const setup = button("Set up Moxie", () => byId("configure-moxie").click());
    setup.dataset.featurePoolSetup = "";
    controls.append(use, setup, status);
    row.append(text, controls);
    return row;
  }

  function renderAvailability() {
    const state = previewEncounter.current();
    const moxie = encounterTracker.resources(state).find((pool) => pool.key === "Resource:moxie");
    for (const row of list.querySelectorAll("[data-feature-entry]")) {
      const entry = features.get(row.dataset.featureEntry);
      const use = playbook.featureUse(entry.pin, state);
      const control = row.querySelector("[data-feature-use]");
      control.hidden = !use;
      control.disabled = Boolean(use?.reason);
      control.textContent = use?.label || "Use feature";
      control.setAttribute("aria-label", `${control.textContent} · ${entry.name}`);
      row.querySelector("[data-feature-pool-setup]").hidden = !entry.moxiePool || Boolean(moxie);
      const status = row.querySelector(".feature-availability");
      status.textContent = entry.moxiePool && moxie ? `${Math.max(0, moxie.capacity - (state.progress?.used[moxie.key] || 0))} / ${moxie.capacity} Moxie`
        : use?.reason || use?.summary || "";
    }
  }

  function renderList() {
    const group = [...recommended, ...custom].find((group) => group.id === selected) || recommended[0];
    const query = filter.value.toLowerCase().trim();
    const rows = group.entries.map((id) => features.get(id)).filter((entry) => entry &&
      `${entry.name} ${entry.summary || ""} ${[...(entry.timings || [])].join(" ")}`.toLowerCase().includes(query));
    list.replaceChildren(...rows.map(featureRow));
    if (!list.childElementCount) list.append(node("p", query ? "No matching features." : "No features in this group.", "empty"));
    renderAvailability();
  }
  function render() {
    const groups = [...recommended, ...custom];
    if (!groups.some((group) => group.id === selected)) selected = "all";
    tabs.replaceChildren(...groups.map((group) => {
      const tab = button(group.name, () => {
        selected = group.id;
        sessionView.set("selectedFeatureGroup", selected);
        for (const control of tabs.children) control.setAttribute("aria-pressed", String(control === tab));
        renderList();
      });
      tab.setAttribute("aria-pressed", String(selected === group.id));
      return tab;
    }));
    renderList();
  }

  function moveEntry(index, step) {
    const next = index + step;
    [draft.entries[index], draft.entries[next]] = [draft.entries[next], draft.entries[index]];
    renderDraft();
    byId("group-included").children[next].querySelector(`[data-reorder="${step}"]:not(:disabled), [data-reorder]:not(:disabled)`).focus();
  }
  function renderDraft() {
    const included = byId("group-included");
    included.replaceChildren();
    for (const [index, id] of draft.entries.entries()) {
      const item = node("li");
      const name = features.get(id)?.name || "Unavailable feature";
      item.append(node("span", name));
      for (const [step, label, symbol] of [[-1, "Move up", "↑"], [1, "Move down", "↓"]]) {
        const control = button(symbol, () => moveEntry(index, step));
        control.setAttribute("aria-label", `${label} · ${name}`);
        control.dataset.reorder = step;
        control.disabled = index + step < 0 || index + step >= draft.entries.length;
        item.append(control);
      }
      const remove = button("×", () => { draft.entries.splice(index, 1); renderDraft(); groupSearch.focus(); });
      remove.setAttribute("aria-label", `Remove ${name} from group`);
      item.append(remove);
      included.append(item);
    }
    if (!included.childElementCount) included.append(node("li", "Add features from the list.", "empty"));
    const available = byId("group-available");
    available.replaceChildren();
    const query = groupSearch.value.trim().toLowerCase();
    for (const [id, entry] of features) {
      if (draft.entries.includes(id) || !entry.name.toLowerCase().includes(query)) continue;
      const item = node("li");
      const add = button(`+ ${entry.name}`, () => { draft.entries.push(id); renderDraft(); groupSearch.focus(); });
      item.append(add);
      available.append(item);
    }
    if (!available.childElementCount) available.append(node("li", "No matching features.", "empty"));
  }

  function openDraft(id) {
    const group = custom.find((entry) => entry.id === id);
    draft = group ? {...group, entries: [...group.entries]} : {id: "", name: "", entries: []};
    form.elements.name.value = draft.name;
    groupSearch.value = "";
    byId("feature-group-feedback").textContent = "";
    byId("remove-feature-group").hidden = !group;
    renderDraft();
  }
  function persist() {
    sessionView.set("featureGroups", custom);
    sessionView.set("selectedFeatureGroup", selected);
    editor.close();
    render();
  }
  byId("manage-feature-groups").onclick = () => {
    choices.replaceChildren(new Option("New group", ""), ...custom.map((group) => new Option(group.name, group.id)));
    choices.value = custom.some((group) => group.id === selected) ? selected : "";
    openDraft(choices.value);
    editor.showModal();
    form.elements.name.focus();
  };
  choices.addEventListener("change", () => openDraft(choices.value));
  groupSearch.addEventListener("input", renderDraft);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) return;
    if ([...recommended, ...custom].some((group) => group.id !== draft.id && group.name.toLowerCase() === name.toLowerCase())) {
      byId("feature-group-feedback").textContent = "Choose a different group name.";
      form.elements.name.focus();
      return;
    }
    const saved = {...draft, id: draft.id || `custom:${Date.now()}`, name};
    custom = draft.id ? custom.map((group) => group.id === saved.id ? saved : group) : [...custom, saved];
    selected = saved.id;
    filter.value = "";
    persist();
  });
  byId("remove-feature-group").onclick = () => {
    custom = custom.filter((group) => group.id !== draft.id);
    if (selected === draft.id) selected = "all";
    persist();
  };
  document.addEventListener("preview-encounter-change", renderAvailability);
  render();
}
