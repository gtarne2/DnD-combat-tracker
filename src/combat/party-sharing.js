function setupPartySharing(panel, request) {
  const choices = {
    party_name_only: "Party name only",
    vitals: "Vitals",
    character_details: "Character details",
  };
  const field = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Share with this DM";
  const select = document.createElement("select");
  select.setAttribute("aria-label", legend.textContent);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  for (const [value, label] of Object.entries(choices)) select.add(new Option(label, value));
  field.append(legend, select, status);
  field.hidden = true;
  panel.append(field);

  let room;
  let last;
  let timer;
  let sending = false;

  const integer = value => /^[+-]?\d+$/.test(String(value).trim()) && Math.abs(Number(value)) <= 0x7fffffff
    ? Number(value) : null;

  function publication(mode, state) {
    if (mode === "party_name_only") return {sharing: mode};
    const hp = encounterTracker.hp(state, layoutPreferences.sharedStat("hp"));
    const effects = effectControls.entries(state).filter(effect => effect.target === "owner" && effectControls.active(effect));
    const ac = integer(layoutPreferences.sharedStat("ac"));
    const unsigned = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : null;
    const vitals = {
      current_hp: unsigned(hp?.current),
      max_hp: unsigned(hp?.max),
      temporary_hp: hp ? unsigned(hp.temporary ?? 0) : null,
      effective_ac: ac === null ? null : integer(ac + (effects.some(effect => effect.shield) ? 5 : 0)),
      initiative: integer(state.progress?.partyClock ? partyInitiative.rows(state).find(row => row.key === "owner")?.score : state.companions?.owner),
      conditions: effects.filter(effect => effect.category === "condition").map(effect => effect.name),
      concentration: state.focus.active?.name ?? null,
    };
    if (mode === "vitals") return {sharing: mode, vitals};

    function numbers(selector, name, value) {
      return Object.fromEntries([...document.querySelectorAll(selector)].flatMap(row => {
        const total = integer(value(row));
        return total === null ? [] : [[name(row), total]];
      }));
    }
    const details = {
      ability_scores: numbers(".ability-score-list button", row => row.firstElementChild?.textContent,
        row => row.querySelector("b")?.textContent),
      saves: numbers("#roll-saves [data-roll-save]", row => row.dataset.rollName,
        row => layoutPreferences.sharedStat(row.dataset.rollSave)),
      skills: numbers("#roll-skills [data-roll-name]", row => row.dataset.rollName,
        row => row.querySelector("summary > strong")?.textContent),
      attacks: [], spells: [], features: [], inventory: [],
      resources: Object.fromEntries(encounterTracker.resources(state).map(pool =>
        [pool.name, Math.max(0, pool.capacity - (state.progress?.used[pool.key] || 0))])),
    };
    const seen = new Set();
    function add(category, id, name, body, overrides = {}) {
      if (!name || seen.has(category + ":" + id)) return;
      seen.add(category + ":" + id);
      const facts = [...body.querySelectorAll(":scope > .option-facts > div")].flatMap(fact => {
        const label = fact.querySelector("dt")?.textContent;
        const value = overrides[label] ?? fact.querySelector("dd")?.textContent;
        return label && value != null ? [label + " " + value] : [];
      });
      // Include only the rendered rules and allowlisted facts. The surrounding sheet also holds private data.
      if ("Quantity" in overrides && !facts.some(fact => fact.startsWith("Quantity "))) {
        facts.unshift("Quantity " + overrides.Quantity);
      }
      const rules = body.querySelector(".description")?.textContent.trim();
      details[category].push({name, rules: [...facts, rules].filter(Boolean).join("\n")});
    }
    for (const [index, row] of [...document.querySelectorAll("#action-groups .option-row")].entries()) {
      const body = row.querySelector(".option-body");
      const name = row.querySelector(".option-title")?.textContent.trim();
      if (!body || !name) continue;
      if (body.dataset.inventoryIndex !== undefined) {
        const used = consumableCards.remaining(state, row.querySelector("[data-consumable]")?.dataset.consumable);
        const quantity = used ?? body.dataset.inventoryQuantity ?? "Unknown";
        add("inventory", body.dataset.inventoryIndex, name, body, {Quantity: quantity});
      }
      const kind = body.querySelector("[data-kind]")?.dataset.kind;
      const id = row.dataset.pin || "row-" + index;
      if (kind === "Feature") add("features", id, name, body);
      if (kind === "Attack" || kind === "Spell") {
        const roll = attackModifiers.forOption(row, state);
        add(kind === "Attack" ? "attacks" : "spells", id, name, body,
          {"Attack roll": roll.attackRoll, Damage: roll.damageRoll});
      }
    }
    for (const row of document.querySelectorAll("#ability-imported-references > article")) {
      add("features", row.dataset.abilitySource.replace(/^option:/, ""), row.querySelector("h3").textContent, row);
    }
    const background = document.querySelector(".background-reference");
    if (background) {
      const title = background.querySelector("summary").cloneNode(true);
      title.querySelector("small")?.remove();
      details.features.push({name: title.textContent.trim(), rules: background.querySelector("p").textContent.trim()});
    }
    return {sharing: mode, vitals, details};
  }

  function readChoice(key) {
    try {
      const saved = localStorage.getItem(key);
      if (Object.hasOwn(choices, saved)) return saved;
    } catch {}
    return "party_name_only";
  }

  async function send() {
    if (!room?.session || sending) return;
    const target = room;
    try {
      const current = publication(readChoice(target.key), previewEncounter.current());
      if (JSON.stringify([target.session, current]) === last) return;
      sending = true;
      await previewEncounter.withWriter(async () => {
        if (room !== target) return;
        const mode = readChoice(target.key);
        const payload = publication(mode, previewEncounter.current());
        const signature = JSON.stringify([target.session, payload]);
        if (signature !== last) {
          await request("publish", payload);
          last = signature;
        }
        if (room === target && mode === readChoice(target.key)) status.textContent = "Sharing " + choices[mode] + ".";
      }, true);
    } catch (error) {
      status.textContent = "Sharing update pending. " + error.message;
    } finally {
      sending = false;
    }
  }

  function schedule() {
    if (!room?.session || sending || timer) return;
    timer = setTimeout(() => { timer = null; void send(); }, 100);
  }

  select.onchange = () => {
    if (!room) return;
    try {
      localStorage.setItem(room.key, select.value);
      status.textContent = "Updating sharing…";
      schedule();
    } catch {
      select.value = readChoice(room.key);
      status.textContent = "Could not save the sharing choice.";
    }
  };
  document.addEventListener("preview-encounter-change", schedule);
  document.addEventListener("preview-stat-overrides", schedule);
  window.addEventListener("storage", event => {
    if (room && event.key === room.key) select.value = readChoice(room.key);
    schedule();
  });
  return state => {
    const key = state?.dm_id && state.self_id && !state.ended
      ? JSON.stringify(["aurora-party-sharing", document.body.dataset.profile, state.room_id, state.self_id]) : null;
    if (key && (room?.key !== key || room?.session !== state.publication_session)) {
      room = {key, session: state.publication_session};
      select.value = readChoice(key);
    }
    if (!key) {
      if (state?.ended) { room = null; last = null; }
      else if (room?.session) room = {key: room.key};
    }
    field.hidden = !room;
    select.disabled = !room;
    if (room && !room.session) status.textContent = "Reconnect to send sharing updates.";
    schedule();
  };
}
