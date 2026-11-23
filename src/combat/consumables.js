const consumableCards = (() => {
  const status = document.getElementById("consumable-status");
  const stacks = () => document.querySelectorAll("[data-consumable]");
  const initial = new Map([...stacks()].map((stack) => [
    stack.dataset.consumable,
    stack.hasAttribute("data-amount") ? Number(stack.dataset.amount) : null,
  ]));

  function remaining(state, key) {
    const amount = initial.get(key);
    return amount == null ? null : Math.max(0, amount - (state.spent[key] || 0));
  }

  function spend(state, key) {
    const available = remaining(state, key);
    if (!available) return null;
    state.spent[key] = (state.spent[key] || 0) + 1;
    return available - 1;
  }

  function render() {
    for (const stack of stacks()) {
      const amount = remaining(previewEncounter.current(), stack.dataset.consumable);
      stack.querySelector("[data-remaining]").textContent = amount ?? "Unavailable";
      stack.querySelector("[data-use]").disabled = amount == null || amount === 0;
    }
    for (const count of document.querySelectorAll("[data-stack-count]")) {
      const amount = remaining(previewEncounter.current(), count.dataset.stackCount);
      count.textContent = amount == null ? "Qty unknown" : amount + " left";
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-use]");
    if (!button || button.disabled) return;
    const key = button.closest("[data-consumable]").dataset.consumable;
    const name = button.dataset.use;
    const focus = button.closest("article").querySelector("[data-focus-spell]");
    if (focus) {
      concentrationControls.cast(focus, key);
      return;
    }
    previewEncounter.transact((state) => {
      const amount = spend(state, key);
      status.textContent = amount === null ? `No ${name} available.` : `Used ${name}. ${amount} remaining.`;
      return amount !== null;
    });
  });

  document.addEventListener("preview-encounter-change", render);
  render();
  return { spend };
})();
