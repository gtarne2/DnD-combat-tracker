// Table tools beside initiative: reaction calls to players (R81), damage from lasting spell
// areas (R83), encounter difficulty (R84) and the end-of-fight recap (R85).
function setupDmTable({change, shownName, status}) {
  const el = id => document.getElementById(id);
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, onclick, className) => {
    const node = make("button", text, className);
    node.type = "button";
    node.onclick = onclick;
    return node;
  };
  let room;
  const rowName = id => {
    const row = room?.combat?.rows.find(r => r.id === id);
    return row ? shownName(row) : "Someone";
  };
  const memberName = member => room?.combat?.rows.find(r => r.damage_recipient === member)?.name
    || room?.members?.find(m => m.member_id === member)?.name || "A player";
  const players = () => (room?.combat?.rows || []).filter(r => !r.enemy && r.damage_recipient);

  // Dice such as "3d8", "2d6+3" or "8d6 + 1d4".
  function roll(text) {
    const expression = String(text || "").replace(/\s+/g, "");
    if (!/^\d*d\d+([+-]\d*d?\d+)*$/i.test(expression)) return null;
    let total = 0;
    for (const [, sign, count, sides, flat] of expression.matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/gi)) {
      let value = 0;
      if (sides) for (let i = 0; i < (Number(count) || 1); i++) value += monsterAssist.die(Number(sides));
      else value = Number(flat);
      total += sign === "-" ? -value : value;
    }
    return Math.max(0, total);
  }

  // Reaction calls (R81). The DM asks chosen players whether they react to what a creature is
  // doing: leaving their reach, casting a spell or attacking. Each player answers from their
  // sheet, and the answers show here until the turn moves on.
  const TRIGGERS = {
    leaves_reach: {label: "Leaves reach", phrase: "is leaving someone's reach", hint: "Opportunity attack"},
    casts_spell: {label: "Casts a spell", phrase: "is casting a spell", hint: "Counterspell and similar"},
    attacks: {label: "Attacks", phrase: "is attacking", hint: "Shield, Protection and similar"},
    other: {label: "Other", phrase: "is doing something", hint: "Any reaction"},
  };
  const drafts = new Map();
  function callForm(row) {
    const draft = drafts.get(row.id) || {trigger: "casts_spell", detail: "", unticked: new Set()};
    drafts.set(row.id, draft);
    const fold = make("details", null, "dm-call-form");
    fold.append(make("summary", "Ask players for reactions"));
    const triggers = make("div", null, "dm-call-triggers");
    triggers.setAttribute("role", "group");
    triggers.setAttribute("aria-label", "What is happening");
    const detail = Object.assign(document.createElement("input"), {maxLength: 80, value: draft.detail});
    detail.setAttribute("aria-label", "Detail for players");
    const placeholder = () => { detail.placeholder = draft.trigger === "casts_spell" ? "Spell and level, such as Fireball (3rd)" : draft.trigger === "attacks" ? "Target, such as Lark" : "Optional detail"; };
    for (const [value, trigger] of Object.entries(TRIGGERS)) {
      const pick = button(trigger.label, () => {
        draft.trigger = value;
        for (const other of triggers.children) other.setAttribute("aria-pressed", String(other === pick));
        placeholder();
      });
      pick.title = trigger.hint;
      pick.setAttribute("aria-pressed", String(draft.trigger === value));
      triggers.append(pick);
    }
    placeholder();
    detail.oninput = () => { draft.detail = detail.value; };
    const who = make("div", null, "dm-call-who");
    const list = players();
    for (const player of list) {
      const label = make("label");
      const box = Object.assign(document.createElement("input"), {type: "checkbox", checked: !draft.unticked.has(player.damage_recipient)});
      box.onchange = () => box.checked ? draft.unticked.delete(player.damage_recipient) : draft.unticked.add(player.damage_recipient);
      label.append(box, " " + player.name);
      who.append(label);
    }
    const send = button("Ask", async () => {
      const recipients = list.map(p => p.damage_recipient).filter(member => !draft.unticked.has(member));
      if (!recipients.length) { status.textContent = "Tick at least one player to ask."; return; }
      if (await change({kind: "call_reaction", call: {id: crypto.randomUUID(), source: row.id, trigger: draft.trigger, detail: draft.detail.trim(), recipients}})) {
        draft.detail = "";
        status.textContent = "Asked " + recipients.length + (recipients.length === 1 ? " player" : " players") + " about " + shownName(row) + ".";
      }
    }, "dm-primary");
    if (!list.length) fold.append(make("p", "No players are in the turn order yet.", "dm-muted"));
    else fold.append(triggers, detail, who, send);
    return fold;
  }
  let callsKey;
  function renderCalls() {
    const calls = room.combat.calls || [];
    const key = JSON.stringify([calls, room.combat.rows.map(r => [r.id, r.name])]);
    if (key === callsKey) return;
    callsKey = key;
    el("dm-calls").hidden = !calls.length;
    el("dm-call-list").replaceChildren(...calls.map(call => {
      const box = make("article", null, "dm-area dm-call");
      const trigger = TRIGGERS[call.trigger] || TRIGGERS.other;
      box.append(make("p", rowName(call.source_id) + " " + trigger.phrase + (call.detail ? ": " + call.detail : ""), "dm-area-head"));
      const answers = make("ul", null, "dm-call-answers");
      for (const member of call.recipients) {
        const answer = call.answers?.[member];
        const item = make("li");
        item.append(make("strong", memberName(member) + " "), make("span", !answer ? "Waiting…" : answer.reacted ? "Reacts" + (answer.note ? ": " + answer.note : "") : "Passes", answer?.reacted ? "dm-call-react" : "dm-muted"));
        answers.append(item);
      }
      box.append(answers);
      const actions = make("div", null, "dm-area-actions");
      actions.append(button("Close", () => change({kind: "dismiss_call", id: call.id})));
      box.append(actions);
      return box;
    }));
  }

  // Lasting spell areas (R83). A creature takes the damage the first time on a turn that it
  // enters the area or when it starts its turn there. With the Owlbear map linked, the
  // dashboard notices both for enemies and offers to queue the damage; any area can also be
  // queued by hand for a creature the DM picks.
  const lasting = () => (room.combat.templates || []).filter(t => t.damage && t.lasts !== "turn" && !t.anchor);
  let turn = null, seen = new Map(), hit = new Map();
  const prompts = [];
  function watchZones() {
    const board = room.combat;
    const templates = lasting();
    const key = board.running ? board.round + ":" + board.current : null;
    if (key !== turn) {
      turn = key;
      seen = new Map();
      hit = new Map();
      prompts.length = 0;
      if (key) for (const t of templates) {
        const inside = new Set(t.inside || []);
        seen.set(t.id, inside);
        const current = board.rows.find(r => r.id === board.current);
        if (current?.enemy && inside.has(current.id)) prompt(t, current, "starts its turn in");
      }
    }
    if (!key) return;
    for (const t of templates) {
      if (!Array.isArray(t.inside)) continue;
      const before = seen.get(t.id);
      if (!before) { seen.set(t.id, new Set(t.inside)); continue; }
      for (const id of t.inside) {
        if (before.has(id)) continue;
        before.add(id);
        const row = board.rows.find(r => r.id === id);
        if (row?.enemy) prompt(t, row, "enters");
      }
    }
    for (let i = prompts.length - 1; i >= 0; i--) if (!templates.some(t => t.id === prompts[i].template.id)) prompts.splice(i, 1);
  }
  function prompt(template, row, verb) {
    const done = hit.get(template.id) || new Set();
    hit.set(template.id, done);
    if (done.has(row.id)) return;
    done.add(row.id);
    prompts.push({id: crypto.randomUUID(), template, row: row.id, verb});
  }
  const caster = t => room.combat.rows.find(r => r.damage_recipient === t.member_id)?.name || "its caster";
  const describe = t => t.damage + (t.damage_type ? " " + t.damage_type : "")
    + (t.save ? " · " + t.save.ability.charAt(0).toUpperCase() + t.save.ability.slice(1) + " save DC " + t.save.dc + (t.save.on_success === "half" ? ", half on success" : "") : "");
  async function queue(template, targets) {
    const amount = roll(template.damage);
    if (amount === null) { status.textContent = "Couldn't read the damage dice " + template.damage + "."; return false; }
    const ok = await change({kind: "queue_zone", id: crypto.randomUUID(), template: template.id, targets, amount});
    if (ok) status.textContent = "Queued " + amount + " " + (template.damage_type || "") + " damage from " + template.spell + " (rolled " + template.damage + "). Resolve it under Area spells.";
    return ok;
  }
  const picks = new Map();
  let zonesKey;
  function renderZones() {
    const templates = lasting();
    const board = room.combat;
    const key = JSON.stringify([templates, prompts.map(p => p.id), board.rows.map(r => [r.id, shownName(r)])]);
    if (key === zonesKey) return;
    zonesKey = key;
    el("dm-zones").hidden = !templates.length;
    const items = [];
    for (const p of prompts) {
      const box = make("article", null, "dm-area dm-zone-prompt");
      box.append(make("p", rowName(p.row) + " " + p.verb + " " + p.template.spell + " (" + caster(p.template) + ") · " + describe(p.template), "dm-area-head"));
      const actions = make("div", null, "dm-area-actions");
      const drop = () => { prompts.splice(prompts.indexOf(p), 1); zonesKey = null; renderZones(); };
      actions.append(button("Roll and queue " + p.template.damage, async () => { if (await queue(p.template, [p.row])) drop(); }, "dm-primary"), button("Skip", drop));
      box.append(actions);
      items.push(box);
    }
    for (const t of templates) {
      const box = make("article", null, "dm-area dm-zone");
      const inside = Array.isArray(t.inside) ? t.inside.map(rowName) : null;
      box.append(make("p", t.spell + " (" + caster(t) + ") · " + describe(t), "dm-area-head"));
      if (inside) box.append(make("p", inside.length ? "Inside on the map: " + inside.join(", ") : "Nobody inside on the map.", "dm-waiting-hint"));
      const actions = make("div", null, "dm-area-actions");
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Creature to damage with " + t.spell);
      for (const row of board.rows) select.add(new Option(shownName(row), row.id));
      if (picks.has(t.id) && board.rows.some(r => r.id === picks.get(t.id))) select.value = picks.get(t.id);
      else if (board.rows.some(r => r.id === board.current)) select.value = board.current;
      select.onchange = () => picks.set(t.id, select.value);
      actions.append(select, button("Roll and queue", () => queue(t, [select.value])));
      box.append(actions);
      items.push(box);
    }
    el("dm-zone-list").replaceChildren(...items);
  }

  // Encounter difficulty (R84) from each enemy's XP, or its challenge rating, against the
  // party's thresholds: the 2014 DMG's adjusted XP or the 2024 DMG's XP budget.
  const CR_XP = {"0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100, "5": 1800, "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900,
    "11": 7200, "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000, "17": 18000, "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000,
    "23": 50000, "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000, "30": 155000};
  // Easy, Medium, Hard, Deadly per character, levels 1 to 20.
  const DMG_2014 = [[25,50,75,100],[50,100,150,200],[75,150,225,400],[125,250,375,500],[250,500,750,1100],[300,600,900,1400],[350,750,1100,1700],
    [450,900,1400,2100],[550,1100,1600,2400],[600,1200,1900,2800],[800,1600,2400,3600],[1000,2000,3000,4500],[1100,2200,3400,5100],[1250,2500,3800,5700],
    [1400,2800,4300,6400],[1600,3200,4800,7200],[2000,3900,5900,8800],[2100,4200,6300,9500],[2400,4900,7300,10900],[2800,5700,8500,12700]];
  // Low, Moderate, High per character.
  const DMG_2024 = [[50,75,100],[100,150,200],[150,225,400],[250,375,500],[500,750,1100],[600,1000,1400],[750,1300,1700],[1000,1700,2100],
    [1300,2000,2600],[1600,2300,3100],[1900,2900,4100],[2200,3700,4700],[2600,4200,5400],[2900,4900,6200],[3300,5400,7800],[3800,6100,9800],
    [4500,7200,11700],[5000,8700,14200],[5500,10700,17200],[6400,13200,22000]];
  const MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  const STORE = "aurora-dm-difficulty-v1";
  let prefs = {level: 1, size: null, rules: "auto"};
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORE)) || {}); } catch {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch {} };
  const levelInput = el("dm-party-level"), sizeInput = el("dm-party-size"), rulesInput = el("dm-difficulty-rules");
  levelInput.value = prefs.level;
  sizeInput.value = prefs.size ?? "";
  rulesInput.value = prefs.rules;
  levelInput.onchange = () => { prefs.level = Math.max(1, Math.min(20, Math.round(levelInput.valueAsNumber) || 1)); save(); renderDifficulty(true); };
  sizeInput.onchange = () => { prefs.size = sizeInput.value === "" ? null : Math.max(1, Math.min(12, Math.round(sizeInput.valueAsNumber) || 1)); save(); renderDifficulty(true); };
  rulesInput.onchange = () => { prefs.rules = rulesInput.value; save(); renderDifficulty(true); };
  const thousands = n => n.toLocaleString("en-US");
  function xpOf(enemy) {
    const stats = enemy.template?.monster?.stats;
    if (!stats) return null;
    if (Number.isInteger(stats.details?.xp)) return stats.details.xp;
    const cr = String(stats.challenge || "").trim().match(/^(\d+\/\d+|\d+)/)?.[1];
    return cr && CR_XP[cr] != null ? CR_XP[cr] : null;
  }
  function difficulty() {
    const board = room.combat;
    const enemies = board.rows.filter(r => r.enemy);
    if (!enemies.length) return null;
    const size = prefs.size || players().length || (room.members || []).filter(m => m.member_id !== room.self_id).length || 1;
    const level = prefs.level;
    const known = enemies.map(r => xpOf(r.enemy)).filter(xp => xp !== null);
    const unknown = enemies.length - known.length;
    const total = known.reduce((a, b) => a + b, 0);
    const editions = enemies.map(r => r.enemy.template?.pack?.edition).filter(Boolean);
    const rules = prefs.rules !== "auto" ? prefs.rules : editions.length && editions.every(e => /2024/.test(e)) ? "2024" : "2014";
    const standing = enemies.filter(r => r.enemy.hp !== 0).length;
    if (rules === "2024") {
      const [low, moderate, high] = DMG_2024[level - 1].map(v => v * size);
      const rating = total >= high ? (total > high ? "Above High" : "High") : total >= moderate ? "Moderate" : total >= low ? "Low" : "Below Low";
      return {rating, rules, line: thousands(total) + " XP", detail: "2024 DMG budget for " + size + " level-" + level + " characters: Low " + thousands(low) + ", Moderate " + thousands(moderate) + ", High " + thousands(high) + ".", unknown, standing, count: enemies.length};
    }
    const counted = known.length;
    let step = counted <= 1 ? 1 : counted === 2 ? 2 : counted <= 6 ? 3 : counted <= 10 ? 4 : counted <= 14 ? 5 : 6;
    if (size < 3) step += 1;
    else if (size >= 6) step -= 1;
    const multiplier = MULTIPLIERS[Math.max(0, Math.min(MULTIPLIERS.length - 1, step))];
    const adjusted = Math.round(total * multiplier);
    const [easy, medium, hard, deadly] = DMG_2014[level - 1].map(v => v * size);
    const rating = adjusted >= deadly ? "Deadly" : adjusted >= hard ? "Hard" : adjusted >= medium ? "Medium" : adjusted >= easy ? "Easy" : "Trivial";
    return {rating, rules, line: thousands(adjusted) + " adjusted XP (" + thousands(total) + " × " + multiplier + ")",
      detail: "2014 DMG thresholds for " + size + " level-" + level + " characters: Easy " + thousands(easy) + ", Medium " + thousands(medium) + ", Hard " + thousands(hard) + ", Deadly " + thousands(deadly) + ".",
      unknown, standing, count: enemies.length};
  }
  let difficultyKey;
  function renderDifficulty(force = false) {
    const board = room?.combat;
    const result = board && difficulty();
    const key = JSON.stringify([result, prefs]);
    if (!force && key === difficultyKey) return;
    difficultyKey = key;
    el("dm-difficulty").hidden = !result;
    if (!result) return;
    const line = el("dm-difficulty-line");
    line.replaceChildren(make("strong", result.rating), " · " + result.line + (result.standing < result.count ? " · " + result.standing + " of " + result.count + " enemies standing" : ""));
    line.dataset.rating = result.rating.toLowerCase().replace(/\s+/g, "-");
    el("dm-difficulty-detail").textContent = result.detail + (result.unknown ? " " + result.unknown + (result.unknown === 1 ? " enemy has" : " enemies have") + " no challenge rating and isn't counted." : "");
  }

  // Fight recap (R85), once the encounter has ended.
  let recapKey, recapText = "";
  el("dm-recap-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(recapText); status.textContent = "Copied the recap."; }
    catch { status.textContent = "Copying isn't available here. Select the recap text instead."; }
  };
  el("dm-recap-clear").onclick = () => change({kind: "clear_log"});
  function renderRecap() {
    const board = room.combat;
    const recap = !board.running ? fightRecap(board.log) : null;
    const key = JSON.stringify([board.running, board.log?.length, recap?.text]);
    if (key === recapKey) return;
    recapKey = key;
    el("dm-recap").hidden = !recap;
    recapText = recap?.text || "";
    el("dm-recap-body").replaceChildren(...(recap?.lines || []).map((text, i) => make("p", text, i ? "dm-recap-line" : "dm-recap-head")));
  }

  return {
    callForm,
    render(state) {
      room = state;
      if (!room?.combat || room.ended) return;
      watchZones();
      renderCalls();
      renderZones();
      renderDifficulty();
      renderRecap();
    },
  };
}
