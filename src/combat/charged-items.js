const chargedItems = (() => {
  const dialog = document.getElementById("bind-charge-pool");
  const form = document.getElementById("bind-charge-form");
  let binding;
  const keyFor = (state, item) => state.progress?.itemChargeBindings?.[item] || item;

  function availability(control, state) {
    const item = control.dataset.chargeKey;
    const key = keyFor(state, item);
    const pool = encounterTracker.resources(state).find((resource) => resource.key === key);
    const left = pool ? Math.max(0, pool.capacity - (state.progress?.used[key] || 0)) : 0;
    const cost = Number(control.dataset.chargeCost);
    return {key, left, cost, pool, uses: Math.floor(left / cost)};
  }

  function render(tools, state) {
    const control = tools.querySelector("[data-charge-key]");
    if (!control) return;
    const {left, cost, pool, uses} = availability(control, state);
    const requiresAttunement = !combatTools.attuned(tools, state);
    const reason = requiresAttunement ? tools.dataset.attunementNote : actionEconomy.reason(state, "owner", actionEconomy.timing(control));
    control.disabled = uses === 0 || Boolean(reason);
    control.title = reason;
    control.setAttribute("aria-label", "Activate " + control.dataset.chargeName);
    tools.querySelector("[data-charge-count]").textContent = pool
      ? `${cost} charge${cost === 1 ? "" : "s"} · ${uses} use${uses === 1 ? "" : "s"} left (${left}/${pool.capacity} charges)` : "Bind a resource pool to activate";
    return {uses, pool, requiresAttunement};
  }

  document.addEventListener("click", (event) => {
    const run = event.target.closest("[data-charge-key]");
    const bind = event.target.closest("[data-bind-charge]");
    if (run && !run.disabled) {
      encounterTracker.update((_, state) => {
        if (!combatTools.attuned(run.parentElement, state)) return false;
        const {key, cost} = availability(run, state);
        if (!actionEconomy.spend(state, "owner", actionEconomy.timing(run))) return false;
        if (!encounterTracker.spendResource(state, key, cost)) return false;
        const name = run.dataset.chargeName;
        previewEncounter.log(state, "item", `Activated ${name}`, run.closest("article, details")?.dataset.sheetEntry);
        document.getElementById("encounter-status").textContent = `Activated ${name} for ${cost} charge${cost === 1 ? "" : "s"}.`;
        return "activating " + name;
      });
    } else if (bind) {
      const control = bind.parentElement.querySelector("[data-charge-key]");
      const state = previewEncounter.current();
      binding = control.dataset.chargeKey;
      const select = form.elements.pool;
      select.replaceChildren(new Option("Imported item pool", "default"), ...encounterTracker.resources(state)
        .filter((pool) => pool.key !== binding).map((pool) => new Option(pool.name, pool.key)));
      select.value = keyFor(state, binding) === binding ? "default" : keyFor(state, binding);
      document.getElementById("bind-charge-heading").textContent = "Bind pool · " + control.dataset.chargeName;
      dialog.showModal();
    }
  });
  document.getElementById("cancel-bind-charge").onclick = () => dialog.close();
  form.onsubmit = (event) => {
    event.preventDefault();
    const item = binding;
    const pool = form.elements.pool.value;
    encounterTracker.update((progress) => {
      progress.itemChargeBindings ||= {};
      if (pool === "default") delete progress.itemChargeBindings[item];
      else progress.itemChargeBindings[item] = pool;
      return "binding a charge pool";
    });
    dialog.close();
  };
  document.addEventListener("preview-encounter-change", () => {
    for (const control of document.querySelectorAll("[data-charge-key]")) render(control.parentElement, previewEncounter.current());
  });
  return {render};
})();
