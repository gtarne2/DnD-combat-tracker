function setupMonsterActions(el, change, selectRow) {
  const panel = el("dm-monster-actions");
  const picker = el("dm-action-rule");
  const dialog = el("dm-action-dialog");
  const form = el("dm-action-form");
  const fields = el("dm-action-fields");
  const submit = el("dm-action-submit");
  const status = form.querySelector("[role=status]");
  const recharge = el("dm-recharge-form");
  const labels = {action:"Action", bonus:"Bonus action", reaction:"Reaction", legendary:"Legendary", manual:"No action slot"};
  const resetLabels = {manual:"Manual / rest", start:"Start of own turn", end:"End of own turn", round:"Round advance"};
  const outcomes = {table:"Table ruling", hit:"Hit", miss:"Miss", save_success:"Save succeeded", save_failure:"Save failed"};
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

  function renderRule() {
    const power = rule(), state = row?.actions;
    el("dm-action-text").textContent = power?.text || "";
    const policy = power?.policy, counter = power?.counter;
    el("dm-rule-counter").textContent = power ? [
      policy.cost === "legendary" ? policy.legendary + " legendary uses" : labels[policy.cost],
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
    el("dm-actions-actor").textContent = row.name + (row.id === current?.id ? " · Current turn" : "") + " · Manual";
    el("dm-action-budget").textContent = [
      ...["action", "bonus", "reaction"].map(key => labels[key] + " " + (actions[key] ? "ready" : "spent")),
      actions.legendary_max ? "Legendary " + actions.legendary_left + " / " + actions.legendary_max : ""
    ].filter(Boolean).join(" · ");
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
        const target = strike.target_note || targetName(state, strike.target) || (strike.target ? "Removed target" : "No specific target");
        const line = make("p", [
          "Strike " + (index + 1), target,
          strike.total === null ? "" : "Total " + strike.total, outcomes[strike.outcome]
        ].filter(Boolean).join(" · "));
        const result = board.damage?.[strike.id]?.result;
        if (strike.outcome === "miss" || result?.kind === "no_damage") {
          line.append(" · No damage");
        } else if (result?.kind === "handled") {
          line.append(" · Handled at table");
        } else if (result?.kind === "sent") {
          const offer = state.offers?.find(o => o.offer_id === result.offer_id);
          if (offer) line.append(" · " + offer.effect.amount + " damage · " + offer.status);
        } else {
          const button = Object.assign(make("button", "Resolve damage for strike " + (index + 1)), {type:"button", disabled:busy});
          const recipient = entry.recipients == null
            ? board.rows.find(r => r.id === strike.target)?.damage_recipient : entry.recipients[strike.id];
          const member = state.members?.find(m => m.member_id === recipient);
          button.onclick = () => resolveDamage(entry.input.id, strike.id, member, target);
          line.append(" ", button);
        }
        item.append(line);
      });
      if (entry.input.note) item.append(make("p", entry.input.note));
      return item;
    }));
  }
  el("dm-current-actions").onclick = () => selectRow(currentId);
  picker.onchange = () => { recharge.reset(); renderRule(); };

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
      status.textContent = el("dm-initiative-status").textContent + " Retry the same entry, or reopen it to review the latest state.";
    }
  };

  function resolveDamage(actionId, strikeId, member, target) {
    open("Resolve damage · " + (member?.name || target), "Confirm damage result", box => {
      const decision = field(box, "Damage result", select({final:"Enter final amount", handled:"Handled at table"}));
      const amount = field(box, member ? "Final damage amount" : "Zero damage (no player sheet target)",
        number(member ? null : 0, 0, member ? 4294967295 : 0));
      amount.required = true;
      decision.onchange = () => {
        amount.disabled = decision.value === "handled";
        amount.closest("label").hidden = amount.disabled;
      };
      return () => ({kind:"finalize_damage", action_id:actionId, strike_id:strikeId,
        decision:amount.disabled ? {kind:"handled"} : {kind:"final", amount:read(amount)}});
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
    open("Manual · " + power.name, "Record action", (box, actor) => {
      const id = crypto.randomUUID();
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
        strikeBox.append(group);
        entries.push({group, read:() => ({
          id:strikeId, rule:ruleId, target:target.value || null,
          target_note:targetNote.value.trim(), total:read(total), outcome:outcome.value
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
      return () => ({kind:"record", action:{
        id, rule:power.id, strikes:entries.map(strike => strike.read()), note:note.value.trim()
      }});
    });
  };
  return render;
}
