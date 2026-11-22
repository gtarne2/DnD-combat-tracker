const concentrationControls = (() => {
  const byId = (id) => document.getElementById(id);
  const activeLabel = byId("active-concentration");
  const duration = byId("concentration-duration");
  const actions = byId("concentration-actions");
  const time = byId("concentration-time");
  const damage = byId("concentration-damage");
  const rules = byId("concentration-rules");
  const save = byId("concentration-save");
  const prompt = byId("concentration-save-prompt");
  const last = byId("concentration-last");
  const status = byId("encounter-status");
  const dialog = byId("replace-concentration");
  let replacement = null;

  function formatRemaining(seconds) {
    if (seconds < 60 && seconds % 6 === 0) {
      return `${seconds / 6} round${seconds === 6 ? "" : "s"} remaining`;
    }
    const units = [[3600, "h"], [60, "min"], [1, "sec"]];
    const parts = [];
    for (const [size, unit] of units) {
      const amount = Math.floor(seconds / size);
      if (amount) parts.push(`${amount} ${unit}`);
      seconds %= size;
    }
    return `${parts.join(" ")} remaining`;
  }

  function render() {
    const focus = previewEncounter.current().focus;
    const active = focus.active;
    const current = focus.pending[0];
    activeLabel.textContent = active?.name || "None active";
    duration.textContent = !active ? "" : active.remaining === null
      ? active.label || "Duration unavailable"
      : formatRemaining(active.remaining);
    duration.hidden = !active;
    actions.hidden = !active;
    time.hidden = !active || active.remaining === null;
    save.hidden = !current;
    save.dataset.promptId = current?.id ?? "";
    const additional = focus.pending.length - 1;
    prompt.textContent = current ? `Constitution save DC ${current.dc} · ${current.damage} damage`
      + (additional > 0 ? ` · ${additional} more pending` : "") : "";
    rules.value = focus.rules;
    last.hidden = !focus.last;
    last.textContent = focus.last
      ? `Last save: ${focus.last.result === "success" ? "succeeded" : "failed"} against DC ${focus.last.dc}.`
      : "";
  }

  function clear(focus) {
    focus.active = null;
    focus.pending = [];
  }

  function start(state, spell) {
    if (spell.scrollKey !== null && consumableCards.spend(state, spell.scrollKey) === null) {
      status.textContent = "This scroll is unavailable.";
      return false;
    }
    const focus = state.focus;
    focus.sequence += 1;
    focus.active = { id: focus.sequence, name: spell.name, label: spell.label, remaining: spell.seconds };
    focus.pending = [];
    focus.last = null;
    status.textContent = `Concentrating on ${spell.name}.`;
    return true;
  }

  function cast(source, scrollKey = null) {
    const spell = {
      name: source.dataset.focusSpell,
      label: source.dataset.durationLabel,
      seconds: source.hasAttribute("data-duration-seconds") ? Number(source.dataset.durationSeconds) : null,
      scrollKey,
    };
    previewEncounter.transact((state) => {
      const active = state.focus.active;
      if (!active) return start(state, spell);
      if (dialog.open) return false;
      replacement = { spell, activeId: active.id };
      byId("replace-message").textContent = `End ${active.name} and concentrate on ${spell.name}?`
        + (scrollKey === null ? "" : " Replacing uses one scroll.");
      dialog.returnValue = "keep";
      dialog.showModal();
      return false;
    });
  }

  dialog.addEventListener("close", () => {
    const proposal = replacement;
    replacement = null;
    if (!proposal || dialog.returnValue !== "replace") return;
    previewEncounter.transact((state) => {
      if (state.focus.active?.id !== proposal.activeId) {
        status.textContent = "Active concentration changed. Choose the spell again.";
        return false;
      }
      return start(state, proposal.spell);
    });
  });

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-concentrate]");
    if (control) cast(control.closest("[data-focus-spell]"));
  });

  rules.addEventListener("change", () => {
    const value = rules.value;
    previewEncounter.transact((state) => {
      state.focus.rules = value;
      return true;
    });
  });

  damage.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(new FormData(damage).get("damage"));
    if (!Number.isInteger(amount) || amount < 0 || amount > 0xffffffff) return;
    damage.elements.namedItem("damage").value = "";
    previewEncounter.transact((state) => {
      const focus = state.focus;
      const hp = encounterTracker.damageOwner(state, amount);
      if (hp.dropped && focus.active) {
        clear(focus);
        status.textContent = "Concentration ended at 0 HP.";
        return true;
      }
      if (!focus.active || amount === 0) {
        status.textContent = "No concentration save required.";
        return hp.changed;
      }
      const dc = Math.max(10, Math.floor(amount / 2));
      focus.sequence += 1;
      focus.pending.push({
        id: focus.sequence, damage: amount, dc: focus.rules === "2024" ? Math.min(dc, 30) : dc,
      });
      status.textContent = "Constitution save required.";
      return true;
    });
  });

  save.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-result]");
    if (!button) return;
    const id = Number(save.dataset.promptId);
    const result = button.dataset.saveResult;
    previewEncounter.transact((state) => {
      const focus = state.focus;
      const current = focus.pending[0];
      if (!current || current.id !== id) return false;
      focus.pending.shift();
      focus.last = { dc: current.dc, result };
      if (result === "failure") clear(focus);
      status.textContent = result === "success" ? "Concentration maintained." : "Concentration ended.";
      return true;
    });
  });

  time.addEventListener("submit", (event) => {
    event.preventDefault();
    const elapsed = new FormData(time);
    const seconds = Number(elapsed.get("elapsed")) * Number(elapsed.get("unit"));
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return;
    previewEncounter.transact((state) => {
      const focus = state.focus;
      if (focus.active?.remaining == null) return false;
      focus.active.remaining = Math.max(0, focus.active.remaining - seconds);
      if (focus.active.remaining === 0) {
        clear(focus);
        status.textContent = "Concentration expired.";
      } else {
        status.textContent = "Concentration duration updated.";
      }
      return true;
    });
  });

  byId("end-concentration").addEventListener("click", () => {
    previewEncounter.transact((state) => {
      if (!state.focus.active) return false;
      clear(state.focus);
      status.textContent = "Concentration ended.";
      return true;
    });
  });

  document.addEventListener("preview-encounter-change", render);
  render();
  return { cast };
})();
