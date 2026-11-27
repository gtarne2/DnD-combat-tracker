const companionControls = (() => {
  const byId = (id) => document.getElementById(id);
  const add = byId("add-companion");
  const editor = byId("companion-editor");
  const form = byId("edit-companion");
  const resourceEditor = byId("companion-resource-editor");
  const resourceForm = byId("companion-resource-form");
  const cards = byId("companion-cards");
  const toggle = byId("toggle-companions");
  const rendered = new Map();
  const textFields = ["name", "kind", "armor", "speed", "stats", "attacks", "abilities", "command", "duration"];
  const numberFields = ["currentHp", "maxHp", "temporary", "remaining", "initiative"];
  const number = (value) => value === "" || value == null ? null : Number(value);
  const blank = () => ({ cards: [], seen: [], sequence: 0, owner: null });
  let edit;
  let resourceEdit;
  let inSidebar = true;

  function fromData(node) {
    const card = Object.fromEntries(textFields.map((field) => [field, node.dataset[field] || ""]));
    card.maxHp = number(node.dataset.maxHp);
    card.currentHp = node.hasAttribute("data-current-hp") ? number(node.dataset.currentHp) : card.maxHp;
    const duration = parseDuration(card.duration);
    card.timerUnit = duration?.unit || "rounds";
    card.remaining = card.timerUnit === "seconds" ? duration.amount : number(node.dataset.rounds) ?? duration?.amount ?? null;
    card.initiative = number(node.dataset.turnScore);
    card.turn = card.initiative === null ? "owner" : "separate";
    return card;
  }
  const templates = new Map([...document.querySelectorAll("[data-companion-template]")]
    .map((node) => [node.dataset.companionTemplate, fromData(node)]));
  const cannonTemplates = new Map([...templates].filter(([id, card]) =>
    id.includes("ELDRITCH_CANNON") || /^Eldritch Cannon\b/i.test(card.name)));
  const seeds = [...document.querySelectorAll("[data-companion-seed]")];
  for (const [id, details] of templates) add.elements.template.add(new Option(details.name, id));

  function isCannon(card) {
    return card.templateId?.includes("ELDRITCH_CANNON") || /^Eldritch Cannon\b/i.test(card.name || "");
  }

  function timer(card) {
    if (card.timerUnit) return {unit: card.timerUnit, amount: card.remaining};
    const unit = parseDuration(card.duration)?.unit || "rounds";
    return {unit, amount: card.rounds == null ? null : card.rounds * (unit === "seconds" ? 6 : 1)};
  }

  function destroyed(card) {
    return card.currentHp === 0 && (card.zeroHp === "vanish" || !card.zeroHp && isCannon(card));
  }

  function available(card) {
    return !destroyed(card) && timer(card).amount !== 0;
  }

  function advance(card, unit, count, state) {
    const duration = timer(card);
    if (duration.unit !== unit || !(duration.amount > 0) || destroyed(card)) return false;
    card.timerUnit = unit;
    card.remaining = Math.max(0, duration.amount - count);
    delete card.rounds;
    if (!card.remaining) {
      effectControls.endForRemovedTarget(state, "companion:" + card.id);
      previewEncounter.log(state, "expiration", `${card.name} expired`);
    }
    return true;
  }

  function node(tag, text) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function button(text, action, description) {
    const result = node("button", text);
    result.type = "button";
    result.dataset.companionAction = action;
    result.setAttribute("aria-label", description);
    return result;
  }

  function update(operation) {
    previewEncounter.transact((state) => operation(state.companions ||= blank(), state));
  }

  function updateCard(id, operation) {
    update((roster, state) => {
      const card = roster.cards.find((entry) => entry.id === id);
      return card ? operation(card, roster, state) : false;
    });
  }

  // Summoning: an action that creates one of a feature's companion variants. The Eldritch
  // Cannon uses it; a feature with other variants can join by listing them in `summons`.
  function summon(id) {
    const template = templates.get(id);
    if (!template) return;
    update((roster, state) => {
      if (!actionEconomy.spend(state, "owner", "action")) return false;
      const card = { ...template, templateId: id, id: ++roster.sequence };
      if (cannonTemplates.has(id)) card.zeroHp = "vanish";
      roster.cards.push(card);
      previewEncounter.log(state, "action", `Created ${template.name}`);
      document.dispatchEvent(new CustomEvent("companion-summoned", {detail: {card}}));
      return "creating " + template.name;
    });
  }
  const createCannon = summon;
  const variantName = (name) => name.replace(/^Eldritch Cannon\s*[-—:]?\s*/i, "");
  const summons = [];
  if (cannonTemplates.size) {
    const row = document.querySelector('.option-row[data-summon-feature], .option-row[data-pin$="_ARTILLERIST_ELDRITCH_CANNON"]');
    if (row) summons.push({row, variants: [...cannonTemplates.keys()], label: "Create cannon"});
  }
  for (const {row, variants, label} of summons) {
    const tools = row.querySelector(".option-execute");
    const pick = document.createElement("select");
    pick.dataset.summonVariant = "";
    pick.setAttribute("aria-label", "Variant to create");
    for (const id of variants) pick.add(new Option(variantName(templates.get(id).name), id));
    const create = document.createElement("button");
    create.type = "button";
    create.dataset.summonCreate = "";
    create.textContent = label;
    tools.prepend(pick, create);
  }
  // The inspector shows a copy of the row's controls, so the click is handled here for both.
  document.addEventListener("click", (event) => {
    const create = event.target.closest("[data-summon-create]");
    if (!create || create.disabled) return;
    const pick = create.parentElement.querySelector("[data-summon-variant]");
    if (pick?.getClientRects().length) {
      summon(pick.value);
      return;
    }
    // The action list row is too narrow for the variant list: open the option beside it so
    // the player can choose there.
    create.closest(".option-row")?.querySelector("[data-inspect]")?.click();
    const shown = [...document.querySelectorAll("#option-inspector [data-summon-variant]")].find((node) => node.getClientRects().length);
    if (shown) shown.focus();
    else if (pick) {
      pick.closest(".option-execute").classList.add("show-variants");
      pick.focus();
    }
  });

  function setCollapsed(value = layoutPreferences.companionsCollapsed()) {
    const hide = inSidebar && value;
    document.body.classList.toggle("companions-collapsed", hide);
    byId("companion-roster-content").hidden = hide;
    toggle.hidden = !inSidebar;
    toggle.textContent = hide ? "Show" : "Hide";
    toggle.setAttribute("aria-label", hide ? "Show companion sidebar" : "Hide companion sidebar");
    toggle.setAttribute("aria-expanded", String(!hide));
    if (inSidebar && !hide) sessionView.restoreScroll(byId("companion-roster-content"));
  }
  const openSidebar = byId("open-companion-sidebar");
  toggle.onclick = () => {
    const value = !layoutPreferences.companionsCollapsed();
    layoutPreferences.setCompanionsCollapsed(value);
    setCollapsed(value);
    if (value && document.body.classList.contains("show-empty-roster")) {
      document.body.classList.remove("show-empty-roster");
      openSidebar.focus();
    }
  };
  openSidebar.onclick = () => {
    document.body.classList.add("show-empty-roster");
    if (layoutPreferences.companionsCollapsed()) layoutPreferences.setCompanionsCollapsed(false);
    setCollapsed(false);
    add.elements.template.focus();
  };
  function place(onCompanionsPage) {
    inSidebar = !onCompanionsPage;
    const parent = byId(inSidebar ? "companion-roster-home" : "companion-roster-body");
    const roster = byId("companions");
    if (roster.parentElement !== parent) parent.append(roster);
    setCollapsed();
  }
  function showCard(id) {
    const card = rendered.get(id)?.element;
    if (!card) return;
    if (inSidebar && layoutPreferences.companionsCollapsed()) {
      layoutPreferences.setCompanionsCollapsed(false);
      setCollapsed();
    }
    card.open = true;
    card.querySelector("summary").focus();
    card.scrollIntoView({block: "nearest"});
  }

  function hpControls(card) {
    return encounterTracker.hpAdjustment((change, isHealing) => {
      updateCard(card.id, (target, _, state) => {
        if (target.currentHp == null || !available(target)) return false;
        const priorHp = target.currentHp;
        const priorTemp = target.temporary || 0;
        if (isHealing) {
          target.currentHp = Math.min(target.maxHp ?? 0xffffffff, target.currentHp + change);
        } else {
          const absorbed = Math.min(target.temporary || 0, change);
          target.temporary = (target.temporary || 0) - absorbed;
          target.currentHp = Math.max(0, target.currentHp - (change - absorbed));
          if (destroyed(target)) effectControls.endForRemovedTarget(state, "companion:" + target.id);
        }
        const moved = Math.abs(priorHp - target.currentHp) + Math.abs(priorTemp - (target.temporary || 0));
        if (!moved) return false;
        previewEncounter.log(state, isHealing ? "healing" : "damage", `${target.name} · ${moved} ${isHealing ? "HP restored" : "damage"} · ${target.currentHp} HP left`);
        return (isHealing ? "healing " : "damaging ") + target.name;
      });
    }, card.currentHp != null && available(card));
  }

  function disclosure(label, content, expanded) {
    const entry = node("details");
    entry.dataset.companionSection = label;
    entry.open = expanded.has(label);
    entry.append(node("summary", label), content);
    return entry;
  }

  function resourceControls(card) {
    const content = node("div");
    content.className = "companion-resource-list";
    for (const resource of card.resources || []) {
      const row = node("div");
      row.dataset.companionResource = resource.id;
      const label = button(resource.name, "edit-resource", "Edit resource: " + resource.name);
      label.className = "resource-name";
      const spend = button("−", "spend-resource", "Spend " + resource.name);
      const restore = button("+", "restore-resource", "Restore " + resource.name);
      spend.disabled = resource.remaining === 0;
      restore.disabled = resource.remaining >= resource.capacity;
      row.append(label, node("strong", resource.remaining + " / " + resource.capacity), spend, restore);
      content.append(row);
    }
    content.append(button("Add resource", "add-resource", "Add resource: " + card.name));
    return content;
  }

  function buildCard(card, state, effects, display, command, old) {
    const expanded = new Set(old
      ? [...old.querySelectorAll("details[data-companion-section][open]")].map((section) => section.dataset.companionSection)
      : ["Attacks", "Abilities"]);
    const panel = node("details");
    panel.className = "companion-card";
    panel.dataset.companionId = card.id;
    panel.dataset.viewDisclosure = "companion:" + card.id;
    panel.open = old?.open || false;
    if (!old) sessionView.restoreDisclosure(panel);
    const hp = card.currentHp == null
      ? card.maxHp == null ? "HP unavailable" : card.maxHp + " max HP"
      : "HP " + card.currentHp + (card.maxHp == null ? "" : " / " + card.maxHp);
    const summary = node("summary");
    summary.dataset.pickCompanion = card.id;
    const stats = [hp, card.temporary > 0 ? "+" + card.temporary + " temp HP" : "", card.armor ? "AC " + card.armor : ""];
    summary.append(node("strong", card.name), node("small", stats.filter(Boolean).join(" · ")));
    if (card.maxHp > 0 && card.currentHp != null) {
      const health = node("meter");
      health.max = card.maxHp;
      health.value = card.currentHp;
      health.setAttribute("aria-label", card.name + " hit points");
      summary.append(health);
    }
    const chips = node("span");
    chips.className = "status-chips";
    const duration = timer(card);
    if (destroyed(card)) chips.append(node("span", "Destroyed · vanished"));
    else if (duration.amount === 0) chips.append(node("span", "Expired"));
    else if (duration.amount != null) {
      const remaining = duration.unit === "seconds" ? effectControls.displayTime(duration.amount)
        : duration.amount + (duration.amount === 1 ? " round" : " rounds");
      chips.append(node("span", remaining + " left"));
    }
    if (state.progress?.current === "companion:" + card.id) chips.append(node("span", "Current turn"));
    for (const item of chips.children) item.className = "status-chip";
    chips.append(...effectControls.indicators(effects, 3));
    if (chips.childElementCount) summary.append(chips);
    const controls = node("div");
    controls.className = "companion-card-actions companion-card-toolbar";
    controls.append(button("Edit", "edit", "Edit " + card.name), button("Duplicate", "duplicate", "Duplicate " + card.name));
    if (available(card)) controls.append(button("Turn actions", "economy", "Track turn actions: " + card.name));
    const remove = button("Remove", "remove", "Remove " + card.name);
    remove.className = "danger-outline";
    controls.append(remove);
    if (duration.unit === "rounds" && duration.amount > 0 && available(card)) {
      controls.append(button("−1 round", "advance", "Advance one round: " + card.name));
    }
    panel.append(summary, controls, hpControls(card));

    if (command) {
      const row = node("div");
      row.className = "companion-command";
      row.append(playbook.followupButton(command, state));
      if (command.roll) row.append(node("small", command.roll));
      panel.append(row);
    }

    const details = node("dl");
    for (const [label, value] of [
      ["Kind", card.kind], ["Speed", card.speed], ["Summon duration", card.duration],
      ["Turn", card.turn === "separate" ? "Initiative " + card.initiative : "With owner"], ["Command", card.command],
    ]) {
      if (!value) continue;
      const row = node("div");
      row.append(node("dt", label), node("dd", value));
      details.append(row);
    }
    panel.append(details);
    for (const [label, value] of [["Attacks", card.attacks], ["Abilities", card.abilities], ["Other stats", card.stats]]) {
      if (value) panel.append(disclosure(label, node("p", value), expanded));
    }
    panel.append(disclosure("Resources and charges", resourceControls(card), expanded));
    const status = node("div");
    status.className = "companion-grid";
    for (const effect of effects) status.append(display.card(effect, false));
    const effectButtons = node("div");
    effectButtons.className = "companion-card-actions";
    for (const [label, category] of [["Add condition", "condition"], ["Add effect", "effect"]]) {
      const control = node("button", label);
      control.type = "button";
      control.dataset.addTargetEffect = "companion:" + card.id;
      control.dataset.category = category;
      effectButtons.append(control);
    }
    status.append(effectButtons);
    panel.append(disclosure("Conditions and effects", status, expanded));
    for (const section of panel.querySelectorAll("[data-companion-section]")) {
      section.dataset.viewDisclosure = panel.dataset.viewDisclosure + ":" + section.dataset.companionSection;
      if (!old) sessionView.restoreDisclosure(section);
    }
    return panel;
  }

  function render() {
    const state = previewEncounter.current();
    const roster = state.companions || blank();
    const display = effectControls.view(state);
    const commands = new Map(playbook.followups(state).filter((entry) => entry.companion)
      .map((entry) => [entry.companion, entry]));
    document.body.classList.toggle("has-companions", roster.cards.length > 0);
    if (roster.cards.length) document.body.classList.remove("show-empty-roster");
    const existing = new Set(roster.cards.map((card) => card.id));
    for (const [id, old] of rendered) {
      if (existing.has(id)) continue;
      old.element.remove();
      rendered.delete(id);
    }
    const empty = byId("no-companions");
    empty.hidden = roster.cards.length > 0;
    for (const [index, card] of roster.cards.entries()) {
      const effects = display.activeFor("companion:" + card.id);
      const command = commands.get(card.id);
      const current = state.progress?.current === "companion:" + card.id;
      const signature = JSON.stringify([card, effects, effects.map(display.remaining), command,
        command && playbook.followupReason(command, state), current]);
      const old = rendered.get(card.id);
      let element = old?.element;
      if (old?.signature !== signature) {
        element = buildCard(card, state, effects, display, command, old?.element);
        const focused = old?.element.contains(document.activeElement) ? document.activeElement : null;
        old?.element.replaceWith(element);
        rendered.set(card.id, {element, signature});
        if (focused) element.querySelector("summary").focus({preventScroll: true});
      }
      if (cards.children[index] !== element) cards.insertBefore(element, cards.children[index] || null);
    }
  }

  function turnFields() {
    const separate = form.elements.turn.value === "separate";
    form.elements.initiative.disabled = !separate;
    form.elements.initiative.required = separate;
  }

  function parseDuration(duration) {
    const rule = /^(?:up to\s+)?(\d+)\s+(round|second|minute|hour|day)s?\.?$/i.exec(duration);
    if (!rule) return null;
    const kind = rule[2].toLowerCase();
    const amount = Number(rule[1]) * { round: 1, second: 1, minute: 60, hour: 3600, day: 86400 }[kind];
    return amount > 0 && amount <= 0xffffffff ? {unit: kind === "round" ? "rounds" : "seconds", amount} : null;
  }

  function openEditor(values, id = null) {
    edit = { id, templateId: values.templateId || null, resources: values.resources };
    const duration = timer(values);
    form.elements.timerUnit.value = duration.unit;
    form.elements.zeroHp.value = isCannon(values) ? "vanish" : values.zeroHp || "keep";
    form.elements.zeroHp.disabled = Boolean(isCannon(values));
    for (const name of [...textFields, ...numberFields, "turn"]) {
      form.elements.namedItem(name).value = (name === "remaining" ? duration.amount : values[name]) ?? (name === "turn" ? "owner" : "");
    }
    turnFields();
    editor.showModal();
  }

  function validTotal(field, current, maximum) {
    if (current === null || maximum === null || current <= maximum) return true;
    field.setCustomValidity("The current value cannot exceed the maximum.");
    field.reportValidity();
    field.setCustomValidity("");
    return false;
  }

  add.addEventListener("submit", (event) => {
    event.preventDefault();
    const choice = add.elements.template.value;
    const templateId = choice === "custom" ? null : choice;
    openEditor({ ...templates.get(templateId), templateId });
  });
  form.elements.turn.addEventListener("change", turnFields);
  byId("companion-cancel").onclick = () => editor.close();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const entry = Object.fromEntries(textFields.map((key) => [key, data.get(key).trim()]));
    if (!entry.name) {
      form.elements.name.setCustomValidity("Enter a companion name.");
      form.reportValidity();
      form.elements.name.setCustomValidity("");
      return;
    }
    for (const field of numberFields) entry[field] = number(data.get(field));
    if (!validTotal(form.elements.currentHp, entry.currentHp, entry.maxHp)) return;
    const duration = entry.remaining === null ? parseDuration(entry.duration) : null;
    entry.remaining ??= duration?.amount ?? null;
    entry.timerUnit = duration?.unit || data.get("timerUnit");
    entry.zeroHp = isCannon({...entry, templateId: edit.templateId}) ? "vanish" : data.get("zeroHp") || "keep";
    entry.turn = data.get("turn");
    const proposal = edit;
    editor.close();
    if (proposal.id !== null) {
      updateCard(proposal.id, (card, _, state) => {
        const wasAvailable = available(card);
        Object.assign(card, entry);
        delete card.rounds;
        if (wasAvailable && !available(card)) effectControls.endForRemovedTarget(state, "companion:" + card.id);
        return "editing " + card.name;
      });
      return;
    }
    update((roster) => {
      roster.cards.push({ ...entry, templateId: proposal.templateId, id: ++roster.sequence, resources: proposal.resources });
      return "adding " + entry.name;
    });
  });

  function openResource(card, resource) {
    resourceEdit = {card: card.id, id: resource?.id};
    resourceForm.elements.name.value = resource?.name || "";
    resourceForm.elements.remaining.value = resource?.remaining ?? 1;
    resourceForm.elements.capacity.value = resource?.capacity ?? 1;
    byId("companion-resource-remove").hidden = !resource;
    resourceEditor.showModal();
  }

  byId("companion-resource-cancel").onclick = () => resourceEditor.close();
  byId("companion-resource-remove").onclick = () => {
    const {card, id} = resourceEdit;
    resourceEditor.close();
    updateCard(card, (target) => {
      const index = target.resources?.findIndex((resource) => resource.id === id) ?? -1;
      if (index < 0) return false;
      const [resource] = target.resources.splice(index, 1);
      return "removing " + resource.name;
    });
  };
  resourceForm.onsubmit = (event) => {
    event.preventDefault();
    const name = resourceForm.elements.name.value.trim();
    const remaining = resourceForm.elements.remaining.valueAsNumber;
    const capacity = resourceForm.elements.capacity.valueAsNumber;
    if (!name || !validTotal(resourceForm.elements.remaining, remaining, capacity)) return;
    const {card, id} = resourceEdit;
    resourceEditor.close();
    updateCard(card, (target, roster) => {
      target.resources ||= [];
      if (id == null) target.resources.push({id: ++roster.sequence, name, remaining, capacity});
      else {
        const resource = target.resources.find((entry) => entry.id === id);
        if (!resource) return false;
        Object.assign(resource, {name, remaining, capacity});
      }
      return "setting " + name;
    });
  };

  cards.addEventListener("click", (event) => {
    const control = event.target.closest("[data-companion-action]");
    if (!control) return;
    const id = Number(control.closest("[data-companion-id]").dataset.companionId);
    const card = previewEncounter.current().companions?.cards.find((card) => card.id === id);
    if (!card) return;
    const action = control.dataset.companionAction;
    const resourceId = Number(control.closest("[data-companion-resource]")?.dataset.companionResource);
    if (action === "edit") openEditor(card, id);
    else if (action === "economy") actionEconomy.open(`companion:${id}`);
    else if (action === "duplicate") openEditor({
      ...card, currentHp: card.maxHp, temporary: 0,
      ...(templates.has(card.templateId) ? {timerUnit: templates.get(card.templateId).timerUnit, remaining: templates.get(card.templateId).remaining} : {}),
      resources: card.resources?.map((entry) => ({...entry, remaining: entry.capacity})),
    });
    else if (action === "add-resource") openResource(card);
    else if (action === "edit-resource") {
      const resource = card.resources?.find((entry) => entry.id === resourceId);
      if (resource) openResource(card, resource);
    } else if (action === "remove") {
      effectControls.removeParticipant(`companion:${id}`, card.name, (state) => {
        const index = state.companions?.cards.findIndex((card) => card.id === id) ?? -1;
        if (index < 0) return false;
        state.companions.cards.splice(index, 1);
        return true;
      });
    } else updateCard(id, (target, _, state) => {
      if (action === "advance" && advance(target, "rounds", 1, state)) {
        return "advancing " + target.name + " one round";
      }
      const resource = target.resources?.find((entry) => entry.id === resourceId);
      if (!resource) return false;
      if (action === "spend-resource" && resource.remaining > 0) {
        resource.remaining -= 1;
        previewEncounter.log(state, "resource", `Spent 1 · ${target.name} · ${resource.name}`);
        return "spending " + resource.name;
      }
      if (action === "restore-resource" && resource.remaining < resource.capacity) {
        resource.remaining += 1;
        previewEncounter.log(state, "resource", `Recovered 1 · ${target.name} · ${resource.name}`);
        return "restoring " + resource.name;
      }
      return false;
    });
  });

  function syncSeeds(state) {
    const roster = state.companions ||= blank();
    let added = false;
    for (const seed of seeds) {
      const templateId = seed.dataset.companionSeed;
      if (roster.seen.includes(templateId)) continue;
      roster.seen.push(templateId);
      roster.cards.push({ ...fromData(seed), id: ++roster.sequence, templateId });
      added = true;
    }
    return added;
  }
  function start() {
    setCollapsed();
    document.addEventListener("preview-encounter-change", render);
    render();
    if (seeds.length) {
      previewEncounter.reconcile(syncSeeds);
      previewEncounter.transact(syncSeeds, { undo: false });
    }
  }
  return { cannonTemplates, createCannon, summon, place, showCard, start, available, advance };
})();
