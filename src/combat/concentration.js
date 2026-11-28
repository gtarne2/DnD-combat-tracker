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
    let placement = null, spellSend = null, castName = null;
    const done = previewEncounter.transact((state) => {
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
      const roll = result ? spellRoll(proposal, method, pool) : "";
      if (result) {
        const kind = {cantrip: "cantrip", ritual: "ritual", free: "free use", slot: "spell slot"}[method];
        const source = "option:" + proposal.key;
        const active = state.focus.active;
        if (proposal.focus && (["bless", "moonbeam"].includes(proposal.effect) || proposal.buff)) {
          const limit = targetLimit(proposal, method, pool);
          const mods = proposal.buff?.mods || (proposal.effect === "bless" ? {attackDie: 4, saveDie: 4} : null);
          const notes = proposal.effect === "bless" ? "+1d4 to attack rolls and saving throws."
            : proposal.effect === "moonbeam" ? ["At start of turn: Constitution save", proposal.dc ? "DC " + proposal.dc : "", roll || proposal.damage].filter(Boolean).join(" · ")
            : effectControls.describeMods(mods);
          active.trackedSpell = {kind: proposal.effect || "buff", limit, notes, source, ...(mods ? {mods} : {})};
          if (!effectControls.setSpellTargets(state, active, proposal.targets || [])) {
            status.textContent = "The target list changed. Open the spell again.";
            return false;
          }
        }
        // R79: a timed buff such as Longstrider goes on each chosen target with its stat changes.
        if (!proposal.focus && proposal.buff && proposal.targets?.length && !effectControls.applyBuff(state,
            {name: proposal.name, mods: proposal.buff.mods, seconds: proposal.buff.seconds, targets: proposal.targets, source})) {
          status.textContent = "The target list changed. Open the spell again.";
          return false;
        }
        if (proposal.healing && !partyActions.applyHp(state, proposal.recipients, proposal.amount, "healing", proposal.name)) {
          status.textContent = "Healing recipient unavailable. Open the spell again.";
          return false;
        }
        if (proposal.effect === "shield") effectControls.recordShield(state, proposal.name, source);
        if (proposal.summon && proposal.summonCreate) {
          const card = summonCard(proposal.summon, slotLevel(proposal, method, pool) || proposal.summon.level, proposal.summonForm);
          companionControls.conjure(state, card, proposal.focus ? state.focus.active?.id : null);
        }
        const situational = proposal.advantageSelected ? "Advantage · " + proposal.advantage : "";
        previewEncounter.log(state, "cast", ["Cast " + proposal.name, kind, roll, situational].filter(Boolean).join(" · "), source);
        castName = String(proposal.name).slice(0, 80);
      }
      if (result && proposal.map) {
        placement = {...proposal.map, id: crypto.randomUUID(), spell: proposal.name};
        // What the DM needs to resolve the area: the damage roll, its type and the save.
        // Only the dice expression, such as "2d8" or "8d6+3": the preview text also names the
        // damage type, which travels separately.
        const dice = String(roll || proposal.damage || "").match(/\d+d\d+(?:\s*[+-]\s*\d+(?:d\d+)?)*/i)?.[0].replace(/\s+/g, "");
        if (dice && dice.length <= 40) placement.damage = dice;
        if (proposal.damageType) placement.damage_type = proposal.damageType;
        if (/^#[0-9a-f]{6}$/i.test(proposal.colour || "")) placement.colour = proposal.colour;
        if (/^[a-z]{1,20}$/.test(proposal.look || "")) placement.look = proposal.look;
        const dc = Number(String(proposal.dc || "").match(/\d+/)?.[0]);
        const [ability, branch] = (proposal.spellSave || "").split(" ");
        if (ability && dc >= 1 && dc <= 40) placement.save = {ability, dc, on_success: branch === "half" ? "half" : "none"};
        if (placement.lasts === "concentration") placement.focus = state.focus.active?.id;
        if (placement.focus == null && placement.lasts === "concentration") placement.lasts = "removed";
      }
      // A save spell aimed from the sheet, without a map template (R76): the DM resolves
      // each target's save from the same queue as area spells.
      if (result && !proposal.map && proposal.saveTargets?.length) {
        const dice = String(roll || proposal.damage || "").match(/\d+d\d+(?:\s*[+-]\s*\d+(?:d\d+)?)*/i)?.[0].replace(/\s+/g, "");
        const amount = Number.isInteger(proposal.saveDamage) ? proposal.saveDamage : partyInitiative.templates.rollDice(dice);
        const dc = Number(String(proposal.dc || "").match(/\d+/)?.[0]);
        const [ability, branch] = (proposal.spellSave || "").split(" ");
        if (Number.isInteger(amount) && ability && dc >= 1 && dc <= 40) {
          spellSend = {id: crypto.randomUUID(), spell: proposal.name, amount: Math.min(100000, amount), targets: proposal.saveTargets,
            save: {ability, dc, on_success: branch === "half" ? "half" : "none"}};
          if (/^[a-z]{1,20}$/.test(proposal.damageType || "")) spellSend.damage_type = proposal.damageType;
        }
      }
      if (!proposal.focus) status.textContent = `Cast ${proposal.name}.`;
      if (proposal.advantageSelected) status.textContent += " Advantage on this attack.";
      if (proposal.firearm && (!proposal.focus || result)) status.textContent += " " + attackModifiers.firearmHint + ".";
      return result;
    });
    Promise.resolve(done).then(async () => {
      if (castName) partyInitiative.templates.logCast(castName).catch(() => {});
      if (spellSend) {
        try {
          await partyInitiative.templates.sendSpell(spellSend);
          status.textContent += " Sent " + spellSend.amount + " damage to the DM for saves.";
        } catch (error) {
          status.textContent += " The damage was not sent to the DM: " + error.message;
        }
      }
      if (!placement) return;
      try {
        await partyInitiative.templates.place(placement);
        status.textContent += " Template sent to Owlbear.";
      } catch (error) {
        status.textContent += " The template was not placed: " + error.message;
      }
    });
  }

  function availableSlots(state, level) {
    return encounterTracker.resources(state).filter((pool) => /^(Spell slot|Pact Magic slot):/.test(pool.key)
      && Number(pool.key.split(":")[1]) >= (level ?? 1)
      && (state.progress?.used[pool.key] || 0) < pool.capacity);
  }

  function spellName(row) {
    return (row.querySelector(".option-title") || row.querySelector("h3")).textContent.trim();
  }

  function interruptionReactions(state, question) {
    const trigger = {attack:"attack", magic_missile:"missile"}[question];
    if (!trigger || actionEconomy.reason(state, "owner", "reaction", true)) return [];
    return reactionChoices.flatMap(({tools, cast}) => {
      const row = tools.closest("article");
      const key = row?.dataset.pin;
      if (tools.dataset.spellEffect !== "shield" || !tools.dataset.incomingEvents.split(" ").includes(trigger)
          || !key || !playbook.isPrepared(key, state)) return [];
      const name = spellName(row);
      return availableSlots(state, Number(cast.dataset.castLevel)).map(pool =>
        ({key, name, pool:pool.key, label:name + " · " + pool.name}));
    });
  }

  function applyInterruptionReaction(state, question, key, pool) {
    const reaction = interruptionReactions(state, question).find(option => option.key === key && option.pool === pool);
    if (!reaction || !actionEconomy.spend(state, "owner", "reaction", true) || !encounterTracker.spendResource(state, pool)) return false;
    const source = "option:" + key;
    effectControls.recordShield(state, reaction.name, source);
    previewEncounter.log(state, "cast", "Cast " + reaction.name + " · spell slot", source);
    return true;
  }

  function spellRoll(proposal, method, pool) {
    return proposal.previews[slotLevel(proposal, method, pool) - 1] || "";
  }

  function slotLevel(proposal, method, pool) {
    return method === "slot" ? Number(pool.split(":")[1]) : proposal.level || 0;
  }
  function targetLimit(proposal, method, pool) {
    return proposal.effect === "moonbeam" ? Number.MAX_SAFE_INTEGER
      : proposal.targetCounts[slotLevel(proposal, method, pool) - 1] || (proposal.buff ? 1 : 0);
  }
  // Summon spells (R82): the overlay's creature numbers, worked out for the slot.
  function readSummon(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  const summonField = byId("cast-summon-field");
  function openSummon(proposal) {
    summonField.hidden = !proposal.summon;
    if (!proposal.summon) return;
    const select = castForm.elements.summonForm;
    select.replaceChildren(...proposal.summon.forms.map((form) => new Option(form, form)));
    byId("cast-summon-form-label").hidden = !proposal.summon.forms.length;
    castForm.elements.summon.checked = true;
    renderSummon();
  }
  function currentSlot() {
    const proposal = directCast;
    if (!proposal) return null;
    const choice = castForm.elements.slot.value;
    const method = proposal.level === 0 ? "cantrip" : ["free", "ritual"].includes(choice) ? choice : "slot";
    return method === "slot" && choice ? Number(choice.split(":")[1]) : proposal.level || proposal.summon?.level || 1;
  }
  function renderSummon() {
    const summon = directCast?.summon;
    if (!summon || summonField.hidden) return;
    const card = summonCard(summon, currentSlot(), castForm.elements.summonForm.value);
    byId("cast-summon-preview").textContent = [card.name, card.armor, "HP " + card.maxHp, card.speed].join(" · ");
  }
  castForm.elements.slot.addEventListener("change", renderSummon);
  castForm.elements.summonForm.addEventListener("change", renderSummon);
  function summonCard(summon, slot, form) {
    const level = Math.max(summon.level, Number(slot) || summon.level);
    const fits = (forms) => !forms?.length || forms.includes(form);
    const hpBase = summon.hp.form?.[form] ?? summon.hp.base;
    const hp = hpBase + summon.hp.per_level * (level - summon.level);
    const ac = summon.ac.base + level + (summon.ac.form?.[form] || 0);
    const attack = byId("spell-rolls")?.dataset.attack;
    const attacks = summon.attacks.filter((entry) => fits(entry.forms)).map((entry) =>
      [entry.name + ": " + [entry.kind, entry.reach].filter(Boolean).join(", "),
        attack ? attack + " to hit" : "your spell attack to hit",
        entry.dice ? entry.dice + " + " + (entry.bonus + level) + (entry.type ? " " + entry.type : "") : ""].filter(Boolean).join(" · "));
    if (summon.multiattack) attacks.unshift("Multiattack: " + Math.floor(level / 2) + (Math.floor(level / 2) === 1 ? " attack" : " attacks"));
    const scores = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
    const speed = [summon.speed, summon.form_speed?.[form]].filter(Boolean).join(", ");
    const features = summon.features.filter((name) => {
      const only = name.match(/\(([^()]*) only\)/i)?.[1];
      return !only || !form || only.split(/,\s*|\s+and\s+|\s+or\s+/i).some((part) => part.trim().toLowerCase() === form.toLowerCase());
    });
    return {name: summon.creature + (form ? " (" + form + ")" : ""), kind: [summon.size, summon.kind].filter(Boolean).join(" "),
      armor: "AC " + ac, maxHp: hp, currentHp: hp, temporary: 0, speed,
      stats: summon.abilities.length === 6 ? summon.abilities.map((score, i) => scores[i] + " " + score).join(" · ") : "",
      attacks: attacks.join("\n"), abilities: features.join("\n"), command: "Acts right after you on your turn.",
      duration: "1 hour", timerUnit: "seconds", remaining: 3600, initiative: null, turn: "owner", zeroHp: "vanish"};
  }
  /** Stat changes from the sheet's `data-spell-buff`, such as `speed=10,seconds=3600`. */
  function readBuff(text) {
    if (!text) return null;
    const values = Object.fromEntries(text.split(",").map((part) => part.split("=")).filter(([, value]) => /^-?\d+$/.test(value || ""))
      .map(([key, value]) => [key, Number(value)]));
    const mods = effectControls.cleanMods(values);
    return mods ? {mods, seconds: values.seconds > 0 ? values.seconds : null} : null;
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
    const preview = [spellRoll(directCast, kind, method), count ? "Up to " + count + (count === 1 ? " target" : " targets") : "", advantage].filter(Boolean).join(" · ");
    const roll = byId("cast-roll-preview");
    roll.hidden = !preview;
    roll.textContent = preview || "";
    const changes = directCast.buff ? effectControls.describeMods(directCast.buff.mods) + " · " : "";
    byId("cast-target-feedback").textContent = directCast.effect === "moonbeam"
      ? "Select creatures currently in the beam. Update the list as they move."
      : count ? changes + "Choose up to " + count + " target" + (count === 1 ? "." : "s.")
      : directCast.buff ? changes + "Choose one target." : "";
  }
  castForm.elements.slot.onchange = renderCost;
  castForm.elements.freePool.onchange = renderCost;
  castForm.elements.situational.onchange = renderCost;

  const SIZE_LABEL = {sphere: "Radius", cylinder: "Radius", emanation: "Radius", cone: "Length", line: "Length", cube: "Side"};
  function renderMap() {
    const form = castForm.elements;
    const shape = form.mapShape.value;
    castForm.querySelector(".cast-map-options").hidden = !form.mapPlace.checked;
    // A placed template sends its damage from the combat rail instead.
    byId("cast-save-field").hidden = !saveReady || (!byId("cast-map-field").hidden && form.mapPlace.checked);
    byId("cast-map-size-label").textContent = SIZE_LABEL[shape];
    byId("cast-map-width").hidden = shape !== "line";
    byId("cast-map-aim").hidden = !["cone", "line", "cube"].includes(shape);
    form.mapSize.required = form.mapPlace.checked;
    // A required size hidden in a closed section would block Confirm without saying why.
    if (form.mapPlace.checked && !form.mapSize.value) castForm.querySelector("#cast-map-field details").open = true;
  }
  castForm.addEventListener("invalid", (event) => {
    const fold = event.target.closest("details");
    if (fold) fold.open = true;
  }, true);
  castForm.elements.mapPlace.onchange = renderMap;
  castForm.elements.mapShape.onchange = renderMap;

  function openMap(tools, focus) {
    const field = byId("cast-map-field");
    const [shape, size, width] = (tools.dataset.spellArea || "").split(" ");
    // Only spells with an area (or a teleport's reach) offer a template.
    field.hidden = !partyInitiative.templates.available() || !shape;
    castForm.elements.mapPlace.checked = false;
    if (field.hidden) return;
    const form = castForm.elements;
    form.mapPlace.checked = Boolean(shape);
    form.mapShape.value = shape || "sphere";
    form.mapSize.value = size || "";
    form.mapWidth.value = width || "5";
    form.mapAim.replaceChildren(new Option("North (drag to aim)", ""),
      ...partyInitiative.templates.targets().map((row) => new Option(row.name, row.id)));
    const lasts = form.mapLasts;
    lasts.querySelector("[value=concentration]").disabled = !focus;
    lasts.value = focus ? "concentration" : "turn";
    byId("cast-map-note").textContent = "";
    renderMap();
  }

  function readMap() {
    const form = castForm.elements;
    if (byId("cast-map-field").hidden || !form.mapPlace.checked) return null;
    const shape = form.mapShape.value;
    const map = {shape, size: form.mapSize.valueAsNumber, lasts: form.mapLasts.value};
    if (shape === "line") map.width = form.mapWidth.valueAsNumber || 5;
    if (["cone", "line", "cube"].includes(shape) && form.mapAim.value) map.aim = form.mapAim.value;
    return map;
  }

  // Save spells with damage can go to the DM with targets picked here, map or not.
  let saveReady = false;
  function openSave(proposal) {
    const [ability, branch] = (proposal.spellSave || "").split(" ");
    const targets = partyInitiative.templates.available() ? partyInitiative.templates.targets() : [];
    saveReady = Boolean(ability && proposal.dc && proposal.damage && targets.length);
    byId("cast-save-field").hidden = !saveReady;
    castForm.elements.saveDamage.value = "";
    if (!saveReady) { byId("cast-save-targets").replaceChildren(); return; }
    byId("cast-save-rule").textContent = ability.charAt(0).toUpperCase() + ability.slice(1) + " save DC " + String(proposal.dc).match(/\d+/)?.[0]
      + (branch === "half" ? ", half damage on a success" : ", no damage on a success") + (proposal.damageType ? " · " + proposal.damageType : "");
    byId("cast-save-targets").replaceChildren(...targets.map(row => {
      const label = document.createElement("label");
      const box = Object.assign(document.createElement("input"), {type: "checkbox", name: "saveTarget", value: row.id});
      label.append(box, " " + row.name);
      return label;
    }));
  }

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
    const proposal = {name: focus?.name || spellName(row),
      focus, activeId: active?.id ?? null, key: row.dataset.pin, level, ritual, firearm, timing,
      previews: control.dataset.castPreviews?.split("|") || [], effect: tools.dataset.spellEffect,
      targetCounts: tools.dataset.targetCounts?.split(",").map(Number) || [],
      advantage: tools.dataset.conditionalAdvantage, dc: tools.dataset.saveDc, damage: tools.dataset.baseDamage,
      damageType: tools.dataset.damageType, spellSave: tools.dataset.spellSave, colour: tools.dataset.spellColour,
      look: tools.dataset.spellLook, buff: readBuff(tools.dataset.spellBuff), summon: readSummon(tools.dataset.spellSummon)};
    proposal.healing = tools.hasAttribute("data-healing-cast");
    const mapReady = partyInitiative.templates.available() && Boolean(tools.dataset.spellArea);
    const saveSpell = partyInitiative.templates.available() && Boolean(proposal.spellSave && proposal.dc && proposal.damage);
    if (level === 0 && !proposal.healing && !proposal.buff && !proposal.summon && !active && !ritualOnly && !proposal.advantage && !mapReady && !saveSpell) {
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
    byId("cast-healing-field").hidden = !proposal.healing;
    castForm.elements.healing.value = "";
    byId("cast-healing-targets").replaceChildren(...(proposal.healing ? [...partyActions.targets(state)] : []).map(([id, target]) => {
      const label = document.createElement("label");
      const box = document.createElement("input");
      Object.assign(box, {type: "checkbox", name: "healTarget", value: id});
      label.append(box, " " + target.name);
      return label;
    }));
    const tracking = Boolean(focus && ["bless", "moonbeam"].includes(proposal.effect) || proposal.buff);
    byId("cast-target-field").hidden = !tracking;
    // A buff defaults to the caster; the player ticks anyone else it lands on.
    if (tracking) targetFields(byId("cast-targets"), state, proposal.buff ? ["owner"] : []);
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
    openSave(proposal);
    openMap(tools, Boolean(focus));
    openSummon(proposal);
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
      proposal.recipients = new FormData(castForm).getAll("healTarget");
      proposal.amount = castForm.elements.healing.valueAsNumber;
      if (proposal.recipients.length && !Number.isSafeInteger(proposal.amount)) {
        castForm.elements.healing.setCustomValidity("Enter the rolled healing amount.");
        castForm.elements.healing.reportValidity();
        castForm.elements.healing.setCustomValidity("");
        return;
      }
      const limit = targetLimit(proposal, method, pool) || 1;
      if (proposal.recipients.length > limit) {
        const field = byId("cast-healing-targets").querySelector("input:checked");
        field.setCustomValidity("Choose up to " + limit + " healing targets.");
        field.reportValidity();
        field.setCustomValidity("");
        return;
      }
      proposal.map = readMap();
      if (proposal.map && !(proposal.map.size >= 1 && proposal.map.size <= 1000)) {
        castForm.elements.mapSize.reportValidity();
        return;
      }
      proposal.saveTargets = byId("cast-save-field").hidden ? [] : new FormData(castForm).getAll("saveTarget");
      proposal.saveDamage = castForm.elements.saveDamage.value === "" ? null : castForm.elements.saveDamage.valueAsNumber;
      proposal.targets = new FormData(castForm).getAll("target");
      proposal.summonCreate = Boolean(proposal.summon) && castForm.elements.summon.checked;
      proposal.summonForm = castForm.elements.summonForm.value || "";
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
    byId("spell-target-feedback").textContent = active.trackedSpell.kind !== "moonbeam" ? "Choose up to " + active.trackedSpell.limit + " targets." : "";
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

  function applyDamage(state, amount, ruleset = state.focus.rules) {
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
      return {changed: true, feedback: feedback + " Concentration ended."};
    }
    if (focus.active) {
      const dc = Math.max(10, Math.floor(amount / 2));
      focus.sequence += 1;
      focus.pending.push({
        id: focus.sequence, damage: amount, dc: focus.rules === "2024" ? Math.min(dc, 30) : dc,
      });
      return {changed: true, feedback};
    }
    return {changed: hp.changed || previousRules !== ruleset, feedback};
  }

  damage.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(new FormData(damage).get("damage"));
    if (!Number.isInteger(amount) || amount < 1 || amount > 0xffffffff) return;
    const ruleset = rules.value;
    damage.elements.namedItem("damage").value = "";
    previewEncounter.transact((state) => {
      const result = applyDamage(state, amount, ruleset);
      status.textContent = result.feedback;
      return result.changed;
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

  // A pop-up reminder when damage asks for a concentration save. The DC is worked out; the
  // player rolls at the table (or with their own dice) and records the result.
  const reminder = byId("concentration-reminder");
  const reminded = new Set();
  function remind(state) {
    const current = state.focus.pending[0];
    if (!current || !state.focus.active) {
      if (reminder.open) reminder.close();
      return;
    }
    reminder.dataset.promptId = current.id;
    byId("concentration-reminder-dc").textContent = `Constitution save DC ${current.dc}`;
    const more = state.focus.pending.length - 1;
    byId("concentration-reminder-detail").textContent = `You took ${current.damage} damage while concentrating on ${state.focus.active.name}.`
      + (more > 0 ? ` ${more} more check${more === 1 ? "" : "s"} after this one.` : "");
    const bonus = document.querySelector('[data-stat="con"]')?.textContent;
    byId("concentration-reminder-bonus").textContent = bonus && bonus !== "—" ? `Your Constitution save: ${bonus}` : "";
    if (!reminded.has(current.id) && !reminder.open && sheetSettings.get("concentrationReminder")) {
      reminded.add(current.id);
      reminder.show();
    }
  }
  reminder.querySelector("[data-reminder-later]").onclick = () => reminder.close();
  reminder.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-result]");
    if (button) recordSave(Number(reminder.dataset.promptId), button.dataset.saveResult);
  });
  document.addEventListener("preview-encounter-change", () => remind(previewEncounter.current()));

  save.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-result]");
    if (button) recordSave(Number(save.dataset.promptId), button.dataset.saveResult);
  });
  function recordSave(id, result) {
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
    if (reminder.open) reminder.close();
    remind(previewEncounter.current());
  }

  time.addEventListener("submit", (event) => {
    event.preventDefault();
    const elapsed = new FormData(time);
    const count = Number(elapsed.get("elapsed"));
    const rounds = elapsed.get("unit") === "rounds";
    const seconds = count * (rounds ? 6 : Number(elapsed.get("unit")));
    if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 0xffffffff) return;
    previewEncounter.transact((state) => {
      const focus = state.focus;
      if (state.progress?.partyClock) {status.textContent = "The DM controls game time."; return false;}
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
  return { availableSlots, cast, applyDamage, interruptionReactions, applyInterruptionReaction };
})();
