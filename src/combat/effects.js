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

  function anchoredTo(state, target) {
    return entries(state).filter((effect) => active(effect) && effect.target !== target
      && ["start", "end"].includes(effect.kind) && (effect.anchor || effect.target) === target);
  }

  function endForRemovedTarget(state, target, assignments = new Map()) {
    for (const effect of anchoredTo(state, target)) {
      const replacement = assignments.get(effect.id);
      if (replacement) effect.anchor = replacement;
      else {
        effect.ended = true;
        effect.anchorRemoved = true;
      }
    }
    for (const effect of entries(state)) {
      if (effect.target === target && active(effect)) {
        effect.ended = true;
        effect.targetRemoved = true;
      }
    }
  }

  const removal = byId("remove-participant");
  const removalForm = byId("remove-participant-form");
  let pendingRemoval;

  function removeParticipant(key, name, remove) {
    const state = previewEncounter.current();
    const affected = anchoredTo(state, key);
    const apply = (assignments) => {
      previewEncounter.transact((draft) => {
        const order = encounterTracker.turns(draft);
        if (anchoredTo(draft, key).some((effect) => !assignments.has(effect.id))
            || [...assignments.values()].some((replacement) => replacement && !order.some((row) => row.key === replacement))) {
          byId("encounter-status").textContent = "Initiative or effects changed. Open participant removal again.";
          return false;
        }
        if (!remove(draft)) return false;
        endForRemovedTarget(draft, key, assignments);
        return "removing " + name;
      });
    };
    if (!affected.length) {
      apply(new Map());
      return;
    }
    const replacements = encounterTracker.turns(state).filter((row) => row.key !== key);
    byId("remove-participant-heading").textContent = "Remove " + name;
    byId("removed-turn-effects").replaceChildren(...affected.map((effect) => {
      const label = node("label", effect.name);
      const select = node("select");
      select.name = String(effect.id);
      select.add(new Option("End effect", ""));
      for (const row of replacements) select.add(new Option("Follow " + row.name, row.key));
      label.append(select);
      return label;
    }));
    pendingRemoval = apply;
    removal.showModal();
  }

  byId("cancel-participant-removal").onclick = () => removal.close();
  removalForm.onsubmit = (event) => {
    event.preventDefault();
    const assignments = new Map(Array.from(new FormData(removalForm), ([id, key]) => [Number(id), key]));
    removal.close();
    pendingRemoval(assignments);
  };

  function participants(state) {
    return new Map([
      ["owner", encounterTracker.ownerName],
      ...(state.companions?.cards || []).map((card) => [`companion:${card.id}`, card.name]),
      ...(state.progress?.partyClock
        ? partyInitiative.rows(state).filter(row => row.key?.startsWith("party:")).map(row => [row.key,row.name])
        : (state.progress?.actors || []).map(actor => [`actor:${actor.id}`, actor.name])),
    ]);
  }

  function initiativeEntry(state, key) {
    if (!key.startsWith("companion:")) return key;
    const card = state.companions?.cards.find((card) => `companion:${card.id}` === key && companionControls.available(card));
    return card ? actionEconomy.turnKey(state,key) : null;
  }

  function spellParticipants(state) {
    return new Map([...participants(state)].filter(([key]) => !key.startsWith("companion:") || initiativeEntry(state, key)));
  }

  function setSpellTargets(state, focus, targets) {
    const names = spellParticipants(state);
    if (targets.length > focus.trackedSpell.limit || targets.some((target) => !names.has(target))) return false;
    const progress = state.progress ||= previewEncounter.emptyProgress();
    progress.effects ||= [];
    const current = progress.effects.filter((effect) => active(effect) && effect.linkedFocus === focus.id);
    for (const effect of current) if (!targets.includes(effect.target)) effect.ended = true;
    for (const target of new Set(targets)) {
      if (current.some((effect) => effect.target === target)) continue;
      progress.effects.push({id: ++progress.sequence, name: focus.name, notes: focus.trackedSpell.notes, target,
        kind: "manual", category: "effect", linkedFocus: focus.id, spellKind: focus.trackedSpell.kind,
        source: focus.trackedSpell.source});
    }
    return true;
  }

  function endConcentrationEffects(state) {
    for (const effect of entries(state)) {
      if (active(effect) && effect.linkedFocus != null && state.focus.active?.id !== effect.linkedFocus) {
        effect.ended = true;
        effect.endedByConcentration = true;
      }
    }
    if (!state.focus.active?.trackedSpell && state.progress) delete state.progress.spellTurnReminder;
  }
  previewEncounter.reconcile(endConcentrationEffects);

  function recordShield(state, name, source) {
    const progress = state.progress ||= previewEncounter.emptyProgress();
    const effects = progress.effects ||= [];
    const prior = effects.find((effect) => active(effect) && effect.shield);
    if (prior) prior.ended = true;
    effects.push({id: ++progress.sequence, name, target: "owner", category: "effect", kind: "start", anchor: "owner",
      remaining: 1, clockLimit: 6, shield: true, source, notes: "+5 AC, including against the triggering attack. Check whether the hit still lands before recording damage."});
  }

  function boundary(state, phase, current) {
    const reminders = [];
    for (const effect of entries(state)) {
      if (active(effect) && effect.kind === phase && initiativeEntry(state, effect.anchor || effect.target) === current) {
        effect.remaining -= 1;
      }
      if (phase === "start" && effect.spellKind === "moonbeam" && active(effect) && initiativeEntry(state, effect.target) === current) {
        const name = participants(state).get(effect.target);
        const reminder = effect.name + " · " + name + " · " + effect.notes;
        reminders.push(reminder);
        previewEncounter.log(state, "effect", reminder, effect.source);
      }
    }
    if (reminders.length) state.progress.spellTurnReminder = reminders.join(" · ");
  }

  function advanceRounds(state, rounds, {initiative = false} = {}) {
    tickRoundEffects(state, rounds);
    for (const card of state.companions?.cards || []) companionControls.advance(card, "rounds", rounds, state);
    return advanceTime(state, rounds * 6, {initiative});
  }

  function tickRoundEffects(state, rounds) {
    for (const effect of entries(state)) {
      if (active(effect) && effect.kind === "rounds") {
        effect.remaining = Math.max(0, effect.remaining - rounds);
      }
    }
  }

  function advanceTime(state, seconds, {initiative = false} = {}) {
    const progress = state.progress ||= previewEncounter.emptyProgress();
    progress.elapsedSeconds = Math.min(Number.MAX_SAFE_INTEGER, (progress.elapsedSeconds || 0) + seconds);
    let concentrationExpired = false;
    for (const card of state.companions?.cards || []) companionControls.advance(card, "seconds", seconds, state);
    for (const effect of entries(state)) {
      if (active(effect) && effect.kind === "seconds") {
        effect.remaining = Math.max(0, effect.remaining - seconds);
      }
      if (!initiative && active(effect) && effect.clockLimit != null) {
        effect.clockLimit = Math.max(0, effect.clockLimit - seconds);
        if (!effect.clockLimit) effect.remaining = 0;
      }
    }
    const focus = state.focus;
    if (focus.active?.remaining != null) {
      focus.active.remaining = Math.max(0, focus.active.remaining - seconds);
      if (focus.active.remaining === 0) {
        previewEncounter.log(state, "expiration", `Concentration expired · ${focus.active.name}`);
        focus.active = null;
        focus.pending = [];
        concentrationExpired = true;
      }
    }
    return { concentrationExpired };
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
    if (effect.ended) return effect.targetRemoved ? "Target removed" : effect.anchorRemoved ? "Turn participant removed"
      : effect.endedByConcentration ? "Concentration ended" : effect.endedByRest ? "Ended on a rest" : "Ended manually";
    if (!active(effect)) return "Expired";
    if (effect.linkedFocus != null) return "While concentrating";
    switch (effect.kind) {
      case "manual": return "Until ended manually";
      case "short": return "Until the next short or long rest";
      case "long": return "Until the next long rest";
      case "rounds": {
        const remaining = `${effect.remaining} round${effect.remaining === 1 ? "" : "s"} remaining`;
        return state.progress?.active === false ? remaining : `${remaining} · start of round ${(state.progress?.round || 1) + effect.remaining}`;
      }
      case "seconds": return `${displayTime(effect.remaining)} of game time remaining`;
      default: {
        const anchor = effect.anchor || effect.target;
        const name = names.get(anchor) || "Unavailable participant";
        const entry = initiativeEntry(state, anchor);
        const shared = entry === "owner" && anchor !== "owner" ? " (with owner)" : "";
        const phase = effect.kind === "start" ? "Start" : "End";
        const count = effect.remaining === 1 ? "next matching turn" : `${effect.remaining} matching turns remaining`;
        const waiting = state.progress?.active === false ? " · encounter inactive" : order.has(entry) ? "" : " · waiting for an initiative entry";
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
    byId("game-time-elapsed").textContent = `Elapsed game time · ${displayTime(state.progress?.elapsedSeconds || 0) || "0 sec"}`;
    const effects = entries(state);
    const display = view(state);
    const signature = JSON.stringify([effects, [...display.names], [...display.order], state.progress?.round, state.progress?.active, Boolean(state.focus.active)]);
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
    byId("effects").classList.toggle("effects-empty", !activeBefore.size && !state.focus.active);
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

  function fillEffect(effect, target, category) {
    const names = participants(previewEncounter.current());
    choose(form.elements.target, names, names.has(effect?.target) ? effect.target : target);
    choose(form.elements.anchor, new Map([["", "Effect target"], ...names]), names.has(effect?.anchor) ? effect.anchor : "");
    form.elements.name.value = effect?.name || "";
    form.elements.notes.value = effect?.notes || "";
    form.elements.category.value = effect?.category || category;
    form.elements.kind.value = effect?.kind || "manual";
    form.elements.remaining.value = Math.max(1, effect?.remaining || 1);
    form.elements.unit.value = "1";
    formFields();
  }

  const presets = () => sessionView.get("effectPresets") || [];
  const preset = form.elements.preset;
  const presetStatus = byId("effect-preset-feedback");
  const deletePreset = byId("delete-effect-preset");
  function renderPresets(selected = "") {
    preset.replaceChildren(new Option("Choose a preset", ""), ...presets().map((entry) => new Option(entry.name, entry.name)));
    preset.value = selected;
    deletePreset.disabled = !selected;
  }
  function open(effect, target = "owner", category = "effect") {
    editing = effect?.id ?? null;
    renderPresets();
    presetStatus.textContent = "";
    fillEffect(effect, target, category);
    editor.showModal();
  }

  byId("add-effect").addEventListener("click", () => open());
  byId("effect-cancel").addEventListener("click", () => editor.close());
  form.elements.kind.addEventListener("change", formFields);
  function readEffect() {
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
    return { name, notes: data.get("notes").trim(), target: data.get("target"),
      category: data.get("category") === "condition" ? "condition" : "effect",
      anchor: ["start", "end"].includes(kind) ? data.get("anchor") : "", kind, remaining,
      ended: false, endedByRest: false, targetRemoved: false, anchorRemoved: false };
  }
  preset.onchange = () => {
    const selected = presets().find((entry) => entry.name === preset.value);
    deletePreset.disabled = !selected;
    if (!selected) return;
    const names = participants(previewEncounter.current());
    const missing = !names.has(selected.target) || selected.anchor && !names.has(selected.anchor);
    fillEffect(selected, form.elements.target.value, form.elements.category.value);
    presetStatus.textContent = missing ? "A saved participant is unavailable. Review the target and turn." : "";
  };
  byId("save-effect-preset").onclick = () => {
    if (!form.reportValidity()) return;
    const effect = readEffect();
    if (!effect) return;
    sessionView.set("effectPresets", [...presets().filter((entry) => entry.name !== effect.name), effect]);
    renderPresets(effect.name);
    presetStatus.textContent = "Preset saved.";
  };
  deletePreset.onclick = () => {
    sessionView.set("effectPresets", presets().filter((entry) => entry.name !== preset.value));
    renderPresets();
    presetStatus.textContent = "Preset removed.";
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const effect = readEffect();
    if (!effect) return;
    const {name} = effect;
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
    const elapsed = Number(data.get("elapsed"));
    const rounds = data.get("unit") === "rounds";
    const seconds = elapsed * (rounds ? 6 : Number(data.get("unit")));
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 0xffffffff) {
      feedback.textContent = "Enter a shorter elapsed time.";
      return;
    }
    previewEncounter.transact((state) => {
      if (state.progress?.partyClock) {feedback.textContent = "The DM controls game time."; return false;}
      if (rounds) advanceRounds(state, elapsed);
      else advanceTime(state, seconds);
      feedback.textContent = "In-game time advanced.";
      return "advancing game time";
    });
  });

  document.addEventListener("preview-encounter-change", render);
  document.addEventListener("preview-encounter-undo", () => { feedback.textContent = ""; });
  render();
  return { boundary, advanceRounds, advanceTime, tickRoundEffects, displayTime, endForRemovedTarget, removeParticipant, indicators,
    view, entries, active, spellParticipants, setSpellTargets, recordShield };
})();
