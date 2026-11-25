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
    return card?.turn === "owner" ? "owner" : actor;
  }

  function override(state, actor, kind) {
    return Boolean(kind && state.progress?.economyOverrides?.[actor]?.[kind]);
  }

  function reason(state, actor, kind) {
    if (!Object.hasOwn(names, kind) || state.progress?.active === false || !state.progress?.economyEnabled?.[actor] || override(state, actor, kind)) return "";
    const current = state.progress.current || encounterTracker.turns(state)[0]?.key;
    if (kind !== "reaction" && turnKey(state, actor) !== current) return `${names[kind]} is available on this participant's turn.`;
    return state.progress.economyUsed?.[actor]?.[kind] ? `${names[kind]} already used.` : "";
  }

  function spend(state, actor, kind) {
    if (!Object.hasOwn(names, kind) || state.progress?.active === false) return true;
    if (reason(state, actor, kind)) {
      document.getElementById("encounter-status").textContent = reason(state, actor, kind);
      return false;
    }
    const progress = state.progress;
    if (override(state, actor, kind)) {
      delete progress.economyOverrides[actor][kind];
      previewEncounter.log(state, "override", `Table override used · ${names[kind]}`);
    }
    if (progress?.economyEnabled?.[actor]) {
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
    const opener = document.getElementById("action-economy-open");
    const used = Object.keys(progress?.economyUsed?.owner || {}).length;
    opener.textContent = progress?.economyEnabled?.owner ? `Turn actions · ${used}/3 used` : "Turn actions";
    if (!dialog.open) return;
    const selected = select.value;
    const choices = [new Option(encounterTracker.ownerName, "owner"), ...(state.companions?.cards || []).filter(companionControls.available)
      .map((card) => new Option(card.name, `companion:${card.id}`))];
    select.replaceChildren(...choices);
    select.value = choices.some((entry) => entry.value === selected) ? selected : "owner";
    const actor = select.value;
    enabled.checked = Boolean(progress?.economyEnabled?.[actor]);
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

  function open(actor) {
    dialog.showModal();
    render();
    select.value = actor;
    render();
  }
  document.getElementById("action-economy-open").onclick = () => open("owner");
  select.onchange = render;
  enabled.onchange = () => {
    const actor = select.value;
    const checked = enabled.checked;
    encounterTracker.update((progress) => {
      progress.economyEnabled ||= {};
      if (checked) progress.economyEnabled[actor] = true;
      else {
        delete progress.economyEnabled[actor];
        if (progress.economyUsed) delete progress.economyUsed[actor];
        if (progress.economyOverrides) delete progress.economyOverrides[actor];
      }
      return "changing turn action tracking";
    });
  };
  document.addEventListener("preview-encounter-change", render);
  return {timing, override, reason, spend, reset, open, render};
})();
