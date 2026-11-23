const effectControls = (() => {
  const byId = (id) => document.getElementById(id);
  const editor = byId("effect-editor");
  const form = byId("effect-form");
  const clock = byId("effect-clock");
  const feedback = byId("effect-feedback");
  const kinds = ["manual", "rounds", "seconds", "start", "end", "short", "long"];
  const timed = (kind) => ["rounds", "seconds", "start", "end"].includes(kind);
  const kindLabel = {manual: "Persistent", rounds: "Rounds", seconds: "Game time",
    start: "Turn start", end: "Turn end", short: "Short or long rest", long: "Long rest"};
  let editing = null;
  let activeBefore = new Set();
  let lastRender = "";

  function entries(state) {
    return Array.isArray(state.progress?.effects) ? state.progress.effects : [];
  }

  function active(effect) {
    return !effect.ended && (!timed(effect.kind) || effect.remaining > 0);
  }

  function endForRemovedTarget(state, target) {
    for (const effect of entries(state)) {
      if (effect.target === target && active(effect)) {
        effect.ended = true;
        effect.targetRemoved = true;
      }
    }
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
    if (effect.ended) return effect.targetRemoved ? "Target removed" : effect.endedByRest ? "Ended on a rest" : "Ended manually";
    if (!active(effect)) return "Expired";
    switch (effect.kind) {
      case "manual": return "Until ended manually";
      case "short": return "Until the next short or long rest";
      case "long": return "Until the next long rest";
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

  function view(state) {
    const names = participants(state);
    const order = new Set(encounterTracker.turns(state).map((row) => row.key));
    const remaining = (effect) => deadline(effect, state, names, order);
    function card(effect, showTarget = true) {
      const result = node("article");
      const tags = node("div");
      tags.className = "status-chips";
      if (effect.category === "condition") tags.append(chip("Condition", "condition"));
      tags.append(chip(kindLabel[effect.kind] || "Effect", effect.kind));
      result.append(node("h3", effect.name), tags);
      if (showTarget) result.append(node("p", names.get(effect.target) || "Unavailable participant"));
      result.append(node("strong", remaining(effect)));
      if (effect.notes) {
        const notes = node("p", effect.notes);
        notes.className = "effect-notes";
        result.append(notes);
      }
      const controls = node("div");
      controls.className = "companion-card-actions";
      controls.append(action(effect, "Edit effect", "edit"));
      controls.append(active(effect) ? action(effect, "End effect", "end") : action(effect, "Remove effect", "remove"));
      result.append(controls);
      return result;
    }
    const targets = new Map();
    for (const effect of entries(state)) {
      if (!active(effect)) continue;
      if (!targets.has(effect.target)) targets.set(effect.target, []);
      targets.get(effect.target).push(effect);
    }
    return {names, order, remaining, card, activeFor: (target) => targets.get(target) || []};
  }

  function chip(text, kind) {
    const result = node("span", text);
    result.className = "status-chip";
    result.dataset.statusKind = kind;
    return result;
  }

  function indicators(effects, limit) {
    const children = effects.slice(0, limit).map((effect) =>
      chip(effect.name, effect.category === "condition" ? "condition" : effect.kind));
    if (effects.length > limit) {
      const more = chip("+" + (effects.length - limit), "manual");
      more.title = effects.slice(limit).map((effect) => effect.name).join(", ");
      children.push(more);
    }
    return children;
  }

  function render() {
    const state = previewEncounter.current();
    const effects = entries(state);
    const display = view(state);
    const signature = JSON.stringify([effects, [...display.names], [...display.order], state.progress?.round, Boolean(state.focus.active)]);
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
      (active(effect) ? live : past).append(display.card(effect));
    }
    if (!live.childElementCount && !state.focus.active) live.append(node("p", "No active effects."));
    byId("ended-effects").hidden = past.childElementCount === 0;
    const ownerEffects = byId("owner-effects");
    ownerEffects.replaceChildren(...indicators(display.activeFor("owner"), 4));
    ownerEffects.hidden = !ownerEffects.childElementCount;
  }

  function formFields() {
    const kind = form.elements.kind.value;
    byId("effect-amount").hidden = !timed(kind);
    form.elements.remaining.required = timed(kind);
    form.elements.remaining.disabled = !timed(kind);
    byId("effect-time-unit").hidden = kind !== "seconds";
    byId("effect-anchor").hidden = !["start", "end"].includes(kind);
  }

  function choose(select, options, value) {
    if (!options.has(value)) options.set(value, "Unavailable participant");
    select.replaceChildren(...[...options].map(([key, label]) => new Option(label, key)));
    select.value = value;
  }

  function open(effect, target = "owner", category = "effect") {
    editing = effect?.id ?? null;
    const names = participants(previewEncounter.current());
    choose(form.elements.target, names, effect?.target || target);
    choose(form.elements.anchor, new Map([["", "Effect target"], ...names]), effect?.anchor || "");
    form.elements.name.value = effect?.name || "";
    form.elements.notes.value = effect?.notes || "";
    form.elements.category.value = effect?.category || category;
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
    const remaining = timed(kind) ? Number(data.get("remaining")) * (kind === "seconds" ? Number(data.get("unit")) : 1) : null;
    if (!name || !kinds.includes(kind)) return;
    if (remaining !== null && (!Number.isInteger(remaining) || remaining < 1 || remaining > 0xffffffff)) {
      form.elements.remaining.setCustomValidity("Enter a shorter duration.");
      form.reportValidity();
      form.elements.remaining.setCustomValidity("");
      return;
    }
    const effect = { name, notes: data.get("notes").trim(), target: data.get("target"),
      category: data.get("category") === "condition" ? "condition" : "effect",
      anchor: ["start", "end"].includes(kind) ? data.get("anchor") : "", kind, remaining,
      ended: false, endedByRest: false, targetRemoved: false };
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
      return (id === null ? "adding " : "editing ") + name;
    });
  });

  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-target-effect]");
    if (add) {
      open(null, add.dataset.addTargetEffect, add.dataset.category);
      return;
    }
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
      const name = effects[index].name;
      if (control.dataset.effectAction === "end" && active(effects[index])) {
        effects[index].ended = true;
      } else if (control.dataset.effectAction === "remove" && !active(effects[index])) {
        effects.splice(index, 1);
      } else return false;
      feedback.textContent = control.dataset.effectAction === "end" ? "Effect ended." : "Effect removed.";
      return (control.dataset.effectAction === "end" ? "ending " : "removing ") + name;
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
      return changed && "advancing game time";
    });
  });

  document.addEventListener("preview-encounter-change", render);
  document.addEventListener("preview-encounter-undo", () => { feedback.textContent = ""; });
  render();
  return { boundary, advanceRound, advanceTime, displayTime, endForRemovedTarget, indicators, view };
})();
