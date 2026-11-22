const effectControls = (() => {
  const byId = (id) => document.getElementById(id);
  const section = byId("effects");
  const editor = byId("effect-editor");
  const form = byId("effect-form");
  const clock = byId("effect-clock");
  const feedback = byId("effect-feedback");
  const kinds = ["manual", "rounds", "seconds", "start", "end"];
  let editing = null;
  let activeBefore = new Set();
  let lastRender = "";

  function entries(state) {
    return Array.isArray(state.progress?.effects) ? state.progress.effects : [];
  }

  function active(effect) {
    return !effect.ended && (effect.kind === "manual" || effect.remaining > 0);
  }

  function participants(state) {
    return new Map([
      ["owner", encounterTracker.ownerName],
      ...(state.companions?.cards || []).map((card) => [`companion:${card.id}`, card.name]),
      ...(state.progress?.actors || []).map((actor) => [`actor:${actor.id}`, actor.name]),
    ]);
  }

  function initiativeEntry(state, key) {
    if (!key.startsWith("companion:")) return key;
    const card = state.companions?.cards.find((card) => `companion:${card.id}` === key && card.rounds !== 0);
    return card ? card.turn === "owner" ? "owner" : key : null;
  }

  function boundary(state, phase, current) {
    for (const effect of entries(state)) {
      if (active(effect) && effect.kind === phase && initiativeEntry(state, effect.anchor || effect.target) === current) {
        effect.remaining -= 1;
      }
    }
  }

  function advanceRound(state) {
    for (const effect of entries(state)) {
      if (active(effect) && effect.kind === "rounds") effect.remaining -= 1;
    }
  }

  function advanceTime(state, seconds) {
    let changed = false;
    let concentrationExpired = false;
    for (const effect of entries(state)) {
      if (active(effect) && effect.kind === "seconds") {
        effect.remaining = Math.max(0, effect.remaining - seconds);
        changed = true;
      }
    }
    const focus = state.focus;
    if (focus.active?.remaining != null) {
      focus.active.remaining = Math.max(0, focus.active.remaining - seconds);
      changed = true;
      if (focus.active.remaining === 0) {
        focus.active = null;
        focus.pending = [];
        concentrationExpired = true;
      }
    }
    return { changed, concentrationExpired };
  }

  function displayTime(seconds) {
    const parts = [];
    for (const [size, label] of [[3600, "h"], [60, "min"], [1, "sec"]]) {
      const count = Math.floor(seconds / size);
      if (count) parts.push(`${count} ${label}`);
      seconds %= size;
    }
    return parts.join(" ");
  }

  function deadline(effect, state, names, order) {
    if (effect.ended) return "Ended manually";
    if (!active(effect)) return "Expired";
    switch (effect.kind) {
      case "manual": return "Until ended manually";
      case "rounds": return `${effect.remaining} round${effect.remaining === 1 ? "" : "s"} remaining · start of round ${(state.progress?.round || 1) + effect.remaining}`;
      case "seconds": return `${displayTime(effect.remaining)} of game time remaining`;
      default: {
        const anchor = effect.anchor || effect.target;
        const name = names.get(anchor) || "Unavailable participant";
        const entry = initiativeEntry(state, anchor);
        const shared = entry === "owner" && anchor !== "owner" ? " (with owner)" : "";
        const phase = effect.kind === "start" ? "Start" : "End";
        const count = effect.remaining === 1 ? "next matching turn" : `${effect.remaining} matching turns remaining`;
        const waiting = order.has(entry) ? "" : " · waiting for an initiative entry";
        return `${phase} of turn: ${name}${shared} · ${count}${waiting}`;
      }
    }
  }

  function node(tag, text) {
    const created = document.createElement(tag);
    if (text !== undefined) created.textContent = text;
    return created;
  }

  function action(effect, label, kind) {
    const button = node("button", label);
    button.type = "button";
    button.dataset.effectAction = kind;
    button.dataset.effectId = effect.id;
    button.setAttribute("aria-label", `${label}: ${effect.name}`);
    return button;
  }

  function render() {
    const state = previewEncounter.current();
    const effects = entries(state);
    const names = participants(state);
    const order = new Set(encounterTracker.turns(state).map((row) => row.key));
    const signature = JSON.stringify([effects, [...names], [...order], state.progress?.round]);
    if (signature === lastRender) return;
    lastRender = signature;
    const expired = effects.filter((effect) => activeBefore.has(effect.id) && !effect.ended && !active(effect));
    activeBefore = new Set(effects.filter(active).map((effect) => effect.id));
    if (expired.length) feedback.textContent = `Expired: ${expired.map((effect) => effect.name).join(", ")}.`;
    const live = byId("effect-list");
    const past = byId("ended-effect-list");
    live.replaceChildren();
    past.replaceChildren();
    for (const effect of effects) {
      const card = node("article");
      card.append(node("h3", effect.name), node("p", names.get(effect.target) || "Unavailable participant"),
        node("p", deadline(effect, state, names, order)));
      if (effect.notes) {
        const notes = node("p", effect.notes);
        notes.className = "effect-notes";
        card.append(notes);
      }
      const controls = node("div");
      controls.className = "companion-card-actions";
      controls.append(action(effect, "Edit effect", "edit"));
      if (active(effect)) controls.append(action(effect, "End effect", "end"));
      else controls.append(action(effect, "Remove effect", "remove"));
      card.append(controls);
      (active(effect) ? live : past).append(card);
    }
    if (!live.childElementCount) live.append(node("p", "No active effects."));
    byId("ended-effects").hidden = past.childElementCount === 0;
  }

  function formFields() {
    const kind = form.elements.kind.value;
    byId("effect-amount").hidden = kind === "manual";
    form.elements.remaining.required = kind !== "manual";
    form.elements.remaining.disabled = kind === "manual";
    byId("effect-time-unit").hidden = kind !== "seconds";
    byId("effect-anchor").hidden = !["start", "end"].includes(kind);
  }

  function choose(select, options, value) {
    if (!options.has(value)) options.set(value, "Unavailable participant");
    select.replaceChildren(...[...options].map(([key, label]) => new Option(label, key)));
    select.value = value;
  }

  function open(effect) {
    editing = effect?.id ?? null;
    const names = participants(previewEncounter.current());
    choose(form.elements.target, names, effect?.target || "owner");
    choose(form.elements.anchor, new Map([["", "Effect target"], ...names]), effect?.anchor || "");
    form.elements.name.value = effect?.name || "";
    form.elements.notes.value = effect?.notes || "";
    form.elements.kind.value = effect?.kind || "manual";
    form.elements.remaining.value = Math.max(1, effect?.remaining || 1);
    form.elements.unit.value = "1";
    formFields();
    editor.showModal();
  }

  byId("add-effect").addEventListener("click", () => open());
  byId("effect-cancel").addEventListener("click", () => editor.close());
  form.elements.kind.addEventListener("change", formFields);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = data.get("name").trim();
    const kind = data.get("kind");
    const remaining = kind === "manual" ? null : Number(data.get("remaining")) * (kind === "seconds" ? Number(data.get("unit")) : 1);
    if (!name || !kinds.includes(kind)) return;
    if (remaining !== null && (!Number.isInteger(remaining) || remaining < 1 || remaining > 0xffffffff)) {
      form.elements.remaining.setCustomValidity("Enter a shorter duration.");
      form.reportValidity();
      form.elements.remaining.setCustomValidity("");
      return;
    }
    const effect = { name, notes: data.get("notes").trim(), target: data.get("target"),
      anchor: ["start", "end"].includes(kind) ? data.get("anchor") : "", kind, remaining, ended: false };
    const id = editing;
    editor.close();
    encounterTracker.update((progress) => {
      const effects = progress.effects ||= [];
      if (id === null) effects.push({ ...effect, id: ++progress.sequence });
      else {
        const current = effects.find((entry) => entry.id === id);
        if (!current) return false;
        Object.assign(current, effect);
      }
      feedback.textContent = "Effect saved.";
      return true;
    });
  });

  section.addEventListener("click", (event) => {
    const control = event.target.closest("[data-effect-action]");
    if (!control) return;
    const id = Number(control.dataset.effectId);
    if (control.dataset.effectAction === "edit") {
      const effect = entries(previewEncounter.current()).find((entry) => entry.id === id);
      if (effect) open(effect);
      return;
    }
    encounterTracker.update((progress) => {
      const effects = progress.effects || [];
      const index = effects.findIndex((entry) => entry.id === id);
      if (index < 0) return false;
      if (control.dataset.effectAction === "end" && active(effects[index])) {
        effects[index].ended = true;
      } else if (control.dataset.effectAction === "remove" && !active(effects[index])) {
        effects.splice(index, 1);
      } else return false;
      feedback.textContent = control.dataset.effectAction === "end" ? "Effect ended." : "Effect removed.";
      return true;
    });
  });

  clock.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(clock);
    const seconds = Number(data.get("elapsed")) * Number(data.get("unit"));
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 0xffffffff) {
      feedback.textContent = "Enter a shorter elapsed time.";
      return;
    }
    previewEncounter.transact((state) => {
      const { changed } = advanceTime(state, seconds);
      feedback.textContent = changed ? "In-game time advanced." : "No in-game timers are active.";
      return changed;
    });
  });

  document.addEventListener("preview-encounter-change", render);
  render();
  return { boundary, advanceRound, advanceTime };
})();
