function setupQuickActions(groups, updateAction) {
  const byId = (id) => document.getElementById(id);
  const items = byId("quick-items");
  const toggle = byId("quick-toggle");
  const dialog = byId("quick-editor");
  const form = byId("quick-form");
  const pins = new Map();
  const staticActions = new Map();
  const creations = new Map();
  let lastRender;

  function node(tag, text) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
  }
  function button(text, callback) {
    const control = node("button", text);
    control.type = "button";
    control.onclick = callback;
    return control;
  }

  function keyFor(source) {
    const stack = source.querySelector("[data-consumable]")?.dataset.consumable || "";
    return "option:" + JSON.stringify([source.dataset.pin, stack]);
  }
  for (const group of groups) {
    for (const source of group.querySelectorAll(".option-row[data-pin]")) {
      if (source.querySelector("[data-feature-level-blocked]")) continue;
      if (!source.querySelector("[data-cast-spell], [data-use], [data-record-attack], [data-feature-use], [data-charge-key]")) continue;
      const key = keyFor(source);
      if (!staticActions.has(key)) staticActions.set(key, {key, source, name: source.querySelector(".option-title").textContent});
    }
  }
  for (const [id, template] of companionControls.cannonTemplates) {
    const key = "create:" + id;
    const name = "Create " + template.name.replace(/^Eldritch Cannon\s*[-—:]?\s*/i, "");
    creations.set(key, {key, name, id, builtIn: true});
  }

  function catalog(state) {
    const result = new Map(creations);
    for (const action of playbook.followups(state)) {
      const name = action.name.replace(/^Eldritch Cannon\s*[-—:]?\s*/i, "");
      result.set(action.key, {key: action.key, name, action, builtIn: Boolean(action.companion)});
    }
    for (const [key, entry] of staticActions) result.set(key, entry);
    return result;
  }

  function canPin(entry, state) {
    return !entry?.source?.querySelector("[data-feature-use]")
      || Boolean(playbook.featureUse(entry.source.dataset.pin, state));
  }

  function setCollapsed(value) {
    items.hidden = value;
    toggle.textContent = value ? "Show" : "Hide";
    toggle.setAttribute("aria-label", (value ? "Show" : "Hide") + " Quick Actions");
    toggle.setAttribute("aria-expanded", String(!value));
    if (!value) sessionView.restoreScroll(items);
  }
  function setPinned(entry, pinned) {
    layoutPreferences.setQuickAction(entry, pinned);
    if (pinned && layoutPreferences.quickActionsCollapsed()) {
      layoutPreferences.setQuickActionsCollapsed(false);
      setCollapsed(false);
    }
    render();
  }
  toggle.onclick = () => {
    const value = !layoutPreferences.quickActionsCollapsed();
    layoutPreferences.setQuickActionsCollapsed(value);
    setCollapsed(value);
  };
  setCollapsed(layoutPreferences.quickActionsCollapsed());

  function pinButton(row) {
    const entry = staticActions.get(keyFor(row));
    if (!entry) return null;
    const control = button("", () => setPinned(entry, !layoutPreferences.showsQuickAction(entry)));
    control.className = "quick-pin quiet-button";
    pins.set(entry.key, control);
    renderPin(entry, control, previewEncounter.current());
    return control;
  }

  function renderPin(entry, control, state) {
    const pressed = layoutPreferences.showsQuickAction(entry);
    control.hidden = !pressed && !canPin(entry, state);
    control.textContent = pressed ? "Unpin Quick Action" : "Pin to Quick Actions";
    control.setAttribute("aria-pressed", String(pressed));
  }

  function optionAction(entry, state) {
    const article = node("article");
    article.dataset.pin = entry.source.dataset.pin;
    article.dataset.sheetEntry = entry.source.dataset.sheetEntry || "";
    const title = node("span", entry.name);
    title.className = "option-title visually-hidden";
    const badge = node("span");
    badge.dataset.optionBadge = "";
    badge.className = "status-chip";
    const tools = entry.source.querySelector(".option-execute").cloneNode(true);
    tools.querySelector("[data-bind-charge]")?.remove();
    const source = entry.source.querySelector("[data-focus-spell]");
    article.append(title, tools, badge);
    if (source) article.append(source.cloneNode(true));
    updateAction(article, state);
    const run = tools.querySelector("button");
    if (run.hidden) {
      run.hidden = false;
      run.disabled = true;
      tools.title = "Set up tracking on this feature to use it.";
    }
    const verb = run.matches("[data-use]") ? "Use" : run.textContent;
    run.textContent = verb + " " + entry.name;
    run.setAttribute("aria-label", run.textContent);
    if (tools.title) run.title = tools.title;
    const stack = tools.querySelector("[data-consumable]");
    if (stack) {
      const remaining = consumableCards.remaining(state, stack.dataset.consumable);
      badge.textContent = remaining == null ? "Qty unknown" : remaining + " left";
      badge.hidden = false;
    }
    return article;
  }

  function renderEntry(entry, state) {
    const container = entry.source ? optionAction(entry, state) : node("article");
    container.className = "quick-entry";
    container.dataset.quickEntry = entry.key;
    if (entry.action) {
      const label = entry.action.companion ? "Activate " + entry.name : entry.name;
      container.append(playbook.followupButton(entry.action, state, label, label + " · used"));
      if (entry.action.detail) {
        const details = node("details");
        details.dataset.viewDisclosure = "quick-action:" + entry.key;
        details.append(node("summary", entry.action.roll || "Rules"), node("p", entry.action.detail));
        container.append(details);
      }
    } else if (entry.id) {
      const create = button(entry.name, () => companionControls.createCannon(entry.id));
      const reason = actionEconomy.reason(state, "owner", "action");
      create.disabled = Boolean(reason);
      if (reason) create.title = reason;
      container.append(create);
    } else if (!entry.source) {
      const control = node("button", entry.name);
      control.disabled = true;
      control.title = "This action is currently unavailable.";
      container.append(control, node("small", "Unavailable"));
    }
    const remove = button("×", () => setPinned(entry, false));
    remove.className = "quick-remove";
    remove.setAttribute("aria-label", "Unpin Quick Action: " + entry.name);
    container.append(remove);
    return container;
  }

  function render() {
    const state = previewEncounter.current();
    const actions = catalog(state);
    for (const [key, control] of pins) {
      if (control.isConnected) renderPin(staticActions.get(key), control, state);
      else pins.delete(key);
    }
    const shown = [...actions.values()].filter((entry) => entry.builtIn && layoutPreferences.showsQuickAction(entry));
    for (const [key, name] of layoutPreferences.quickActions()) shown.push(actions.get(key) || {key, name});
    const next = shown.map((entry) => renderEntry(entry, state));
    const signature = next.map((entry) => entry.outerHTML).join("");
    if (signature === lastRender) return;
    lastRender = signature;
    toggle.hidden = next.length === 0;
    const expanded = new Set([...items.querySelectorAll("details[open]")]
      .map((details) => details.closest("[data-quick-entry]").dataset.quickEntry));
    const focused = document.activeElement.closest("[data-quick-entry]");
    const focusedKey = focused?.dataset.quickEntry;
    const focusedRemove = document.activeElement.matches(".quick-remove");
    for (const entry of next) {
      const details = entry.querySelector("details");
      if (details) {
        details.open = expanded.has(entry.dataset.quickEntry);
        sessionView.restoreDisclosure(details);
      }
    }
    items.replaceChildren(...next);
    sessionView.restoreScroll(items);
    if (focusedKey) {
      const replacement = next.find((entry) => entry.dataset.quickEntry === focusedKey)
        ?.querySelector(focusedRemove ? ".quick-remove" : "button:not(:disabled)");
      (replacement || byId("quick-manage")).focus({preventScroll: true});
    }
  }

  byId("quick-manage").onclick = () => {
    const state = previewEncounter.current();
    const available = [...catalog(state).values()]
      .filter((entry) => canPin(entry, state) && !layoutPreferences.showsQuickAction(entry))
      .sort((first, second) => first.name.localeCompare(second.name));
    form.elements.action.replaceChildren(...available.map((entry) => new Option(entry.name, entry.key)));
    byId("quick-picker-empty").hidden = Boolean(available.length);
    form.elements.action.disabled = form.querySelector("[type=submit]").disabled = !available.length;
    dialog.showModal();
  };
  byId("quick-cancel").onclick = () => dialog.close();
  form.onsubmit = (event) => {
    event.preventDefault();
    const state = previewEncounter.current();
    const entry = catalog(state).get(form.elements.action.value);
    if (entry && canPin(entry, state)) setPinned(entry, true);
    dialog.close();
  };
  render();
  return {pinButton, render};
}
