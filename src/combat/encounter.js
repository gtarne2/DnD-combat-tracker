const previewEncounter = (() => {
  const profile = document.body.dataset.profile;
  const key = profile && `aurora-combat-encounter-v1:${profile}`;
  const legacyKey = `aurora-combat-consumables-v1:${profile}`;
  const status = document.getElementById("encounter-status");
  const emptyFocus = () => ({ active: null, pending: [], last: null, sequence: 0, rules: "2014" });
  const integer = (number) => Number.isSafeInteger(number) && number >= 0;
  let persisted = Boolean(key);
  const reconciliations = [];
  let state = { spent: {}, focus: emptyFocus(), companions: null, progress: null };
  let history = [];

  function snapshot(value) {
    return {
      spent: Object.fromEntries(Object.entries(value?.spent || {})
        .filter(([, used]) => integer(used) && used > 0 && used <= 0xffffffff)),
      focus: focusFrom(value?.focus),
      companions: Array.isArray(value?.companions?.cards) && Array.isArray(value.companions.seen)
        && integer(value.companions.sequence) ? value.companions : null,
      progress: integer(value?.progress?.round) && value.progress.round > 0
        && integer(value.progress.sequence) && Array.isArray(value.progress.actors)
        && value.progress.used && Array.isArray(value.progress.resources) ? value.progress : null,
    };
  }

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
      state = snapshot(value);
      history = Array.isArray(value?.undo) ? value.undo.slice(-32).map(snapshot) : [];
    } catch (error) {
      if (!(error instanceof SyntaxError)) persisted = false;
    }
  }

  function refresh() {
    document.dispatchEvent(new Event("preview-encounter-change"));
  }

  function save() {
    while (persisted) {
      try {
        localStorage.setItem(key, JSON.stringify({ ...state, undo: history }));
        break;
      } catch (error) {
        if (error?.name === "QuotaExceededError" && history.length) history.shift();
        else persisted = false;
      }
    }
  }

  function locked(run) {
    const refreshAndRun = () => {
      read();
      run();
      refresh();
    };
    if (persisted && navigator.locks) {
      navigator.locks.request(key, refreshAndRun).catch(() => {
        status.textContent = "Could not record the update. Try again.";
      });
    } else {
      refreshAndRun();
    }
  }

  function transact(update, { undo = true } = {}) {
    locked(() => {
      const draft = structuredClone(state);
      if (!update(draft)) return;
      for (const reconcile of reconciliations) reconcile(draft);
      if (JSON.stringify(draft) === JSON.stringify(state)) return;
      if (undo) history = [...history, state].slice(-32);
      state = draft;
      save();
    });
  }

  function undo() {
    locked(() => {
      const previous = history.pop();
      if (!previous) return;
      // Keep IDs monotonic so a stale confirmation or save cannot target a later event.
      previous.focus.sequence = Math.max(previous.focus.sequence, state.focus.sequence);
      if (state.companions) {
        previous.companions ||= {cards: [], seen: [], sequence: 0, owner: null};
        previous.companions.sequence = Math.max(previous.companions.sequence, state.companions.sequence);
      }
      if (state.progress) {
        previous.progress ||= {round: 1, current: null, hp: null, actors: [], sequence: 0, used: {}, resources: []};
        previous.progress.sequence = Math.max(previous.progress.sequence, state.progress.sequence);
      }
      for (const reconcile of reconciliations) reconcile(previous);
      state = previous;
      save();
    });
  }

  window.addEventListener("storage", (event) => {
    if (persisted && [key, legacyKey, null].includes(event.key)) {
      read();
      refresh();
    }
  });
  read();
  return { transact, undo, current: () => state, isPersisted: () => persisted,
    canUndo: () => history.length > 0, reconcile: (callback) => reconciliations.push(callback) };
})();
