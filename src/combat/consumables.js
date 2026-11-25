const consumableCards = (() => {
  const status = document.getElementById("encounter-status");
  const stacks = () => document.querySelectorAll("[data-consumable]");
  const initial = new Map([...stacks()].map((stack) => [
    stack.dataset.consumable,
    stack.hasAttribute("data-amount") ? Number(stack.dataset.amount) : null,
  ]));
  const dialog = document.getElementById("reconcile-consumables");
  const form = dialog.querySelector("form");
  const button = document.getElementById("review-consumables");
  let reviewing = [];

  function differences(state) {
    return [...initial].filter(([key]) => pending(state, key));
  }

  function pending(state, key) {
    return initial.has(key) && Object.hasOwn(state.importedStacks, key)
      && state.importedStacks[key] !== initial.get(key) && state.spent[key] > 0;
  }

  function acceptUnchanged(state) {
    for (const [key, amount] of initial) {
      if (!Object.hasOwn(state.importedStacks, key) || !state.spent[key]) {
        state.importedStacks[key] = amount;
      }
    }
    return true;
  }

  function remaining(state, key) {
    const amount = initial.has(key) && Object.hasOwn(state.importedStacks, key)
      ? state.importedStacks[key] : initial.get(key);
    return amount == null ? null : Math.max(0, amount - (state.spent[key] || 0));
  }

  function spend(state, key) {
    if (pending(state, key)) return null;
    const available = remaining(state, key);
    if (!available) return null;
    state.spent[key] = (state.spent[key] || 0) + 1;
    return available - 1;
  }

  function render() {
    const current = previewEncounter.current();
    button.hidden = !differences(current).length;
    for (const stack of stacks()) {
      const amount = remaining(previewEncounter.current(), stack.dataset.consumable);
      stack.querySelector("[data-remaining]").textContent = amount ?? "Unavailable";
      stack.querySelector("[data-use]").disabled = amount == null || amount === 0 || pending(current, stack.dataset.consumable);
    }
    for (const count of document.querySelectorAll("[data-stack-count]")) {
      const amount = remaining(previewEncounter.current(), count.dataset.stackCount);
      count.textContent = amount == null ? "Qty unknown" : amount + " left";
    }
  }

  button.onclick = () => {
    const state = previewEncounter.current();
    reviewing = differences(state).map(([key, amount]) => ({key, amount, old: state.importedStacks[key], used: state.spent[key]}));
    const list = document.getElementById("consumable-changes");
    list.replaceChildren(...reviewing.map(({key, amount, old, used}, index) => {
      const row = document.createElement("label");
      const title = [...stacks()].find((stack) => stack.dataset.consumable === key)?.closest("article")?.querySelector(".option-title")?.textContent || key;
      row.textContent = `${title} · Previous import ${old ?? "unknown"} · New import ${amount ?? "unknown"} · Pending tracker use ${used}. Units already reflected in Aurora`;
      const field = document.createElement("input");
      Object.assign(field, {name: String(index), type: "number", min: "0", max: String(used), value: "0", required: true});
      row.append(field);
      return row;
    }));
    dialog.showModal();
  };
  document.getElementById("cancel-reconcile-consumables").onclick = () => dialog.close();
  form.onsubmit = (event) => {
    event.preventDefault();
    const rows = reviewing.map((row, index) => ({...row, credit: form.elements.namedItem(String(index)).valueAsNumber}));
    const rebase = (state) => {
      for (const {key, amount, credit} of rows) {
        state.importedStacks[key] = amount;
        const pending = (state.spent[key] || 0) - credit;
        if (pending > 0) state.spent[key] = pending;
        else delete state.spent[key];
      }
    };
    previewEncounter.transact((state) => {
      if (rows.some(({key, old, used}) => state.importedStacks[key] !== old || state.spent[key] !== used)) {
        status.textContent = "Tracker usage changed. Review the imported quantities again.";
        return false;
      }
      rebase(state);
      return true;
    }, {undo: false, rebase});
    dialog.close();
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-use]");
    if (!button || button.disabled) return;
    const key = button.closest("[data-consumable]").dataset.consumable;
    const name = button.dataset.use;
    const focus = button.closest("article").querySelector("[data-focus-spell]");
    if (focus && !focus.hidden) {
      concentrationControls.cast(focus, key, button);
      return;
    }
    previewEncounter.transact((state) => {
      if (!actionEconomy.spend(state, "owner", actionEconomy.timing(button))) return false;
      const amount = spend(state, key);
      status.textContent = amount === null ? `No ${name} available.` : `Used ${name}. ${amount} remaining.`;
      if (amount !== null) previewEncounter.log(state, "consumable", `Used ${name} · ${amount} remaining`, button.closest("article")?.dataset.sheetEntry);
      return amount !== null && "using " + name;
    });
  });

  document.addEventListener("preview-encounter-change", render);
  render();
  return { remaining, spend, pending, start: () => previewEncounter.transact(acceptUnchanged, {undo: false}) };
})();
