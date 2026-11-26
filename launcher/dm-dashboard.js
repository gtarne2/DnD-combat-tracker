const renderDmParty = (() => {
  const table = document.getElementById("dm-party-table");
  const rows = table.tBodies[0];
  const empty = document.getElementById("dm-empty");
  const ac = document.getElementById("dm-show-ac");
  const dialog = document.getElementById("dm-inspector");
  const content = document.getElementById("dm-inspector-content");
  const setting = "aurora-dm-show-ac";
  try { ac.checked = localStorage.getItem(setting) !== "false"; } catch {}

  let lastState;
  let signature;
  let inspector;
  let inspectorSignature;

  function node(tag, value) {
    const element = document.createElement(tag);
    if (value != null) element.textContent = value;
    return element;
  }
  const shown = value => value ?? "—";
  const hp = vitals => !vitals ? "—" : shown(vitals.current_hp) + " / " + shown(vitals.max_hp);
  const presence = member => member.online ? "Online" : member.inspection ? "Offline · stale" : "Offline";
  function clearInspector() {
    inspector = null;
    inspectorSignature = null;
    content.replaceChildren();
    document.getElementById("dm-inspector-title").textContent = "Character inspector";
    document.getElementById("dm-inspector-presence").textContent = "";
  }
  dialog.addEventListener("close", () => { if (!dialog.open) clearInspector(); });

  function renderInspector(member) {
    if (!member?.inspection) {
      clearInspector();
      if (dialog.open) dialog.close();
      return;
    }
    const next = JSON.stringify([member.member_id, member.name, member.online, member.inspection]);
    if (next === inspectorSignature) return;
    inspectorSignature = next;
    document.getElementById("dm-inspector-title").textContent = member.name;
    document.getElementById("dm-inspector-presence").textContent = presence(member);
    content.replaceChildren();

    function facts(title, values) {
      if (!Object.keys(values).length) return;
      const list = node("dl");
      for (const [label, value] of Object.entries(values)) {
        const item = node("div");
        item.append(node("dt", label), node("dd", shown(value)));
        list.append(item);
      }
      const section = node("section");
      section.append(node("h3", title), list);
      content.append(section);
    }

    const {vitals, details} = member.inspection;
    facts("Vitals", {
      HP: hp(vitals), "Temp HP": vitals.temporary_hp, AC: vitals.effective_ac,
      Initiative: vitals.initiative, Conditions: vitals.conditions.join(", ") || "None",
      Concentration: vitals.concentration ?? "None",
    });
    if (!details) return;
    facts("Ability scores", details.ability_scores);
    facts("Saving throws", details.saves);
    facts("Skills", details.skills);
    facts("Resources remaining", details.resources);

    for (const [key, title] of [["attacks", "Attacks"], ["spells", "Spells"], ["features", "Features"], ["inventory", "Inventory"]]) {
      if (!details[key].length) continue;
      const section = node("section");
      section.append(node("h3", title));
      for (const {name, rules} of details[key]) {
        const rule = node("article");
        rule.append(node("h4", name));
        if (rules) rule.append(node("p", rules));
        section.append(rule);
      }
      content.append(section);
    }
  }

  function render(state) {
    lastState = state;
    const members = (state?.members || []).filter(member => member.member_id !== state.self_id);
    if (inspector) renderInspector(members.find(member => member.member_id === inspector));
    const next = JSON.stringify([state?.ended, Boolean(state), ac.checked, members]);
    if (next === signature) return;
    signature = next;
    const focused = document.activeElement.dataset.inspectMember;
    table.hidden = !members.length;
    empty.hidden = Boolean(members.length);
    empty.textContent = !state ? "Waiting for the party helper." : state.ended ? "Room closed." : "Waiting for players to join.";
    document.getElementById("dm-ac-heading").hidden = !ac.checked;
    rows.replaceChildren(...members.map(member => {
      const row = node("tr");
      row.dataset.member = member.member_id;
      const name = node("th", member.name);
      name.scope = "row";
      if (members.some(other => other.member_id !== member.member_id && other.name === member.name)) {
        name.append(node("small", member.member_id.slice(0, 8)));
      }
      const vitals = member.inspection?.vitals;
      row.append(name, node("td", presence(member)), node("td", hp(vitals)), node("td", shown(vitals?.temporary_hp)));
      if (ac.checked) row.append(node("td", shown(vitals?.effective_ac)));
      row.append(node("td", shown(vitals?.initiative)), node("td", vitals ? vitals.conditions.join(", ") || "None" : "—"),
        node("td", vitals ? vitals.concentration ?? "None" : "—"));
      const inspect = node("td");
      if (member.inspection) {
        const button = node("button", "Inspect");
        button.type = "button";
        button.dataset.inspectMember = member.member_id;
        button.setAttribute("aria-label", "Inspect " + name.textContent);
        button.onclick = () => {
          inspector = member.member_id;
          renderInspector(member);
          dialog.showModal();
        };
        inspect.append(button);
      } else inspect.textContent = "Name only";
      row.append(inspect);
      return row;
    }));
    if (focused) (rows.querySelector(`[data-inspect-member="${CSS.escape(focused)}"]`) || ac).focus({preventScroll:true});
  }
  ac.onchange = () => {
    try { localStorage.setItem(setting, String(ac.checked)); } catch {}
    render(lastState);
  };
  return render;
})();
