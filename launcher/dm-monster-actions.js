function setupMonsterActions(el, change, selectRow) {
  const panel = el("dm-monster-actions");
  const picker = el("dm-action-rule");
  const mode = el("dm-action-mode");
  const dialog = el("dm-action-dialog");
  const form = el("dm-action-form");
  const fields = el("dm-action-fields");
  const submit = el("dm-action-submit");
  const status = form.querySelector("[role=status]");
  const recharge = el("dm-recharge-form");
  const labels = {action:"Action", bonus:"Bonus action", reaction:"Reaction", legendary:"Legendary", manual:"No action slot"};
  const resetLabels = {manual:"Manual / rest", start:"Start of own turn", end:"End of own turn", round:"Round advance"};
  const outcomes = {table:"Table ruling", hit:"Hit", miss:"Miss", save_success:"Save succeeded", save_failure:"Save failed"};
  const questions = {attack:"Attack hit or reaction", save:"Saving throw", magic_missile:"Magic Missile reaction"};
  const history = el("dm-action-history");
  let room, row, currentId, busy, draft;
  const rule = () => row?.actions?.rules.find(r => r.id === picker.value);
  const targetName = (state, id) => state.combat.rows.find(candidate => candidate.id === id)?.name
    || state.members?.find(member => member.member_id === id)?.name;
  const make = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  const number = (value, min = 0, max = 4294967295) => {
    const input = make("input");
    input.type = "number";
    input.min = min;
    input.max = max;
    input.value = value ?? "";
    return input;
  };
  const select = (choices, value) => {
    const input = make("select");
    input.replaceChildren(...Object.entries(choices).map(([key, label]) => new Option(label, key)));
    if (value !== undefined) input.value = value;
    return input;
  };
  const text = (max, multiline = false, required = false) => {
    const input = make(multiline ? "textarea" : "input");
    input.maxLength = max;
    input.required = required;
    return input;
  };
  function field(container, name, input) {
    const label = make("label", name);
    input.setAttribute("aria-label", name);
    label.append(input);
    container.append(label);
    return input;
  }
  const toggle = checked => Object.assign(make("input"), {type:"checkbox", checked});
  const read = input => input.value === "" ? null : input.valueAsNumber;
  const controlButton = (label, onclick) => Object.assign(make("button", label), {type:"button", onclick});

  function modeField(box, label, initial = mode.value) {
    return field(box, label, select({manual:"Manual", assist:"Assist"}, initial));
  }

  function renderRule() {
    const power = rule(), state = row?.actions;
    const policy = power?.policy, counter = power?.counter;
    el("dm-action-detail").hidden = !power;
    el("dm-action-name").textContent = power?.name || "";
    el("dm-action-cost").textContent = power ? costLabel(policy) : "";
    if (power) el("dm-action-cost").dataset.cost = policy.cost;
    el("dm-action-text").textContent = power?.text || "";
    // A multiattack lists its strikes with each strike's own rules, in the order the pack gives.
    const parts = el("dm-action-parts");
    const counts = power ? strikeParts(power, row.actions.rules) : new Map();
    const composite = counts.size > 0;
    parts.hidden = !composite;
    parts.replaceChildren(...(composite ? [...counts].map(([id, count]) => {
      const part = row.actions.rules.find(r => r.id === id);
      const item = make("li");
      const head = make("div");
      head.className = "dm-strike-head";
      const times = make("span", count ? "×" + count : "•");
      times.className = "dm-strike-count";
      times.setAttribute("aria-label", count ? count + (count === 1 ? " strike" : " strikes") : "Part of this action");
      head.append(times, make("strong", part?.name || id));
      item.append(head);
      if (part?.text) {
        const body = make("p", part.text);
        body.className = "dm-strike-text";
        item.append(body);
      }
      return item;
    }) : []));
    renderCatalog();
    el("dm-rule-counter").textContent = power ? [
      policy.uses === null ? "" : counter.remaining + " / " + policy.uses + " uses",
      policy.recharge ? (counter.spent ? "Recharge spent" : "Recharge ready") : "",
      counter?.queued == null ? "" : "Queued roll " + counter.queued,
      !policy.recharge || counter.last_roll == null ? "" : "Last recharge roll " + counter.last_roll,
      policy.cost === "legendary" && !state.legendary_max ? "Set a legendary budget in Correct action economy" : ""
    ].filter(Boolean).join(" · ") : "";
    const current = room?.combat.running && row?.id === room.combat.current;
    let available = false;
    if (power && !counter.spent && counter.remaining !== 0) {
      available = policy.cost === "manual"
        || policy.cost === "legendary" && state.legendary_left >= policy.legendary
        || policy.cost === "reaction" && state.reaction
        || current && ["action", "bonus"].includes(policy.cost) && state[policy.cost];
    }
    el("dm-preview-action").disabled = busy || !available;
    el("dm-correct-rule").disabled = busy || !power;
    recharge.hidden = !(policy?.recharge && counter.spent);
    if (!recharge.hidden) {
      recharge.elements.roll.max = policy.recharge.die;
      recharge.elements.roll.disabled = busy;
      recharge.querySelector("button").disabled = busy;
      el("dm-clear-roll").disabled = busy || counter.queued == null;
    }
  }

  // The strikes a composite action makes, as rule id → count. Packs list them when they can;
  // otherwise read the rules text for the monster's other action names ("two with its claws").
  const numbers = {one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, once:1, twice:2};
  function strikeParts(power, rules) {
    const counts = new Map();
    const listed = power.strikes || [];
    if (listed.length > 1 || listed.length === 1 && listed[0] !== power.id) {
      for (const id of listed) counts.set(id, (counts.get(id) || 0) + 1);
      return counts;
    }
    if (!/multiattack/i.test(power.name + " " + power.text)) return counts;
    const text = power.text.toLowerCase();
    for (const other of rules) {
      if (other.id === power.id || /multiattack/i.test(other.name)) continue;
      const base = other.name.toLowerCase().replace(/\s*\(.*\)$/, "").replace(/s$/, "");
      if (base.length < 3) continue;
      const pattern = new RegExp("\\b" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:e?s)?\\b");
      const hit = pattern.exec(text);
      if (!hit) continue;
      const before = text.slice(Math.max(0, hit.index - 40), hit.index);
      const said = [...before.matchAll(/\b(one|two|three|four|five|six|seven|eight|once|twice|\d+)\b/g)].pop()?.[1];
      counts.set(other.id, said ? numbers[said] ?? Number(said) : 0);
    }
    return counts;
  }
  const costLabel = policy => policy.cost === "legendary" ? "Legendary · " + policy.legendary + (policy.legendary === 1 ? " use" : " uses") : labels[policy.cost];
  // Every action of the selected monster, grouped by cost. Selecting a card drives the labelled select.
  const catalog = el("dm-action-list");
  function renderCatalog() {
    const rules = row?.actions?.rules || [];
    const groups = new Map();
    for (const power of rules) {
      const key = power.policy.cost;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(power);
    }
    const focused = document.activeElement?.closest?.("#dm-action-list [data-rule]")?.dataset.rule;
    catalog.replaceChildren(...[...groups].map(([cost, list]) => {
      const group = make("div");
      group.className = "dm-action-group";
      group.append(make("h5", labels[cost] || cost));
      for (const power of list) {
        const card = make("button");
        card.type = "button";
        card.className = "dm-action-card";
        card.dataset.rule = power.id;
        card.dataset.cost = cost;
        card.setAttribute("aria-pressed", String(power.id === picker.value));
        card.disabled = busy;
        card.append(make("strong", power.name));
        const notes = [];
        const parts = strikeParts(power, rules);
        const total = [...parts.values()].reduce((sum, n) => sum + n, 0);
        if (parts.size) notes.push(total ? total + (total === 1 ? " strike" : " strikes") : parts.size + " parts");
        if (power.policy.uses != null) notes.push(power.counter.remaining + "/" + power.policy.uses + " uses");
        if (power.policy.recharge) notes.push(power.counter.spent ? "Recharging" : "Recharge ready");
        if (notes.length) card.append(make("small", notes.join(" · ")));
        if (power.counter.spent || power.counter.remaining === 0) card.dataset.spent = "true";
        group.append(card);
      }
      return group;
    }));
    if (focused) catalog.querySelector(`[data-rule="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  catalog.addEventListener("click", event => {
    const card = event.target.closest("[data-rule]");
    if (!card || card.disabled || picker.value === card.dataset.rule) return;
    picker.value = card.dataset.rule;
    picker.dispatchEvent(new Event("change"));
  });

  function render(state, selected, waiting) {
    busy = waiting;
    submit.disabled = busy;
    const board = state?.combat;
    if (!board || state.ended) {
      if (dialog.open) dialog.close();
      room = row = currentId = null;
      return;
    }
    const current = board.running ? board.rows.find(candidate => candidate.id === board.current) : null;
    const newEncounter = room?.room_id !== state.room_id || room?.combat.id !== board.id;
    currentId = current?.id;
    room = state;
    const nextRow = selected?.enemy ? selected : current?.enemy ? current : null;
    const rowChanged = nextRow?.id !== row?.id || newEncounter;
    row = nextRow;
    const actions = row?.actions;
    panel.hidden = !actions;
    if (newEncounter && dialog.open) dialog.close();
    if (!actions) return;
    el("dm-current-actions").hidden = !current?.enemy || row.id === current.id;
    el("dm-actions-actor").textContent = row.name + (row.id === current?.id ? " · Current turn" : "") + " · "
      + (mode.value === "assist" ? "Assist" : "Manual");
    const pills = ["action", "bonus", "reaction"].map(key => {
      const pill = make("span", labels[key] + " " + (actions[key] ? "ready" : "spent"));
      pill.className = "dm-pill";
      pill.dataset.state = actions[key] ? "ready" : "spent";
      return pill;
    });
    if (actions.legendary_max) {
      const pill = make("span", "Legendary " + actions.legendary_left + " / " + actions.legendary_max);
      pill.className = "dm-pill dm-pill-legendary";
      pill.dataset.state = actions.legendary_left ? "ready" : "spent";
      pills.push(pill);
    }
    el("dm-action-budget").replaceChildren(...pills);
    el("dm-add-rule").disabled = el("dm-correct-budget").disabled = busy;
    const prior = rowChanged ? "" : picker.value;
    const choices = actions.rules.map(r => new Option(r.name, r.id));
    picker.replaceChildren(...choices);
    if (actions.rules.some(r => r.id === prior)) picker.value = prior;
    picker.disabled = busy || !choices.length;
    if (rowChanged) recharge.reset();
    renderRule();
    history.hidden = !actions.history.length;
    if (rowChanged) history.open = false;
    history.querySelector("ol").replaceChildren(...actions.history.map(entry => {
      const cost = entry.source.cost;
      const item = make("li");
      item.dataset.actionId = entry.input.id;
      item.append(make("strong", entry.name + " · Round " + entry.round + " · " + labels[cost]
        + (cost === "legendary" ? " × " + entry.source.legendary : "")));
      entry.input.strikes.forEach((strike, index) => {
        const power = actions.rules.find(rule => rule.id === strike.rule);
        const number = index + 1;
        const target = strike.target_note || targetName(state, strike.target) || (strike.target ? "Removed target" : "No specific target");
        const recipient = entry.recipients == null
          ? board.rows.find(r => r.id === strike.target)?.damage_recipient : entry.recipients[strike.id];
        const member = state.members?.find(m => m.member_id === recipient);
        const actionId = entry.input.id;
        const window = board.windows?.[strike.id];
        const phase = window?.resolution.kind;
        const ruling = phase === "final" ? window.resolution.outcome : strike.outcome;
        const line = make("p", [
          "Strike " + number, target,
          strike.attack_roll == null ? "" : "Natural " + strike.attack_roll.natural,
          strike.attack_roll?.digital_total == null ? "" : "Digital total " + strike.attack_roll.digital_total,
          strike.total === null ? "" : "Total " + strike.total, outcomes[ruling]
        ].filter(Boolean).join(" · "));
        function control(label, handler) {
          const button = Object.assign(make("button", label), {type:"button", disabled:busy});
          button.onclick = handler;
          line.append(" ", button);
        }
        const windowEdit = edit => ({kind:"strike_window", action_id:actionId, strike_id:strike.id, edit});
        if (window) {
          const description = {
            pending:"Waiting for reply", answered:"Reply received", stale:"Trigger stale · resolve at the table",
            canceled:"Question canceled", final:"Ruling finalized"
          }[phase];
          line.append(" · " + description);
          if (window.reply) line.append(" · " + (outcomes[window.reply.answer] || "Passed")
            + (window.reply.reacted ? " · Reaction used" : ""));
          if (window.resolution.override_note) line.append(" · " + window.resolution.override_note);
        }
        const result = board.damage?.[strike.id]?.result;
        if (phase && phase !== "final") {
          if (phase === "answered" && window.reply.answer !== "pass") {
            control("Use reply on strike " + number, () => change(windowEdit({kind:"resume", window:window.reference})));
          }
          if (["pending","answered"].includes(phase)) {
            control("Cancel question on strike " + number, () => change(windowEdit({kind:"cancel", window:window.reference})));
          }
          control("Record spoken ruling for strike " + number, () => open("Spoken ruling · " + target, "Save override", box => {
            const outcome = field(box, "Final ruling", select(outcomes, ruling));
            const note = field(box, "Private override reason", text(1000,true,true));
            return () => windowEdit({kind:"override", window:window.reference, outcome:outcome.value, note:note.value.trim()});
          }, true));
        } else if (ruling === "miss" || result?.kind === "no_damage") {
          line.append(" · No damage");
        } else if (result?.kind === "handled") {
          line.append(" · Handled at table");
        } else if (result?.kind === "sent") {
          const offer = state.offers?.find(o => o.offer_id === result.offer_id);
          if (offer) line.append(" · " + offer.effect.amount + " damage · " + offer.status);
        } else {
          control("Resolve damage for strike " + number, () => resolveDamage(entry, strike, power, ruling, member, target));
        }
        if (!phase && !result && !board.damage_rolls?.[strike.id]
            && (mode.value === "assist" || strike.attack_roll || strike.assist_damage)) {
          control("Review strike " + number, () => reviewStrike(entry, strike, power, target));
        }
        if (!result && member && (!phase || ["stale","canceled"].includes(phase))
            && (strike.target === member.member_id || board.rows.some(r => r.id === strike.target))) {
          control((phase ? "Ask again for strike " : "Ask player for strike ") + number,
            () => open("Ask player · " + member.name, "Send question", box => {
              const id = crypto.randomUUID();
              const question = field(box, "Question", select(questions,
                ruling.startsWith("save_") || power?.mechanics?.save ? "save" : "attack"));
              const announcement = field(box, "Optional announcement to everyone", text(120));
              return () => windowEdit({kind:"open", id, question:question.value, announcement:announcement.value.trim()});
            }, true));
        }
        item.append(line);
      });
      if (entry.input.note) item.append(make("p", entry.input.note));
      return item;
    }));
    draft?.read.refresh?.();
  }
  el("dm-current-actions").onclick = () => selectRow(currentId);
  picker.onchange = () => { recharge.reset(); renderRule(); };
  mode.onchange = () => render(room, row, busy);

  function open(title, button, build, initiativeEdit = false) {
    if (!row || busy || dialog.open) return;
    const base = room, id = row.id;
    el("dm-action-dialog-title").textContent = title;
    fields.replaceChildren();
    submit.textContent = button;
    status.textContent = "";
    draft = {base, id, read:build(fields, row), initiativeEdit};
    dialog.showModal();
  }
  el("dm-action-cancel").onclick = () => dialog.close();
  dialog.addEventListener("close", () => { if (!dialog.open) draft = null; });
  form.onsubmit = async event => {
    event.preventDefault();
    const pending = draft;
    if (!pending || busy) return;
    let action;
    try {
      action = pending.read();
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    const edit = pending.initiativeEdit ? action : {kind:"monster_action", id:pending.id, action};
    if (await change(edit, pending.base)) {
      if (!pending.initiativeEdit && action.kind === "record") history.open = true;
      if (draft === pending) dialog.close();
    } else if (draft === pending) {
      if (edit.action?.kind === "record" && room?.combat.id === pending.base.combat.id
          && room.combat.current === pending.base.combat.current && room.combat.round === pending.base.combat.round) {
        pending.base = room;
      }
      status.textContent = el("dm-initiative-status").textContent + " Retry the same entry, or reopen it to review the latest state.";
    }
  };

  function resolveDamage(entry, strike, power, ruling, member, target) {
    const actionId = entry.input.id, strikeId = strike.id;
    open("Resolve damage · " + (member?.name || target), "Confirm damage result", box => {
      const decision = field(box, "Damage result", select({final:"Enter final amount", handled:"Handled at table"}));
      const amount = field(box, member ? "Final damage amount" : "Zero damage (no player sheet target)",
        number(member ? null : 0, 0, member ? 4294967295 : 0));
      amount.required = true;
      const assist = modeField(box, "Damage mode", strike.assist_damage ? "assist" : "manual");
      const guide = make("div");
      box.append(guide);
      const mechanics = power?.mechanics;
      const components = mechanics?.damage || [];
      const save = mechanics?.save;
      const branch = !save && mechanics?.save_dc != null ? null : monsterAssist.branch(save, ruling);
      const terms = monsterAssist.damageTerms(components);
      const naturalCritical = ruling === "hit" && !save && strike.attack_roll?.natural === 20;
      const averages = components.length && components.every(component => Number.isInteger(component.average))
        ? components.reduce((total, component) => total + component.average, 0) : null;
      const matching = save ? entry.input.strikes.filter(other => other.rule === strike.rule).map(other => other.id) : [strikeId];
      const saved = () => matching.map(id => room?.combat.damage_rolls?.[id]).find(Boolean);
      if (power) {
        const rules = make("p", power.text);
        rules.className = "dm-rule-text";
        guide.append(rules);
      }
      appendMechanics(guide, mechanics);
      if (components.length) guide.append(make("p", components.map(component =>
        [component.damage_type, component.dice, component.average == null ? "" : "printed average " + component.average]
          .filter(Boolean).join(" · ")).join(" / ")));
      const confirmed = field(guide, "I checked resistance, other modifiers and conditional riders", toggle(false));
      const critical = field(guide, "Apply critical dice", toggle(naturalCritical));
      critical.closest("label").hidden = !naturalCritical;
      const feedback = make("p");
      guide.append(feedback);
      const controls = make("div");
      controls.className = "dm-controls";
      guide.append(controls);
      let rolled, rolling = false, selectedAmount;
      const rollButton = controlButton("Roll damage", async () => {
        if (!terms || busy || rolling || saved()) return;
        rolled ||= monsterAssist.rollDamage(terms, naturalCritical);
        const pending = draft;
        rolling = true;
        update();
        const stored = await change({kind:"store_damage_roll", action_id:actionId, strike_id:strikeId, roll:rolled}, pending.base);
        rolling = false;
        if (draft !== pending) return;
        if (room?.combat.id === pending.base.combat.id) pending.base = room;
        if (stored || saved()) {
          status.textContent = "";
        } else {
          status.textContent = el("dm-initiative-status").textContent + " Retry to keep the same damage dice.";
        }
        update();
      });
      const pickAmount = value => {
        if (value == null || value > Number(amount.max)) return;
        selectedAmount = value;
        amount.value = value;
      };
      const criticalAverage = () => !critical.checked ? averages : terms && averages != null
        ? terms.reduce((sum, term) => sum + Math.max(0, Math.floor(term.count * (term.sides + 1) + term.modifier)), 0) : null;
      const rolledAmount = () => {
        const roll = saved();
        return roll ? monsterAssist.amount(critical.checked ? roll.critical : roll.normal, branch) : null;
      };
      const averageAmount = () => monsterAssist.amount(criticalAverage(), branch);
      const useRoll = controlButton("Use rolled damage", () => pickAmount(rolledAmount()));
      const useAverage = controlButton("Use printed average", () => pickAmount(averageAmount()));
      controls.append(rollButton, useRoll, useAverage);
      amount.oninput = () => { selectedAmount = undefined; };
      function update() {
        amount.disabled = decision.value === "handled";
        amount.closest("label").hidden = amount.disabled;
        guide.hidden = amount.disabled || assist.value !== "assist";
        if (!confirmed.checked && selectedAmount !== undefined) {
          amount.value = "";
          selectedAmount = undefined;
        }
        const roll = saved();
        rollButton.textContent = rolled && !roll ? "Retry storing damage roll" : "Roll damage";
        rollButton.disabled = busy || rolling || !terms || !branch || branch === "none" || !!roll || !member;
        useRoll.disabled = !member || !confirmed.checked || rolledAmount() == null;
        useAverage.textContent = critical.checked ? "Use critical average" : "Use printed average";
        useAverage.disabled = !member || !confirmed.checked || averageAmount() == null;
        feedback.textContent = [
          branch ? "Damage branch: " + branch : "Enter the final amount from the table ruling.",
          rolledAmount() == null ? "" : "Rolled suggestion " + rolledAmount(),
          averageAmount() == null ? "" : "Average suggestion " + averageAmount()
        ].filter(Boolean).join(" · ");
      }
      critical.onchange = () => {
        if (selectedAmount !== undefined) amount.value = "";
        selectedAmount = undefined;
        update();
      };
      for (const input of [decision, assist, confirmed]) input.onchange = update;
      update();
      const readDecision = () => ({kind:"finalize_damage", action_id:actionId, strike_id:strikeId,
        decision:amount.disabled ? {kind:"handled"} : {kind:"final", amount:read(amount)}});
      readDecision.refresh = update;
      return readDecision;
    }, true);
  }

  function appendMechanics(host, mechanics) {
    const save = mechanics?.save;
    if (save) host.append(make("p", save.ability + " save DC " + save.dc
      + " · Success: " + save.on_success + " damage · Failure: " + save.on_failure + " damage"));
    else if (mechanics?.save_dc != null) host.append(make("p", "Save DC " + mechanics.save_dc + " · Resolve the branches at the table."));
    if (mechanics?.manual_note) host.append(make("p", mechanics.manual_note));
  }

  function strikeFields(host, power, target, total, outcome, localMode, prior = {}) {
    const guide = make("div");
    host.append(guide);
    const mechanics = power?.mechanics;
    appendMechanics(guide, mechanics);
    const digital = field(guide, "Enable digital attack roll", toggle(false));
    const compare = field(guide, "Compare with available AC", toggle(false));
    const suggest = field(guide, "Suggest damage after ruling", toggle(Boolean(prior.assist_damage)));
    const natural = field(guide, "Natural d20", number(prior.attack_roll?.natural, 1, 20));
    const printed = mechanics?.attack_bonus;
    const adjustment = field(guide, "Situational attack adjustment", number(0, -1000, 1000));
    const useBonus = field(guide, "Confirm printed attack bonus and adjustment", toggle(false));
    const printedText = make("p", Number.isInteger(printed) ? "Printed attack bonus " + (printed >= 0 ? "+" : "") + printed : "Use your table total if an attack modifier is unavailable.");
    guide.append(printedText);
    let roll = prior.attack_roll?.digital ? prior.attack_roll : null, derived;
    const rollButton = controlButton("Roll d20", () => {
      if (roll || !digital.checked || !adjustment.reportValidity()) return;
      const die = monsterAssist.die(20);
      const sum = useBonus.checked && Number.isInteger(printed) ? die + printed + (read(adjustment) || 0) : null;
      const digitalTotal = sum != null && sum >= -2147483648 && sum <= 2147483647 ? sum : null;
      roll = {natural:die, digital:true, digital_total:digitalTotal};
      natural.value = die;
      if (digitalTotal != null) total.value = digitalTotal;
      update();
    });
    const advice = make("p");
    const suggestion = () => compare.checked ? monsterAssist.compare(read(natural), read(total), monsterAssist.armor(room, target())) : null;
    const choose = controlButton("Use suggested outcome", () => {
      derived = suggestion();
      if (derived) outcome.value = derived;
    });
    guide.append(rollButton, advice, choose);
    if (mechanics?.save) {
      for (const field of [digital,compare,natural,adjustment,useBonus]) field.closest("label").hidden = true;
      printedText.hidden = rollButton.hidden = true;
    }
    function update() {
      guide.hidden = localMode.value !== "assist";
      natural.readOnly = !!roll;
      rollButton.disabled = !digital.checked || !!roll;
      adjustment.disabled = !digital.checked || !!roll || !Number.isInteger(printed);
      useBonus.disabled = adjustment.disabled;
      const proposed = suggestion();
      if (derived && derived !== proposed) {
        outcome.value = "table";
        derived = null;
      }
      choose.hidden = !proposed;
      const die = read(natural);
      advice.textContent = [
        die === 20 ? "Natural 20 · critical hit candidate" : die === 1 ? "Natural 1 · automatic miss candidate" : "",
        roll?.digital_total == null ? "" : "Digital total " + roll.digital_total,
        compare.checked ? proposed ? "Suggested " + proposed + " using available armor class."
          : "No permitted armor class or comparable roll. Use a table ruling." : ""
      ].filter(Boolean).join(" · ");
    }
    outcome.onchange = () => { derived = null; };
    for (const input of [digital,compare,natural,total]) input.addEventListener("input",update);
    update();
    return {update, read:() => {
      update();
      const actual = roll || (natural.value === "" ? null : {natural:read(natural), digital:false, digital_total:null});
      return {total:read(total), outcome:outcome.value, attack_roll:actual, assist_damage:suggest.checked};
    }};
  }

  function reviewStrike(entry, strike, power, target) {
    open("Review strike · " + target, "Save strike ruling", box => {
      const localMode = modeField(box, "Resolution mode", strike.attack_roll || strike.assist_damage ? "assist" : mode.value);
      if (power) box.append(make("p", power.text));
      const total = field(box, "Physical roll total", number(strike.total, -2147483648, 2147483647));
      const outcome = field(box, "Table outcome", select(outcomes, strike.outcome));
      const assist = strikeFields(box, power, () => strike.target, total, outcome, localMode, strike);
      localMode.onchange = assist.update;
      const readReview = () => ({kind:"review_strike", action_id:entry.input.id, strike_id:strike.id, review:assist.read()});
      readReview.refresh = assist.update;
      return readReview;
    }, true);
  }

  el("dm-add-rule").onclick = () => open("Add hand-entered action", "Add action", box => {
    const id = crypto.randomUUID();
    const name = field(box, "Action name", text(120, false, true));
    const rules = field(box, "Rules text", text(4000, true, true));
    return () => ({kind:"add_rule", rule:{id, name:name.value.trim(), text:rules.value.trim()}});
  });
  el("dm-correct-budget").onclick = () => open("Correct action economy", "Save correction", (box, actor) => {
    const state = actor.actions;
    const action = field(box, "Action ready", toggle(state.action));
    const bonus = field(box, "Bonus action ready", toggle(state.bonus));
    const reaction = field(box, "Reaction ready", toggle(state.reaction));
    const max = field(box, "Maximum legendary uses", number(state.legendary_max));
    const left = field(box, "Remaining legendary uses", number(state.legendary_left));
    const reset = field(box, "Legendary recovery", select(resetLabels, state.legendary_reset));
    max.required = left.required = true;
    return () => {
      if (read(left) > read(max)) throw Error("Remaining uses must fit the maximum.");
      return {kind:"correct_budget", action:action.checked, bonus:bonus.checked, reaction:reaction.checked,
        legendary_max:read(max), legendary_left:read(left), legendary_reset:reset.value};
    };
  });
  el("dm-correct-rule").onclick = () => {
    const power = rule();
    if (!power) return;
    open("Correct " + power.name, "Save correction", box => {
      const {policy, counter} = power;
      const cost = field(box, "Source cost", select(labels, policy.cost));
      const legendary = field(box, "Legendary uses spent", number(policy.legendary || 1, 1));
      const max = field(box, "Maximum limited uses (blank for unlimited)", number(policy.uses));
      const left = field(box, "Remaining limited uses", number(counter.remaining));
      const reset = field(box, "Limited-use recovery", select(resetLabels, policy.reset));
      const die = field(box, "Recharge die sides (blank for no recharge)", number(policy.recharge?.die, 1, 1000));
      const minimum = field(box, "Recharge succeeds at", number(policy.recharge?.minimum, 1, 1000));
      const ready = field(box, "Recharge ready", toggle(!counter.spent));
      function update() {
        const legendaryOn = cost.value === "legendary";
        legendary.closest("label").hidden = !legendaryOn;
        legendary.disabled = !legendaryOn;
        left.disabled = reset.disabled = max.value === "";
        minimum.disabled = ready.disabled = die.value === "";
        left.required = !left.disabled;
        minimum.required = !minimum.disabled;
      }
      legendary.required = true;
      for (const input of [cost, max, die]) input.addEventListener("input", update);
      update();
      return () => {
        if (max.value !== "" && read(left) > read(max)) throw Error("Remaining uses must fit the maximum.");
        if (die.value !== "" && read(minimum) > read(die)) throw Error("The minimum must fit the recharge die.");
        return {kind:"correct_rule", rule:power.id,
          policy:{cost:cost.value, legendary:legendary.disabled ? 0 : read(legendary),
            uses:read(max), reset:reset.value,
            recharge:die.value === "" ? null : {die:read(die), minimum:read(minimum)}},
          remaining:left.disabled ? null : read(left), ready:ready.disabled || ready.checked};
      };
    });
  };
  recharge.onsubmit = async event => {
    event.preventDefault();
    if (await change({kind:"monster_action", id:row.id,
      action:{kind:"queue_roll", rule:rule().id, roll:read(recharge.elements.roll)}})) recharge.reset();
  };
  el("dm-clear-roll").onclick = () => change({kind:"monster_action", id:row.id,
    action:{kind:"queue_roll", rule:rule().id, roll:null}});

  el("dm-preview-action").onclick = () => {
    const power = rule();
    if (!power) return;
    open((mode.value === "assist" ? "Assist · " : "Manual · ") + power.name, "Record action", (box, actor) => {
      const id = crypto.randomUUID();
      const localMode = modeField(box, "Resolution mode");
      const strikeBox = make("div");
      const entries = [];
      const freeform = power.strikes.length === 1 && power.strikes[0] === power.id;
      const rows = [
        ...room.combat.rows,
        ...(room.members || []).filter(member => member.member_id !== room.self_id
          && !room.combat.rows.some(row => row.damage_recipient === member.member_id))
          .map(member => ({id:member.member_id, name:member.name}))
      ];
      const choices = Object.fromEntries([["","No listed target"], ...rows.map(target => [
        target.id, rows.some(other => other.id !== target.id && other.name === target.name)
          ? target.name + " · " + target.id.slice(0, 8) : target.name
      ])]);
      const add = Object.assign(make("button", "Add strike or target"), {type:"button"});
      const remove = Object.assign(make("button", "Remove last strike"), {type:"button"});
      function addStrike(ruleId) {
        const strikeId = crypto.randomUUID();
        const group = make("fieldset");
        const rule = actor.actions.rules.find(r => r.id === ruleId);
        group.append(make("legend", "Strike " + (entries.length + 1) + " · " + rule.name));
        if (ruleId !== power.id) group.append(make("p", rule.text));
        const target = field(group, "Target", select(choices));
        const targetNote = field(group, "Private target detail", text(120));
        const total = field(group, "Physical roll total", number(null, -2147483648, 2147483647));
        const outcome = field(group, "Table outcome", select(outcomes));
        const assist = strikeFields(group, rule, () => target.value, total, outcome, localMode);
        target.onchange = assist.update;
        strikeBox.append(group);
        entries.push({group, update:assist.update, read:() => ({
          id:strikeId, rule:ruleId, target:target.value || null,
          target_note:targetNote.value.trim(), ...assist.read()
        })});
        add.disabled = entries.length >= 32;
        remove.disabled = entries.length <= 1;
      }
      const rules = make("p", power.text);
      rules.className = "dm-rule-text";
      box.append(rules, strikeBox);
      for (const ruleId of power.strikes) addStrike(ruleId);
      if (freeform) {
        add.onclick = () => addStrike(power.id);
        remove.onclick = () => {
          entries.pop().group.remove();
          add.disabled = false;
          remove.disabled = entries.length <= 1;
        };
        const controls = make("div");
        controls.className = "dm-controls";
        controls.append(add, remove);
        box.append(controls);
      }
      const note = field(box, "Private note or ruling override", text(1000, true));
      const update = () => entries.forEach(strike => strike.update());
      localMode.onchange = update;
      const readAction = () => ({kind:"record", action:{
        id, rule:power.id, strikes:entries.map(strike => strike.read()), note:note.value.trim()
      }});
      readAction.refresh = update;
      return readAction;
    });
  };
  return render;
}
