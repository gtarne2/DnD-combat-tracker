const attackModifiers = (() => {
  const imported = new Map([...document.querySelectorAll("[data-infusion][data-attack-scope]")]
    .map(({dataset}) => [dataset.infusion, {
      scope: dataset.attackScope, attack: Number(dataset.attackBonus), damage: Number(dataset.damageBonus),
    }]));
  const firearm = document.getElementById("arcane-firearm");
  const equipped = firearm.querySelector("input");
  const hasFirearm = document.getElementById("encounter-baseline").dataset.arcaneFirearm === "true";
  firearm.hidden = !hasFirearm;
  const firearmHint = "Arcane Firearm · +1d8 to one damage roll";
  const firearmEnabled = (state) => hasFirearm && state.progress?.arcaneFirearm === true;

  function targetOptions(scope) {
    const choices = [new Option("No extra bonus", "")];
    if (scope !== "weapon") choices.push(new Option("My spell attacks", "spell"));
    if (scope === "spell") return choices;
    if (!scope) choices.push(new Option("All my weapon attacks", "weapon"));
    const weapons = new Map();
    for (const tools of document.querySelectorAll("#all-options [data-attack-kind=weapon]")) {
      const row = tools.closest(".option-row[data-pin]");
      if (row) weapons.set("weapon:" + row.dataset.pin, row.querySelector(".option-title").textContent.trim());
    }
    for (const [key, name] of [...weapons].sort(([, a], [, b]) => a.localeCompare(b))) {
      choices.push(new Option(name, key));
    }
    return choices;
  }

  const signed = (amount) => (amount >= 0 ? "+" : "") + amount;

  function assignmentControl(id, name, state) {
    const bonus = imported.get(id);
    if (!bonus) return null;
    const label = document.createElement("label");
    label.className = "infusion-target";
    const select = document.createElement("select");
    select.append(...targetOptions(bonus.scope));
    const target = state.progress?.infusionTargets?.[id] || "";
    if (!Array.from(select.options).some(({value}) => value === target)) {
      select.append(new Option("Attack unavailable in this import", target));
    }
    select.value = target;
    select.setAttribute("aria-label", "Apply " + name + " to");
    select.dataset.infusionAssignment = id;
    const note = document.createElement("small");
    note.textContent = bonus.damage
      ? `${signed(bonus.attack)} to hit and ${signed(bonus.damage)} damage`
      : `${signed(bonus.attack)} to spell attacks`;
    select.title = "Use No extra bonus when this is on someone else or Aurora already included it.";
    label.append("Apply to my attacks", select, note);
    select.addEventListener("change", () => {
      const choice = select.value;
      encounterTracker.update((progress) => {
        progress.infusionTargets ||= {};
        if (choice) progress.infusionTargets[id] = choice;
        else delete progress.infusionTargets[id];
        return "assigning " + name;
      });
    });
    return label;
  }

  function forOption(card, state) {
    const data = card?.querySelector(".option-execute")?.dataset || {};
    const kind = data.attackKind;
    const hasAttack = /^[+-]?\d+(?=\s|$)/.test(data.baseAttack || "");
    const matches = (target) => Boolean(target && kind && (target === kind
      || (kind === "weapon" && card.dataset.pin && target === "weapon:" + card.dataset.pin)));
    let attack = 0;
    let damage = 0;
    for (const id of state.progress?.infusions || []) {
      const bonus = imported.get(id);
      if (bonus && matches(state.progress.infusionTargets?.[id])) {
        attack = Math.max(attack, bonus.attack);
        damage = Math.max(damage, bonus.damage);
      }
    }
    for (const ability of state.progress?.abilities || []) {
      if (ability.kind === "imbuement" && ability.active && matches(ability.attackTarget)) {
        attack += Number(ability.attackBonus) || 0;
        if (kind === "weapon") damage += Number(ability.damageBonus) || 0;
      }
    }
    if (!hasAttack) attack = 0;
    const baseDamage = data.baseDamage || "";
    const attackRoll = attack ? data.baseAttack.replace(/^[+-]?\d+/, (value) => signed(Number(value) + attack)) : data.baseAttack;
    const damageRoll = damage && baseDamage
      ? baseDamage.replace(/^(\d+d\d+)(?:\s*([+-])\s*(\d+))?(?=\s+[a-z]+(?:\s+damage)?$|$)/i, (_, dice, sign, amount) => {
        const total = damage + (sign === "-" ? -1 : 1) * Number(amount || 0);
        return dice + (total ? signed(total) : "");
      }) : baseDamage;
    const firearmActive = data.firearmEligible !== undefined && firearmEnabled(state);
    const adjustment = [attack ? signed(attack) + " to hit" : "", damage ? signed(damage) + " damage" : "",
      firearmActive ? firearmHint : ""].filter(Boolean).join(" · ");
    return {attackRoll, damageRoll, adjustment, firearmActive, flatDamage: damage};
  }

  function updateOption(card, state) {
    const label = card.querySelector("[data-roll-adjustment]");
    const {attackRoll, damageRoll, adjustment, firearmActive, flatDamage} = forOption(card, state);
    label.hidden = !adjustment;
    label.textContent = adjustment;
    const row = card.querySelector(".option-roll");
    if (row) {
      row.dataset.originalRoll ??= row.textContent;
      const roll = adjustment && attackRoll ? [attackRoll, damageRoll].filter(Boolean).join(" · ") : row.dataset.originalRoll;
      row.textContent = roll;
      const extra = firearmActive ? "+1d8 firearm" : flatDamage && damageRoll === card.querySelector(".option-execute").dataset.baseDamage
        ? signed(flatDamage) + " damage" : "";
      if (extra) {
        const chip = document.createElement("span");
        chip.className = "option-roll-extra";
        chip.textContent = (roll ? " · " : "") + extra;
        row.append(chip);
      }
      row.title = adjustment;
    }
    const attackFact = card.querySelector("dd[data-base-attack]");
    const damageFact = card.querySelector("dd[data-base-damage]");
    if (attackFact && attackRoll) attackFact.textContent = attackRoll;
    if (damageFact && damageRoll) damageFact.textContent = damageRoll;
  }

  equipped.addEventListener("change", () => {
    const checked = equipped.checked;
    encounterTracker.update((progress) => {
      progress.arcaneFirearm = checked;
      return checked ? "readying Arcane Firearm" : "putting away Arcane Firearm";
    });
  });
  document.addEventListener("preview-encounter-change", () => {
    equipped.checked = firearmEnabled(previewEncounter.current());
  });
  equipped.checked = firearmEnabled(previewEncounter.current());
  return {targetOptions, assignmentControl, forOption, updateOption, firearmEnabled, firearmHint};
})();
