const previewEncounter = (() => {
  const profile = document.body.dataset.profile;
  const key = profile && `aurora-combat-encounter-v1:${profile}`;
  const legacyKey = `aurora-combat-consumables-v1:${profile}`;
  const status = document.getElementById("encounter-status");
  const emptyFocus = () => ({ active: null, pending: [], last: null, sequence: 0, rules: "2014" });
  const integer = (number) => Number.isSafeInteger(number) && number >= 0;
  let persisted = Boolean(key);
  let state = { spent: {}, focus: emptyFocus() };

  function focusFrom(saved) {
    const focus = emptyFocus();
    if (!saved || typeof saved !== "object") return focus;
    if (saved.rules === "2024") focus.rules = "2024";
    if (integer(saved.sequence)) focus.sequence = saved.sequence;
    const active = saved.active;
    if (active && integer(active.id) && active.id <= focus.sequence && typeof active.name === "string"
        && typeof active.label === "string" && (active.remaining === null || integer(active.remaining))) {
      focus.active = active;
      if (Array.isArray(saved.pending)) {
        focus.pending = saved.pending.filter((hit) => hit && integer(hit.id)
          && hit.id <= focus.sequence && integer(hit.damage) && integer(hit.dc));
      }
    }
    if (saved.last && integer(saved.last.dc) && ["success", "failure"].includes(saved.last.result)) {
      focus.last = saved.last;
    }
    return focus;
  }

  function read() {
    if (!persisted) return;
    try {
      const saved = localStorage.getItem(key);
      const value = saved === null
        ? { spent: JSON.parse(localStorage.getItem(legacyKey)) }
        : JSON.parse(saved);
      state = {
        spent: Object.fromEntries(Object.entries(value?.spent || {})
          .filter(([, used]) => integer(used) && used > 0 && used <= 0xffffffff)),
        focus: focusFrom(value?.focus),
      };
    } catch (error) {
      if (!(error instanceof SyntaxError)) persisted = false;
    }
  }

  function refresh() {
    document.dispatchEvent(new Event("preview-encounter-change"));
  }

  function transact(update) {
    const run = () => {
      read();
      const draft = structuredClone(state);
      if (update(draft)) {
        state = draft;
        if (persisted) {
          try {
            localStorage.setItem(key, JSON.stringify(state));
          } catch {
            persisted = false;
          }
        }
      }
      refresh();
    };
    if (persisted && navigator.locks) {
      navigator.locks.request(key, run).catch(() => {
        status.textContent = "Could not record the update. Try again.";
      });
    } else {
      run();
    }
  }

  window.addEventListener("storage", (event) => {
    if (persisted && [key, legacyKey, null].includes(event.key)) {
      read();
      refresh();
    }
  });
  read();
  return { transact, current: () => state, isPersisted: () => persisted };
})();
