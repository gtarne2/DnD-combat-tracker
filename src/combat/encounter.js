const previewEncounter = (() => {
  const profile = document.body.dataset.profile;
  const key = profile && `aurora-combat-encounter-v1:${profile}`;
  const legacyKey = `aurora-combat-consumables-v1:${profile}`;
  const status = document.getElementById("encounter-status");
  const emptyFocus = () => ({ active: null, pending: [], last: null, sequence: 0, rules: "2014" });
  const emptyProgress = () => ({round: 1, current: null, hp: null, actors: [], sequence: 0, used: {}, resources: [], effects: []});
  const integer = (number) => Number.isSafeInteger(number) && number >= 0;
  let persisted = Boolean(key);
  const reconciliations = [];
  let state = { spent: {}, focus: emptyFocus(), companions: null, progress: null };
  let history = [];
  let writerReady = false;
  let delivery = {receipts: {}};

  function log(state, kind, label, source = "") {
    const progress = state.progress ||= emptyProgress();
    const activity = progress.activity ||= [];
    activity.push({id: ++progress.sequence, at: new Date().toISOString(),
      round: progress.active === false ? null : progress.round, kind, label, source});
  }

  function snapshot(value) {
    return {
      importedStacks: Object.fromEntries(Object.entries(value?.importedStacks || {})
        .filter(([, amount]) => amount === null || integer(amount) && amount <= 0xffffffff)),
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
    if (!persisted) return false;
    try {
      const saved = localStorage.getItem(key);
      const value = saved === null
        ? { spent: JSON.parse(localStorage.getItem(legacyKey)) }
        : JSON.parse(saved);
      state = snapshot(value);
      delivery = value?.partyDelivery || {receipts: {}};
      history = Array.isArray(value?.undo) ? value.undo.slice(-32).map((entry) => ({
        before: snapshot(entry?.before ?? entry),
        label: typeof entry?.label === "string" ? entry.label : "",
      })) : [];
      return true;
    } catch (error) {
      if (!(error instanceof SyntaxError)) persisted = false;
      return false;
    }
  }

  function refresh() {
    const focused = document.activeElement;
    const area = focused.closest("article, form, [data-followup-key], #combat-turn-order");
    document.dispatchEvent(new Event("preview-encounter-change"));
    if (focused === document.body || !focused.matches("button, input, select") || (document.activeElement !== focused && document.activeElement !== document.body)) return;
    if (focused.isConnected && !focused.matches(":disabled") && focused.getClientRects().length) return;
    const fallback = [...(area?.querySelectorAll("button:not(:disabled), input:not(:disabled), summary") || [])]
      .find((control) => control.getClientRects().length && !control.closest("[inert]"));
    (fallback || (focused.closest("#combat-turn-order") ? document.getElementById("manage-initiative")
      : document.querySelector("#option-search:not([hidden])")))?.focus({preventScroll: true});
  }

  function write(draft, previous, ledger = delivery) {
    const retained = previous.slice();
    while (persisted) {
      try {
        const undo = retained.map(({before, label}) => ({...before, label}));
        localStorage.setItem(key, JSON.stringify({...draft, partyDelivery: ledger, undo}));
        return retained;
      } catch (error) {
        if (error?.name === "QuotaExceededError" && retained.length) retained.shift();
        else return null;
      }
    }
    return null;
  }

  // A readwrite transaction on the same store admits one writer across tabs
  // when Web Locks are unavailable. Keep it open during brief party requests.
  let fallbackLock;
  function openWriter() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("aurora-encounter-writer", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("writer");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Encounter writer is unavailable."));
    });
  }

  async function singleWriter(run) {
    const db = await (fallbackLock ||= openWriter());
    return new Promise((resolve, reject) => {
      const tx = db.transaction("writer", "readwrite");
      const store = tx.objectStore("writer");
      let finished = false;
      let result;
      let failure;
      tx.oncomplete = () => failure ? reject(failure) : resolve(result);
      tx.onabort = () => reject(tx.error || new Error("Encounter writer was interrupted."));
      const hold = () => {
        store.get(key).onsuccess = () => { if (!finished) hold(); };
      };
      store.get(key).onsuccess = () => {
        hold();
        Promise.resolve().then(run).then(value => { result = value; }, error => { failure = error; })
          .finally(() => { finished = true; });
      };
    });
  }

  async function locked(run, durable = false) {
    const refreshAndRun = async (serialized) => {
      const loaded = read();
      if (durable && !loaded) throw new Error("Could not read browser storage. Try again.");
      writerReady = loaded && serialized;
      try { return await run(); }
      finally { writerReady = false; refresh(); }
    };
    if (key && navigator.locks) return navigator.locks.request(key, () => refreshAndRun(true));
    if (key && typeof indexedDB !== "undefined") {
      try { await (fallbackLock ||= openWriter()); }
      catch (error) { if (durable) throw error; return refreshAndRun(); }
      return singleWriter(() => refreshAndRun(true));
    }
    if (durable) throw new Error("Party delivery requires a browser that can enforce a single active writer.");
    return refreshAndRun();
  }

  function transact(update, options) {
    return locked(() => commit(update, options)).catch(() => {
      status.textContent = "Could not record the update. Try again.";
      return "failed";
    });
  }

  function commit(update, { undo = true, label = "", rebase = null, receipt = null, clock = null, boundary = false, windowReply = null } = {}) {
    const draft = structuredClone(state);
    const result = update(draft);
    if (!result && !receipt && !clock) return "unchanged";
    if (result) {
      for (const reconcile of reconciliations) reconcile(draft);
    }
    if (clock?.mechanical) partyInitiative.remember(state, draft);
    let ledger = partyActions.prepareDelivery(draft, delivery);
    const shared = ledger !== delivery;
    if (shared && !writerReady) throw new Error("Party actions require durable storage and a single writer.");
    if (clock) ledger = {...ledger, clocks: {...ledger.clocks, [clock.key]: clock.cursor}};
    if (receipt) ledger = {...ledger, receipts: {...ledger.receipts, [receipt]: true}};
    if (windowReply) ledger = {...ledger, windowReplies: {...ledger.windowReplies, [receipt]: windowReply}};
    const changed = Boolean(result) && JSON.stringify(draft) !== JSON.stringify(state);
    if (!changed && !receipt && !shared && !clock) return "unchanged";
    if (changed) {
      const previousEffects = new Map((state.progress?.effects || []).map((effect) => [effect.id, effect]));
      for (const effect of draft.progress?.effects || []) {
        const previous = previousEffects.get(effect.id);
        if (previous && effectControls.active(previous) && !effectControls.active(effect) && (!effect.ended || effect.endedByRest)) {
          log(draft, "expiration", `${effect.name} expired`, `effect:${effect.id}`);
        }
      }
    }
    let nextHistory = changed && undo
      ? [...history, {before: state, label: typeof result === "string" ? result : label}].slice(-32)
      : history;
    if (shared || clock || boundary) nextHistory = [];
    if (rebase && (changed || receipt)) {
      nextHistory = structuredClone(nextHistory);
      for (const entry of nextHistory) rebase(entry.before);
    }
    const nextState = changed ? draft : state;
    const retained = write(nextState, nextHistory, ledger);
    if (!retained && (receipt || shared || clock)) {
      status.textContent = "Could not save the party action. Try again.";
      return "failed";
    }
    state = nextState;
    history = retained || nextHistory;
    if (clock) status.textContent = "DM clock updated. Local Undo starts here.";
    else if (shared) status.textContent = "Party action saved. Local Undo starts here. Review recipients in Session → Party and correct costs in Resources or Turn actions.";
    delivery = ledger;
    if (!retained) persisted = false;
    return retained ? "durable" : "failed";
  }

  function undo() {
    return locked(() => {
      const entry = history.at(-1);
      if (!entry) return;
      const previous = structuredClone(entry.before);
      previous.importedStacks = state.importedStacks;
      // Keep IDs monotonic so a stale confirmation or save cannot target a later event.
      previous.focus.sequence = Math.max(previous.focus.sequence, state.focus.sequence);
      if (state.companions) {
        previous.companions ||= {cards: [], seen: [], sequence: 0, owner: null};
        previous.companions.sequence = Math.max(previous.companions.sequence, state.companions.sequence);
      }
      if (state.progress) {
        previous.progress ||= emptyProgress();
        previous.progress.sequence = Math.max(previous.progress.sequence, state.progress.sequence);
      }
      for (const reconcile of reconciliations) reconcile(previous);
      const ledger = partyActions.prepareDelivery(previous, delivery);
      if (ledger !== delivery && !writerReady) throw new Error("Party writer unavailable.");
      const remaining = ledger === delivery ? history.slice(0, -1) : [];
      const retained = write(previous, remaining, ledger);
      if (!retained && ledger !== delivery) throw new Error("Party action could not be saved.");
      state = previous;
      delivery = ledger;
      history = retained || remaining;
      if (!retained) persisted = false;
      status.textContent = entry.label ? "Combat update undone · " + entry.label + "." : "Combat update undone.";
      document.dispatchEvent(new Event("preview-encounter-undo"));
    }).catch(() => { status.textContent = "Could not undo the update. Try again."; });
  }

  window.addEventListener("storage", (event) => {
    if (persisted && [key, legacyKey, null].includes(event.key)) {
      read();
      refresh();
    }
  });
  read();
  return { transact, undo, log, emptyProgress, current: () => state, isPersisted: () => persisted,
    withWriter: locked,
    delivery: () => delivery,
    finishCommand: (id) => locked(() => {
      if (!delivery.outbox?.[id]) return;
      const next = {...delivery, outbox: {...delivery.outbox}};
      delete next.outbox[id];
      const retained = write(state, history, next);
      if (!retained) throw new Error("Could not save delivery status.");
      history = retained;
      delivery = next;
    }, true),
    applyClock: ({key, cursor, epoch, align, mechanical}, update) => locked(() => {
      if (epoch !== delivery.restoreEpoch) throw new Error("A backup was restored. Resume the party from the launcher.");
      const saved = delivery.clocks?.[key] || 0;
      if (saved > cursor || saved === cursor && (!align || state.progress?.partyClock?.key === key)) return;
      if (commit(update, {clock:{key,cursor,mechanical},undo:false}) !== "durable") throw new Error("Could not save the DM clock. Retrying.");
    }, true),
    restoreEpoch: () => delivery.restoreEpoch,
    received: (id) => Object.hasOwn(delivery.receipts, id),
    receive: (id, update, options) => commit(update, {...options, receipt: id}),
    finishWindowReply: (id, stale) => locked(() => {
      const reply = delivery.windowReplies?.[id];
      if (!reply) return;
      const next = {...delivery, windowReplies: {...delivery.windowReplies}};
      delete next.windowReplies[id];
      if (stale && reply.command.reply.reacted) {
        next.staleWindowReactions = {...next.staleWindowReactions, [id]: reply.room_id};
      }
      const retained = write(state, history, next);
      if (!retained) throw new Error("Could not save the reaction reply status.");
      history = retained;
      delivery = next;
    }, true),
    canUndo: () => history.length > 0, undoLabel: () => history.at(-1)?.label || "",
    reconcile: (callback) => reconciliations.push(callback) };
})();
