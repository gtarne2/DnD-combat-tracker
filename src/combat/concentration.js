const concentrationControls = (() => {
  const byId = (id) => document.getElementById(id);
  const activeLabel = byId("active-concentration");
  const duration = byId("concentration-duration");
  const actions = byId("concentration-actions");
  const manage = actions.querySelector("summary");
  document.addEventListener("click", (event) => {
    if (actions.open && !actions.contains(event.target)) {
      if (actions.contains(document.activeElement)) manage.focus({preventScroll: true});
      actions.open = false;
    }
  });
  actions.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !actions.open) return;
    event.preventDefault();
    actions.open = false;
    manage.focus({preventScroll: true});
  });
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
  const damageDialog = byId("damage-dialog");
  const incoming = byId("incoming-event");
  const reactionChoices = [...document.querySelectorAll("#action-groups [data-incoming-events]")]
    .map((tools) => ({tools, cast: tools.querySelector("[data-cast-spell]")}))
    .filter((entry) => entry.cast);
  byId("incoming-event-field").hidden = !reactionChoices.length;
  const targetDialog = byId("spell-target-dialog");
  const manageTargets = byId("manage-spell-targets");
  const guidance = byId("guidance-without-concentration");
  let replacement = null;
  let directCast = null;

  function formatRemaining(seconds, label) {
    if (/\brounds?\b/i.test(label) && seconds % 6 === 0) {
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
      : formatRemaining(active.remaining, active.label);
    const effectSummary = byId("effect-concentration");
    effectSummary.hidden = !active;
    byId("effect-concentration-name").textContent = active?.name || "";
    byId("effect-concentration-duration").textContent = duration.textContent;
    duration.hidden = !active;
    actions.hidden = !active;
    if (!active) actions.open = false;
    manageTargets.hidden = !active?.trackedSpell;
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
    if (damageDialog.open) renderReactions(state);
  }

  function clear(focus) {
    focus.active = null;
    focus.pending = [];
  }

  function start(state, spell) {
    if (spell.scrollKey !== null && !actionEconomy.spend(state, "owner", spell.timing)) return false;
    if (spell.scrollKey !== null && consumableCards.spend(state, spell.scrollKey) === null) {
      status.textContent = "This scroll is unavailable.";
      return false;
    }
    const focus = state.focus;
    if (state.progress) delete state.progress.spellTurnReminder;
    focus.sequence += 1;
    focus.active = { id: focus.sequence, name: spell.name, label: spell.label, remaining: spell.seconds, repeatBonus: spell.repeatBonus };
    focus.pending = [];
    focus.last = null;
    status.textContent = `Concentrating on ${spell.name}.`;
    if (spell.scrollKey !== null) previewEncounter.log(state, "cast", `Cast ${spell.name} from a scroll`, spell.source);
    return spell.scrollKey === null ? "casting " + spell.name : "using a scroll of " + spell.name;
  }

  function cast(source, scrollKey = null, control = null) {
    const spell = {...readSpell(source, scrollKey), timing: control && actionEconomy.timing(control)};
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
      scrollKey, repeatBonus: source.dataset.repeatBonus, source: source.closest("article")?.dataset.sheetEntry};
  }

  function finishCast(proposal, method, pool = "") {
    previewEncounter.transact((state) => {
      if (!playbook.isPrepared(proposal.key, state) && method !== "ritual") {
        status.textContent = "This spell is unprepared. Choose a prepared spell or a ritual.";
        return false;
      }
      if (proposal.focus && (state.focus.active?.id ?? null) !== proposal.activeId) {
        status.textContent = "Concentration changed. Choose Cast again.";
        return false;
      }
      if (method === "ritual" && !proposal.ritual) return false;
      if (method !== "ritual" && !actionEconomy.spend(state, "owner", proposal.timing)) return false;
      if (pool && !encounterTracker.spendResource(state, pool)) {
        status.textContent = "That casting resource is unavailable.";
        return false;
      }
      const result = proposal.focus ? start(state, proposal.focus) : "casting " + proposal.name;
      if (result) {
        const roll = spellRoll(proposal, method, pool);
        const kind = {cantrip: "cantrip", ritual: "ritual", free: "free use", slot: "spell slot"}[method];
        const source = "option:" + proposal.key;
        const active = state.focus.active;
        if (proposal.focus && ["bless", "moonbeam"].includes(proposal.effect)) {
          const limit = targetLimit(proposal, method, pool);
          const notes = proposal.effect === "bless" ? "+1d4 to attack rolls and saving throws."
            : ["At start of turn: Constitution save", proposal.dc ? "DC " + proposal.dc : "", roll || proposal.damage].filter(Boolean).join(" · ");
          active.trackedSpell = {kind: proposal.effect, limit, notes, source};
          if (!effectControls.setSpellTargets(state, active, proposal.targets || [])) {
            status.textContent = "The target list changed. Open the spell again.";
            return false;
          }
        }
        if (proposal.effect === "shield") effectControls.recordShield(state, proposal.name, source);
        const situational = proposal.advantageSelected ? "Advantage · " + proposal.advantage : "";
        previewEncounter.log(state, "cast", ["Cast " + proposal.name, kind, roll, situational].filter(Boolean).join(" · "), source);
      }
      if (!proposal.focus) status.textContent = `Cast ${proposal.name}.`;
      if (proposal.advantageSelected) status.textContent += " Advantage on this attack.";
      if (proposal.firearm && (!proposal.focus || result)) status.textContent += " " + attackModifiers.firearmHint + ".";
      return result;
    });
  }

  function availableSlots(state, level) {
    return encounterTracker.resources(state).filter((pool) => /^(Spell slot|Pact Magic slot):/.test(pool.key)
      && Number(pool.key.split(":")[1]) >= (level ?? 1)
      && (state.progress?.used[pool.key] || 0) < pool.capacity);
  }

  function spellRoll(proposal, method, pool) {
    return proposal.previews[slotLevel(proposal, method, pool) - 1] || "";
  }

  function slotLevel(proposal, method, pool) {
    return method === "slot" ? Number(pool.split(":")[1]) : proposal.level || 0;
  }
  function targetLimit(proposal, method, pool) {
    return proposal.effect === "moonbeam" ? Number.MAX_SAFE_INTEGER
      : proposal.targetCounts[slotLevel(proposal, method, pool) - 1] || 0;
  }
  function targetFields(host, state, selected = []) {
    host.replaceChildren(...[...effectControls.spellParticipants(state)].map(([key, name]) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      Object.assign(input, {type: "checkbox", name: "target", value: key, checked: selected.includes(key)});
      label.append(input, " " + name);
      return label;
    }));
  }

  function renderCost() {
    const method = directCast?.level === 0 ? "cantrip" : castForm.elements.slot.value;
    const free = method === "free";
    byId("cast-free-pool").hidden = !free || castForm.elements.freePool.options.length <= 1;
    const label = castForm.elements.slot.selectedOptions[0]?.textContent;
    byId("cast-cost").textContent = method === "ritual" ? "No slot or tracked uses. Add the ritual casting time at the table."
      : method === "cantrip" ? "No slot or tracked uses."
      : free ? castForm.elements.freePool.value ? `Cost: one use of ${castForm.elements.freePool.selectedOptions[0].textContent}.` : "Cost: no slot or tracked uses."
      : method ? `Cost: one ${label}.` : "";
    const kind = method.includes(":") ? "slot" : method;
    const count = directCast.targetCounts[slotLevel(directCast, kind, method) - 1];
    const advantage = directCast.advantage && castForm.elements.situational.checked ? "Advantage on this attack" : "";
    const preview = [spellRoll(directCast, kind, method), count ? "Up to " + count + " targets" : "", advantage].filter(Boolean).join(" · ");
    const roll = byId("cast-roll-preview");
    roll.hidden = !preview;
    roll.textContent = preview || "";
    byId("cast-target-feedback").textContent = directCast.effect === "moonbeam"
      ? "Select creatures currently in the beam. Update the list as they move."
      : count ? "Choose up to " + count + " targets." : "";
  }
  castForm.elements.slot.onchange = renderCost;
  castForm.elements.freePool.onchange = renderCost;
  castForm.elements.situational.onchange = renderCost;

  function openCast(control, fromReaction = false) {
    if (!control || (!fromReaction && control.disabled)) return;
    const row = control.closest("article");
    const source = row.querySelector("[data-focus-spell]");
    const state = previewEncounter.current();
    const ritual = control.hasAttribute("data-ritual-cast");
    const timing = actionEconomy.timing(control);
    const ritualOnly = !playbook.isPrepared(row.dataset.pin, state) || Boolean(actionEconomy.reason(state, "owner", timing));
    if (ritualOnly && !ritual) return;
    const focus = source && !(source.hasAttribute("data-guidance") && state.progress?.guidanceWithoutConcentration)
      ? readSpell(source) : null;
    const level = control.hasAttribute("data-cast-level") ? Number(control.dataset.castLevel) : null;
    const active = focus ? state.focus.active : null;
    const tools = row.querySelector(".option-execute");
    const firearmEligible = tools.hasAttribute("data-firearm-eligible");
    const firearm = firearmEligible && attackModifiers.firearmEnabled(state);
    const proposal = {name: focus?.name || (row.querySelector(".option-title") || row.querySelector("h3")).textContent.trim(),
      focus, activeId: active?.id ?? null, key: row.dataset.pin, level, ritual, firearm, timing,
      previews: control.dataset.castPreviews?.split("|") || [], effect: tools.dataset.spellEffect,
      targetCounts: tools.dataset.targetCounts?.split(",").map(Number) || [],
      advantage: tools.dataset.conditionalAdvantage, dc: tools.dataset.saveDc, damage: tools.dataset.baseDamage};
    if (level === 0 && !active && !ritualOnly && !proposal.advantage) {
      finishCast(proposal, "cantrip");
      return;
    }
    directCast = proposal;
    byId("cast-heading").textContent = `Cast ${proposal.name}`;
    const warning = byId("cast-warning");
    warning.hidden = !active;
    warning.textContent = active ? `Casting this spell will end concentration on ${active.name}.` : "";
    byId("cast-firearm-field").hidden = !firearmEligible;
    castForm.elements.firearm.checked = firearm;
    const material = byId("cast-material-notice");
    material.hidden = !tools.dataset.materialNotice;
    material.textContent = tools.dataset.materialNotice ? "Materials: " + tools.dataset.materialNotice : "";
    byId("cast-advantage-field").hidden = !proposal.advantage;
    byId("cast-advantage-condition").textContent = proposal.advantage || "";
    castForm.elements.situational.checked = false;
    const tracking = Boolean(focus && ["bless", "moonbeam"].includes(proposal.effect));
    byId("cast-target-field").hidden = !tracking;
    if (tracking) targetFields(byId("cast-targets"), state);
    else byId("cast-targets").replaceChildren();
    const field = byId("cast-slot-field");
    field.hidden = level === 0;
    const input = castForm.elements.slot;
    input.disabled = level === 0;
    const slotNotice = byId("cast-slot-notice");
    slotNotice.hidden = true;
    if (level !== 0) {
      const slots = ritualOnly ? [] : availableSlots(state, level);
      slotNotice.hidden = ritualOnly || slots.length > 0;
      input.replaceChildren(...slots.map((pool) => new Option(pool.name, pool.key)));
      if (ritual) input.add(new Option("Cast as a ritual", "ritual"));
      if (!ritualOnly) input.add(new Option("Use a free cast", "free"));
      if (!ritualOnly && (!slots.length || level === null)) {
        input.prepend(new Option("Choose how to cast…", "", true, true));
      }
    }
    castForm.elements.freePool.replaceChildren(new Option("No tracked resource", ""), ...encounterTracker.resources(state)
      .filter((pool) => !/^(Spell slot|Pact Magic slot):/.test(pool.key) && (state.progress?.used[pool.key] || 0) < pool.capacity)
      .map((pool) => new Option(pool.name, pool.key)));
    renderCost();
    castDialog.showModal();
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-cast-spell]");
    if (control) openCast(control);
  });
  castForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const proposal = directCast;
    const choice = castForm.elements.slot.value;
    if (proposal) {
      proposal.firearm = !byId("cast-firearm-field").hidden && castForm.elements.firearm.checked;
      proposal.advantageSelected = Boolean(proposal.advantage && castForm.elements.situational.checked);
      const method = proposal.level === 0 ? "cantrip" : ["free", "ritual"].includes(choice) ? choice : "slot";
      const pool = method === "slot" ? choice : method === "free" ? castForm.elements.freePool.value : "";
      proposal.targets = new FormData(castForm).getAll("target");
      if (proposal.targets.length > targetLimit(proposal, method, pool)) {
        byId("cast-target-feedback").textContent = "Too many targets for this slot.";
        return;
      }
      castDialog.close();
      finishCast(proposal, method, pool);
    }
  });
  byId("cancel-cast").addEventListener("click", () => castDialog.close());

  function renderReactions(state = previewEncounter.current()) {
    const reminders = byId("reaction-reminders");
    reminders.replaceChildren();
    reminders.hidden = !incoming.value;
    if (reminders.hidden) return;
    const eligible = reactionChoices.filter(({tools, cast}) => {
      const card = tools.closest("article");
      const level = Number(cast.dataset.castLevel);
      return tools.dataset.incomingEvents.split(" ").includes(incoming.value)
        && playbook.isPrepared(card.dataset.pin, state) && !actionEconomy.reason(state, "owner", "reaction")
        && (level === 0 || concentrationControls.availableSlots(state, level).length > 0);
    });
    for (const {tools, cast} of eligible) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = cast.getAttribute("aria-label");
      button.title = tools.dataset.reactionTrigger;
      button.onclick = () => openCast(cast, true);
      reminders.append(button);
    }
    if (!eligible.length) reminders.textContent = "No matching prepared reaction with an available slot.";
  }
  incoming.onchange = () => renderReactions();
  let editingFocus;
  manageTargets.onclick = () => {
    const state = previewEncounter.current();
    const active = state.focus.active;
    if (!active?.trackedSpell) return;
    editingFocus = active.id;
    const chosen = effectControls.entries(state).filter((effect) => effectControls.active(effect) && effect.linkedFocus === active.id).map((effect) => effect.target);
    targetFields(byId("ongoing-spell-targets"), state, chosen);
    byId("spell-target-feedback").textContent = active.trackedSpell.kind === "bless" ? "Choose up to " + active.trackedSpell.limit + " targets." : "";
    targetDialog.showModal();
  };
  byId("cancel-spell-targets").onclick = () => targetDialog.close();
  byId("spell-target-form").onsubmit = (event) => {
    event.preventDefault();
    const targets = new FormData(event.currentTarget).getAll("target");
    previewEncounter.transact((state) => {
      const active = state.focus.active;
      if (active?.id !== editingFocus || !active.trackedSpell || !effectControls.setSpellTargets(state, active, targets)) {
        byId("spell-target-feedback").textContent = "Review the target count and available participants.";
        return false;
      }
      targetDialog.close();
      return "updating " + active.name + " targets";
    });
  };
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
      if (hp.changed || focus.active) previewEncounter.log(state, "damage", `Took ${amount} damage${hp.current == null ? "" : ` · ${hp.current} HP left`}`);
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
    }, {label: "recording damage"});
    rules.value = previewEncounter.current().focus.rules;
    byId("damage-dialog").close();
  });
  byId("damage-dialog").addEventListener("close", () => {
    rules.value = previewEncounter.current().focus.rules;
    damage.elements.namedItem("damage").value = "";
    incoming.value = "";
    renderReactions();
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
      return "recording a concentration save";
    });
  });

  time.addEventListener("submit", (event) => {
    event.preventDefault();
    const elapsed = new FormData(time);
    const count = Number(elapsed.get("elapsed"));
    const rounds = elapsed.get("unit") === "rounds";
    const seconds = count * (rounds ? 6 : Number(elapsed.get("unit")));
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 0xffffffff) return;
    previewEncounter.transact((state) => {
      const focus = state.focus;
      if (focus.active?.remaining == null) return false;
      const updated = rounds ? effectControls.advanceRounds(state, count) : effectControls.advanceTime(state, seconds);
      if (updated.concentrationExpired) {
        status.textContent = "Concentration expired.";
      } else {
        status.textContent = "Concentration duration updated.";
      }
      return "advancing game time";
    });
  });

  function endConcentration() {
    previewEncounter.transact((state) => {
      if (!state.focus.active) return false;
      clear(state.focus);
      status.textContent = "Concentration ended.";
      return "ending concentration";
    });
  }
  byId("end-concentration").addEventListener("click", endConcentration);
  byId("effect-end-concentration").addEventListener("click", endConcentration);

  document.addEventListener("preview-encounter-change", render);
  render();
  return { availableSlots, cast };
})();
