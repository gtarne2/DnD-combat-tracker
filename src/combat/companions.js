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
  const numberFields = ["currentHp", "maxHp", "temporary", "rounds", "initiative"];
  const number = (value) => value === "" || value == null ? null : Number(value);
  const blank = () => ({ cards: [], seen: [], sequence: 0, owner: null });
  let edit;
  let resourceEdit;
  let inSidebar = true;

  function fromData(node) {
    const card = Object.fromEntries(textFields.map((field) => [field, node.dataset[field] || ""]));
    card.maxHp = number(node.dataset.maxHp);
    card.currentHp = node.hasAttribute("data-current-hp") ? number(node.dataset.currentHp) : card.maxHp;
    card.rounds = number(node.dataset.rounds);
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

  function createCannon(id) {
    const template = cannonTemplates.get(id);
    if (!template) return;
    update((roster) => {
      roster.cards.push({ ...template, templateId: id, rounds: template.rounds ?? parseRounds(template.duration),
        id: ++roster.sequence });
      return "creating " + template.name;
    });
  }

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
    const form = node("form");
    form.className = "companion-damage";
    const label = node("label", "HP adjustment");
    const amount = node("input");
    Object.assign(amount, {type: "number", min: "1", max: "4294967295", required: true, name: "amount"});
    label.append(amount);
    const damage = node("button", "Damage");
    const heal = node("button", "Heal");
    damage.value = "damage";
    heal.value = "heal";
    damage.disabled = heal.disabled = card.currentHp == null;
    form.append(label, damage, heal);
    form.onsubmit = (event) => {
      event.preventDefault();
      const change = amount.valueAsNumber;
      if (!Number.isInteger(change) || change < 1 || change > 0xffffffff) return;
      const isHealing = event.submitter?.value === "heal";
      updateCard(card.id, (target) => {
        if (target.currentHp == null) return false;
        if (isHealing) {
          target.currentHp = Math.min(target.maxHp ?? 0xffffffff, target.currentHp + change);
        } else {
          const absorbed = Math.min(target.temporary || 0, change);
          target.temporary = (target.temporary || 0) - absorbed;
          target.currentHp = Math.max(0, target.currentHp - (change - absorbed));
        }
        return (isHealing ? "healing " : "damaging ") + target.name;
      });
    };
    return form;
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
    if (card.rounds === 0) chips.append(node("span", "Expired"));
    else if (card.rounds != null) {
      const remaining = /\b(?:second|minute|hour|day)s?\b/i.test(card.duration)
        ? effectControls.displayTime(card.rounds * 6)
        : card.rounds + (card.rounds === 1 ? " round" : " rounds");
      chips.append(node("span", remaining + " left"));
    }
    if (state.progress?.current === "companion:" + card.id) chips.append(node("span", "Current turn"));
    for (const item of chips.children) item.className = "status-chip";
    chips.append(...effectControls.indicators(effects, 3));
    if (chips.childElementCount) summary.append(chips);
    panel.append(summary, hpControls(card));

    if (command) {
      const commandControl = playbook.followupButton(command, state);
      panel.append(commandControl);
      if (command.roll) panel.append(node("p", command.roll));
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
    const controls = node("div");
    controls.className = "companion-card-actions";
    controls.append(button("Edit", "edit", "Edit " + card.name), button("Duplicate", "duplicate", "Duplicate " + card.name));
    if (card.rounds > 0) controls.append(button("−1 round", "advance", "Advance one round: " + card.name));
    controls.append(button("Remove", "remove", "Remove " + card.name));
    panel.append(controls);
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
        command && playbook.followupUsed(command, state), current]);
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

  function parseRounds(duration) {
    const rule = /^(?:up to\s+)?(\d+)\s+(round|second|minute|hour|day)s?\.?$/i.exec(duration);
    if (!rule) return null;
    const seconds = Number(rule[1]) * { round: 6, second: 1, minute: 60, hour: 3600, day: 86400 }[rule[2].toLowerCase()];
    return seconds > 0 && seconds <= 0xffffffff ? Math.ceil(seconds / 6) : null;
  }

  function openEditor(values, id = null) {
    edit = { id, templateId: values.templateId || null, resources: values.resources };
    for (const name of [...textFields, ...numberFields, "turn"]) {
      form.elements.namedItem(name).value = values[name] ?? (name === "turn" ? "owner" : "");
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
    if (entry.rounds === null) entry.rounds = parseRounds(entry.duration);
    entry.turn = data.get("turn");
    const proposal = edit;
    editor.close();
    if (proposal.id !== null) {
      updateCard(proposal.id, (card) => {
        Object.assign(card, entry);
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
    else if (action === "duplicate") openEditor({
      ...card, currentHp: card.maxHp, temporary: 0, rounds: templates.get(card.templateId)?.rounds ?? card.rounds,
      resources: card.resources?.map((entry) => ({...entry, remaining: entry.capacity})),
    });
    else if (action === "add-resource") openResource(card);
    else if (action === "edit-resource") {
      const resource = card.resources?.find((entry) => entry.id === resourceId);
      if (resource) openResource(card, resource);
    } else updateCard(id, (target, roster, state) => {
      if (action === "remove") {
        roster.cards.splice(roster.cards.indexOf(target), 1);
        effectControls.endForRemovedTarget(state, "companion:" + id);
        return "removing " + target.name;
      }
      if (action === "advance" && target.rounds > 0) {
        target.rounds -= 1;
        return "advancing " + target.name + " one round";
      }
      const resource = target.resources?.find((entry) => entry.id === resourceId);
      if (!resource) return false;
      if (action === "spend-resource" && resource.remaining > 0) {
        resource.remaining -= 1;
        return "spending " + resource.name;
      }
      if (action === "restore-resource" && resource.remaining < resource.capacity) {
        resource.remaining += 1;
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
  return { cannonTemplates, createCannon, place, showCard, start };
})();
