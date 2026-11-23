const companionControls = (() => {
  const byId = (id) => document.getElementById(id);
  const add = byId("add-companion");
  const editor = byId("companion-editor");
  const form = byId("edit-companion");
  const cards = byId("companion-cards");
  const detail = byId("companion-detail");
  const textFields = ["name", "kind", "armor", "speed", "stats", "attacks", "abilities", "command", "duration"];
  const numberFields = ["currentHp", "maxHp", "temporary", "rounds", "initiative"];
  const number = (value) => value === "" || value == null ? null : Number(value);
  const blank = () => ({ cards: [], seen: [], sequence: 0, owner: null });
  let edit = null;
  let selectedId = null;
  let lastRender;

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
  const seeds = [...document.querySelectorAll("[data-companion-seed]")];
  for (const [id, details] of templates) {
    const option = new Option(details.name, id);
    add.elements.template.add(option);
  }

  const cannonControls = byId("cannon-controls");
  const variants = [...templates].filter(([id, card]) => id.includes("ELDRITCH_CANNON") || /^Eldritch Cannon\b/i.test(card.name));
  if (variants.length) {
    cannonControls.hidden = false;
    cannonControls.append(node("strong", "Create cannon"));
    for (const [id, template] of variants) {
      const create = node("button", template.name.replace(/^Eldritch Cannon\s*[-—:]?\s*/i, ""));
      create.onclick = () => update(roster => {
        roster.cards.push({...template, templateId: id, rounds: template.rounds ?? parseRounds(template.duration), id: ++roster.sequence});
        return true;
      });
      cannonControls.append(create);
    }
  }
  function node(tag, text) {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
  }

  function button(text, action, name) {
    const result = node("button", text);
    result.type = "button";
    result.dataset.companionAction = action;
    result.setAttribute("aria-label", `${text}: ${name}`);
    return result;
  }

  function render() {
    const roster = previewEncounter.current().companions || blank();
    if (!roster.cards.some((card) => card.id === selectedId)) selectedId = null;
    const effects = previewEncounter.current().progress?.effects || [];
    const signature = JSON.stringify([roster.cards, selectedId, effects]);
    if (signature === lastRender) return;
    lastRender = signature;
    const previousDetails = detail.querySelector(`[data-companion-id="${selectedId}"]`);
    const expanded = new Set([...previousDetails?.querySelectorAll("details[open] > summary") || []]
      .map((heading) => heading.textContent));
    document.body.classList.toggle("has-companions", roster.cards.length > 0);
    cards.replaceChildren();
    detail.replaceChildren();
    detail.hidden = selectedId === null;
    if (!roster.cards.length) cards.append(node("p", "No companions yet."));
    for (const card of roster.cards) {
      const hp = card.currentHp != null ? `${card.currentHp}${card.maxHp == null ? "" : ` / ${card.maxHp}`}`
        : card.maxHp == null ? "" : `${card.maxHp} max`;
      const pick = node("button");
      pick.type = "button";
      pick.dataset.pickCompanion = card.id;
      pick.setAttribute("aria-pressed", String(card.id === selectedId));
      const summary = [hp ? `HP ${hp}` : "HP unavailable", card.temporary > 0 ? `+${card.temporary} temp` : "",
        card.armor ? `AC ${card.armor}` : "",
        card.rounds === 0 ? "Expired" : ""].filter(Boolean).join(" · ");
      pick.append(node("strong", card.name), node("small", summary));
      if (card.maxHp > 0 && card.currentHp != null) {
        const health = node("meter");
        health.max = card.maxHp;
        health.value = card.currentHp;
        health.setAttribute("aria-label", `${card.name} hit points`);
        pick.append(health);
      }
      cards.append(pick);
      if (card.id !== selectedId) continue;
      const activeEffects = effects.filter(effect => effect.target === "companion:" + card.id && !effect.ended &&
        (!["start","end","seconds","rounds"].includes(effect.kind) || effect.remaining > 0));
      const article = node("article");
      article.dataset.companionId = card.id;
      article.append(node("h3", card.name));
      const details = node("dl");
      const duration = card.rounds == null ? card.duration : card.rounds === 0 ? "Expired"
        : `${card.rounds} round${card.rounds === 1 ? "" : "s"} remaining${card.duration ? ` · ${card.duration}` : ""}`;
      for (const [label, value] of [
        ["Kind", card.kind], ["HP", hp], ["Temporary HP", String(card.temporary || 0)], ["AC", card.armor], ["Speed", card.speed],
        ["Duration", duration], ["Turn", card.turn === "separate" ? `Initiative ${card.initiative}` : "With owner"],
        ["Effects", activeEffects.map(effect => effect.name).join(", ") || "None active"], ["Command", card.command],
      ]) {
        if (!value) continue;
        const row = node("div");
        row.append(node("dt", label), node("dd", value));
        details.append(row);
      }
      article.append(details);
      const damage = node("form");
      damage.className = "companion-damage";
      const label = node("label", "Damage amount");
      const amount = node("input");
      Object.assign(amount, {type: "number", min: "1", max: "4294967295", required: true});
      label.append(amount);
      const apply = node("button", "Apply damage");
      apply.disabled = card.currentHp == null;
      damage.append(label, apply);
      if (apply.disabled) damage.append(node("span", "Set current HP in Edit to record damage."));
      damage.onsubmit = event => {
        event.preventDefault();
        const loss = amount.valueAsNumber;
        update(roster => {
          const target = roster.cards.find(entry => entry.id === card.id);
          if (target?.currentHp == null || !(target.currentHp || target.temporary)) return false;
          const absorbed = Math.min(target.temporary || 0, loss);
          target.temporary = (target.temporary || 0) - absorbed;
          target.currentHp = Math.max(0, target.currentHp - (loss - absorbed));
          return true;
        });
      };
      article.append(damage);
      for (const [label, value] of [["Other stats", card.stats], ["Attacks", card.attacks], ["Abilities", card.abilities]]) {
        if (!value) continue;
        const section = node("details");
        section.open = expanded.has(label);
        const body = node("p", value);
        body.className = "companion-text";
        section.append(node("summary", label), body);
        article.append(section);
      }
      const controls = node("div");
      controls.className = "companion-card-actions";
      controls.append(button("Edit", "edit", card.name), button("Duplicate", "duplicate", card.name));
      if (card.rounds > 0) controls.append(button("Advance 1 round", "advance", card.name));
      controls.append(button("Remove", "remove", card.name));
      article.append(controls);
      detail.append(article);
    }
  }

  function select(id) {
    selectedId = id;
    render();
  }

  cards.addEventListener("click", (event) => {
    const pick = event.target.closest("[data-pick-companion]");
    if (!pick) return;
    select(Number(pick.dataset.pickCompanion));
    cards.querySelector(`[data-pick-companion="${selectedId}"]`).focus();
    document.dispatchEvent(new Event("companion-inspected"));
  });

  function update(operation) {
    previewEncounter.transact((state) => operation(state.companions ||= blank()));
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
    edit = { id, templateId: values.templateId || null };
    for (const name of [...textFields, ...numberFields, "turn"]) {
      form.elements.namedItem(name).value = values[name] ?? (name === "turn" ? "owner" : "");
    }
    turnFields();
    editor.showModal();
  }

  add.addEventListener("submit", (event) => {
    event.preventDefault();
    const choice = add.elements.template.value;
    const templateId = choice === "custom" ? null : choice;
    openEditor({ ...templates.get(templateId), templateId });
  });
  form.elements.turn.addEventListener("change", turnFields);
  byId("companion-cancel").addEventListener("click", () => editor.close());
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
    if (entry.rounds === null) entry.rounds = parseRounds(entry.duration);
    entry.turn = data.get("turn");
    const proposal = edit;
    editor.close();
    update((roster) => {
      if (proposal.id === null) {
        roster.cards.push({ ...entry, templateId: proposal.templateId, id: ++roster.sequence });
        return true;
      }
      const card = roster.cards.find((card) => card.id === proposal.id);
      if (!card) return false;
      Object.assign(card, entry);
      return true;
    });
  });

  detail.addEventListener("click", (event) => {
    const control = event.target.closest("[data-companion-action]");
    if (!control) return;
    const id = Number(control.closest("[data-companion-id]").dataset.companionId);
    const card = previewEncounter.current().companions?.cards.find((card) => card.id === id);
    if (!card) return;
    const action = control.dataset.companionAction;
    if (action === "edit") openEditor(card, id);
    else if (action === "duplicate") openEditor({
        ...card, currentHp: card.maxHp, temporary: 0, rounds: templates.get(card.templateId)?.rounds ?? card.rounds,
    });
    else update((roster) => {
      const index = roster.cards.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      if (action === "remove") roster.cards.splice(index, 1);
      else if (roster.cards[index].rounds > 0) roster.cards[index].rounds -= 1;
      else return false;
      return true;
    });
  });

  document.addEventListener("preview-encounter-change", render);
  render();
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
  if (seeds.length) {
    previewEncounter.reconcile(syncSeeds);
    previewEncounter.transact(syncSeeds, { undo: false });
  }
  return { select, selected: () => selectedId, detail };
})();
