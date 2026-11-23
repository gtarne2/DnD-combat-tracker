const encounterTracker = (() => {
  const byId = (id) => document.getElementById(id);
  const baseline = byId("encounter-baseline");
  const importedResources = [...baseline.querySelectorAll("[data-resource]")].map((entry) => ({
    key: entry.dataset.resource, name: entry.textContent, capacity: Number(entry.dataset.capacity), recovery: entry.dataset.recovery,
  }));
  const keyHp = () => document.querySelector("#key-stats [data-stat=hp]").textContent;
  let hpBaseline = keyHp();
  const blank = () => ({round: 1, current: null, hp: null, actors: [], sequence: 0, used: {}, resources: [], effects: []});
  const get = (state) => state.progress || blank();
  const owner = byId("encounter-owner");
  const hpForm = byId("encounter-hp-form");
  const actorForm = byId("combatant-form");
  const resourceForm = byId("encounter-resource-form");
  const resourceChoice = byId("resource-choice");
  const moxieKey = "Resource:moxie";
  const order = byId("turn-order");
  const resources = byId("encounter-resources");
  let editId = null;
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
    result.push({key: "owner", name: baseline.dataset.owner, shared, score: companions.owner, rank: 0, id: 0});
    for (const card of companions.cards) {
      if (card.turn === "separate" && card.initiative != null && card.rounds !== 0) {
        result.push({key: `companion:${card.id}`, name: card.name, score: card.initiative, rank: 1, id: card.id});
      }
    }
    for (const actor of get(state).actors) {
      result.push({key: `actor:${actor.id}`, name: actor.name, score: actor.score, rank: 2, id: actor.id, hp: actor.hp});
    }
    return result.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.rank - b.rank || a.id - b.id);
  }

  function resourceList(progress) {
    const all = new Map(importedResources.map((resource) => [resource.key, resource]));
    for (const resource of progress.resources) all.set(resource.key, {...all.get(resource.key), ...resource});
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
    const hp = progress.hp || initialHp();
    const text = hp ? displayHp(hp) : hpBaseline;
    for (const node of document.querySelectorAll("[data-stat=hp]")) node.textContent = text;
    for (const node of document.querySelectorAll("[data-temp-hp]")) {
      node.hidden = false;
      node.textContent = hp?.temporary > 0 ? `+${hp.temporary} temp HP` : "0 temp HP";
    }
  }

  function render() {
    const state = previewEncounter.current();
    const progress = get(state);
    const rows = turns(state);
    const undoLabel = previewEncounter.undoLabel();
    const signature = JSON.stringify([progress, rows, hpBaseline, undoLabel, previewEncounter.canUndo(), previewEncounter.isPersisted()]);
    paintKeyHp(progress);
    if (signature === lastRender) return;
    lastRender = signature;
    const running = progress.active !== false;
    const active = running ? rows.find((row) => row.key === progress.current) || rows[0] : null;
    byId("round-number").textContent = running ? `Round ${progress.round}` : "Encounter inactive";
    byId("current-turn").textContent = !running ? "" : rows.length > 1 ? "Turn: " + active.name : "Solo turn";
    byId("current-turn").hidden = !running;
    byId("end-encounter").hidden = !running;
    byId("next-turn").hidden = !running;
    byId("start-encounter").hidden = running;
    const lastAttack = byId("last-attack");
    lastAttack.hidden = !progress.lastAttack;
    lastAttack.textContent = progress.lastAttack
      ? `Last attack · ${progress.lastAttack.name}${progress.lastAttack.round == null ? "" : ` · Round ${progress.lastAttack.round}`}` : "";
    const undo = byId("undo-turn");
    undo.disabled = !previewEncounter.canUndo();
    undo.title = undoLabel ? "Undo " + undoLabel : "Undo combat update";
    undo.setAttribute("aria-label", undo.title);
    byId("undo-label").hidden = !undoLabel;
    byId("undo-label").textContent = undoLabel ? "Last change · " + undoLabel : "";
    byId("encounter-storage").textContent = previewEncounter.isPersisted() ? "Saved locally" : "This tab only";
    owner.elements.initiative.value = state.companions?.owner ?? "";
    const hp = progress.hp || initialHp();
    byId("encounter-hp").textContent = displayHp(hp);
    const temporary = hp?.temporary ? ` · ${hp.temporary} temporary HP` : "";
    byId("damage-hp").textContent = hp ? `Current HP: ${displayHp(hp)}${temporary}` : "Set HP on the combat sheet to apply damage to it.";
    hpForm.elements.current.value = hp?.current ?? "";
    hpForm.elements.max.value = hp?.max ?? "";
    hpForm.elements.temporary.value = hp?.temporary ?? 0;
    order.replaceChildren();
    for (const row of rows) {
      const item = html("li");
      const score = html("span", row.score ?? "—");
      score.className = "initiative-score";
      const name = html("span", row.name);
      name.className = "initiative-name";
      item.append(score, name);
      if (row.hp != null || row.shared?.length) {
        const hp = html("small", row.shared?.length
          ? "With " + row.shared.length + (row.shared.length === 1 ? " companion" : " companions")
          : row.hp + " HP");
        if (row.shared?.length) hp.title = row.shared.join(", ");
        hp.className = "initiative-hp";
        item.append(hp);
      }
      if (row.key === active?.key) item.setAttribute("aria-current", "true");
      if (row.rank === 2) {
        const controls = html("span");
        const edit = button("Edit", row.name, "edit", row.id);
        const remove = button("Remove", row.name, "remove", row.id);
        edit.textContent = "⋯";
        remove.textContent = "×";
        edit.title = edit.getAttribute("aria-label");
        remove.title = remove.getAttribute("aria-label");
        controls.className = "initiative-edit";
        controls.append(edit, remove);
        item.append(controls);
      }
      order.append(item);
    }
    resources.replaceChildren();
    for (const resource of resourceList(progress)) {
      const used = progress.used[resource.key] || 0;
      const remaining = Math.max(0, resource.capacity - used);
      const item = html("li");
      const spellSlot = /^(Spell slot|Pact Magic slot):/.test(resource.key);
      item.classList.toggle("spell-slot-pool", spellSlot);
      const label = html(resource.key.startsWith("Feature:") || resource.key === moxieKey ? "button" : "span", resource.name);
      if (label.tagName === "BUTTON") {
        label.type = "button";
        label.dataset.resourceDetail = resource.key;
        label.title = `Read ${resource.name}`;
      }
      label.className = "resource-name";
      const count = html("strong", `${remaining} / ${resource.capacity}`);
      count.className = "resource-count";
      const spend = button("Spend", resource.name, "spend", resource.key, remaining === 0);
      const restore = button("Restore", resource.name, "restore", resource.key, used === 0);
      for (const [control, symbol] of [[spend, "−"], [restore, "+"]]) {
        control.title = control.getAttribute("aria-label");
        control.textContent = symbol;
      }
      const group = html("div");
      group.className = "resource-label";
      group.append(label, count);
      if ((spellSlot || resource.key === moxieKey) && resource.capacity <= 12) {
        const pips = html("span");
        pips.className = "slot-pips";
        pips.setAttribute("aria-hidden", "true");
        for (let i = 0; i < resource.capacity; i++) {
          const pip = html("i");
          pip.classList.toggle("available", i < remaining);
          pips.append(pip);
        }
        group.append(pips);
      }
      if (resource.key === moxieKey && resource.recovery) {
        item.classList.add("moxie-pool");
        group.append(html("small", resource.recovery === "short" ? "Short rest" : "Long rest"));
      }
      item.append(group, spend, restore);
      resources.append(item);
    }
  }

  function update(operation, label) {
    previewEncounter.transact((state) => operation(state.progress ||= blank(), state), {label});
  }

  function reconcileCurrent(state) {
    const progress = state.progress;
    if (!progress?.current) return;
    const rows = turns(state);
    if (!rows.some((row) => row.key === progress.current)) progress.current = rows[0]?.key || null;
  }
  previewEncounter.reconcile(reconcileCurrent);

  const endDialog = byId("end-encounter-dialog");
  endDialog.querySelector("form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "end") return;
    update((progress) => {
      if (progress.active === false) return false;
      progress.active = false;
      return "ending the encounter";
    });
  });
  byId("start-encounter").addEventListener("click", () => {
    update((progress, state) => {
      if (progress.active !== false) return false;
      progress.active = true;
      progress.round = 1;
      progress.current = turns(state)[0].key;
      progress.turnSequence = (progress.turnSequence || 0) + 1;
      progress.followupUses = {};
      delete progress.lastAttack;
      return "starting a new encounter";
    });
  });
  byId("next-turn").addEventListener("click", () => {
    update((progress, state) => {
      if (progress.active === false) return false;
      const rows = turns(state);
      const index = Math.max(0, rows.findIndex((row) => row.key === progress.current));
      const wrap = index === rows.length - 1;
      progress.turnSequence = (progress.turnSequence || 0) + 1;
      effectControls.boundary(state, "end", rows[index].key);
      progress.current = rows[wrap ? 0 : index + 1].key;
      if (wrap) {
        progress.round += 1;
        effectControls.advanceRounds(state, 1);
      }
      reconcileCurrent(state);
      if (progress.current) effectControls.boundary(state, "start", progress.current);
      return wrap ? "advancing to round " + progress.round : "advancing the turn";
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
    const hp = {current: number(hpForm.elements.current.value), max: number(hpForm.elements.max.value),
      temporary: Number(hpForm.elements.temporary.value)};
    if (hp.max !== null && hp.current > hp.max) {
      hpForm.elements.current.setCustomValidity("Current HP cannot exceed maximum HP.");
      hpForm.reportValidity();
      hpForm.elements.current.setCustomValidity("");
      return;
    }
    update((progress, state) => {
      progress.hp = hp;
      if (hp.current === 0) { state.focus.active = null; state.focus.pending = []; }
      return "setting hit points";
    });
    byId("hp-settings").close();
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
      if (!byId("encounter-settings").open) byId("encounter-settings").showModal();
      byId("combatant-panel").open = true;
      byId("cancel-combatant").hidden = false;
      for (const [key, value] of Object.entries(actor)) {
        const field = actorForm.elements.namedItem(key);
        if (field) field.value = value ?? "";
      }
      actorForm.elements.name.focus();
    }
  });

  function chooseResource() {
    const resource = resourceList(get(previewEncounter.current())).find((entry) => entry.key === resourceChoice.value);
    resourceForm.elements.name.value = resource?.name ?? "";
    resourceForm.elements.capacity.value = resource?.capacity ?? "";
    resourceForm.elements.recovery.value = resource?.recovery ?? "";
    resourceForm.querySelector("button").textContent = resource ? "Save resource" : "Add resource";
  }
  function chooseResourcePool(key = "") {
    const choices = resourceList(get(previewEncounter.current())).map((entry) => new Option(entry.name, entry.key));
    if (key === moxieKey && !choices.some((choice) => choice.value === key)) choices.push(new Option("Moxie", key));
    resourceChoice.replaceChildren(new Option("New resource", ""), ...choices);
    resourceChoice.value = key;
    chooseResource();
    if (key === moxieKey && !resourceForm.elements.name.value) {
      resourceForm.elements.name.value = "Moxie";
      resourceForm.elements.recovery.value = "short";
    }
  }
  document.querySelector('[data-dialog="resource-settings"]').addEventListener("click", () => chooseResourcePool());
  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-configure-moxie]")) return;
    chooseResourcePool(moxieKey);
    byId("resource-settings").showModal();
    resourceForm.elements.capacity.focus();
  });
  resourceChoice.addEventListener("change", chooseResource);
  resourceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(resourceForm);
    const name = data.get("name").trim();
    if (!name) return;
    const capacity = number(data.get("capacity"));
    const recovery = data.get("recovery");
    const previous = resourceChoice.value;
    update((progress) => {
      const key = previous || `manual:${++progress.sequence}`;
      const resource = progress.resources.find((resource) => resource.key === key);
      if (resource) Object.assign(resource, {name, capacity, recovery});
      else progress.resources.push({key, name, capacity, recovery});
      return true;
    });
    byId("resource-settings").close();
  });
  resources.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const {action, key} = control.dataset;
    update((progress, state) => {
      const pool = resourceList(progress).find((resource) => resource.key === key);
      if (!pool) return false;
      if (action === "spend") return spendResource(state, key) && "spending " + pool.name;
      return action === "restore" && restoreResource(state, key) && "restoring " + pool.name;
    });
  });

  function damageOwner(state, amount) {
    const existing = state.progress?.hp || initialHp();
    if (amount === 0 || !existing) return {changed: false, dropped: false, current: existing?.current};
    const progress = state.progress ||= blank();
    const absorbed = Math.min(existing.temporary || 0, amount);
    progress.hp = {...existing, current: Math.max(0, existing.current - (amount - absorbed)),
      temporary: (existing.temporary || 0) - absorbed};
    return {changed: absorbed > 0 || existing.current !== progress.hp.current,
      dropped: progress.hp.current === 0, current: progress.hp.current, absorbed, temporary: progress.hp.temporary};
  }

  function healOwner(progress, kind, amount) {
    const hp = progress.hp || initialHp();
    if (!hp) return;
    const current = kind === "long" ? hp.max ?? hp.current : Math.min(hp.max ?? 0xffffffff, hp.current + amount);
    const temporary = kind === "long" ? 0 : hp.temporary || 0;
    if (current !== hp.current || temporary !== (hp.temporary || 0)) progress.hp = {...hp, current, temporary};
  }
  document.addEventListener("preview-stat-overrides", () => { hpBaseline = keyHp(); render(); });
  document.addEventListener("preview-encounter-change", render);
  render();
  function spendResource(state, key, cost = 1) {
    const progress = state.progress ||= blank();
    const pool = resourceList(progress).find((resource) => resource.key === key);
    const used = progress.used[key] || 0;
    if (!pool || used + cost > pool.capacity) return false;
    progress.used[key] = used + cost;
    return true;
  }
  function restoreResource(state, key, amount = 1) {
    const progress = state.progress;
    const used = progress?.used[key] || 0;
    const pool = resourceList(get(state)).find((resource) => resource.key === key);
    if (!used || !pool) return false;
    const remaining = Math.max(0, Math.min(used, pool.capacity) - amount);
    if (remaining > 0) progress.used[key] = remaining;
    else delete progress.used[key];
    return true;
  }
  function recordAttack(name) {
    update((progress) => {
      progress.lastAttack = {name, round: progress.active === false ? null : progress.round, sequence: ++progress.sequence};
      byId("encounter-status").textContent = "Recorded attack with " + name + ".";
      return "attacking with " + name;
    });
  }
  return {damageOwner, healOwner, spendResource, restoreResource, recordAttack, hp: (state) => state.progress?.hp || initialHp(),
    update, ownerName: baseline.dataset.owner, turns, resources: (state) => resourceList(get(state))};
})();
