const combatTools = (() => {
  const byId = (id) => document.getElementById(id);
  const baseline = byId("encounter-baseline").dataset;
  const attackCount = Number(baseline.attacksPerAction) || 1;
  const hitManeuvers = [...document.querySelectorAll("#action-groups [data-hit-maneuver]")]
    .map((tools) => {
      const card = tools.closest("article");
      return {key: card.dataset.pin, name: card.querySelector(".option-title").textContent, timing: tools.dataset.turnCost};
    }).filter((entry, index, entries) => entries.findIndex((other) => other.key === entry.key) === index);
  const attackRiders = byId("attack-riders");
  const attackOutcome = byId("attack-outcome");
  const hit = byId("attack-hit");
  const miss = byId("attack-miss");
  const turn = (state) => state.progress?.turnSequence || 0;

  function ownerTurn(state) {
    return state.progress?.active !== false
      && (state.progress?.current || encounterTracker.turns(state)[0]?.key) === "owner";
  }

  function continuesAttack(state, timing) {
    const sequence = state.progress?.attackSequence;
    return timing === "action" && ownerTurn(state) && sequence?.turn === turn(state)
      && sequence.count < attackCount && !actionEconomy.override(state, "owner", "action");
  }

  function recordWeapon(state, timing) {
    const continued = continuesAttack(state, timing);
    if (!continued && !actionEconomy.spend(state, "owner", timing)) return false;
    if (timing !== "action" || !ownerTurn(state) || attackCount === 1) return true;
    const count = continued ? state.progress.attackSequence.count + 1 : 1;
    state.progress.attackSequence = {turn: turn(state), count};
    return "Attack " + count + " of " + attackCount;
  }

  function recordOutcome(outcome) {
    const id = previewEncounter.current().progress?.lastAttack?.sequence;
    encounterTracker.update((progress, state) => {
      const attack = progress.lastAttack;
      if (attack?.sequence !== id || attack?.turn !== turn(state) || attack.outcome) return false;
      attack.outcome = outcome;
      previewEncounter.log(state, "attack", attack.name + " · " + outcome, attack.source);
      return "recording a " + outcome;
    });
  }
  hit.onclick = () => recordOutcome("hit");
  miss.onclick = () => recordOutcome("miss");

  function recordRider(rider) {
    const id = previewEncounter.current().progress?.lastAttack?.sequence;
    encounterTracker.update((progress, state) => {
      const attack = progress.lastAttack;
      if (attack?.sequence !== id || attack?.turn !== turn(state) || attack.outcome !== "hit") return false;
      if (rider) {
        const use = playbook.featureUse(rider.key, state);
        if (!use?.pool || use.reason || attack.maneuver
          || !actionEconomy.spend(state, "owner", rider.timing)
          || !encounterTracker.spendResource(state, use.pool.key, use.cost)) return false;
        attack.maneuver = rider.name;
      } else {
        if (progress.sneakAttackTurn === turn(state)) return false;
        progress.sneakAttackTurn = turn(state);
        attack.sneak = baseline.sneakAttack;
      }
      const label = rider?.name || "Sneak Attack · " + baseline.sneakAttack;
      previewEncounter.log(state, "attack", attack.name + " · " + label, rider ? "option:" + rider.key : attack.source);
      return "recording " + label;
    });
  }

  function renderAttack() {
    const state = previewEncounter.current();
    const progress = state.progress;
    const sequence = progress?.attackSequence;
    const sequenceText = byId("attack-sequence");
    sequenceText.hidden = !sequence || sequence.turn !== turn(state) || !ownerTurn(state);
    sequenceText.textContent = sequenceText.hidden ? "" : "Attack " + sequence.count + " of " + attackCount + " · " + Math.max(0, attackCount - sequence.count) + " left";
    const attack = progress?.lastAttack;
    const active = attack?.turn === turn(state) && (attackCount > 1 || baseline.sneakAttack || hitManeuvers.length);
    attackOutcome.hidden = !active || Boolean(attack.outcome);
    attackRiders.hidden = !active || attack.outcome !== "hit";
    const reminder = byId("spell-turn-reminder");
    reminder.textContent = progress?.spellTurnReminder || "";
    reminder.hidden = !reminder.textContent;
    if (!active || attackRiders.hidden) {
      attackRiders.replaceChildren();
      return;
    }
    const nodes = [];
    const add = (label, title, disabled, invoke) => {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = label;
      control.title = title;
      control.disabled = disabled;
      control.onclick = invoke;
      nodes.push(control);
    };
    if (baseline.sneakAttack) {
      const used = progress.sneakAttackTurn === turn(state);
      add(used ? "Sneak Attack used" : "Add Sneak Attack · " + baseline.sneakAttack,
        "Record only if this hit meets your Sneak Attack requirements.", used, () => recordRider(null));
    }
    for (const rider of hitManeuvers) {
      const use = playbook.featureUse(rider.key, state);
      if (!use?.pool) continue;
      add(rider.name, use.reason || use.summary || "",
        Boolean(use.reason || attack.maneuver || actionEconomy.reason(state, "owner", rider.timing)), () => recordRider(rider));
    }
    attackRiders.replaceChildren(...nodes);
    attackRiders.hidden = !nodes.length;
  }

  function attuned(tools, state) {
    const key = tools.dataset.attunementKey;
    return !key || (state.progress?.attunedItems?.[key] ?? tools.hasAttribute("data-initially-attuned"));
  }

  function inventoryAttunement(item, source) {
    const key = source.dataset.attunementKey;
    if (!key) return;
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    const sync = () => { input.checked = attuned(source, previewEncounter.current()); };
    input.onchange = () => {
      const checked = input.checked;
      const name = item.querySelector("summary strong").textContent;
      encounterTracker.update((progress) => {
        progress.attunedItems ||= {};
        progress.attunedItems[key] = checked;
        return (checked ? "attuning " : "ending attunement to ") + name;
      });
    };
    label.append(input, " Attuned");
    label.title = source.dataset.attunementNote;
    item.append(label);
    document.addEventListener("preview-encounter-change", sync);
    sync();
  }

  const dawn = byId("dawn-dialog");
  byId("cancel-dawn").onclick = () => dawn.close();
  byId("dawn-form").onsubmit = (event) => {
    event.preventDefault();
    const seconds = event.currentTarget.elements.hours.valueAsNumber * 3600;
    if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86400) return;
    dawn.close();
    encounterTracker.update((progress, state) => {
      if (seconds && !progress.partyClock) effectControls.advanceTime(state, seconds);
      const changes = [];
      for (const pool of encounterTracker.resources(state, true).filter((entry) => entry.recovery === "dawn")) {
        const spent = Math.min(progress.used[pool.key] || 0, pool.capacity);
        if (!spent) continue;
        const rolled = pool.dawnDie ? Math.floor(Math.random() * pool.dawnDie) + 1 + pool.dawnBonus : spent;
        const restored = Math.min(spent, rolled);
        if (spent > restored) progress.used[pool.key] = spent - restored;
        else delete progress.used[pool.key];
        changes.push(pool.name + " recovered " + restored);
      }
      const label = ["Dawn", ...changes].join(" · ");
      previewEncounter.log(state, "resource", label);
      byId("encounter-status").textContent = label;
      return "recording dawn";
    });
  };

  const form = byId("spell-filter-form");
  const schools = new Set([...document.querySelectorAll("#action-groups [data-school]")].map((node) => node.dataset.school));
  for (const school of [...schools].sort()) form.elements.school.add(new Option(school, school));
  const filters = form.elements;
  const savedFilters = sessionView.get("spellFilters");
  for (const field of form.querySelectorAll("select")) field.value = savedFilters?.[field.name] || "";
  filters.spellsOnly.checked = savedFilters?.spellsOnly === "on";
  const filtering = () => filters.spellsOnly.checked || [...form.querySelectorAll("select")].some((input) => input.value);
  function filterSpells(card) {
    if (!filtering()) return true;
    const tools = card.querySelector(".option-execute");
    const cast = tools.querySelector("[data-cast-spell]");
    if (!cast) return false;
    const matches = (field, flag) => !field.value || (field.value === "yes") === flag;
    const state = previewEncounter.current();
    return (!filters.school.value || filters.school.value === tools.dataset.school)
      && (!filters.preparation.value || (filters.preparation.value === "ready") === playbook.isPrepared(card.dataset.pin, state))
      && matches(filters.materials, tools.hasAttribute("data-material-notice"))
      && matches(filters.ritual, cast.hasAttribute("data-ritual-cast"))
      && matches(filters.concentration, Boolean(card.querySelector("[data-focus-spell]:not([hidden])"))
        && !(card.querySelector("[data-focus-spell][data-guidance]") && state.progress?.guidanceWithoutConcentration));
  }

  function filtersChanged() {
    sessionView.set("spellFilters", Object.fromEntries(new FormData(form)));
    const control = document.querySelector('[data-dialog="spell-filters"]');
    control.textContent = filtering() ? "Spell filters · On" : "Spell filters";
    document.dispatchEvent(new Event("combat-options-change"));
  }
  form.onchange = filtersChanged;
  form.onsubmit = (event) => { event.preventDefault(); byId("spell-filters").close(); };
  byId("clear-spell-filters").onclick = () => {
    for (const field of form.querySelectorAll("select")) field.value = "";
    filters.spellsOnly.checked = false;
    filtersChanged();
  };
  document.addEventListener("preview-encounter-change", renderAttack);
  return {recordWeapon, continuesAttack, filtering, filterSpells, filtersChanged, inventoryAttunement, attuned, renderAttack};
})();
