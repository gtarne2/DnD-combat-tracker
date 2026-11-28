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
  const amountDialog = byId("feature-amount-dialog");
  const amountForm = byId("feature-amount-form");
  let amountProposal;
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
  const optionTimings = new Map();
  const importedUses = new Map();
  for (const row of document.querySelectorAll("#action-groups [data-pin]")) {
    const body = row.querySelector(".option-body");
    const timing = row.querySelector("[data-turn-cost]:not([data-feature-level-blocked])");
    if (!optionTimings.has(row.dataset.pin) && timing) optionTimings.set(row.dataset.pin, timing.dataset.turnCost);
    const prepared = body.dataset.prepared;
    const name = row.querySelector(".option-title").textContent;
    if (prepared !== undefined) {
      const level = row.querySelector(".spell-level")?.textContent;
      spells.set(row.dataset.pin, { name, level, prepared: prepared === "true" });
    }
    const key = `option:${row.dataset.pin}`;
    if (body.dataset.moxieAction) moxieFeatures.set(row.dataset.pin, {name, action: body.dataset.moxieAction, cost: Number(body.dataset.moxieCost || 0)});
    if (body.dataset.featurePool || Object.hasOwn(body.dataset, "unlimitedFeature")) {
      importedUses.set(row.dataset.pin, {
        name, key: body.dataset.featurePool,
        cost: body.hasAttribute("data-feature-cost") ? Number(body.dataset.featureCost) : null,
      });
    }
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
  function activate(id, timing) {
    updateAbility(id, (ability, _progress, state) => {
      if (ability.kind !== "use" && ability.active) {
        ability.active = false;
        useFeedback(ability.name + " deactivated.");
        return "deactivating " + ability.name;
      }
      if (!actionEconomy.spend(state, "owner", timing ?? optionTimings.get(ability.source))) return false;
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
    const imported = !ability && importedUses.get(key);
    const resourceKey = ability ? ability.pool : imported ? imported.key : key;
    const pool = pools(state).find((entry) => entry.key === resourceKey);
    const moxie = !ability && moxieFeatures.get(key);
    if (!ability && !pool && !moxie && !imported) return null;
    if (moxie) {
      const shared = pools(state).find((entry) => entry.key === moxieKey);
      const remaining = shared && Math.max(0, shared.capacity - (state.progress?.used[moxieKey] || 0));
      const spent = state.progress?.used[key] || 0;
      const label = !shared ? "Set up Moxie" : moxie.action === "spend" ? `Spend ${moxie.cost} Moxie`
        : moxie.action === "refill" ? "Record reaction and refill Moxie" : "Record trick";
      const shortLabel = shared && moxie.action === "refill" ? "Refill Moxie" : label;
      const reason = pool && spent >= pool.capacity ? `${pool.name} has no uses left.`
        : shared && remaining < moxie.cost ? `Requires ${moxie.cost} Moxie (${remaining} left).` : "";
      const limits = pool ? `${Math.max(0, pool.capacity - spent)} / ${pool.capacity} uses · ` : "";
      return {moxie, pool, setup: !shared, label, shortLabel, reason, summary: shared ? `${limits}${remaining} / ${shared.capacity} Moxie` : "Set your Moxie maximum to track this feature."};
    }
    const label = imported?.key ? imported.cost == null ? "Spend points" : "Use feature"
      : imported ? "Use feature" : ability?.kind === "use" ? "Use feature" : ability?.active ? "Deactivate" : "Activate";
    const remaining = pool ? Math.max(0, pool.capacity - (state.progress?.used[resourceKey] || 0)) : 0;
    const cost = ability?.cost ?? imported?.cost ?? 1;
    const reason = !ability?.active && resourceKey && remaining < cost
      ? pool ? "Requires " + cost + " from " + pool.name + " (" + remaining + " left)." : "The linked resource is unavailable."
      : "";
    return {ability, imported, pool, resourceKey, cost, remaining, label, reason,
      summary: pool ? remaining + " / " + pool.capacity + " " + pool.name : imported && !resourceKey ? "Unlimited uses" : ""};
  }

  function activateFeature(key, timing = optionTimings.get(key)) {
    const use = featureUse(key, previewEncounter.current());
    if (!use || use.reason) return;
    if (use.ability) {
      activate(use.ability.id, timing);
      return;
    }
    if (use.moxie) {
      if (use.setup) {
        byId("configure-moxie").click();
      } else if (use.moxie.action === "failed-save") {
        moxieOutcome.dataset.feature = key;
        moxieOutcome.dataset.turnCost = timing || "";
        byId("moxie-outcome-heading").textContent = use.moxie.name;
        moxieOutcome.showModal();
      } else {
        recordMoxieFeature(key, false, timing);
      }
      return;
    }
    if (use.imported?.key && use.imported.cost == null) {
      amountProposal = {key, timing};
      amountForm.elements.recipient.replaceChildren(new Option("Record points only", ""),
        ...[...partyActions.targets(previewEncounter.current())].map(([id, target]) => new Option(target.name, id)));
      byId("feature-amount-title").textContent = use.imported.name;
      byId("feature-amount-remaining").textContent = use.remaining + " points remaining";
      amountForm.elements.amount.max = use.remaining;
      amountForm.elements.amount.value = "1";
      amountDialog.showModal();
      return;
    }
    recordImportedUse(key, timing);
  }

  function recordImportedUse(key, timing, amount, recipient) {
    previewEncounter.transact((state) => {
      const current = featureUse(key, state);
      if (!current || current.ability || current.reason) {
        useFeedback(current?.reason || "The feature changed. Choose it again.");
        return false;
      }
      if (!actionEconomy.spend(state, "owner", timing)) return false;
      if (current.resourceKey && !encounterTracker.spendResource(state, current.resourceKey, amount ?? current.cost)) {
        useFeedback("The chosen resource is unavailable.");
        return false;
      }
      const name = current.imported?.name || current.pool.name;
      if (recipient && !partyActions.applyHp(state, [recipient], amount, "healing", name)) {
        useFeedback("Healing recipient unavailable. Choose the feature again.");
        return false;
      }
      const cost = current.resourceKey ? " · " + (amount ?? current.cost) + " from " + current.pool.name : "";
      useFeedback(name + " used" + cost + ".");
      previewEncounter.log(state, "action", "Used " + name + cost, "option:" + key);
      return "using " + name;
    });
  }
  byId("cancel-feature-amount").onclick = () => amountDialog.close();
  amountForm.onsubmit = (event) => {
    event.preventDefault();
    const amount = amountForm.elements.amount.valueAsNumber;
    if (!amountProposal || !Number.isSafeInteger(amount) || amount < 1) return;
    recordImportedUse(amountProposal.key, amountProposal.timing, amount, amountForm.elements.recipient.value);
    amountDialog.close();
  };

  function recordMoxieFeature(key, failed = false, timing) {
    previewEncounter.transact((state) => {
      const use = featureUse(key, state);
      if (!use?.moxie || use.setup || use.reason) {
        useFeedback(use?.reason || "The feature changed. Choose it again.");
        return false;
      }
      const {action, cost, name} = use.moxie;
      if (!actionEconomy.spend(state, "owner", timing)) return false;
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
    if (result === "failed" || result === "used") recordMoxieFeature(moxieOutcome.dataset.feature, result === "failed", moxieOutcome.dataset.turnCost);
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
    form.elements.attackTarget.replaceChildren(...attackModifiers.targetOptions());
    if (values.attackTarget && ![...form.elements.attackTarget.options].some((option) => option.value === values.attackTarget)) {
      form.elements.attackTarget.append(new Option("Attack unavailable in this import", values.attackTarget));
    }
    for (const field of ["name", "kind", "pool", "cost", "reset", "followup", "notes", "category", "reference", "summary",
      "description", "attackTarget", "attackBonus", "damageBonus"]) {
      form.elements[field].value = values[field] ?? ({kind: "use", cost: 1}[field] || "");
    }
    showAttackFields();
    linkSearch.value = "";
    filterLinks(linkKey(values));
    byId("remove-ability").hidden = !values.id;
    editor.showModal();
  }
  function showAttackFields() {
    byId("ability-attack-options").hidden = form.elements.kind.value !== "imbuement";
    byId("ability-damage-bonus").hidden = form.elements.attackTarget.value === "spell";
  }
  form.elements.kind.addEventListener("change", showAttackFields);
  form.elements.attackTarget.addEventListener("change", showAttackFields);
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
    values.attackBonus = Number(values.attackBonus);
    values.damageBonus = Number(values.damageBonus);
    const source = editing;
    encounterTracker.update((progress) => {
      progress.abilities ||= [];
      const saved = progress.abilities.find((entry) => entry.id === source.id);
      if (saved) {
        if (values.kind === "use") saved.active = false;
        if (saved.kind === "imbuement" && (saved.name !== values.name || linkKey(saved) !== values.link)) {
          delete progress.partyAssignments?.["ability:" + saved.id];
        }
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
    const imported = importedUses.get(source);
    const pool = pools(previewEncounter.current()).find((pool) => pool.key === (imported?.key || source));
    openAbility(current || {source, name, pool: pool?.key, cost: imported?.cost, reset: pool?.recovery});
  });

  function followups(state) {
    const actions = [];
    const active = state.focus.active;
    if (active?.repeatBonus === "heat-metal" || active?.name === "Heat Metal") {
      actions.push({key: `heat:${active.id}`, name: "Heat Metal · repeat damage",
        notes: "Repeat the spell’s damage while concentrating."});
    }
    for (const card of state.companions?.cards || []) {
      if (!companionControls.available(card) || !/^Eldritch Cannon\b/i.test(card.name) &&
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
      if (followupReason(action, state) || !followups(state).some((row) => row.key === action.key)) {
        if (protector.open) protectorFeedback.textContent = "This cannon is no longer available for activation.";
        return false;
      }
      if (!actionEconomy.spend(state, "owner", "bonus-action")) return false;
      if (!partyActions.applyHp(state, recipients, amount, "temporary_hp", action.name)) {
        protectorFeedback.textContent = "A selected recipient is unavailable. Reopen Protector to refresh the list.";
        return false;
      }
      progress.followupUses = {...progress.followupUses, [action.key]: turn};
      previewEncounter.log(state, "action", `Used ${action.name} · Bonus Action`);
      useFeedback(action.name + " used as a bonus action.");
      if (action.variant === "protector" && protector.open) protector.close();
      return "using " + action.name;
    });
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
    // Just the effect line here; the cannon's full rules stay on its card and under Rules.
    const [effect, ...rest] = String(action.detail || "").split(/\n+/);
    byId("protector-description").textContent = effect || "";
    const rules = byId("protector-rules");
    rules.hidden = !rest.length;
    rules.querySelector("p").textContent = rest.join("\n");
    renderProtectorTargets(true);
    protector.showModal();
  }
  // Recipients. When the cannon's aura is on the Owlbear map, the allies inside it (and the
  // cannon) start checked, and follow the map until the player changes a box.
  let protectorEdited = false, protectorAura = "";
  function renderProtectorTargets(fresh = false) {
    if (!pendingProtector) return;
    const targets = byId("protector-targets");
    const checked = new Set([...targets.querySelectorAll("input:checked")].map(input => input.value));
    const inside = partyInitiative.templates.auraTargets?.(pendingProtector.companion) || null;
    const key = JSON.stringify(inside && [...inside].sort());
    if (!fresh && (protectorEdited || key === protectorAura)) return;
    if (fresh) protectorEdited = false;
    protectorAura = key;
    targets.querySelectorAll("label, p").forEach(node => node.remove());
    for (const [id, {name, hp}] of partyActions.targets(previewEncounter.current())) {
      const label = make("label");
      const checkbox = make("input");
      Object.assign(checkbox, {type: "checkbox", name: "recipient", value: id,
        checked: inside ? inside.has(id) : !fresh && checked.has(id)});
      checkbox.onchange = () => { protectorEdited = true; };
      label.append(checkbox, hp ? ` ${name} · ${hp.temporary || 0} temp HP` : ` ${name}`);
      targets.append(label);
    }
    if (!targets.querySelector("input")) targets.append(make("p", "Set current HP to make a recipient available."));
    byId("protector-aura-note").textContent = inside ? "Checked from the cannon's 10-foot aura on the map." : "";
  }
  document.addEventListener("preview-encounter-change", () => { if (protector.open) renderProtectorTargets(); });
  byId("protector-roll").onclick = () => {
    const modifier = Number(cannonRolls?.modifier);
    protectorForm.elements.amount.value = Math.floor(Math.random() * 8) + 1 + (Number.isFinite(modifier) ? Math.max(1, modifier) : 1);
  };

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

  function followupReason(action, state) {
    if (actionEconomy.override(state, "owner", "bonus-action")) return "";
    return actionEconomy.reason(state, "owner", "bonus-action")
      || (state.progress?.followupUses?.[action.key] === (state.progress?.turnSequence || 0) ? "Used this turn" : "");
  }

  function followupButton(action, state, label = "Use bonus action", usedLabel = "Used this turn") {
    const reason = followupReason(action, state);
    const control = button(reason === "Used this turn" ? usedLabel : label, () => activateFollowup(action));
    control.dataset.followupKey = action.key;
    control.disabled = Boolean(reason);
    if (reason) control.title = reason;
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
      actions.map((action) => [action, followupReason(action, state)]), state.progress?.infusions,
      state.progress?.infusionTargets, partyActions.members(), previewEncounter.delivery().sources, linkedEffects]);
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
    const focusedAssignment = document.activeElement.dataset.infusionAssignment;
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
      const title = make("summary", name);
      details.append(title);
      const pool = pools(state).find((entry) => entry.key === "Charge:" + id);
      if (pool) {
        const remaining = Math.max(0, pool.capacity - (state.progress?.used[pool.key] || 0));
        title.append(make("small", ` · ${remaining} / ${pool.capacity} charges`));
        const recovery = pool.recovery === "short" ? "after each rest" : pool.recovery === "long" ? "after a long rest" : "";
        if (pool.rechargeDie && recovery) details.append(make("p", `Regains 1d${pool.rechargeDie} spent charges ${recovery}.`));
        const spend = button("Spend charge", () => encounterTracker.update((progress, current) =>
          encounterTracker.spendResource(current, pool.key) && "spending a " + name + " charge"));
        spend.disabled = !remaining || !active;
        details.append(spend);
      }
      const assignment = attackModifiers.assignmentControl(id, name, state);
      if (assignment) {
        details.append(assignment);
        const party = active && partyActions.grantControl("infusion:" + id, name, attackModifiers.infusion(id).scope);
        if (party) details.append(party);
      }
      details.append(abilityDetails({}, sources.get(`option:Feature:${id}`)));
      restoreCard(details, `infusion:${id}`);
      row.append(details, toggle);
      infusionList.append(row);
      if (focusedAssignment === id) assignment?.querySelector("select").focus({preventScroll: true});
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
      if (ability.active && ability.kind === "imbuement") {
        const party = partyActions.grantControl("ability:" + ability.id, ability.name, null);
        if (party) controls.append(party);
      }
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
    const recovering = pools(state).filter((pool) => resets(pool.recovery, kind)).map((pool) =>
      pool.rechargeDie ? `${pool.name} (1d${pool.rechargeDie} charges)` : pool.name);
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
      const recharge = [];
      for (const pool of encounterTracker.resources(state, true)) {
        if (!resets(pool.recovery, kind)) continue;
        const used = progress.used[pool.key] || 0;
        if (!pool.rechargeDie) {
          if (used) previewEncounter.log(state, "resource", `Recovered ${Math.min(used, pool.capacity)} · ${pool.name}`);
          delete progress.used[pool.key];
          continue;
        }
        const spent = Math.min(progress.used[pool.key] || 0, pool.capacity);
        if (!spent) continue;
        const rolled = Math.floor(Math.random() * pool.rechargeDie) + 1;
        const gained = Math.min(rolled, spent);
        previewEncounter.log(state, "resource", `Recovered ${gained} · ${pool.name}`);
        if (spent > gained) progress.used[pool.key] = spent - gained;
        else delete progress.used[pool.key];
        recharge.push(`${pool.name} regained ${gained} (1d${pool.rechargeDie} rolled ${rolled}).`);
      }
      const beforeHp = encounterTracker.hp(state)?.current;
      encounterTracker.healOwner(progress, kind, healing);
      const healed = (progress.hp?.current ?? beforeHp) - beforeHp;
      if (healed > 0) previewEncounter.log(state, "healing", `Restored ${healed} HP`);
      previewEncounter.log(state, "rest", kind === "long" ? "Long rest" : "Short rest");
      for (const ability of abilities(state)) {
        if (resets(ability.reset, kind)) {
          delete progress.partyAssignments?.["ability:" + ability.id];
          ability.active = false;
          ability.uses = 0;
        }
        if (kind === "long" && ability.kind === "imbuement" && imbuements.has(String(ability.id))) {
          ability.active = imbuements.get(String(ability.id));
        }
      }
      const seconds = kind === "long" ? 28800 : 3600;
      for (const effect of progress.effects || []) {
        if (!effect.ended && resets(effect.kind, kind)) {
          effect.ended = true;
          effect.endedByRest = true;
        }
      }
      if (!progress.partyClock) {
        effectControls.tickRoundEffects(state, seconds / 6);
        effectControls.advanceTime(state, seconds);
      }
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
      status.textContent = [kind === "long" ? "Long rest completed." : "Short rest completed.", ...recharge].join(" ");
      byId("encounter-status").textContent = status.textContent;
      return true;
    });
    rest.close();
    // A rest the DM called (R90) is answered once the player has taken it.
    document.dispatchEvent(new CustomEvent("sheet-rest-taken", {detail: {kind}}));
  });

  document.addEventListener("preview-encounter-change", render);
  render();
  return {isPrepared, featureUse, activateFeature, followups, followupReason, followupButton, optionTiming: (key) => optionTimings.get(key),
    hasPreparation: spells.size > 0};
})();
