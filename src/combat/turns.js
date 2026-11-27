const encounterTracker = (() => {
  const byId = (id) => document.getElementById(id);
  const baseline = byId("encounter-baseline");
  const importedResources = [...baseline.querySelectorAll("[data-resource]")].map((entry) => ({
    key: entry.dataset.resource, name: entry.textContent, capacity: Number(entry.dataset.capacity), recovery: entry.dataset.recovery,
    rechargeDie: Number(entry.dataset.rechargeDie || 0),
    dawnDie: Number(entry.dataset.dawnDie || 0), dawnBonus: Number(entry.dataset.dawnBonus || 0),
  }));
  const keyHp = () => document.querySelector("#key-stats [data-stat=hp]").textContent;
  let hpBaseline = keyHp();
  const blank = previewEncounter.emptyProgress;
  const get = (state) => state.progress || blank();
  const owner = byId("encounter-owner");
  const hpForm = byId("encounter-hp-form");
  const actorForm = byId("combatant-form");
  const resourceForm = byId("encounter-resource-form");
  const resourceChoice = byId("resource-choice");
  const moxieKey = "Resource:moxie";
  const order = byId("turn-order");
  const resources = byId("encounter-resources");
  const allResources = byId("resource-pool-list");
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

  function hpAdjustment(adjust, available = true) {
    const form = html("form");
    form.className = "companion-damage";
    // One compact row: "HP [amount] Damage Heal".
    const label = html("label", "HP");
    label.className = "hp-adjust-label";
    const amount = html("input");
    Object.assign(amount, {type: "number", min: "1", max: "4294967295", required: true, name: "amount", placeholder: "0"});
    amount.setAttribute("aria-label", "HP adjustment");
    label.append(amount);
    const damage = html("button", "Damage");
    const heal = html("button", "Heal");
    damage.value = "damage";
    heal.value = "heal";
    amount.disabled = damage.disabled = heal.disabled = !available;
    form.append(label, damage, heal);
    form.onsubmit = (event) => {
      event.preventDefault();
      adjust(amount.valueAsNumber, event.submitter?.value === "heal");
    };
    return form;
  }

  function turns(state) {
    if (state.progress?.partyClock) return partyInitiative.rows(state);
    const companions = state.companions || {owner: null, cards: []};
    const result = [];
    const shared = companions.cards.filter((card) => card.turn === "owner" && companionControls.available(card))
      .map((card) => card.name);
    result.push({key: "owner", name: baseline.dataset.owner, shared, score: companions.owner, rank: 0, id: 0});
    for (const card of companions.cards) {
      if (card.turn === "separate" && card.initiative != null && companionControls.available(card)) {
        result.push({key: `companion:${card.id}`, name: card.name, score: card.initiative, rank: 1, id: card.id});
      }
    }
    for (const actor of get(state).actors) {
      result.push({key: `actor:${actor.id}`, name: actor.name, score: actor.score, rank: 2, id: actor.id, hp: actor.hp});
    }
    return result.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.rank - b.rank || a.id - b.id);
  }

  function resourceList(progress, includeRemoved = false) {
    const all = new Map(importedResources.map((resource) => [resource.key, resource]));
    for (const resource of progress.resources) all.set(resource.key, {...all.get(resource.key), ...resource});
    return [...all.values()].filter((resource) => includeRemoved || !progress.removedResources?.includes(resource.key));
  }

  function initialHp(baseline = hpBaseline) {
    const match = /^(\d+)(?:\s*\/\s*(\d+)|(?:\s+max)?)$/i.exec(baseline.trim());
    if (!match) return null;
    return {current: Number(match[1]), max: match[2] ? Number(match[2]) : /max$/i.test(baseline) ? Number(match[1]) : null};
  }
  function displayHp(hp) {
    return hp == null ? "Unavailable" : hp.max == null ? String(hp.current) : `${hp.current} / ${hp.max}`;
  }
  function paintKeyHp(progress) {
    const hp = progress.hp || initialHp();
    const text = hp ? displayHp(hp) : hpBaseline;
    for (const node of document.querySelectorAll("[data-stat=hp]")) node.textContent = text;
    // Colour band and meter for the HP card; unknown maximums hide the meter.
    const ratio = hp?.max > 0 ? Math.max(0, Math.min(1, hp.current / hp.max)) : null;
    for (const card of document.querySelectorAll(".hp-card")) {
      card.dataset.band = ratio == null ? "unknown" : hp.current === 0 ? "down" : ratio <= .25 ? "low" : ratio <= .5 ? "hurt" : "healthy";
      card.style.setProperty("--hp-fill", ratio == null ? "0%" : (ratio * 100).toFixed(1) + "%");
    }
    for (const node of document.querySelectorAll("[data-temp-hp]")) {
      node.hidden = false;
      node.textContent = hp?.temporary > 0 ? `+${hp.temporary} temp HP` : "0 temp HP";
    }
  }

  function render() {
    const state = previewEncounter.current();
    const progress = get(state);
    const sharedBoard = partyInitiative.board();
    // In a party room with a DM encounter the rail follows the shared order, joined or not.
    const watching = Boolean(sharedBoard) && !progress.partyClock;
    const rows = watching ? sharedBoard.rows.map((row) => ({...row, rank: 3})) : turns(state);
    const undoLabel = previewEncounter.undoLabel();
    const pinnedResources = layoutPreferences.pinnedResources();
    const signature = JSON.stringify([progress, rows, sharedBoard && [sharedBoard.running, sharedBoard.current, sharedBoard.round, sharedBoard.joined, partyInitiative.players()], byId("party-encounter-note").dataset.error, hpBaseline, undoLabel, previewEncounter.canUndo(), previewEncounter.isPersisted(), pinnedResources]);
    paintKeyHp(progress);
    if (signature === lastRender) return;
    lastRender = signature;
    const sharedClock = Boolean(progress.partyClock);
    const party = sharedClock || watching;
    const running = watching ? sharedBoard.running : progress.active !== false;
    const active = !running ? null : watching ? rows.find((row) => row.id === sharedBoard.current) || null
      : rows.find((row) => row.key === progress.current) || rows[0];
    const mine = (row) => row?.key === "owner" || Boolean(row?.key?.startsWith("companion:"));
    const round = watching ? sharedBoard.round : progress.round;
    byId("round-number").textContent = running ? `Round ${round}` : party ? "Waiting for the DM" : "Encounter inactive";
    byId("current-turn").textContent = !running || !active ? "" : party
      ? (active.key === "owner" ? "Your turn" : "Turn: " + active.name)
      : rows.length > 1 ? "Turn: " + active.name : "Solo turn";
    byId("current-turn").hidden = !running;
    byId("current-turn").classList.toggle("is-mine", party && mine(active));
    byId("encounter-owner").hidden = byId("combatant-panel").hidden = party;
    byId("end-encounter").hidden = !running || party;
    byId("next-turn").hidden = !running || party;
    byId("start-encounter").hidden = running || party;
    // Party rooms: only the owner of the current row ends it; the DM runs everything else.
    const endTurn = byId("end-my-turn");
    endTurn.hidden = !(sharedClock && running && mine(active));
    endTurn.dataset.row = endTurn.hidden ? "" : active.id;
    endTurn.textContent = active?.key === "owner" ? "End Turn" : "End " + (active?.name || "") + "'s turn";
    const banner = byId("party-encounter");
    banner.hidden = !party;
    if (party) {
      const others = [...new Set([...partyInitiative.players(),
        ...rows.filter((row) => Array.isArray(row.shared) && row.key !== "owner").map((row) => row.name)])];
      byId("party-encounter-who").textContent = others.length ? " with " + others.join(", ") : "";
      const joined = sharedClock || sharedBoard?.joined;
      const join = byId("party-join-form");
      join.hidden = Boolean(joined);
      if (!joined && document.activeElement !== join.elements.score && join.elements.score.value === "")
        join.elements.score.value = state.companions?.owner ?? "";
      const note = byId("party-encounter-note");
      if (!note.dataset.error) note.textContent = !joined ? "Roll initiative to join. The DM can also add you."
        : !running ? "You're in. The DM starts the encounter."
        : mine(active) ? "It's your turn. Press End Turn when you're done."
        : "The DM runs the turn order.";
    }
    document.body.classList.toggle("party-encounter-active", party);
    const lastAttack = byId("last-attack");
    lastAttack.hidden = !progress.lastAttack;
    lastAttack.textContent = progress.lastAttack
      ? ["Last attack", progress.lastAttack.name, progress.lastAttack.roll, progress.lastAttack.round == null ? "" : `Round ${progress.lastAttack.round}`].filter(Boolean).join(" · ") : "";
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
    const compactOrder = byId("combat-turn-order");
    compactOrder.replaceChildren();
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
      if (party) item.dataset.side = mine(row) ? "you" : Array.isArray(row.shared) ? "ally" : "other";
      const compact = item.cloneNode(true);
      if (row.rank === 2) {
        const adjust = button("HP", row.name, "hp", row.id, row.hp == null);
        adjust.title = "Adjust hit points";
        compact.append(adjust);
      }
      compactOrder.append(compact);
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
    compactOrder.hidden = rows.length <= 1 && !party;
    const focused = document.activeElement;
    const focusList = allResources.contains(focused) ? allResources : resources.contains(focused) ? resources : null;
    resources.replaceChildren();
    allResources.replaceChildren();
    const pools = resourceList(progress);
    const shown = new Set(pinnedResources ?? pools.slice(0, 3).map((resource) => resource.key));
    for (const resource of pools) {
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
      if ((spellSlot || resource.key === moxieKey || resource.key.startsWith("Charge:")) && resource.capacity <= 12) {
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
      if (resource.rechargeDie && resource.recovery) {
        group.append(html("small", `+1d${resource.rechargeDie} / ${resource.recovery === "short" ? "rest" : "long rest"}`));
      }
      if (resource.recovery === "dawn") {
        const amount = resource.dawnDie ? "1d" + resource.dawnDie + (resource.dawnBonus ? " + " + resource.dawnBonus : "") : "Full";
        group.append(html("small", amount + " at dawn"));
      }
      item.append(group, spend, restore);
      const inDialog = item.cloneNode(true);
      const pin = button(shown.has(resource.key) ? "Unpin" : "Pin", resource.name, "pin", resource.key);
      inDialog.append(pin);
      allResources.append(inDialog);
      item.classList.toggle("unpinned-resource", !shown.has(resource.key));
      resources.append(item);
    }
    if (focusList && focused.dataset.key) {
      const controls = [...focusList.querySelectorAll("button:not(:disabled)")];
      const valid = (control) => control.dataset.key === focused.dataset.key && control.getClientRects().length;
      const replacement = controls.find((control) => valid(control) && control.dataset.action === focused.dataset.action)
        || controls.find(valid) || (focusList === resources ? byId("show-all-resources") : byId("all-resources").querySelector("button"));
      replacement.focus({preventScroll: true});
    }
  }

  function update(operation, label) {
    previewEncounter.transact((state) => operation(state.progress ||= blank(), state), {label});
  }

  function reconcileCurrent(state) {
    const progress = state.progress;
    if (!progress?.current || progress.partyClock) return;
    const rows = turns(state);
    if (!rows.some((row) => row.key === progress.current)) progress.current = rows[0]?.key || null;
  }
  previewEncounter.reconcile(reconcileCurrent);

  const endDialog = byId("end-encounter-dialog");
  endDialog.querySelector("form").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "end") return;
    const title = byId("end-encounter-name").value.trim();
    byId("end-encounter-name").value = "";
    update((progress, state) => {
      if (progress.active === false || progress.partyClock) return false;
      delete progress.spellTurnReminder;
      const archives = progress.archives ||= [];
      archives.push({id: ++progress.sequence, at: new Date().toISOString(), title: title || `Encounter ${archives.length + 1}`,
        round: progress.round, roster: turns(state).map((row) => row.name), activity: structuredClone(progress.activity || [])});
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
      progress.activity = [];
      actionEconomy.reset(state);
      delete progress.lastAttack;
      return "starting a new encounter";
    });
  });
  function enterTurn(state, from, to, wrap) {
    const progress = state.progress;
    delete progress.spellTurnReminder;
    progress.turnSequence = (progress.turnSequence || 0) + 1;
    if (from) effectControls.boundary(state, "end", from);
    progress.current = to;
    if (wrap) {
      progress.round += 1;
      effectControls.advanceRounds(state, 1, {initiative:true});
    }
    reconcileCurrent(state);
    actionEconomy.reset(state, progress.current);
    effectControls.boundary(state, "start", progress.current);
  }

  byId("next-turn").addEventListener("click", () => {
    update((progress, state) => {
      if (progress.active === false || progress.partyClock || partyInitiative.board()) return false;
      const rows = turns(state);
      const index = Math.max(0, rows.findIndex((row) => row.key === progress.current));
      const wrap = index === rows.length - 1;
      enterTurn(state, rows[index].key, rows[wrap ? 0 : index + 1].key, wrap);
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
      const actor = get(previewEncounter.current()).actors.find((actor) => actor.id === id);
      if (!actor) return;
      effectControls.removeParticipant(`actor:${id}`, actor.name, (state) => {
        const index = state.progress?.actors.findIndex((actor) => actor.id === id) ?? -1;
        if (index < 0) return false;
        state.progress.actors.splice(index, 1);
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
    const progress = get(previewEncounter.current());
    const resource = resourceList(progress, true).find((entry) => entry.key === resourceChoice.value);
    const removed = resource && progress.removedResources?.includes(resource.key);
    resourceForm.elements.name.value = resource?.name ?? "";
    resourceForm.elements.capacity.value = resource?.capacity ?? "";
    resourceForm.elements.recovery.value = resource?.recovery ?? "";
    byId("save-resource").textContent = resource ? "Save resource" : "Add resource";
    byId("remove-resource").hidden = !resource || removed;
    byId("restore-resource").hidden = !removed;
    resourceForm.hidden = Boolean(removed);
  }
  function chooseResourcePool(key = "") {
    const progress = get(previewEncounter.current());
    const choices = [];
    const removed = html("optgroup");
    removed.label = "Removed resources";
    for (const entry of resourceList(progress, true)) {
      const choice = new Option(entry.name, entry.key);
      if (progress.removedResources?.includes(entry.key)) removed.append(choice);
      else choices.push(choice);
    }
    if (key === moxieKey && ![...choices, ...removed.children].some((choice) => choice.value === key)) {
      choices.push(new Option("Moxie", key));
    }
    resourceChoice.replaceChildren(new Option("New resource", ""), ...choices);
    if (removed.children.length) resourceChoice.append(removed);
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
    (resourceForm.hidden ? byId("restore-resource") : resourceForm.elements.capacity).focus();
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
      if (progress.removedResources?.includes(previous)) return false;
      const key = previous || `manual:${++progress.sequence}`;
      const resource = progress.resources.find((resource) => resource.key === key);
      if (resource) Object.assign(resource, {name, capacity, recovery});
      else progress.resources.push({key, name, capacity, recovery});
      return true;
    });
    byId("resource-settings").close();
  });
  for (const [id, remove] of [["remove-resource", true], ["restore-resource", false]]) {
    byId(id).addEventListener("click", () => {
      const key = resourceChoice.value;
      update((progress) => {
        const resource = resourceList(progress, true).find((entry) => entry.key === key);
        const removed = new Set(progress.removedResources);
        if (!resource || removed.has(key) === remove) return false;
        if (remove) removed.add(key);
        else removed.delete(key);
        progress.removedResources = [...removed];
        byId("encounter-status").textContent = `${resource.name} ${remove ? "removed" : "restored"}.`;
        return `${remove ? "removing" : "restoring"} ${resource.name}`;
      });
      byId("resource-settings").close();
    });
  }
  function resourceClick(event) {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const {action, key} = control.dataset;
    if (action === "pin") {
      const pins = new Set(layoutPreferences.pinnedResources() ?? resourceList(get(previewEncounter.current())).slice(0, 3).map((pool) => pool.key));
      if (!pins.delete(key)) pins.add(key);
      layoutPreferences.setPinnedResources([...pins]);
      render();
      return;
    }
    update((progress, state) => {
      const pool = resourceList(progress).find((resource) => resource.key === key);
      if (!pool) return false;
      if (action === "spend") return spendResource(state, key) && "spending " + pool.name;
      return action === "restore" && restoreResource(state, key) && "restoring " + pool.name;
    });
  }
  resources.addEventListener("click", resourceClick);
  allResources.addEventListener("click", resourceClick);

  byId("heal-owner-form").onsubmit = (event) => {
    event.preventDefault();
    const amount = event.target.elements.amount.valueAsNumber;
    update((progress, state) => {
      const current = (progress.hp || initialHp())?.current;
      if (!healOwner(progress, "direct", amount)) return false;
      const restored = progress.hp.current - current;
      previewEncounter.log(state, "healing", `Restored ${restored} HP · ${baseline.dataset.owner}`);
      return `healing ${restored} HP`;
    });
    event.target.reset();
    byId("heal-owner").close();
  };
  byId("combat-turn-order").onclick = (event) => {
    const control = event.target.closest("[data-action=hp]");
    if (!control) return;
    const id = Number(control.dataset.key);
    const actor = get(previewEncounter.current()).actors.find((entry) => entry.id === id);
    if (actor?.hp == null) return;
    const dialog = byId("combatant-hp");
    byId("combatant-hp-heading").textContent = "Adjust HP · " + actor.name;
    byId("combatant-hp-content").replaceChildren(hpAdjustment((amount, healing) => {
      update((progress, state) => {
        const current = progress.actors.find((entry) => entry.id === id);
        if (current?.hp == null) return false;
        const next = Math.max(0, Math.min(0xffffffff, current.hp + (healing ? amount : -amount)));
        if (next === current.hp) return false;
        const changed = Math.abs(next - current.hp);
        current.hp = next;
        previewEncounter.log(state, healing ? "healing" : "damage", `${current.name} · ${changed} ${healing ? "HP restored" : "damage"} · ${next} HP left`);
        return `${healing ? "healing" : "damaging"} ${current.name} (${amount} HP)`;
      });
      dialog.close();
    }));
    dialog.showModal();
    dialog.querySelector("input").focus();
  };

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
    if (current === hp.current && temporary === (hp.temporary || 0)) return false;
    progress.hp = {...hp, current, temporary};
    return true;
  }
  function temporaryHp(hp, amount) {
    return Math.max(hp.temporary || 0, amount);
  }
  function grantOwnerTemporaryHp(progress, amount) {
    const hp = progress.hp || initialHp();
    if (!hp || temporaryHp(hp, amount) === (hp.temporary || 0)) return false;
    progress.hp = {...hp, temporary: temporaryHp(hp, amount)};
    return true;
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
    previewEncounter.log(state, "resource", `Spent ${cost} · ${pool.name}`);
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
    if (remaining !== used) previewEncounter.log(state, "resource", `Recovered ${used - remaining} · ${pool.name}`);
    return true;
  }
  // HP card quick box: type a number, then choose Damage, Heal, Set HP or Temp HP.
  // With the box empty, the buttons open their full forms as before.
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-hp-quick] [data-hp-op]");
    if (!control) return;
    const field = control.closest("[data-hp-quick]").querySelector("[data-hp-amount]");
    const amount = field.valueAsNumber;
    if (field.value === "" || !Number.isInteger(amount)) {
      if (control.dataset.hpOp === "temp") queueMicrotask(() => hpForm.elements.temporary.focus());
      return;
    }
    event.stopImmediatePropagation();
    event.preventDefault();
    const status = byId("encounter-status");
    if (amount < 0 || amount > 0xffffffff) { status.textContent = "Enter a whole number from 0."; return; }
    const op = control.dataset.hpOp;
    const hp = get(previewEncounter.current()).hp || initialHp();
    if (!hp && op !== "set") {
      status.textContent = "Set your HP first.";
      const dialog = byId("hp-settings");
      if (!dialog.open) dialog.showModal();
      return;
    }
    field.value = "";
    if (op === "damage") {
      if (amount === 0) return;
      previewEncounter.transact((state) => {
        const result = concentrationControls.applyDamage(state, amount);
        status.textContent = result.feedback;
        return result.changed;
      }, {label: "recording damage"});
    } else if (op === "heal") {
      update((progress, state) => {
        const current = (progress.hp || initialHp())?.current;
        if (!healOwner(progress, "direct", amount)) { status.textContent = "HP is already full."; return false; }
        const restored = progress.hp.current - current;
        previewEncounter.log(state, "healing", `Restored ${restored} HP · ${baseline.dataset.owner}`);
        status.textContent = `Healed ${restored} HP.`;
        return `healing ${restored} HP`;
      });
    } else if (op === "set") {
      update((progress) => {
        const existing = progress.hp || initialHp();
        const max = existing?.max ?? null;
        const current = max == null ? amount : Math.min(max, amount);
        if (existing && existing.current === current) return false;
        progress.hp = {current, max, temporary: existing?.temporary || 0};
        status.textContent = `HP set to ${current}${max == null ? "" : " / " + max}.`;
        return "setting HP";
      });
    } else if (op === "temp") {
      update((progress) => {
        if (!grantOwnerTemporaryHp(progress, amount)) {
          status.textContent = `Kept ${hp.temporary || 0} temporary HP.`;
          return false;
        }
        status.textContent = `Gained ${amount} temporary HP.`;
        return "gaining temporary HP";
      });
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    // Enter in the quick box has no single meaning, so it does nothing.
    if (event.key === "Enter" && event.target.matches?.("[data-hp-amount]")) event.preventDefault();
  });
  function recordAttack(name, card) {
    update((progress, state) => {
      const sequence = combatTools.recordWeapon(state, card.querySelector(".option-execute")?.dataset.turnCost);
      if (!sequence) return false;
      const roll = attackModifiers.forOption(card, state).adjustment;
      const source = card.dataset.sheetEntry || `option:${card.dataset.pin}`;
      progress.lastAttack = {name, roll, source, turn: progress.turnSequence || 0,
        round: progress.active === false ? null : progress.round, sequence: ++progress.sequence};
      byId("encounter-status").textContent = "Recorded attack with " + name + ".";
      const label = ["Attack with " + name, typeof sequence === "string" ? sequence : "", roll].filter(Boolean).join(" · ");
      previewEncounter.log(state, "attack", label, source);
      return "attacking with " + name;
    });
  }
  return {enterTurn,damageOwner, healOwner, temporaryHp, grantOwnerTemporaryHp, hpAdjustment, spendResource, restoreResource, recordAttack, hp: (state, baseline) => state.progress?.hp || initialHp(baseline),
    update, ownerName: baseline.dataset.owner, turns, resources: (state, includeRemoved) => resourceList(get(state), includeRemoved)};
})();
