const playbook = (() => {
  const byId = (id) => document.getElementById(id);
  const editor = byId("ability-editor");
  const form = byId("ability-form");
  const rest = byId("rest-dialog");
  const list = byId("ability-list");
  const status = byId("playbook-status");
  const followupList = byId("bonus-followup-list");
  const protector = byId("protector-dialog");
  const protectorForm = byId("protector-form");
  const protectorFeedback = byId("protector-feedback");
  const linkSearch = byId("ability-link-search");
  const referenceDialog = byId("ability-reference");
  const moxieOutcome = byId("moxie-outcome");
  const moxieKey = "Resource:moxie";
  const cannonRolls = byId("cannon-rolls")?.dataset;
  let pendingProtector;
  const knownInfusions = [...document.querySelectorAll("[data-infusion]")]
    .map((node) => [node.dataset.infusion, node.textContent])
    .sort(([, a], [, b]) => a.localeCompare(b));
  const infusionKeys = new Set(knownInfusions.map(([id]) => `option:Feature:${id}`));
  byId("known-infusion-panel").hidden = knownInfusions.length === 0;
  const abilities = (state) => state.progress?.abilities || [];
  const resets = (recovery, kind) => recovery === "short" || (recovery === "long" && kind === "long");
  const spells = new Map();
  const importedSources = new Map();
  const moxieFeatures = new Map();
  for (const row of document.querySelectorAll("#action-groups [data-pin]")) {
    const body = row.querySelector(".option-body");
    const prepared = body.dataset.prepared;
    const name = row.querySelector(".option-title").textContent;
    if (prepared !== undefined) {
      const level = row.querySelector(".spell-level")?.textContent;
      spells.set(row.dataset.pin, { name, level, prepared: prepared === "true" });
    }
    const key = `option:${row.dataset.pin}`;
    if (body.dataset.moxieAction) moxieFeatures.set(row.dataset.pin, {name, action: body.dataset.moxieAction, cost: Number(body.dataset.moxieCost || 0)});
    const category = body.dataset.inventoryIndex !== undefined ? "Item" : body.querySelector("[data-kind]").dataset.kind;
    if (category !== "Attack") addImportedSource(key, name, category, body);
  }
  for (const source of byId("ability-imported-references").children) {
    addImportedSource(source.dataset.abilitySource, source.querySelector("h3").textContent, "Feature", source);
  }

  function addImportedSource(key, name, category, body) {
    if (importedSources.has(key)) return;
    const facts = [...body.querySelectorAll(".option-facts > div")];
    const reference = facts.find((fact) => fact.querySelector("dt").textContent === "Source")?.querySelector("dd").textContent;
    importedSources.set(key, {name, category: infusionKeys.has(key) ? "Infusion" : category,
      reference, facts, description: body.querySelector(".description")});
  }
  let editing;
  let pendingRest;
  let lastSignature;
  let openReference;

  function make(tag, text) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, callback) {
    const node = make("button", label);
    node.type = "button";
    node.addEventListener("click", callback);
    return node;
  }
  function isPrepared(key, state = previewEncounter.current()) {
    return state.progress?.prepared?.[key] ?? spells.get(key)?.prepared ?? true;
  }
  function pools(state) {
    return encounterTracker.resources(state);
  }
  function updateAbility(id, operation) {
    encounterTracker.update((progress, state) => {
      const ability = progress.abilities?.find((entry) => entry.id === id);
      return ability ? operation(ability, progress, state) : false;
    });
  }
  function useFeedback(message) {
    byId("encounter-status").textContent = message;
  }
  function activate(id) {
    updateAbility(id, (ability, _progress, state) => {
      if (ability.kind !== "use" && ability.active) {
        ability.active = false;
        useFeedback(ability.name + " deactivated.");
        return "deactivating " + ability.name;
      }
      if (ability.pool && !encounterTracker.spendResource(state, ability.pool, ability.cost)) {
        const pool = pools(state).find((entry) => entry.key === ability.pool);
        useFeedback("Not enough " + (pool?.name || "resource uses") + " to use " + ability.name + ".");
        return false;
      }
      ability.uses = (ability.uses || 0) + 1;
      ability.active = ability.kind !== "use";
      useFeedback(ability.name + (ability.active ? " activated." : " used."));
      return "using " + ability.name;
    });
  }

  function featureUse(key, state) {
    if (!key) return null;
    const ability = abilities(state).find((entry) => entry.source === key);
    const resourceKey = ability ? ability.pool : key;
    const pool = pools(state).find((entry) => entry.key === resourceKey);
    const moxie = !ability && moxieFeatures.get(key);
    if (!ability && !pool && !moxie) return null;
    if (moxie) {
      const shared = pools(state).find((entry) => entry.key === moxieKey);
      const remaining = shared && Math.max(0, shared.capacity - (state.progress?.used[moxieKey] || 0));
      const spent = state.progress?.used[key] || 0;
      const label = !shared ? "Set up Moxie" : moxie.action === "spend" ? `Spend ${moxie.cost} Moxie`
        : moxie.action === "refill" ? "Record reaction and refill Moxie" : "Record trick";
      const reason = pool && spent >= pool.capacity ? `${pool.name} has no uses left.`
        : shared && remaining < moxie.cost ? `Requires ${moxie.cost} Moxie (${remaining} left).` : "";
      const limits = pool ? `${Math.max(0, pool.capacity - spent)} / ${pool.capacity} uses · ` : "";
      return {moxie, pool, setup: !shared, label, reason, summary: shared ? `${limits}${remaining} / ${shared.capacity} Moxie` : "Set your Moxie maximum to track this feature."};
    }
    const label = ability?.kind === "use" ? "Use feature" : ability?.active ? "Deactivate" : "Activate";
    const remaining = pool ? Math.max(0, pool.capacity - (state.progress?.used[resourceKey] || 0)) : 0;
    const cost = ability?.cost ?? 1;
    const reason = !ability?.active && resourceKey && remaining < cost
      ? pool ? "Requires " + cost + " from " + pool.name + " (" + remaining + " left)." : "The linked resource is unavailable."
      : "";
    return {ability, pool, label, reason, summary: pool ? remaining + " / " + pool.capacity + " " + pool.name : ""};
  }

  function activateFeature(key) {
    const use = featureUse(key, previewEncounter.current());
    if (!use || use.reason) return;
    if (use.ability) {
      activate(use.ability.id);
      return;
    }
    if (use.moxie) {
      if (use.setup) {
        byId("configure-moxie").click();
      } else if (use.moxie.action === "failed-save") {
        moxieOutcome.dataset.feature = key;
        byId("moxie-outcome-heading").textContent = use.moxie.name;
        moxieOutcome.showModal();
      } else {
        recordMoxieFeature(key);
      }
      return;
    }
    previewEncounter.transact((state) => {
      const current = featureUse(key, state);
      if (!current || current.ability || !encounterTracker.spendResource(state, key)) {
        useFeedback(current?.reason || "The feature changed. Choose it again.");
        return false;
      }
      useFeedback(current.pool.name + " used.");
      return "using " + current.pool.name;
    });
  }

  function recordMoxieFeature(key, failed = false) {
    previewEncounter.transact((state) => {
      const use = featureUse(key, state);
      if (!use?.moxie || use.setup || use.reason) {
        useFeedback(use?.reason || "The feature changed. Choose it again.");
        return false;
      }
      const {action, cost, name} = use.moxie;
      // Availability for both pools was checked against the same draft.
      if (use.pool) encounterTracker.spendResource(state, use.pool.key);
      if (action === "spend") encounterTracker.spendResource(state, moxieKey, cost);
      if (action === "refill") encounterTracker.restoreResource(state, moxieKey, Infinity);
      if (action === "failed-save" && failed) encounterTracker.restoreResource(state, moxieKey);
      useFeedback(name + " recorded.");
      return "using " + name;
    });
  }
  moxieOutcome.querySelector("form").addEventListener("submit", (event) => {
    const result = event.submitter?.value;
    if (result === "failed" || result === "used") recordMoxieFeature(moxieOutcome.dataset.feature, result === "failed");
  });

  function linkKey(ability) {
    return ability.link ?? (ability.source ? `option:${ability.source}` : "");
  }

  function linkedSources(state) {
    const sources = new Map(importedSources);
    const display = effectControls.view(state);
    for (const effect of effectControls.entries(state)) {
      const category = effectControls.active(effect) ? "Active effect" : "Ended effect";
      sources.set(`effect:${effect.id}`, {name: effect.name, category,
        target: display.names.get(effect.target), duration: display.remaining(effect), notes: effect.notes});
    }
    return sources;
  }

  function filterLinks(value = form.elements.link.value) {
    const query = linkSearch.value.trim().toLowerCase();
    const sources = linkedSources(previewEncounter.current());
    const options = [...sources].filter(([key, source]) => key === value ||
      `${source.name} ${source.category} ${source.reference || ""}`.toLowerCase().includes(query))
      .sort(([, a], [, b]) => a.name.localeCompare(b.name))
      .map(([key, source]) => new Option(`${source.name} · ${source.category}`, key));
    if (value && !sources.has(value)) options.push(new Option("Unavailable linked source", value));
    form.elements.link.replaceChildren(new Option("No linked source", ""), ...options);
    form.elements.link.value = value;
  }

  function openAbility(values = {}) {
    editing = values;
    const options = pools(previewEncounter.current()).map((pool) => new Option(pool.name, pool.key));
    if (values.pool && !options.some((option) => option.value === values.pool)) {
      options.push(new Option("Unavailable resource", values.pool));
    }
    form.elements.pool.replaceChildren(new Option("No shared resource", ""), ...options);
    for (const field of ["name", "kind", "pool", "cost", "reset", "followup", "notes", "category", "reference", "summary", "description"]) {
      form.elements[field].value = values[field] ?? ({kind: "use", cost: 1}[field] || "");
    }
    linkSearch.value = "";
    filterLinks(linkKey(values));
    byId("remove-ability").hidden = !values.id;
    editor.showModal();
  }
  byId("add-ability").addEventListener("click", () => openAbility());
  linkSearch.addEventListener("input", () => filterLinks());
  byId("cancel-ability").addEventListener("click", () => editor.close());
  byId("remove-ability").addEventListener("click", () => {
    const id = editing.id;
    updateAbility(id, (ability, progress) => {
      progress.abilities = progress.abilities.filter((entry) => entry.id !== id);
      return "removing " + ability.name;
    });
    editor.close();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = Object.fromEntries([...data].map(([key, value]) => [key, value.trim()]));
    if (!values.name) return;
    values.cost = Number(values.cost);
    const source = editing;
    encounterTracker.update((progress) => {
      progress.abilities ||= [];
      const saved = progress.abilities.find((entry) => entry.id === source.id);
      if (saved) {
        if (values.kind === "use") saved.active = false;
        Object.assign(saved, values);
      } else {
        if (source.id != null) return false;
        progress.abilities.push({...values, source: source.source, id: ++progress.sequence, active: false, uses: 0});
      }
      return (saved ? "editing " : "tracking ") + values.name;
    });
    editor.close();
  });
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-track-feature]");
    if (!control) return;
    const body = control.closest(".option-body");
    const source = body.dataset.feature;
    const current = abilities(previewEncounter.current()).find((entry) => entry.source === source);
    const article = control.closest("article");
    const name = (article.querySelector(".option-title") || article.querySelector("h3")).textContent.trim();
    const pool = pools(previewEncounter.current()).find((pool) => pool.key === source);
    openAbility(current || {source, name, pool: pool?.key, reset: pool?.recovery});
  });

  function followups(state) {
    const actions = [];
    const active = state.focus.active;
    if (active?.repeatBonus === "heat-metal" || active?.name === "Heat Metal") {
      actions.push({key: `heat:${active.id}`, name: "Heat Metal · repeat damage",
        notes: "Repeat the spell’s damage while concentrating."});
    }
    for (const card of state.companions?.cards || []) {
      if (card.rounds === 0 || !/^Eldritch Cannon\b/i.test(card.name) &&
        !card.templateId?.includes("ELDRITCH_CANNON")) continue;
      const variant = /(?:force[ _-]+ballista|flamethrower|protector)$/i
        .exec(card.templateId || card.name)?.[0].toLowerCase().replace(/[ _-]+/g, " ");
      const detail = card.attacks || card.abilities;
      const roll = variant === "force ballista" ? `Spell attack ${cannonRolls?.attack ?? "unavailable"}`
        : variant === "flamethrower" ? `Save DC ${cannonRolls?.dc ?? "unavailable"}` : "";
      const dice = detail?.match(/\b\d+d\d+\b/i)?.[0];
      actions.push({key: `cannon:${card.id}`, name: card.name, notes: card.command,
        companion: card.id, variant, detail, roll: [roll, dice].filter(Boolean).join(" · ")});
    }
    for (const ability of abilities(state)) {
      if (ability.active && ability.followup) actions.push({
        key: `ability:${ability.id}`, name: ability.followup, notes: ability.notes,
      });
    }
    return actions;
  }
  function recordFollowup(action, recipients = [], amount = 0) {
    encounterTracker.update((progress, state) => {
      const turn = progress.turnSequence || 0;
      if (progress.followupUses?.[action.key] === turn || !followups(state).some((row) => row.key === action.key)) {
        if (protector.open) protectorFeedback.textContent = "This cannon is no longer available for activation.";
        return false;
      }
      const targets = protectorTargets(state);
      if (recipients.some(id => !targets.has(id))) {
        protectorFeedback.textContent = "A selected recipient is unavailable. Reopen Protector to refresh the list.";
        return false;
      }
      for (const id of recipients) {
        const { hp } = targets.get(id);
        const temporary = Math.max(hp.temporary || 0, amount);
        if (id === "owner") progress.hp = {...hp, temporary};
        else hp.temporary = temporary;
      }
      progress.followupUses = {...progress.followupUses, [action.key]: turn};
      useFeedback(action.name + " used as a bonus action.");
      if (action.variant === "protector" && protector.open) protector.close();
      return "using " + action.name;
    });
  }

  function protectorTargets(state) {
    const targets = new Map();
    const ownerHp = encounterTracker.hp(state);
    if (ownerHp) targets.set("owner", {name: encounterTracker.ownerName, hp: ownerHp});
    for (const card of state.companions?.cards || []) {
      if (card.currentHp != null && card.rounds !== 0) targets.set(String(card.id), {name: card.name, hp: card});
    }
    return targets;
  }

  function activateFollowup(action) {
    if (action.variant !== "protector") {
      recordFollowup(action);
      return;
    }
    if (protector.open) return;
    pendingProtector = action;
    protectorForm.reset();
    protectorFeedback.textContent = "";
    byId("protector-description").textContent = action.detail || "";
    const targets = byId("protector-targets");
    targets.querySelectorAll("label, p").forEach(node => node.remove());
    for (const [id, {name, hp}] of protectorTargets(previewEncounter.current())) {
      const label = make("label");
      const checkbox = make("input");
      Object.assign(checkbox, {type: "checkbox", name: "recipient", value: id});
      label.append(checkbox, ` ${name} · ${hp.temporary || 0} temp HP`);
      targets.append(label);
    }
    if (!targets.querySelector("input")) targets.append(make("p", "Set current HP to make a recipient available."));
    protector.showModal();
  }

  protectorForm.addEventListener("submit", event => {
    event.preventDefault();
    if (event.submitter?.value === "record") {
      recordFollowup(pendingProtector);
      return;
    }
    const recipients = new FormData(protectorForm).getAll("recipient");
    if (!recipients.length) {
      protectorFeedback.textContent = "Choose at least one recipient.";
      return;
    }
    recordFollowup(pendingProtector, recipients, protectorForm.elements.amount.valueAsNumber);
  });

  function followupUsed(action, state) {
    return state.progress?.followupUses?.[action.key] === (state.progress?.turnSequence || 0);
  }

  function followupButton(action, state, label = "Use bonus action", usedLabel = "Used this turn") {
    const used = followupUsed(action, state);
    const control = button(used ? usedLabel : label, () => activateFollowup(action));
    control.dataset.followupKey = action.key;
    control.disabled = used;
    if (used) control.title = "Used this turn";
    return control;
  }

  function abilityDetails(ability, source) {
    const content = make("div");
    content.className = "tracked-details";
    const facts = make("dl");
    facts.className = "option-facts";
    const fact = (label, value) => {
      if (!value) return;
      const row = make("div");
      row.append(make("dt", label), make("dd", value));
      facts.append(row);
    };
    fact("Reference", ability.reference);
    if (source) {
      fact(source.category, source.name);
      fact("Applies to", source.target);
      fact("Duration", source.duration);
      for (const row of source.facts || []) facts.append(row.cloneNode(true));
    } else if (linkKey(ability)) {
      fact("Linked source", "Unavailable");
    }
    if (facts.childElementCount) content.append(facts);
    for (const text of [ability.description, ability.notes, source?.notes].filter(Boolean)) {
      const paragraph = make("p", text);
      paragraph.className = "companion-text";
      content.append(paragraph);
    }
    if (source?.description) content.append(source.description.cloneNode(true));
    if (!content.childElementCount) content.append(make("p", "No description available."));
    return content;
  }

  function renderReference(ability, source) {
    byId("ability-reference-heading").textContent = ability.name;
    byId("ability-reference-content").replaceChildren(abilityDetails(ability, source));
  }

  function render() {
    const state = previewEncounter.current();
    const actions = followups(state);
    const sources = linkedSources(state);
    const tracked = abilities(state);
    const linkedEffects = tracked.map((ability) => linkKey(ability)).filter((key) => key.startsWith("effect:"))
      .map((key) => sources.get(key));
    const signature = JSON.stringify([abilities(state), pools(state), state.progress?.used,
      actions, state.progress?.turnSequence, state.progress?.followupUses, state.progress?.infusions, linkedEffects]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const openCards = new Map([...byId("playbook").querySelectorAll("details[data-view-disclosure]")]
      .map((details) => [details.dataset.viewDisclosure, details.open]));
    function restoreCard(details, key) {
      details.dataset.viewDisclosure = key;
      if (openCards.has(key)) details.open = openCards.get(key);
      else sessionView.restoreDisclosure(details);
    }
    list.replaceChildren();
    if (!tracked.length) list.append(make("p", "Track a trait, effect, or imbuement."));
    const activeInfusions = state.progress?.infusions || [];
    byId("known-infusion-heading").textContent = `Artificer infusions · ${knownInfusions.filter(([id]) => activeInfusions.includes(id)).length} active`;
    const infusionList = byId("known-infusion-list");
    infusionList.replaceChildren();
    for (const [id, name] of knownInfusions) {
      const active = activeInfusions.includes(id);
      const row = make("div");
      const toggle = button(active ? "Deactivate" : "Activate", () => {
        encounterTracker.update((progress) => {
          const selected = new Set(progress.infusions || []);
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          progress.infusions = [...selected];
          return true;
        });
      });
      toggle.setAttribute("aria-label", `${toggle.textContent} ${name}`);
      const details = make("details");
      details.append(make("summary", name), abilityDetails({}, sources.get(`option:Feature:${id}`)));
      restoreCard(details, `infusion:${id}`);
      row.append(details, toggle);
      infusionList.append(row);
    }
    for (const ability of tracked) {
      const row = make("article");
      const source = sources.get(linkKey(ability));
      const pool = pools(state).find((entry) => entry.key === ability.pool);
      const available = pool && Math.max(0, pool.capacity - (state.progress?.used[pool.key] || 0));
      const category = ability.category || source?.category || (ability.kind === "imbuement" ? "Imbuement" : "");
      const summary = [category || ability.reference,
        ability.kind === "use" ? "" : ability.active ? "Active" : "Inactive",
        ability.kind === "imbuement" ? "" : `${ability.uses || 0} used`,
        pool ? `${available} / ${pool.capacity} ${pool.name}` : ""];
      const details = make("details");
      const title = make("summary");
      title.append(make("strong", ability.name), make("small", summary.filter(Boolean).join(" · ")));
      if (ability.summary) title.append(make("span", ability.summary));
      const content = abilityDetails(ability, source);
      const controls = make("div");
      controls.className = "companion-card-actions";
      controls.append(button("Edit", () => openAbility(ability)));
      if (content.textContent.length > 650 || content.querySelector("table")) {
        controls.prepend(button("Open full details", () => {
          openReference = ability.id;
          renderReference(ability, source);
          referenceDialog.showModal();
        }));
      }
      details.append(title, content, controls);
      restoreCard(details, `tracked-ability:${ability.id}`);
      const label = ability.kind === "use" ? "Record use" : ability.active ? "Deactivate" : "Activate";
      const use = button(label, () => activate(ability.id));
      use.disabled = !ability.active && Boolean(ability.pool) && (!pool || available < ability.cost);
      const useControls = make("div");
      useControls.className = "companion-card-actions";
      useControls.append(use);
      row.append(details, useControls);
      list.append(row);
    }
    if (referenceDialog.open) {
      const ability = tracked.find((entry) => entry.id === openReference);
      if (ability) renderReference(ability, sources.get(linkKey(ability)));
      else referenceDialog.close();
    }
    followupList.replaceChildren();
    for (const action of actions) {
      const row = make("article");
      const text = make("div");
      text.append(action.companion ? button(action.name, () => companionControls.showCard(action.companion)) : make("strong", action.name));
      if (action.notes) text.append(make("p", action.notes));
      row.append(text, followupButton(action, state));
      followupList.append(row);
    }
    document.dispatchEvent(new Event("followups-changed"));
  }

  function checklist(container, entries) {
    container.replaceChildren();
    if (!entries.length) container.append(make("p", "None available."));
    for (const [key, name, checked] of entries) {
      const label = make("label");
      const box = make("input");
      box.type = "checkbox";
      box.value = key;
      box.checked = checked;
      label.append(box, document.createTextNode(` ${name}`));
      container.append(label);
    }
  }
  function openRest(kind) {
    pendingRest = kind;
    const state = previewEncounter.current();
    byId("rest-heading").textContent = kind === "long" ? "Long rest" : "Short rest";
    const recovering = pools(state).filter((pool) => resets(pool.recovery, kind)).map((pool) => pool.name);
    byId("rest-summary").textContent = recovering.length ? `Restores: ${recovering.join(", ")}.` : "No resources are set to recover on this rest.";
    byId("long-rest-choices").hidden = kind !== "long";
    const hp = encounterTracker.hp(state);
    const healing = byId("rest-form").elements.healing;
    byId("short-rest-healing").hidden = kind === "long" || !hp;
    healing.disabled = kind === "long" || !hp;
    healing.value = "0";
    byId("rest-hp").textContent = !hp ? "Set HP to track healing."
      : kind === "long" ? (hp.max == null ? "Set maximum HP to heal on a long rest." : `HP ${hp.current} → ${hp.max}`)
        : `Current HP ${hp.current}${hp.max == null ? "" : ` / ${hp.max}`}. Enter the total HP recovered after rolling Hit Dice.`;
    if (kind === "long" && hp?.temporary > 0) {
      byId("rest-hp").textContent += ` · ${hp.temporary} temporary HP expires.`;
    }
    if (kind === "long") {
      checklist(byId("rest-spells"), [...spells].sort(([, a], [, b]) => a.name.localeCompare(b.name))
        .map(([key, spell]) => [key, [spell.name, spell.level].filter(Boolean).join(" · "), isPrepared(key, state)]));
      const imported = knownInfusions.map(([id, name]) => [id, name, state.progress?.infusions?.includes(id)]);
      const custom = abilities(state).filter((ability) => ability.kind === "imbuement")
        .map((ability) => [ability.id, ability.name, ability.active && !resets(ability.reset, kind)]);
      checklist(byId("rest-imbuements"), [...imported, ...custom]);
      byId("rest-form").elements.imbuement.value = "";
    }
    byId("rest-picker").close();
    rest.showModal();
  }
  for (const control of document.querySelectorAll("[data-rest]")) {
    control.addEventListener("click", () => openRest(control.dataset.rest));
  }
  byId("cancel-rest").addEventListener("click", () => rest.close());
  byId("rest-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const kind = pendingRest;
    const healing = Number(byId("rest-form").elements.healing.value);
    const customName = byId("rest-form").elements.imbuement.value.trim();
    const choices = (id) => new Map([...byId(id).querySelectorAll("input")].map((input) => [input.value, input.checked]));
    const prepared = choices("rest-spells");
    const imbuements = choices("rest-imbuements");
    encounterTracker.update((progress, state) => {
      for (const pool of pools(state)) if (resets(pool.recovery, kind)) delete progress.used[pool.key];
      encounterTracker.healOwner(progress, kind, healing);
      for (const ability of abilities(state)) {
        if (resets(ability.reset, kind)) {
          ability.active = false;
          ability.uses = 0;
        }
        if (kind === "long" && ability.kind === "imbuement" && imbuements.has(String(ability.id))) {
          ability.active = imbuements.get(String(ability.id));
        }
      }
      const seconds = kind === "long" ? 28800 : 3600;
      const rounds = seconds / 6;
      for (const effect of progress.effects || []) {
        if (!effect.ended && resets(effect.kind, kind)) {
          effect.ended = true;
          effect.endedByRest = true;
        }
        if (effect.kind === "rounds") effect.remaining = Math.max(0, effect.remaining - rounds);
      }
      for (const card of state.companions?.cards || []) {
        if (card.rounds > 0) card.rounds = Math.max(0, card.rounds - rounds);
      }
      effectControls.advanceTime(state, seconds);
      if (kind === "long") {
        const available = new Set(knownInfusions.map(([id]) => id));
        const saved = (progress.infusions || []).filter((id) => !available.has(id));
        progress.infusions = [...saved, ...knownInfusions.filter(([id]) => imbuements.get(id)).map(([id]) => id)];
        if (customName) {
          progress.abilities ||= [];
          const existing = progress.abilities.find((ability) => ability.kind === "imbuement"
            && ability.name.toLowerCase() === customName.toLowerCase());
          if (existing) existing.active = true;
          else progress.abilities.push({id: ++progress.sequence, name: customName, kind: "imbuement",
            active: true, uses: 0, cost: 1, notes: "", reset: "", pool: "", followup: ""});
        }
        progress.prepared = {...progress.prepared};
        for (const [key, checked] of prepared) {
          if (checked === spells.get(key)?.prepared) delete progress.prepared[key];
          else progress.prepared[key] = checked;
        }
      }
      progress.followupUses = {};
      status.textContent = kind === "long" ? "Long rest completed." : "Short rest completed.";
      byId("encounter-status").textContent = status.textContent;
      return true;
    });
    rest.close();
  });

  document.addEventListener("preview-encounter-change", render);
  render();
  return {isPrepared, featureUse, activateFeature, followups, followupUsed, followupButton,
    hasPreparation: spells.size > 0};
})();
