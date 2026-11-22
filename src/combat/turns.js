const encounterTracker = (() => {
  const byId = (id) => document.getElementById(id);
  const baseline = byId("encounter-baseline");
  const importedResources = [...baseline.querySelectorAll("[data-resource]")].map((entry) => ({
    key: entry.dataset.resource, name: entry.textContent, capacity: Number(entry.dataset.capacity),
  }));
  const keyHp = () => document.querySelector("#key-stats [data-stat=hp]").textContent;
  let hpBaseline = keyHp();
  const blank = () => ({round: 1, current: null, hp: null, actors: [], sequence: 0, used: {}, resources: [], effects: []});
  const get = (state) => state.progress || blank();
  const owner = byId("encounter-owner");
  const hpForm = byId("encounter-hp-form");
  const actorForm = byId("combatant-form");
  const resourceForm = byId("encounter-resource-form");
  const order = byId("turn-order");
  const resources = byId("encounter-resources");
  let editId = null;
  let resourceKey = null;
  let lastRender = "";

  function html(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const number = (value) => value == null || value === "" ? null : Number(value);
  function button(label, name, action, key, disabled = false) {
    const result = html("button", label);
    result.type = "button";
    result.disabled = disabled;
    result.dataset.action = action;
    result.dataset.key = key;
    result.setAttribute("aria-label", `${label}: ${name}`);
    return result;
  }

  function turns(state) {
    const companions = state.companions || {owner: null, cards: []};
    const result = [];
    const shared = companions.cards.filter((card) => card.turn === "owner" && card.rounds !== 0)
      .map((card) => card.name);
    if (companions.owner != null) {
      result.push({key: "owner", name: baseline.dataset.owner + (shared.length ? ` with ${shared.join(", ")}` : ""),
        score: companions.owner, rank: 0, id: 0});
    }
    for (const card of companions.cards) {
      if (card.turn === "separate" && card.initiative != null && card.rounds !== 0) {
        result.push({key: `companion:${card.id}`, name: card.name, score: card.initiative, rank: 1, id: card.id});
      }
    }
    for (const actor of get(state).actors) {
      result.push({key: `actor:${actor.id}`, name: actor.name, score: actor.score, rank: 2, id: actor.id, hp: actor.hp});
    }
    return result.sort((a, b) => b.score - a.score || a.rank - b.rank || a.id - b.id);
  }

  function resourceList(progress) {
    const all = new Map(importedResources.map((resource) => [resource.key, resource]));
    for (const resource of progress.resources) all.set(resource.key, resource);
    return [...all.values()];
  }

  function initialHp() {
    const match = /^(\d+)(?:\s*\/\s*(\d+)|(?:\s+max)?)$/i.exec(hpBaseline.trim());
    if (!match) return null;
    return {current: Number(match[1]), max: match[2] ? Number(match[2]) : /max$/i.test(hpBaseline) ? Number(match[1]) : null};
  }
  function displayHp(hp) {
    return hp == null ? "Unavailable" : hp.max == null ? String(hp.current) : `${hp.current} / ${hp.max}`;
  }
  function paintKeyHp(progress) {
    const text = progress.hp ? displayHp(progress.hp) : hpBaseline;
    for (const node of document.querySelectorAll("[data-stat=hp]")) node.textContent = text;
  }

  function render() {
    const state = previewEncounter.current();
    const progress = get(state);
    const rows = turns(state);
    const signature = JSON.stringify([progress, rows, hpBaseline, previewEncounter.canUndo(), previewEncounter.isPersisted()]);
    paintKeyHp(progress);
    if (signature === lastRender) return;
    lastRender = signature;
    const active = rows.find((row) => row.key === progress.current);
    byId("round-number").textContent = `Round ${progress.round}`;
    byId("current-turn").textContent = active ? `Turn: ${active.name}` : "Ready to start";
    const next = byId("next-turn");
    next.textContent = active ? "Next turn" : "Start turns";
    next.disabled = rows.length === 0;
    byId("undo-turn").disabled = !previewEncounter.canUndo();
    byId("encounter-storage").textContent = previewEncounter.isPersisted() ? "Saved locally" : "This tab only";
    owner.elements.initiative.value = state.companions?.owner ?? "";
    const hp = progress.hp || initialHp();
    byId("encounter-hp").textContent = displayHp(hp);
    hpForm.elements.current.value = hp?.current ?? "";
    hpForm.elements.max.value = hp?.max ?? "";
    order.replaceChildren();
    for (const row of rows) {
      const item = html("li", `${row.score} · ${row.name}${row.hp == null ? "" : ` · ${row.hp} HP`}`);
      if (row.key === progress.current) item.setAttribute("aria-current", "true");
      if (row.rank === 2) item.append(button("Edit", row.name, "edit", row.id), button("Remove", row.name, "remove", row.id));
      order.append(item);
    }
    resources.replaceChildren();
    for (const resource of resourceList(progress)) {
      const used = progress.used[resource.key] || 0;
      const remaining = Math.max(0, resource.capacity - used);
      const item = html("li", `${resource.name} · ${remaining} / ${resource.capacity}`);
      item.append(button("Spend", resource.name, "spend", resource.key, remaining === 0),
        button("Restore", resource.name, "restore", resource.key, used === 0),
        button("Edit", resource.name, "capacity", resource.key));
      resources.append(item);
    }
  }

  function update(operation) {
    previewEncounter.transact((state) => operation(state.progress ||= blank(), state));
  }

  function reconcileCurrent(state) {
    const progress = state.progress;
    if (!progress?.current) return;
    const rows = turns(state);
    if (!rows.some((row) => row.key === progress.current)) progress.current = rows[0]?.key || null;
  }
  previewEncounter.reconcile(reconcileCurrent);

  byId("next-turn").addEventListener("click", () => {
    update((progress, state) => {
      const rows = turns(state);
      if (!rows.length) return false;
      const index = rows.findIndex((row) => row.key === progress.current);
      const wrap = index === rows.length - 1;
      if (index >= 0) effectControls.boundary(state, "end", rows[index].key);
      progress.current = rows[wrap ? 0 : index + 1].key;
      if (wrap) {
        progress.round += 1;
        effectControls.advanceRound(state);
        effectControls.advanceTime(state, 6);
        for (const card of state.companions?.cards || []) {
          if (card.rounds > 0) card.rounds -= 1;
        }
      }
      reconcileCurrent(state);
      if (progress.current) effectControls.boundary(state, "start", progress.current);
      return true;
    });
  });
  byId("undo-turn").addEventListener("click", previewEncounter.undo);

  owner.addEventListener("submit", (event) => {
    event.preventDefault();
    const score = number(owner.elements.initiative.value);
    update((_, state) => {
      const roster = state.companions ||= {cards: [], seen: [], sequence: 0, owner: null};
      if (roster.owner === score) return false;
      roster.owner = score;
      return true;
    });
  });
  hpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const hp = {current: number(hpForm.elements.current.value), max: number(hpForm.elements.max.value)};
    if (hp.max !== null && hp.current > hp.max) {
      hpForm.elements.current.setCustomValidity("Current HP cannot exceed maximum HP.");
      hpForm.reportValidity();
      hpForm.elements.current.setCustomValidity("");
      return;
    }
    update((progress, state) => {
      progress.hp = hp;
      if (hp.current === 0) { state.focus.active = null; state.focus.pending = []; }
      return true;
    });
  });

  function resetActor() {
    editId = null;
    actorForm.reset();
    byId("cancel-combatant").hidden = true;
  }
  byId("cancel-combatant").addEventListener("click", resetActor);
  actorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(actorForm);
    const entry = {name: data.get("name").trim(), score: number(data.get("score")), hp: number(data.get("hp"))};
    if (!entry.name) return;
    const id = editId;
    resetActor();
    update((progress) => {
      if (id == null) progress.actors.push({...entry, id: ++progress.sequence});
      else {
        const actor = progress.actors.find((actor) => actor.id === id);
        if (!actor) return false;
        Object.assign(actor, entry);
      }
      return true;
    });
  });
  order.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const id = Number(control.dataset.key);
    if (control.dataset.action === "remove") {
      update((progress) => {
        progress.actors = progress.actors.filter((actor) => actor.id !== id);
        return true;
      });
    } else {
      const actor = get(previewEncounter.current()).actors.find((actor) => actor.id === id);
      if (!actor) return;
      editId = id;
      byId("combatant-panel").open = true;
      byId("cancel-combatant").hidden = false;
      for (const [key, value] of Object.entries(actor)) {
        const field = actorForm.elements.namedItem(key);
        if (field) field.value = value ?? "";
      }
      actorForm.elements.name.focus();
    }
  });

  resourceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(resourceForm);
    const name = data.get("name").trim();
    if (!name) return;
    const capacity = number(data.get("capacity"));
    const previous = resourceKey;
    resourceKey = null;
    resourceForm.reset();
    resourceForm.querySelector("button").textContent = "Add resource";
    update((progress) => {
      const key = previous || `manual:${++progress.sequence}`;
      const resource = progress.resources.find((resource) => resource.key === key);
      if (resource) Object.assign(resource, {name, capacity});
      else progress.resources.push({key, name, capacity});
      return true;
    });
  });
  resources.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const {action, key} = control.dataset;
    if (action === "capacity") {
      const resource = resourceList(get(previewEncounter.current())).find((resource) => resource.key === key);
      resourceKey = key;
      resourceForm.elements.name.value = resource.name;
      resourceForm.elements.capacity.value = resource.capacity;
      resourceForm.querySelector("button").textContent = "Save resource";
      resourceForm.elements.capacity.focus();
      return;
    }
    update((progress) => {
      const resource = resourceList(progress).find((resource) => resource.key === key);
      if (!resource) return false;
      const used = progress.used[key] || 0;
      if (action === "spend" && used < resource.capacity) progress.used[key] = used + 1;
      else if (action === "restore" && used > 0) {
        if (used === 1) delete progress.used[key];
        else progress.used[key] = used - 1;
      } else return false;
      return true;
    });
  });

  function damageOwner(state, amount) {
    const existing = state.progress?.hp || initialHp();
    if (amount === 0 || !existing) return {changed: false, dropped: false};
    const progress = state.progress ||= blank();
    progress.hp = {...existing, current: Math.max(0, existing.current - amount)};
    return {changed: existing.current !== progress.hp.current, dropped: progress.hp.current === 0};
  }

  document.addEventListener("preview-stat-overrides", () => { hpBaseline = keyHp(); render(); });
  document.addEventListener("preview-encounter-change", render);
  render();
  return {damageOwner, update, ownerName: baseline.dataset.owner, turns};
})();
