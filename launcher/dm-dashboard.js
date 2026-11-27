// DM settings: assists and layout choices, kept in this browser. Other scripts read them with
// dmSettings.get(name) and listen for "dm-settings-change".
const dmSettings = (() => {
  const KEY = "aurora-dm-settings-v1";
  const DEFAULTS = {autoSaves: true, assistDefault: false, openMore: false};
  const values = {...DEFAULTS};
  try { Object.assign(values, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
  const dialog = document.getElementById("dm-settings");
  const inputs = [...dialog.querySelectorAll("[data-dm-setting]")];
  const more = () => document.querySelectorAll("details.dm-more");
  for (const input of inputs) {
    input.checked = Boolean(values[input.dataset.dmSetting]);
    input.addEventListener("change", () => {
      values[input.dataset.dmSetting] = input.checked;
      try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {}
      if (input.dataset.dmSetting === "openMore") for (const details of more()) details.open = input.checked;
      document.dispatchEvent(new Event("dm-settings-change"));
    });
  }
  if (values.openMore) for (const details of more()) details.open = true;
  document.getElementById("dm-settings-open").onclick = () => dialog.showModal();
  return {get: name => Boolean(values[name] ?? DEFAULTS[name])};
})();

const renderDmParty = (() => {
  const rows = document.getElementById("dm-party-list");
  const hint = document.getElementById("dm-join-hint");
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

  function node(tag, value, className) {
    const element = document.createElement(tag);
    if (value != null) element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#gi-" + name);
    svg.append(use);
    return svg;
  }
  // Fill fraction and colour band for an HP bar. Unknown values render an empty track.
  function hpMeter(current, max) {
    const meter = node("span", null, "dm-hp-meter");
    const fill = node("span", null, "dm-hp-fill");
    const ratio = max > 0 && current != null ? Math.max(0, Math.min(1, current / max)) : 0;
    fill.style.width = (ratio * 100).toFixed(1) + "%";
    meter.dataset.band = current == null || !max ? "unknown" : current === 0 ? "down" : ratio <= .25 ? "low" : ratio <= .5 ? "hurt" : "healthy";
    meter.append(fill);
    return meter;
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

    const {vitals, details} = member.inspection;
    content.append(...dmCharacterSections(vitals, details));
  }

  function render(state) {
    lastState = state;
    const members = (state?.members || []).filter(member => member.member_id !== state.self_id);
    if (inspector) renderInspector(members.find(member => member.member_id === inspector));
    const next = JSON.stringify([state?.ended, Boolean(state), ac.checked, members]);
    if (next === signature) return;
    signature = next;
    const focused = document.activeElement.dataset.inspectMember;
    rows.hidden = !members.length;
    empty.hidden = Boolean(members.length);
    hint.hidden = Boolean(members.length || !state || state.ended);
    empty.textContent = !state ? "Waiting for the party helper." : state.ended ? "Room closed." : "Waiting for players to join.";
    rows.replaceChildren(...members.map(member => {
      const card = node("article", null, "dm-member");
      card.dataset.member = member.member_id;
      card.dataset.presence = member.online ? "online" : "offline";
      const head = node("header", null, "dm-member-head");
      const name = node("h3", member.name, "dm-member-name");
      if (members.some(other => other.member_id !== member.member_id && other.name === member.name)) {
        name.append(node("small", member.member_id.slice(0, 8)));
      }
      const status = node("span", null, "dm-presence");
      status.append(node("span", null, "dm-dot"), node("span", presence(member)));
      head.append(name, status);
      card.append(head);
      const vitals = member.inspection?.vitals;
      const foot = node("span", null, "dm-member-foot");
      if (vitals) {
        const hpRow = node("div", null, "dm-hp-row");
        const hpValue = node("span", null, "dm-hp-text");
        hpValue.append(icon("heart-organ"), node("span", hp(vitals), "dm-hp-value"));
        if (vitals.temporary_hp) hpValue.append(node("span", "+" + vitals.temporary_hp + " temp", "dm-temp"));
        hpRow.append(hpValue, hpMeter(vitals.current_hp, vitals.max_hp));
        const stats = node("div", null, "dm-member-stats");
        if (ac.checked) {
          const shield = node("span", null, "dm-stat dm-ac");
          shield.title = "Armor Class";
          shield.append(icon("checked-shield"), node("span", "AC", "dm-stat-label"), node("strong", shown(vitals.effective_ac)));
          stats.append(shield);
        }
        if (vitals.initiative != null) {
          const init = node("span", null, "dm-stat");
          init.title = "Initiative bonus";
          init.append(icon("dice-twenty-faces-twenty"), node("span", "Init", "dm-stat-label"), node("strong", String(vitals.initiative)));
          stats.append(init);
        }
        const tags = node("div", null, "dm-tags");
        for (const condition of vitals.conditions) tags.append(node("span", condition, "dm-tag dm-condition"));
        if (vitals.concentration) {
          const focus = node("span", null, "dm-tag dm-concentration");
          focus.append(icon("magic-swirl"), node("span", vitals.concentration));
          tags.append(focus);
        }
        card.append(hpRow, stats);
        stats.append(foot);
        if (tags.childElementCount) card.append(tags);
      } else {
        card.append(node("p", "Sharing only their name. Players choose what to share in Session → Party.", "dm-member-note"));
      }
      if (member.inspection) {
        const button = node("button");
        button.type = "button";
        button.dataset.inspectMember = member.member_id;
        button.setAttribute("aria-label", "Inspect " + name.textContent);
        button.append(icon("magnifying-glass"), node("span", "Inspect"));
        button.onclick = () => {
          inspector = member.member_id;
          renderInspector(member);
          dialog.showModal();
        };
        foot.append(button);
      } else foot.append(node("span", "Name only", "dm-tag dm-private"));
      if (!vitals) card.append(foot);
      return card;
    }));
    if (focused) (rows.querySelector(`[data-inspect-member="${CSS.escape(focused)}"]`) || ac).focus({preventScroll:true});
  }
  ac.onchange = () => {
    try { localStorage.setItem(setting, String(ac.checked)); } catch {}
    render(lastState);
  };
  return render;
})();

// Shared character details, as sections. Used by the inspector and by the turn order card when
// the DM selects a player. Long lists (attacks, spells, features, inventory) fold away when
// `folded` is set, so the turn card stays short.
function dmCharacterSections(vitals, details, {folded = false, withVitals = true} = {}) {
  const node = (tag, value, className) => {
    const element = document.createElement(tag);
    if (value != null) element.textContent = value;
    if (className) element.className = className;
    return element;
  };
  const shown = value => value ?? "—";
  const sections = [];
  function facts(title, values) {
    if (!values || !Object.keys(values).length) return;
    const list = node("dl");
    for (const [label, value] of Object.entries(values)) {
      const item = node("div");
      item.append(node("dt", label), node("dd", shown(value)));
      list.append(item);
    }
    const section = node("section");
    section.append(node("h3", title), list);
    sections.push(section);
  }
  if (withVitals && vitals) facts("Vitals", {
    HP: vitals ? shown(vitals.current_hp) + " / " + shown(vitals.max_hp) : "—", "Temp HP": vitals.temporary_hp, AC: vitals.effective_ac,
    Initiative: vitals.initiative, Conditions: (vitals.conditions || []).join(", ") || "None",
    Concentration: vitals.concentration ?? "None",
  });
  if (!details) return sections;
  facts("Ability scores", details.ability_scores);
  facts("Saving throws", details.saves);
  facts("Skills", details.skills);
  facts("Resources remaining", details.resources);
  for (const [key, title] of [["attacks", "Attacks"], ["spells", "Spells"], ["features", "Features"], ["inventory", "Inventory"]]) {
    if (!details[key]?.length) continue;
    const section = node(folded ? "details" : "section");
    if (folded) {
      section.className = "dm-fold";
      section.append(node("summary", title + " (" + details[key].length + ")"));
    } else section.append(node("h3", title));
    for (const {name, rules} of details[key]) {
      const rule = node("article");
      rule.append(node("h4", name));
      if (rules) rule.append(node("p", rules));
      section.append(rule);
    }
    sections.push(section);
  }
  return sections;
}

// Owlbear Rodeo link (stage O1): show the pairing code and whether an extension is connected.
;(() => {
  const panel = document.getElementById("dm-owlbear");
  const url = document.body.dataset.partyUrl;
  if (!panel || !url) return;
  const code = document.getElementById("dm-owlbear-code");
  const state = document.getElementById("dm-owlbear-state");
  const port = document.getElementById("dm-owlbear-port");
  const unpair = document.getElementById("dm-owlbear-disconnect");
  async function call(action) {
    const response = await fetch(url + "/" + action, {method:"POST", cache:"no-store", referrerPolicy:"no-referrer"});
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  function show(link) {
    panel.hidden = false;
    code.textContent = link.code;
    const linked = link.sessions > 0 && link.last_seen != null && link.last_seen < 15;
    state.dataset.linked = String(linked);
    state.textContent = linked ? "Linked" : link.sessions > 0 ? "Paired, bridge window closed" : "Not linked";
    unpair.hidden = link.sessions === 0;
    port.hidden = link.port === 47831;
    port.textContent = "Port 47831 was busy, so the bridge uses port " + link.port + ". Enter it under Different port in the extension.";
  }
  let stopped = false;
  async function refresh() {
    if (stopped) return;
    try { show(await call("owlbear")); }
    catch (error) {
      // Player rooms and older helpers have no Owlbear link: keep the panel hidden.
      if (/DM rooms|unavailable/i.test(error.message)) { stopped = true; panel.hidden = true; }
    }
  }
  document.getElementById("dm-owlbear-new").addEventListener("click", async () => show(await call("owlbear_code")));
  unpair.addEventListener("click", async () => show(await call("owlbear_disconnect")));
  refresh();
  setInterval(refresh, 3000);
})();
