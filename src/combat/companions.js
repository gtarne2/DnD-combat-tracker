(() => {
  const byId = (id) => document.getElementById(id);
  const add = byId("add-companion");
  const owner = byId("companion-owner");
  const editor = byId("companion-editor");
  const form = byId("edit-companion");
  const cards = byId("companion-cards");
  const initiative = byId("companion-initiative");
  const textFields = ["name", "kind", "armor", "speed", "stats", "attacks", "abilities", "command", "duration"];
  const numberFields = ["currentHp", "maxHp", "rounds", "initiative"];
  const number = (value) => value === "" || value == null ? null : Number(value);
  const blank = () => ({ cards: [], seen: [], sequence: 0, owner: null });
  let edit = null;
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
    const signature = JSON.stringify(roster);
    if (signature === lastRender) return;
    lastRender = signature;
    cards.replaceChildren();
    if (!roster.cards.length) cards.append(node("p", "No companions in this encounter."));
    for (const card of roster.cards) {
      const article = node("article");
      article.dataset.companionId = card.id;
      article.append(node("h3", card.name));
      const details = node("dl");
      const hp = card.currentHp != null ? `${card.currentHp}${card.maxHp == null ? "" : ` / ${card.maxHp}`}`
        : card.maxHp == null ? "" : `${card.maxHp} max`;
      const duration = card.rounds == null ? card.duration : card.rounds === 0 ? "Expired"
        : `${card.rounds} round${card.rounds === 1 ? "" : "s"} remaining${card.duration ? ` · ${card.duration}` : ""}`;
      for (const [label, value] of [
        ["Kind", card.kind], ["HP", hp], ["AC", card.armor], ["Speed", card.speed],
        ["Duration", duration], ["Turn", card.turn === "separate" ? `Initiative ${card.initiative}` : "With owner"],
        ["Command", card.command],
      ]) {
        if (!value) continue;
        const row = node("div");
        row.append(node("dt", label), node("dd", value));
        details.append(row);
      }
      article.append(details);
      for (const [label, value] of [["Other stats", card.stats], ["Attacks", card.attacks], ["Abilities", card.abilities]]) {
        if (!value) continue;
        const section = node("details");
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
      cards.append(article);
    }
    owner.elements.initiative.value = roster.owner ?? "";
    initiative.replaceChildren();
    const shared = roster.cards.filter((card) => card.turn === "owner" && card.rounds !== 0).map((card) => card.name);
    const rows = [{ score: roster.owner, label: shared.length ? `Owner with ${shared.join(", ")}` : "Owner" }];
    for (const card of roster.cards) {
      if (card.turn === "separate" && card.rounds !== 0) rows.push({ score: card.initiative, label: card.name });
    }
    rows.sort((left, right) => (right.score ?? -Infinity) - (left.score ?? -Infinity));
    for (const row of rows) initiative.append(node("li", `${row.score ?? "—"} · ${row.label}`));
  }

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
    const templateId = add.elements.template.value;
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

  cards.addEventListener("click", (event) => {
    const control = event.target.closest("[data-companion-action]");
    if (!control) return;
    const id = Number(control.closest("[data-companion-id]").dataset.companionId);
    const card = previewEncounter.current().companions?.cards.find((card) => card.id === id);
    if (!card) return;
    const action = control.dataset.companionAction;
    if (action === "edit") openEditor(card, id);
    else if (action === "duplicate") openEditor({
      ...card, currentHp: card.maxHp, rounds: templates.get(card.templateId)?.rounds ?? card.rounds,
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

  owner.addEventListener("submit", (event) => {
    event.preventDefault();
    const score = number(new FormData(owner).get("initiative"));
    update((roster) => {
      roster.owner = score;
      return true;
    });
  });
  document.addEventListener("preview-encounter-change", render);
  render();
  if (seeds.length) update((roster) => {
    let added = false;
    for (const seed of seeds) {
      const templateId = seed.dataset.companionSeed;
      if (roster.seen.includes(templateId)) continue;
      roster.seen.push(templateId);
      roster.cards.push({ ...fromData(seed), id: ++roster.sequence, templateId });
      added = true;
    }
    return added;
  });
})();
