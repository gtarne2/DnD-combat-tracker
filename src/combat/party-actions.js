// Sheet-side target choices and the private side of outgoing party actions.
const partyActions = (() => {
  let room;
  const staged = new WeakMap();
  const epoch = previewEncounter.restoreEpoch();
  function members() {
    if (room?.ended || epoch !== previewEncounter.restoreEpoch()) return [];
    return (room?.members || []).filter(member => member.member_id !== room.self_id && member.member_id !== room.dm_id);
  }
  function memberLabel(member) {
    return room.members.some(other => other.name === member.name && other.member_id !== member.member_id)
      ? member.name + " · " + member.member_id.slice(0, 8) : member.name;
  }
  const remoteKey = id => "party:" + room.room_id + ":" + id;
  function setRoom(next) {
    const previous = JSON.stringify(members());
    const id = room?.room_id;
    room = next;
    if (id !== room?.room_id || previous !== JSON.stringify(members())) {
      document.dispatchEvent(new Event("preview-encounter-change"));
    }
  }
  function targets(state) {
    const result = new Map();
    const hp = encounterTracker.hp(state);
    if (hp) result.set("owner", {name: encounterTracker.ownerName, hp});
    for (const card of state.companions?.cards || []) {
      if (card.currentHp != null && companionControls.available(card)) result.set(String(card.id), {name: card.name, hp: card});
    }
    for (const member of members()) result.set(remoteKey(member.member_id), {
      name: memberLabel(member) + (member.online ? " · Party" : " · Offline"), recipient: member.member_id});
    return result;
  }

  function enqueue(state, recipient, source, effect, action_id, binding) {
    const pending = staged.get(state) || [];
    const label = source.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
    pending.push({room: room.room_id, sender: room.self_id, binding,
      command: {kind: "send", action_id, recipient, source: Array.from(label).slice(0, 120).join(""), effect}});
    staged.set(state, pending);
  }

  function applyHp(state, selected, amount, kind, source) {
    if (!selected.length) return true;
    const choices = targets(state);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 0xffffffff || selected.some(id => !choices.has(id))) return false;
    const action = selected.some(id => choices.get(id).recipient) ? crypto.randomUUID() : null;
    const progress = state.progress ||= previewEncounter.emptyProgress();
    for (const id of new Set(selected)) {
      const {hp, recipient} = choices.get(id);
      if (recipient) enqueue(state, recipient, source, {kind, amount}, action);
      else if (kind === "healing") {
        if (id === "owner") encounterTracker.healOwner(progress, "direct", amount);
        else hp.currentHp = Math.min(hp.maxHp ?? 0xffffffff, hp.currentHp + amount);
      } else if (id === "owner") encounterTracker.grantOwnerTemporaryHp(progress, amount);
      else hp.temporary = encounterTracker.temporaryHp(hp, amount);
    }
    return true;
  }

  function sourceGrant(state, key, category) {
    const p = state.progress;
    if (key.startsWith("infusion:")) {
      const id = key.slice(9);
      const bonus = attackModifiers.infusion(id);
      if (!p?.infusions?.includes(id) || !bonus || p.infusionTargets?.[id]) return;
      return {category: bonus.scope, attack: bonus.attack, damage: bonus.damage, stacking: "infusion", end_rule: "source_ends"};
    }
    const ability = p?.abilities?.find(entry => key === "ability:" + entry.id);
    if (!ability?.active || ability.kind !== "imbuement" || ability.attackTarget) return;
    if (ability.link?.startsWith("effect:") && !effectControls.entries(state).some(effect =>
      ability.link === "effect:" + effect.id && effectControls.active(effect))) return;
    return {category, attack: Number(ability.attackBonus) || 0, damage: category === "weapon" ? Number(ability.damageBonus) || 0 : 0,
      stacking: "custom", end_rule: {short: "short_rest", long: "long_rest"}[ability.reset] || "source_ends"};
  }

  function grantControl(key, name, category) {
    const binding = previewEncounter.delivery().sources?.[key];
    if (!members().length && !binding) return;
    const label = document.createElement("label");
    const field = document.createElement("select");
    field.setAttribute("aria-label", "Party assignment for " + name);
    field.add(new Option("No party assignment", ""));
    for (const member of members()) {
      for (const scope of category ? [category] : ["weapon", "spell"]) {
        field.add(new Option(memberLabel(member) + " · " + scope + " attack", remoteKey(member.member_id) + "/" + scope));
      }
    }
    if (binding) {
      const value = "party:" + binding.room + ":" + binding.recipient + "/" + binding.spec.category;
      if (![...field.options].some(o => o.value === value)) field.add(new Option("Current party assignment", value));
      field.value = value;
    }
    field.onchange = () => {
      const choice = field.value;
      previewEncounter.transact(draft => {
        const p = draft.progress;
        if (!p) return false;
        if (!choice) {
          delete p.partyAssignments?.[key];
          return "ending " + name;
        }
        const [target, scope] = choice.split("/");
        const recipient = targets(draft).get(target)?.recipient;
        if (!recipient) return false;
        if (key.startsWith("infusion:")) delete p.infusionTargets?.[key.slice(9)];
        else {
          const ability = p.abilities?.find(entry => key === "ability:" + entry.id);
          if (!ability) return false;
          ability.attackTarget = "";
        }
        const spec = sourceGrant(draft, key, scope);
        if (!spec) return false;
        const grant_id = crypto.randomUUID();
        (p.partyAssignments ||= {})[key] = grant_id;
        enqueue(draft, recipient, name, {kind: "grant", amount: {...spec, grant_id}}, crypto.randomUUID(),
          {key, grant_id, spec, recipient, room: room.room_id, sender: room.self_id});
        return "assigning " + name;
      });
    };
    label.append("Party assignment ", field);
    return label;
  }

  function endedSources(state, current) {
    return Object.values(current.sources || {}).filter(binding =>
      state.progress?.partyAssignments?.[binding.key] !== binding.grant_id ||
      JSON.stringify(sourceGrant(state, binding.key, binding.spec.category)) !== JSON.stringify(binding.spec));
  }

  function prepareDelivery(state, current) {
    const additions = staged.get(state) || [];
    const ended = endedSources(state, current);
    if (!additions.length && !ended.length) return current;
    const ledger = {...current, sources: {...current.sources}, outbox: {...current.outbox}};
    for (const {key, room, sender, grant_id} of ended) {
      delete ledger.sources[key];
      if (state.progress?.partyAssignments?.[key] === grant_id) delete state.progress.partyAssignments[key];
      ledger.outbox[crypto.randomUUID()] = {room, sender, command: {kind: "end_grant", grant_id}};
    }
    for (const {room, sender, command, binding} of additions) {
      ledger.outbox[crypto.randomUUID()] = {room, sender, command};
      if (binding) ledger.sources[binding.key] = binding;
    }
    return ledger;
  }

  return {setRoom, members, memberLabel, targets, applyHp, grantControl, prepareDelivery,
    hasEndedSource: (state, ledger) => endedSources(state, ledger).length > 0};
})();
