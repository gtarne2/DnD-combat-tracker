const concentrationControls = (() => {
  const byId = (id) => document.getElementById(id);
  const activeLabel = byId("active-concentration");
  const duration = byId("concentration-duration");
  const actions = byId("concentration-actions");
  const time = byId("concentration-time");
  const damage = byId("concentration-damage");
  const rules = byId("concentration-rules");
  const save = byId("concentration-save");
  const prompt = byId("concentration-save-prompt");
  const last = byId("concentration-last");
  const status = byId("encounter-status");
  const dialog = byId("replace-concentration");
  const castDialog = byId("cast-dialog");
  const castForm = byId("cast-form");
  const guidance = byId("guidance-without-concentration");
  let replacement = null;
  let directCast = null;

  function formatRemaining(seconds) {
    if (seconds < 60 && seconds % 6 === 0) {
      return `${seconds / 6} round${seconds === 6 ? "" : "s"} remaining`;
    }
    const units = [[3600, "h"], [60, "min"], [1, "sec"]];
    const parts = [];
    for (const [size, unit] of units) {
      const amount = Math.floor(seconds / size);
      if (amount) parts.push(`${amount} ${unit}`);
      seconds %= size;
    }
    return `${parts.join(" ")} remaining`;
  }

  function render() {
    const state = previewEncounter.current();
    const focus = state.focus;
    guidance.checked = state.progress?.guidanceWithoutConcentration === true;
    for (const mark of document.querySelectorAll("[data-guidance]")) mark.hidden = guidance.checked;
    const active = focus.active;
    const current = focus.pending[0];
    activeLabel.textContent = active?.name || "None active";
    activeLabel.closest(".focus-status").classList.toggle("has-concentration", Boolean(active));
    duration.textContent = !active ? "" : active.remaining === null
      ? active.label || "Duration unavailable"
      : formatRemaining(active.remaining);
    const effectSummary = byId("effect-concentration");
    effectSummary.hidden = !active;
    effectSummary.textContent = active ? "Concentration · " + active.name + " · " + duration.textContent : "";
    duration.hidden = !active;
    actions.hidden = !active;
    time.hidden = !active || active.remaining === null;
    save.hidden = !current;
    save.dataset.promptId = current?.id ?? "";
    const additional = focus.pending.length - 1;
    prompt.textContent = current ? `Constitution save DC ${current.dc} · ${current.damage} damage`
      + (additional > 0 ? ` · ${additional} more pending` : "") : "";
    rules.value = focus.rules;
    last.hidden = !focus.last;
    last.textContent = focus.last
      ? `Last save: ${focus.last.result === "success" ? "succeeded" : "failed"} against DC ${focus.last.dc}.`
      : "";
  }

  function clear(focus) {
    focus.active = null;
    focus.pending = [];
  }

  function start(state, spell) {
    if (spell.scrollKey !== null && consumableCards.spend(state, spell.scrollKey) === null) {
      status.textContent = "This scroll is unavailable.";
      return false;
    }
    const focus = state.focus;
    focus.sequence += 1;
    focus.active = { id: focus.sequence, name: spell.name, label: spell.label, remaining: spell.seconds, repeatBonus: spell.repeatBonus };
    focus.pending = [];
    focus.last = null;
    status.textContent = `Concentrating on ${spell.name}.`;
    return true;
  }

  function cast(source, scrollKey = null) {
    const spell = readSpell(source, scrollKey);
    previewEncounter.transact((state) => {
      const active = state.focus.active;
      if (!active) return start(state, spell);
      if (dialog.open) return false;
      replacement = { spell, activeId: active.id };
      byId("replace-message").textContent = `End ${active.name} and concentrate on ${spell.name}?`
        + (scrollKey === null ? "" : " Replacing uses one scroll.");
      dialog.returnValue = "keep";
      dialog.showModal();
      return false;
    });
  }

  dialog.addEventListener("close", () => {
    const proposal = replacement;
    replacement = null;
    if (!proposal || dialog.returnValue !== "replace") return;
    previewEncounter.transact((state) => {
      if (state.focus.active?.id !== proposal.activeId) {
        status.textContent = "Active concentration changed. Choose the spell again.";
        return false;
      }
      return start(state, proposal.spell);
    });
  });

  function readSpell(source, scrollKey = null) {
    return {name: source.dataset.focusSpell, label: source.dataset.durationLabel,
      seconds: source.hasAttribute("data-duration-seconds") ? Number(source.dataset.durationSeconds) : null,
      scrollKey, repeatBonus: source.dataset.repeatBonus};
  }

  function finishCast(proposal, slot) {
    previewEncounter.transact((state) => {
      if (!playbook.isPrepared(proposal.key, state) && (slot || !proposal.ritual)) {
        status.textContent = "This spell is unprepared. Choose a prepared spell or a ritual.";
        return false;
      }
      if (proposal.focus && (state.focus.active?.id ?? null) !== proposal.activeId) {
        status.textContent = "Concentration changed. Choose Cast again.";
        return false;
      }
      if (slot && !encounterTracker.spendResource(state, slot)) {
        status.textContent = "That spell slot is unavailable.";
        return false;
      }
      if (proposal.focus) return start(state, proposal.focus);
      status.textContent = `Cast ${proposal.name}.`;
      return Boolean(slot);
    });
  }

  function availableSlots(state, level) {
    return encounterTracker.resources(state).filter((pool) => /^(Spell slot|Pact Magic slot):/.test(pool.key)
      && Number(pool.key.split(":")[1]) >= (level ?? 1)
      && (state.progress?.used[pool.key] || 0) < pool.capacity);
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-cast-spell]");
    if (!control || control.disabled) return;
    const row = control.closest("article");
    const source = row.querySelector("[data-focus-spell]");
    const state = previewEncounter.current();
    const ritual = control.hasAttribute("data-ritual-cast");
    const ritualOnly = !playbook.isPrepared(row.dataset.pin, state);
    if (ritualOnly && !ritual) return;
    const focus = source && !(source.hasAttribute("data-guidance") && state.progress?.guidanceWithoutConcentration)
      ? readSpell(source) : null;
    const level = control.hasAttribute("data-cast-level") ? Number(control.dataset.castLevel) : null;
    const active = focus ? state.focus.active : null;
    const proposal = {name: focus?.name || (row.querySelector(".option-title") || row.querySelector("h3")).textContent.trim(),
      focus, activeId: active?.id ?? null, key: row.dataset.pin, level, ritual};
    if (level === 0 && !active && !ritualOnly) {
      finishCast(proposal, "");
      return;
    }
    directCast = proposal;
    byId("cast-heading").textContent = `Cast ${proposal.name}`;
    const warning = byId("cast-warning");
    warning.hidden = !active;
    warning.textContent = active ? `Casting this spell will end concentration on ${active.name}.` : "";
    const field = byId("cast-slot-field");
    field.hidden = level === 0;
    const input = castForm.elements.slot;
    input.disabled = level === 0;
    const slotNotice = byId("cast-slot-notice");
    slotNotice.hidden = true;
    if (level !== 0) {
      const slots = ritualOnly ? [] : availableSlots(state, level);
      slotNotice.hidden = ritualOnly || slots.length > 0;
      input.replaceChildren(...slots.map((pool) => new Option(pool.name, pool.key)),
        new Option(ritualOnly ? "Cast as a ritual" : "Cast without a slot", "free"));
      if (!ritualOnly && (!slots.length || level === null)) {
        input.prepend(new Option("Choose how to cast…", "", true, true));
      }
    }
    castDialog.showModal();
  });
  castForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const proposal = directCast;
    const choice = castForm.elements.slot.value;
    castDialog.close();
    if (proposal) finishCast(proposal, proposal.level === 0 || choice === "free" ? "" : choice);
  });
  byId("cancel-cast").addEventListener("click", () => castDialog.close());
  guidance.addEventListener("change", () => {
    const checked = guidance.checked;
    encounterTracker.update((progress) => {
      progress.guidanceWithoutConcentration = checked;
      return true;
    });
  });

  damage.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(new FormData(damage).get("damage"));
    if (!Number.isInteger(amount) || amount < 1 || amount > 0xffffffff) return;
    const ruleset = rules.value;
    damage.elements.namedItem("damage").value = "";
    previewEncounter.transact((state) => {
      const focus = state.focus;
      const hp = encounterTracker.damageOwner(state, amount);
      const previousRules = focus.rules;
      focus.rules = ruleset;
      const feedback = hp.current == null ? "HP unavailable."
        : hp.absorbed ? `${hp.absorbed} absorbed by temporary HP · ${hp.temporary} temp and ${hp.current} HP left.`
        : hp.changed ? `${amount} damage recorded · ${hp.current} HP left.` : "HP is already 0.";
      if (hp.dropped && focus.active) {
        clear(focus);
        status.textContent = `${feedback} Concentration ended.`;
        return true;
      }
      if (!focus.active) {
        status.textContent = feedback;
        return hp.changed || previousRules !== ruleset;
      }
      const dc = Math.max(10, Math.floor(amount / 2));
      focus.sequence += 1;
      focus.pending.push({
        id: focus.sequence, damage: amount, dc: focus.rules === "2024" ? Math.min(dc, 30) : dc,
      });
      status.textContent = feedback;
      return true;
    });
    rules.value = previewEncounter.current().focus.rules;
    byId("damage-dialog").close();
  });
  byId("damage-dialog").addEventListener("close", () => {
    rules.value = previewEncounter.current().focus.rules;
    damage.elements.namedItem("damage").value = "";
  });

  save.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-result]");
    if (!button) return;
    const id = Number(save.dataset.promptId);
    const result = button.dataset.saveResult;
    previewEncounter.transact((state) => {
      const focus = state.focus;
      const current = focus.pending[0];
      if (!current || current.id !== id) return false;
      focus.pending.shift();
      focus.last = { dc: current.dc, result };
      if (result === "failure") clear(focus);
      status.textContent = result === "success" ? "Concentration maintained." : "Concentration ended.";
      return true;
    });
  });

  time.addEventListener("submit", (event) => {
    event.preventDefault();
    const elapsed = new FormData(time);
    const seconds = Number(elapsed.get("elapsed")) * Number(elapsed.get("unit"));
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return;
    previewEncounter.transact((state) => {
      const focus = state.focus;
      if (focus.active?.remaining == null) return false;
      const updated = effectControls.advanceTime(state, seconds);
      if (updated.concentrationExpired) {
        status.textContent = "Concentration expired.";
      } else {
        status.textContent = "Concentration duration updated.";
      }
      return updated.changed;
    });
  });

  byId("end-concentration").addEventListener("click", () => {
    previewEncounter.transact((state) => {
      if (!state.focus.active) return false;
      clear(state.focus);
      status.textContent = "Concentration ended.";
      return true;
    });
  });

  document.addEventListener("preview-encounter-change", render);
  render();
  return { availableSlots, cast };
})();
