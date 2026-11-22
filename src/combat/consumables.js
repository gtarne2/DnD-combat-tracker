(() => {
  const profile = document.body.dataset.profile;
  const storageKey = profile && `aurora-combat-consumables-v1:${profile}`;
  const status = document.getElementById("consumable-status");
  const stacks = () => document.querySelectorAll("[data-consumable]");
  const initial = new Map([...stacks()].map((stack) => [
    stack.dataset.consumable,
    stack.hasAttribute("data-amount") ? Number(stack.dataset.amount) : null,
  ]));
  let storedLocally = Boolean(storageKey);
  let spent = new Map();

  function readUses() {
    if (!storedLocally) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey)) || {};
      spent = new Map(Object.entries(saved).filter(([, used]) =>
        Number.isInteger(used) && used > 0 && used <= 0xffffffff,
      ));
    } catch (error) {
      if (!(error instanceof SyntaxError)) storedLocally = false;
    }
  }

  function saveUses() {
    if (!storedLocally) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(spent)));
    } catch {
      storedLocally = false;
    }
  }

  function remaining(key) {
    const amount = initial.get(key);
    return amount == null ? null : Math.max(0, amount - (spent.get(key) || 0));
  }

  function renderQuantities() {
    for (const stack of stacks()) {
      const amount = remaining(stack.dataset.consumable);
      stack.querySelector("[data-remaining]").textContent = amount ?? "Unavailable";
      stack.querySelector("[data-use]").disabled = amount == null || amount === 0;
    }
  }

  function useOne(key, name) {
    readUses();
    const available = remaining(key);
    if (available == null || available === 0) {
      renderQuantities();
      status.textContent = available === 0 ? `No ${name} remaining.` : `Quantity unavailable for ${name}.`;
      return;
    }
    spent.set(key, (spent.get(key) || 0) + 1);
    saveUses();
    renderQuantities();
    status.textContent = `Used ${name}. ${available - 1} remaining.`
      + (storedLocally ? "" : " Recorded in this tab.");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-use]");
    if (!button || button.disabled) return;
    const key = button.closest("[data-consumable]").dataset.consumable;
    const name = button.dataset.use;
    if (storedLocally && navigator.locks) {
      navigator.locks.request(storageKey, () => useOne(key, name)).catch(() => {
        status.textContent = `Could not record ${name}. Try again.`;
      });
    } else {
      useOne(key, name);
    }
  });

  window.addEventListener("storage", (event) => {
    if (storedLocally && (event.key === storageKey || event.key === null)) {
      readUses();
      renderQuantities();
    }
  });

  readUses();
  renderQuantities();
})();
