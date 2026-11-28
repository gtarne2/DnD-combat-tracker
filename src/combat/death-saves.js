// R89: death saving throws while the owner is at 0 HP. The HP card shows the marks and the
// controls. With the "Roll death saves for me" assist on, a Roll button rolls the d20; with it
// off, the player types the d20 they rolled at the table, or clicks Success or Failure.
// Any HP above 0 clears the saves. Damage at 0 HP adds a failure.
const deathSaves = (() => {
  const status = document.getElementById("encounter-status");
  const owner = document.getElementById("encounter-baseline").dataset.owner || "You";

  function hp(state) { return encounterTracker.hp(state); }
  function dying(state) { return hp(state)?.current === 0; }
  function current(state) {
    if (!dying(state)) return null;
    const saves = state.progress?.deathSaves;
    return {successes: saves?.successes || 0, failures: saves?.failures || 0,
      stable: saves?.stable === true, dead: saves?.dead === true};
  }
  function saves(state) {
    const progress = state.progress ||= previewEncounter.emptyProgress();
    return progress.deathSaves ||= {successes: 0, failures: 0};
  }
  function settle(saves) {
    saves.successes = Math.min(3, saves.successes);
    saves.failures = Math.min(3, saves.failures);
    if (saves.failures >= 3) saves.dead = true;
    else if (saves.successes >= 3) saves.stable = true;
    return saves.dead ? " · Dead" : saves.stable ? " · Stable" : "";
  }

  // result: a d20 number, "success" or "failure".
  function record(state, result) {
    const health = hp(state);
    if (health?.current !== 0) return false;
    const marks = saves(state);
    if (marks.stable || marks.dead) return false;
    if (result === 20) {
      state.progress.hp = {...health, current: 1, temporary: health.temporary || 0};
      delete state.progress.deathSaves;
      previewEncounter.log(state, "healing", `Death save · natural 20 · ${owner} is back up with 1 HP`);
      status.textContent = "Natural 20: back up with 1 HP.";
      return "a natural 20 death save";
    }
    let outcome;
    if (typeof result === "number") {
      if (result === 1) { marks.failures += 2; outcome = "natural 1 · two failures"; }
      else if (result >= 10) { marks.successes += 1; outcome = result + " · success"; }
      else { marks.failures += 1; outcome = result + " · failure"; }
    } else if (result === "success") { marks.successes += 1; outcome = "success"; }
    else { marks.failures += 1; outcome = "failure"; }
    const end = settle(marks);
    previewEncounter.log(state, "save", "Death save · " + outcome + end);
    status.textContent = "Death save: " + outcome + end + ".";
    return "a death save";
  }

  // Called by applyDamage before the damage lands, then after it, so we know where HP started.
  function damaged(state, before, through) {
    const health = hp(state);
    if (!before || through <= 0 || health?.current !== 0) return "";
    const max = health.max ?? before.max;
    if (before.current > 0) {
      // Dropping to 0: damage left over that equals the HP maximum kills outright.
      const left = through - before.current;
      if (max > 0 && left >= max) {
        Object.assign(saves(state), {failures: 3, dead: true});
        previewEncounter.log(state, "damage", `Instant death · ${left} damage left over at 0 HP`);
        return " Instant death: the damage left over is at least your HP maximum.";
      }
      return " Make death saves on your turns.";
    }
    const marks = saves(state);
    if (marks.dead) return "";
    delete marks.stable;
    if (max > 0 && through >= max) {
      Object.assign(marks, {failures: 3, dead: true});
      previewEncounter.log(state, "damage", "Instant death · damage at 0 HP reached the HP maximum");
      return " Instant death: damage at 0 HP reached your HP maximum.";
    }
    marks.failures += 1;
    const end = settle(marks);
    previewEncounter.log(state, "save", "Death save failure from damage at 0 HP" + end);
    return " Death save failure from damage at 0 HP" + end + ". A critical hit counts as two: press Failure again.";
  }

  function stabilize(state) {
    if (!dying(state)) return false;
    const marks = saves(state);
    if (marks.stable || marks.dead) return false;
    marks.stable = true;
    previewEncounter.log(state, "save", owner + " is stable at 0 HP");
    status.textContent = "Stable at 0 HP.";
    return "stabilizing";
  }

  previewEncounter.reconcile((draft) => {
    if (draft.progress?.deathSaves && !dying(draft)) delete draft.progress.deathSaves;
  });

  const dots = (count, kind) => [0, 1, 2].map((index) =>
    `<span class="death-dot${index < count ? " is-marked" : ""}" data-kind="${kind}"></span>`).join("");
  function render() {
    const state = previewEncounter.current();
    const marks = current(state);
    const assist = sheetSettings.get("rollDeathSaves");
    for (const box of document.querySelectorAll("[data-death-saves]")) {
      box.hidden = !marks;
      if (!marks) continue;
      box.dataset.state = marks.dead ? "dead" : marks.stable ? "stable" : "dying";
      box.querySelector("[data-death-marks=success]").innerHTML = dots(marks.successes, "success");
      box.querySelector("[data-death-marks=failure]").innerHTML = dots(marks.failures, "failure");
      box.querySelector("[data-death-marks=success]").setAttribute("aria-label", marks.successes + " of 3 successes");
      box.querySelector("[data-death-marks=failure]").setAttribute("aria-label", marks.failures + " of 3 failures");
      const open = !marks.dead && !marks.stable;
      box.querySelector(".death-save-actions").hidden = !open;
      box.querySelector("[data-death-save=stable]").hidden = !open;
      box.querySelector("[data-death-save-form]").hidden = !open || assist;
      box.querySelector("[data-death-save=roll]").hidden = !open || !assist;
      box.querySelector("[data-death-save-state]").textContent = marks.dead ? "Dead. Undo or set HP if that was a mistake."
        : marks.stable ? "Stable at 0 HP. Healing brings you back." : "";
    }
  }

  function act(update) {
    previewEncounter.transact((state) => update(state));
  }
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-death-saves] [data-death-save]");
    if (!control) return;
    const kind = control.dataset.deathSave;
    if (kind === "roll") {
      const roll = 1 + crypto.getRandomValues(new Uint32Array(1))[0] % 20;
      act((state) => record(state, roll));
    } else if (kind === "stable") act(stabilize);
    else act((state) => record(state, kind));
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest?.("[data-death-save-form]");
    if (!form) return;
    event.preventDefault();
    const field = form.querySelector("input");
    const roll = field.valueAsNumber;
    if (!Number.isInteger(roll) || roll < 1 || roll > 20) { status.textContent = "Type the d20 you rolled, 1 to 20."; return; }
    field.value = "";
    act((state) => record(state, roll));
  });
  document.addEventListener("preview-encounter-change", render);
  document.addEventListener("sheet-settings-change", render);
  render();
  return {current, damaged, record, stabilize};
})();
