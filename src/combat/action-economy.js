const actionEconomy = (() => {
  const names = {action: "Action", "bonus-action": "Bonus Action", reaction: "Reaction"};
  const dialog = document.getElementById("action-economy");
  const select = document.getElementById("economy-participant");
  const enabled = document.getElementById("economy-enabled");
  const controls = document.getElementById("economy-controls");
  const timing = (control) => control.closest(".option-execute")?.dataset.turnCost;

  function turnKey(state, actor) {
    if (actor === "owner") return actor;
    const card = state.companions?.cards.find((card) => `companion:${card.id}` === actor);
    if (card && state.progress?.partyClock) return state.progress.partyClock.separate.includes(card.id) ? actor : "owner";
    return card?.turn === "owner" ? "owner" : actor;
  }

  // Settings decide: on in the DM's shared initiative, and in solo encounters only when the
  // player asks for it. A companion can still be switched off from its card.
  function tracking(state, actor) {
    if (!sheetSettings.get("trackActions")) return false;
    const chosen = state.progress?.economyEnabled?.[actor];
    if (actor !== "owner" && chosen === false) return false;
    return Boolean(state.progress?.partyClock) || sheetSettings.get("trackActionsSolo");
  }

  function override(state, actor, kind) {
    return Boolean(kind && state.progress?.economyOverrides?.[actor]?.[kind]);
  }

  function reason(state, actor, kind, force = false) {
    if (!Object.hasOwn(names, kind) || !force && (state.progress?.active === false || !tracking(state, actor)) || override(state, actor, kind)) return "";
    const current = state.progress?.current || encounterTracker.turns(state)[0]?.key;
    if (kind !== "reaction" && turnKey(state, actor) !== current) return `${names[kind]} is available on this participant's turn.`;
    return state.progress?.economyUsed?.[actor]?.[kind] ? `${names[kind]} already used.` : "";
  }

  function spend(state, actor, kind, force = false) {
    if (!Object.hasOwn(names, kind) || !force && state.progress?.active === false) return true;
    const unavailable = reason(state, actor, kind, force);
    if (unavailable) {
      document.getElementById("encounter-status").textContent = unavailable;
      return false;
    }
    const progress = force || tracking(state, actor) ? (state.progress ||= previewEncounter.emptyProgress()) : state.progress;
    if (override(state, actor, kind)) {
      delete progress.economyOverrides[actor][kind];
      previewEncounter.log(state, "override", `Table override used · ${names[kind]}`);
    }
    if (force || tracking(state, actor)) {
      progress.economyUsed ||= {};
      progress.economyUsed[actor] ||= {};
      progress.economyUsed[actor][kind] = true;
    }
    return true;
  }

  function reset(state, current) {
    const progress = state.progress;
    for (const entries of [progress.economyUsed, progress.economyOverrides]) {
      for (const actor of Object.keys(entries || {})) if (!current || turnKey(state, actor) === current) delete entries[actor];
    }
  }

  function render() {
    const state = previewEncounter.current();
    const progress = state.progress;
    renderChips(state);
    if (!dialog.open) return;
    const selected = select.value;
    const choices = [new Option(encounterTracker.ownerName, "owner"), ...(state.companions?.cards || []).filter(companionControls.available)
      .map((card) => new Option(card.name, `companion:${card.id}`))];
    select.replaceChildren(...choices);
    select.value = choices.some((entry) => entry.value === selected) ? selected : "owner";
    const actor = select.value;
    enabled.checked = tracking(state, actor);
    controls.hidden = !enabled.checked;
    const focus = document.activeElement.dataset.economyControl;
    controls.replaceChildren(...Object.entries(names).map(([kind, label]) => {
      const row = document.createElement("p");
      const blocked = reason(state, actor, kind);
      row.className = "focus-form";
      const armed = override(state, actor, kind);
      const current = document.createElement("strong");
      current.textContent = `${label} · ${armed ? "Override ready" : blocked || "Available"}`;
      const record = document.createElement("button");
      record.textContent = "Record " + label;
      record.dataset.economyControl = `record:${kind}`;
      record.disabled = Boolean(blocked) || progress?.active === false;
      record.onclick = () => encounterTracker.update((_, draft) => {
        if (!spend(draft, actor, kind)) return false;
        previewEncounter.log(draft, "action", `Recorded ${label} · ${select.selectedOptions[0].textContent}`);
        return "recording " + label.toLowerCase();
      });
      const allow = document.createElement("button");
      allow.textContent = (armed ? "Cancel override for " : "Override ") + label;
      allow.dataset.economyControl = `override:${kind}`;
      allow.onclick = () => encounterTracker.update((current) => {
        current.economyOverrides ||= {};
        const overrides = current.economyOverrides[actor] ||= {};
        if (overrides[kind]) delete overrides[kind];
        else overrides[kind] = true;
        return "changing a table override";
      });
      row.append(current, record, allow);
      return row;
    }));
    if (focus) ([...controls.querySelectorAll("button:not(:disabled)")].find((button) => button.dataset.economyControl === focus) || enabled).focus();
  }

  // Quick view on the combat rail: one chip per action. Clicking a spent one is a table
  // override that makes it ready again; clicking a ready one records it.
  function renderChips(state) {
    const host = document.getElementById("economy-chips");
    if (!host) return;
    const progress = state.progress;
    // A gold outline and flag on Combat options while it is this character's turn.
    const myTurn = Boolean(progress && progress.active !== false && progress.current && turnKey(state, progress.current) === "owner");
    document.getElementById("combat")?.classList.toggle("is-my-turn", myTurn);
    const flag = document.getElementById("turn-flag");
    if (flag) flag.hidden = !myTurn;
    host.hidden = !tracking(state, "owner") || progress?.active === false;
    if (host.hidden) return;
    const focus = document.activeElement?.dataset?.economyChip;
    host.replaceChildren(...Object.entries(names).map(([kind, label]) => {
      const used = Boolean(progress?.economyUsed?.owner?.[kind]);
      const waiting = !used && kind !== "reaction" && !myTurn;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "economy-chip";
      chip.dataset.economyChip = kind;
      chip.dataset.state = used ? "spent" : waiting ? "waiting" : "ready";
      chip.setAttribute("aria-pressed", String(used));
      chip.textContent = label;
      chip.setAttribute("aria-label", label + (used ? " used" : waiting ? " available on your turn" : " ready"));
      chip.title = used ? `${label} used. Click to mark it ready again (table override)` : waiting ? `${label} is available on your turn` : `${label} ready. Click to record it`;
      chip.disabled = waiting;
      chip.onclick = () => encounterTracker.update((_, draft) => {
        if (used) {
          delete draft.progress.economyUsed.owner[kind];
          previewEncounter.log(draft, "override", `Table override · ${label} ready again`);
          return "changing a table override";
        }
        if (!spend(draft, "owner", kind)) return false;
        previewEncounter.log(draft, "action", `Recorded ${label} · ${encounterTracker.ownerName}`);
        return "recording " + label.toLowerCase();
      });
      return chip;
    }));
    if (focus) host.querySelector(`[data-economy-chip="${focus}"]`)?.focus();
  }

  function open(actor) {
    dialog.showModal();
    render();
    select.value = actor;
    render();
  }
  select.onchange = render;
  enabled.onchange = () => {
    const actor = select.value;
    const checked = enabled.checked;
    encounterTracker.update((progress) => {
      progress.economyEnabled ||= {};
      progress.economyEnabled[actor] = checked;
      if (!checked) {
        if (progress.economyUsed) delete progress.economyUsed[actor];
        if (progress.economyOverrides) delete progress.economyOverrides[actor];
      }
      return "changing turn action tracking";
    });
  };
  document.addEventListener("preview-encounter-change", render);
  document.addEventListener("sheet-settings-change", render);
  return {turnKey, timing, override, reason, spend, reset, open, render, tracking};
})();
