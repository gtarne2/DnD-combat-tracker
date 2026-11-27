// R78: stat changes from active effects on this sheet's owner (Longstrider, Bless, Shield of
// Faith, a custom effect), shown on the stats they change. Equipped gear is already part of
// the imported numbers; these come on top of the imported value or the player's override.
const statEffects = (() => {
  const signed = (value) => (value >= 0 ? "+" : "") + value;
  const number = (text) => /^\s*[+-]?\d+\s*$/.test(text || "") ? Number(text) : null;

  function roll(text, bonus, die) {
    const value = number(text);
    if (value === null || !bonus && !die) return text;
    return signed(value + bonus) + (die ? " +1d" + die : "");
  }

  function speed(text, bonus) {
    if (!bonus || !text) return text;
    const walk = /(\d+)(\s*ft\.?\s*walk)/i;
    if (walk.test(text)) return text.replace(walk, (_, feet, rest) => Math.max(0, Number(feet) + bonus) + rest);
    return /\d+/.test(text) ? text.replace(/\d+/, (feet) => String(Math.max(0, Number(feet) + bonus))) : text;
  }

  function label(mods, keys) {
    const names = [...new Set(keys.flatMap((key) => mods.sources[key] || []))];
    return names.join(", ");
  }

  function show(node, base, value, why) {
    if (!node) return;
    node.textContent = value;
    const boosted = value !== base;
    node.classList.toggle("stat-boosted", boosted);
    node.title = boosted ? `${base} before ${why}` : "";
  }

  function note(card, text) {
    if (!card) return;
    let line = card.querySelector(".stat-boost-note");
    if (!text) { line?.remove(); return; }
    if (!line) {
      line = document.createElement("small");
      line.className = "stat-boost-note";
      card.querySelector(".stat-number")?.after(line);
    }
    line.textContent = text;
  }

  function render() {
    const state = previewEncounter.current();
    const mods = effectControls.modsFor(state);
    const base = (key) => layoutPreferences.sharedStat(key) || "";

    const speedNode = document.querySelector("#key-stats [data-stat=speed]");
    const speedWhy = label(mods, ["speed"]);
    show(speedNode, base("speed"), speed(base("speed"), mods.speed), speedWhy);
    note(speedNode?.closest(".stat-card"), mods.speed ? `${signed(mods.speed)} ft. · ${speedWhy}` : "");
    for (const fact of document.querySelectorAll("[data-sheet-fact]")) {
      if (fact.querySelector("dt")?.textContent !== "Movement") continue;
      const value = fact.querySelector("dd");
      value.dataset.imported ??= value.textContent;
      show(value, value.dataset.imported, speed(value.dataset.imported, mods.speed), speedWhy);
    }

    const acNode = document.querySelector("#key-stats [data-stat=ac]");
    const acWhy = label(mods, ["ac"]);
    show(acNode, base("ac"), roll(base("ac"), mods.ac, 0).replace(/^\+/, ""), acWhy);
    note(acNode?.closest(".stat-card"), mods.ac ? `${signed(mods.ac)} · ${acWhy}` : "");

    const saveWhy = label(mods, ["save", "saveDie"]);
    for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
      const imported = base(key);
      const value = roll(imported, mods.save, mods.saveDie);
      show(document.querySelector(`.ability-tile [data-stat="${key}"]`), imported, value, saveWhy);
      for (const node of document.querySelectorAll(`[data-glance-save="${key}"]`)) show(node, imported, value, saveWhy);
      const total = document.querySelector(`[data-roll-save="${key}"] summary > strong`);
      if (total) show(total, imported, value, saveWhy);
    }
  }

  /** A whole-number stat with effect bonuses, for what the sheet shares with the party. */
  function shared(state, key) {
    const value = number(layoutPreferences.sharedStat(key));
    if (value === null) return null;
    const mods = effectControls.modsFor(state);
    return value + (key === "ac" ? mods.ac : ["str", "dex", "con", "int", "wis", "cha"].includes(key) ? mods.save : 0);
  }

  document.addEventListener("preview-encounter-change", render);
  document.addEventListener("preview-stat-overrides", render);
  render();
  return {render, shared, speed, roll};
})();
