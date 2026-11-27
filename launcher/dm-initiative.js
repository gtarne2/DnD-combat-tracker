function setupDmInitiative(request, refresh) {
  const el = id => document.getElementById(id);
  const panel = el("dm-initiative");
  const order = el("dm-order");
  const dialog = el("dm-enemy");
  const form = el("dm-enemy-form");
  const status = el("dm-initiative-status");
  const send = initiativeWriter(request);
  let room, editing, busy = false, signature, damageSignature, currentEnemy;
  const selected = () => room?.combat?.rows.find(row => row.id === order.value);
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const icon = name => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#gi-" + name);
    svg.append(use);
    return svg;
  };
  function meter(current, max) {
    const track = make("span", null, "dm-hp-meter");
    const fill = make("span", null, "dm-hp-fill");
    const ratio = max > 0 && current != null ? Math.max(0, Math.min(1, current / max)) : 0;
    fill.style.width = (ratio * 100).toFixed(1) + "%";
    track.dataset.band = current == null || !max ? "unknown" : current === 0 ? "down" : ratio <= .25 ? "low" : ratio <= .5 ? "hurt" : "healthy";
    track.append(fill);
    return track;
  }
  // Pointer shortcut for the turn order. The labelled select stays the keyboard and assistive control.
  const turns = el("dm-turns");
  turns.addEventListener("click", event => {
    const item = event.target.closest("[data-row]");
    if (!item || order.value === item.dataset.row) return;
    order.value = item.dataset.row;
    order.dispatchEvent(new Event("change"));
  });
  let turnsKey;
  function renderTurns() {
    const board = room?.combat;
    const rows = board?.rows || [];
    const key = JSON.stringify([rows, board?.running, board?.current, order.value,
      room?.members?.map(m => [m.member_id, m.name, m.online, m.inspection?.vitals?.current_hp, m.inspection?.vitals?.max_hp, m.inspection?.vitals?.initiative]), busy]);
    if (key === turnsKey) return;
    turnsKey = key;
    renderWaiting(rows);
    el("dm-turns-empty").hidden = rows.length > 0 || waitingCount > 0;
    turns.replaceChildren(...rows.map(row => {
      const item = make("li", null, "dm-turn");
      item.dataset.row = row.id;
      const enemy = row.enemy;
      item.dataset.kind = enemy ? "enemy" : row.damage_recipient ? "player" : "companion";
      if (board.running && row.id === board.current) item.dataset.current = "true";
      if (row.id === order.value) item.dataset.selected = "true";
      const score = make("span", row.score == null ? "—" : String(row.score), "dm-turn-score");
      const body = make("span", null, "dm-turn-body");
      const title = make("span", null, "dm-turn-name");
      title.append(make("span", row.name));
      if (enemy) title.append(icon(enemy.revealed ? "eyeball" : "invisible"));
      body.append(title);
      const sub = [];
      if (board.running && row.id === board.current) sub.push("Current turn");
      if (enemy) sub.push(enemy.revealed ? "Shown as " + enemy.alias : "Hidden from players");
      if (enemy?.template?.pack.edition) sub.push(enemy.template.pack.edition);
      if (row.shared?.length) sub.push("with " + row.shared.join(", "));
      if (enemy?.conditions) sub.push(enemy.conditions);
      body.append(make("span", sub.join(" · "), "dm-turn-sub"));
      let hp = enemy ? {current:enemy.hp, max:enemy.max_hp} : null;
      if (!enemy && row.damage_recipient) {
        const vitals = room.members?.find(m => m.member_id === row.damage_recipient)?.inspection?.vitals;
        if (vitals) hp = {current:vitals.current_hp, max:vitals.max_hp};
      }
      item.append(score, body);
      if (hp) {
        const side = make("span", null, "dm-turn-hp");
        side.append(make("span", (hp.current ?? "—") + " / " + (hp.max ?? "—")), meter(hp.current, hp.max));
        item.append(side);
      }
      return item;
    }));
  }
  // Connected players without a row yet. The DM can seat them with the score they rolled at the table.
  let waitingCount = 0;
  const waitingList = el("dm-waiting-list");
  function renderWaiting(rows) {
    const seated = new Set(rows.map(row => row.damage_recipient).filter(Boolean));
    const members = (room?.members || []).filter(m => m.member_id !== room.self_id && !seated.has(m.member_id));
    waitingCount = members.length;
    el("dm-waiting").hidden = !members.length;
    const typed = new Map([...waitingList.querySelectorAll("input[data-seat]")].map(input => [input.dataset.seat, input.value]));
    const focused = document.activeElement?.closest?.("#dm-waiting-list [data-seat]")?.dataset.seat;
    waitingList.replaceChildren(...members.map(member => {
      const item = make("li", null, "dm-waiting-row");
      item.dataset.presence = member.online ? "online" : "offline";
      const who = make("span", null, "dm-waiting-name");
      who.append(make("span", null, "dm-dot"), make("span", member.name));
      const vitals = member.inspection?.vitals;
      const sub = [member.online ? "Online" : "Offline"];
      if (vitals?.initiative != null) sub.push("Init " + (vitals.initiative >= 0 ? "+" : "") + vitals.initiative);
      who.append(make("small", sub.join(" · ")));
      const form = make("form", null, "dm-seat");
      const input = make("input");
      Object.assign(input, {type:"number", required:true, step:1, min:-20, max:99, value:typed.get(member.member_id) ?? ""});
      input.dataset.seat = member.member_id;
      input.setAttribute("aria-label", "Initiative for " + member.name);
      input.placeholder = "Init";
      const add = make("button");
      add.type = "submit";
      add.dataset.seat = member.member_id;
      add.append(icon("dice-twenty-faces-twenty"), make("span", "Add to order"));
      add.setAttribute("aria-label", "Add " + member.name + " to the turn order");
      add.disabled = busy;
      form.append(input, add);
      form.onsubmit = event => {
        event.preventDefault();
        change({kind:"seat", member:member.member_id, score:input.valueAsNumber});
      };
      item.append(who, form);
      return item;
    }));
    if (focused) waitingList.querySelector(`input[data-seat="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  function renderEnemyCard(row) {
    const card = el("dm-enemy-detail");
    const enemy = row?.enemy;
    el("dm-focus-empty").hidden = Boolean(row);
    card.hidden = !row;
    card.replaceChildren();
    if (!row) return;
    const head = make("div", null, "dm-enemy-head");
    const title = make("h3", row.name);
    head.append(title);
    const board = room.combat;
    if (board.running && row.id === board.current) head.append(make("span", "Current turn", "dm-badge dm-badge-current"));
    if (enemy) {
      const badge = make("span", null, "dm-badge " + (enemy.revealed ? "dm-badge-shown" : "dm-badge-hidden"));
      badge.append(icon(enemy.revealed ? "eyeball" : "invisible"), make("span", enemy.revealed ? "Revealed as " + enemy.alias : "Hidden from players"));
      head.append(badge);
    }
    card.append(head);
    if (!enemy) {
      const vitals = row.damage_recipient && room.members?.find(m => m.member_id === row.damage_recipient)?.inspection?.vitals;
      if (vitals) {
        const stats = make("div", null, "dm-enemy-stats");
        const hp = make("div", null, "dm-enemy-hp");
        const label = make("span", null, "dm-hp-text");
        label.append(icon("heart-organ"), make("span", "HP " + (vitals.current_hp ?? "—") + " / " + (vitals.max_hp ?? "—")));
        if (vitals.temporary_hp) label.append(make("span", "+" + vitals.temporary_hp + " temp", "dm-temp"));
        hp.append(label, meter(vitals.current_hp, vitals.max_hp));
        stats.append(hp);
        if (vitals.effective_ac != null) {
          const armor = make("span", null, "dm-stat dm-ac");
          armor.append(icon("checked-shield"), make("span", "AC", "dm-stat-label"), make("strong", String(vitals.effective_ac)));
          stats.append(armor);
        }
        card.append(stats);
        const tags = make("div", null, "dm-tags");
        for (const condition of vitals.conditions || []) tags.append(make("span", condition, "dm-tag dm-condition"));
        if (vitals.concentration) tags.append(make("span", "Concentrating · " + vitals.concentration, "dm-tag dm-concentration"));
        if (tags.childElementCount) card.append(tags);
      }
      card.append(make("p", "Players run their own turns from their sheet. Select an enemy to use its stat block and actions.", "dm-muted"));
      return;
    }
    const stats = make("div", null, "dm-enemy-stats");
    const hp = make("div", null, "dm-enemy-hp");
    const label = make("span", null, "dm-hp-text");
    label.append(icon("heart-organ"), make("span", "HP " + (enemy.hp ?? "—") + " / " + (enemy.max_hp ?? "—")));
    hp.append(label, meter(enemy.hp, enemy.max_hp));
    const armor = make("span", null, "dm-stat dm-ac");
    armor.append(icon("checked-shield"), make("span", "AC", "dm-stat-label"), make("strong", String(enemy.ac ?? "—")));
    const init = make("span", null, "dm-stat");
    init.append(icon("dice-twenty-faces-twenty"), make("span", "Init", "dm-stat-label"), make("strong", String(row.score)));
    stats.append(hp, armor, init);
    card.append(stats, quickHp(row));
    if (enemy.conditions) {
      const tags = make("div", null, "dm-tags");
      for (const condition of enemy.conditions.split(/\s*,\s*/).filter(Boolean)) tags.append(make("span", condition, "dm-tag dm-condition"));
      card.append(tags);
    }
    if (enemy.notes) card.append(make("p", enemy.notes, "dm-enemy-notes"));
  }
  // Quick damage and healing for the selected enemy, without opening Edit enemy. The typed
  // amount survives the dashboard's refresh.
  let quickAmount = "", quickFocus = false;
  function quickHp(row) {
    const enemy = row.enemy;
    const box = make("form", null, "dm-quick-hp");
    const amount = Object.assign(document.createElement("input"), {type:"number", min:1, max:100000, value:quickAmount, placeholder:"Amount"});
    amount.setAttribute("aria-label", "HP change for " + row.name);
    amount.oninput = () => { quickAmount = amount.value; };
    amount.onfocus = () => { quickFocus = true; };
    amount.onblur = () => { quickFocus = false; };
    const apply = async sign => {
      const value = amount.valueAsNumber;
      if (!Number.isInteger(value) || value < 1 || enemy.hp == null) {
        status.textContent = enemy.hp == null ? "Set this enemy's HP in Edit enemy first." : "Type a whole number first.";
        return;
      }
      const hp = sign < 0 ? Math.max(0, enemy.hp - value) : Math.min(enemy.max_hp ?? Number.MAX_SAFE_INTEGER, enemy.hp + value);
      const next = {revealed:enemy.revealed, hp, max_hp:enemy.max_hp, ac:enemy.ac};
      for (const name of ["name","alias","conditions","notes"]) next[name] = enemy[name] ?? "";
      if (await change({kind:"enemy", id:row.id, score:row.score, enemy:next})) {
        quickAmount = "";
        status.textContent = (sign < 0 ? "Damaged " : "Healed ") + row.name + " by " + value + ". HP " + hp + (enemy.max_hp == null ? "" : " / " + enemy.max_hp) + ".";
      }
    };
    const damage = Object.assign(make("button", "Damage"), {type:"submit", disabled:busy});
    const heal = Object.assign(make("button", "Heal"), {type:"button", disabled:busy});
    heal.onclick = () => apply(1);
    box.onsubmit = event => { event.preventDefault(); apply(-1); };
    box.append(amount, damage, heal);
    if (quickFocus) queueMicrotask(() => amount.focus({preventScroll:true}));
    return box;
  }
  const renderActions = setupMonsterActions(el, change, id => { order.value = id; controls(); });

  function controls() {
    const board = room?.combat;
    if (!board) return;
    const row = selected(), enemy = row?.enemy;
    renderActions(room, row, busy);
    const index = board.rows.indexOf(row);
    const allowed = {start:!board.running && board.rows.length, next:board.running, end:board.running,
      move_up:index > 0 && row.score === board.rows[index-1].score, correct:board.running && row,
      edit:enemy, duplicate:enemy, reveal:enemy, remove:enemy, group:enemy, add:true,
      load:!board.running && board.saves.length, new:!board.running};
    for (const b of panel.querySelectorAll("[data-edit]")) b.disabled = busy || !allowed[b.dataset.edit];
    el("dm-export-encounter").disabled = busy || !board.rows.length;
    el("dm-import-encounter").disabled = busy || board.running;
    const statBlock = el("dm-instance-stat-block");
    statBlock.hidden = !enemy?.template;
    renderMonsterStatBlock(statBlock.querySelector("div"), enemy?.template);
    const reveal = panel.querySelector("[data-edit=reveal]");
    reveal.querySelector(".dm-label").textContent = enemy?.revealed ? "Hide" : "Reveal";
    reveal.querySelector("use").setAttribute("href", enemy?.revealed ? "#gi-invisible" : "#gi-eyeball");
    el("dm-advance").querySelector("button").disabled = busy || !board.running;
    el("dm-save").querySelector("button").disabled = busy;
    renderEnemyCard(row);
    renderTurns();
  }

  async function change(edit, base = room) {
    if (busy || !base?.combat) return false;
    busy = true; controls();
    try {
      await send(base, edit);
      status.textContent = edit.kind === "correct" ? "Turn corrected. Each owner can adjust committed effects and turn actions on their sheet." : "";
      return true;
    } catch (error) {
      status.textContent = error.message;
      form.querySelector("[role=status]").textContent = error.message;
      return false;
    } finally { await refresh(); busy = false; controls(); }
  }

  setupMonsterLibrary(request, change);
  // Remember whether the DM keeps the selected enemy's stat block open.
  const statBlockDetails = el("dm-instance-stat-block");
  try { statBlockDetails.open = localStorage.getItem("aurora-dm-stat-block-open") === "true"; } catch {}
  statBlockDetails.addEventListener("toggle", () => {
    try { localStorage.setItem("aurora-dm-stat-block-open", String(statBlockDetails.open)); } catch {}
  });
  order.onchange = controls;
  panel.addEventListener("click", async event => {
    const kind = event.target.closest("[data-edit]")?.dataset.edit;
    if (!kind || busy) return;
    if (kind === "edit" || kind === "add") {
      await refresh();
      if (!room?.combat || dialog.open) return;
      const row = selected();
      if (kind === "edit" && !row?.enemy) return;
      editing = {room, id:kind === "edit" ? row.id : null};
      const enemy = editing.id ? row.enemy : {};
      form.reset();
      for (const name of ["name","alias","hp","max_hp","ac","conditions","notes"])
        form.elements[name].value = enemy[name] ?? "";
      form.elements.revealed.checked = Boolean(enemy.revealed);
      form.elements.score.value = editing.id ? row.score : 0;
      form.querySelector("[role=status]").textContent = "";
      dialog.showModal();
      return;
    }
    const row = selected();
    if (kind === "load") change({kind,name:el("dm-saves").value});
    else if (kind === "reveal") change({kind,id:row.id,revealed:!row.enemy.revealed});
    else if (["remove","duplicate","move_up","group","correct"].includes(kind)) change({kind,id:row.id});
    else change({kind});
  });
  el("dm-roll").onclick = () => { form.elements.score.value = Math.floor(Math.random()*20)+1; };
  el("dm-cancel").onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const f = form.elements, enemy = {revealed:f.revealed.checked};
    for (const name of ["name","alias","conditions","notes"]) enemy[name] = f[name].value.trim();
    for (const name of ["hp","max_hp","ac"]) enemy[name] = f[name].value === "" ? null : f[name].valueAsNumber;
    if (await change({kind:"enemy",id:editing.id,score:f.score.valueAsNumber,enemy},editing.room)) dialog.close();
    else if (room?.combat?.id === editing.room.combat.id) {
      const row = snapshot => snapshot.combat.rows.find(r => r.id === editing.id);
      if (JSON.stringify(row(room)) === JSON.stringify(row(editing.room))) editing.room = room;
      else form.querySelector("[role=status]").textContent = "This enemy changed. Close and reopen its details to review the latest values.";
    }
  };
  el("dm-advance").onsubmit = event => {
    event.preventDefault();
    const f = event.target.elements;
    change({kind:"advance",amount:f.amount.valueAsNumber,rounds:f.unit.value === "rounds"});
  };
  el("dm-save").onsubmit = event => {
    event.preventDefault();
    change({kind:"save",name:event.target.elements.name.value.trim()});
  };
  // P10 portable encounters. The host owns the file; seats are re-paired explicitly on import.
  const importDialog = el("dm-encounter-import"), importForm = el("dm-encounter-import-form");
  let pendingEncounter;
  el("dm-export-encounter").onclick = async () => {
    try {
      const file = await request("export_encounter");
      const blob = new Blob([JSON.stringify(file, null, 1) + "\n"], {type:"application/json"});
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url;
      a.download = "encounter-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "Exported the encounter without player identities, recorded strikes or pending exchanges.";
    } catch (error) { status.textContent = error.message; }
  };
  el("dm-import-encounter").onchange = async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      // The local helper accepts request bodies up to 1 MiB.
      if (file.size > 1000 * 1000) throw new Error("Encounter files are limited to 1 MB.");
      const encounter = JSON.parse(await file.text());
      if (encounter?.format !== "aurora-encounter" || !Array.isArray(encounter.rows))
        throw new Error("This file is not an exported encounter.");
      await refresh();
      if (!room?.combat || room.combat.running) throw new Error("End the current encounter before importing.");
      pendingEncounter = {encounter, room};
      const rows = encounter.rows, seats = rows.filter(r => r.actor?.kind === "player");
      const enemies = rows.filter(r => r.actor?.kind === "enemy").length;
      const current = rows.find(r => r.id === encounter.current);
      const currentName = current && (current.actor.enemy?.name ?? current.actor.name);
      el("dm-encounter-import-summary").textContent = [
        enemies + (enemies === 1 ? " enemy" : " enemies"), seats.length + (seats.length === 1 ? " player seat" : " player seats"),
        "round " + encounter.round, currentName ? "turn pointer on " + currentName : "no turn pointer",
        encounter.running ? "exported while running (resume with Start)" : "exported while stopped"
      ].join(" · ") + ".";
      const players = (room.members || []).filter(m => m.member_id !== room.self_id);
      const box = el("dm-encounter-seats");
      box.replaceChildren(...seats.map(seat => {
        const label = document.createElement("label");
        const companions = seat.actor.companions.map(c => c.name);
        label.textContent = seat.actor.name + (companions.length ? " (with " + companions.join(", ") + ")" : "") + " ";
        const select = document.createElement("select");
        select.dataset.seat = seat.id;
        select.append(new Option("Leave out", ""), ...players.map(m => new Option(
          m.name + (players.some(o => o !== m && o.name === m.name) ? " · " + m.member_id.slice(0, 8) : ""), m.member_id)));
        // Guess: prefill only an unambiguous same-name player. The DM still confirms every seat.
        const same = players.filter(m => m.name === seat.actor.name);
        if (same.length === 1) select.value = same[0].member_id;
        label.append(select);
        return label;
      }));
      importForm.querySelector("[role=status]").textContent = "";
      importDialog.showModal();
    } catch (error) { status.textContent = error.message; }
  };
  el("dm-encounter-import-cancel").onclick = () => importDialog.close();
  importForm.onsubmit = async event => {
    event.preventDefault();
    const seats = {}, chosen = new Set();
    for (const select of el("dm-encounter-seats").querySelectorAll("select")) {
      if (!select.value) continue;
      if (chosen.has(select.value)) {
        importForm.querySelector("[role=status]").textContent = "Pair each player with at most one seat.";
        return;
      }
      chosen.add(select.value);
      seats[select.dataset.seat] = select.value;
    }
    if (await change({kind:"import", encounter:pendingEncounter.encounter, seats}, room)) {
      importDialog.close();
      status.textContent = "Imported the encounter. Review the order, then Start / resume encounter.";
    } else importForm.querySelector("[role=status]").textContent = status.textContent;
  };

  // Area spells (O5). The caster sent rolled damage for confirmed targets. Assist rolls each
  // target's save, halves or zeroes damage on a success, and applies resistances, immunities and
  // vulnerabilities to the spell's damage type. The DM checks the table and presses Apply.
  const areaChoices = new Map();
  let areasKey;
  const AREA_ROLLS = "aurora-dm-area-rolls";
  let areaRolls = {};
  try { areaRolls = JSON.parse(localStorage.getItem(AREA_ROLLS) || "{}"); } catch {}
  const title = text => text.charAt(0).toUpperCase() + text.slice(1);
  function saveBonus(row, ability) {
    const want = [ability, ability.slice(0, 3)];
    const find = map => {
      const key = Object.keys(map || {}).find(k => want.some(w => k.toLowerCase().startsWith(w)));
      return key === undefined ? null : map[key];
    };
    if (row.enemy) {
      const stats = row.enemy.template?.monster.stats;
      if (!stats) return null;
      const save = stats.saves?.[title(ability)];
      if (Number.isInteger(save)) return save;
      const score = stats.abilities?.[title(ability)];
      return Number.isInteger(score) ? Math.floor((score - 10) / 2) : null;
    }
    const member = room.members?.find(m => m.member_id === row.damage_recipient);
    const details = member?.inspection?.details;
    const save = find(details?.saves);
    if (Number.isInteger(save)) return save;
    const score = find(details?.ability_scores);
    return Number.isInteger(score) ? Math.floor((score - 10) / 2) : null;
  }
  function defense(row, type) {
    const defenses = row.enemy?.template?.monster.stats.defenses;
    if (!defenses || !type) return {factor: 1, note: ""};
    const names = text => !text || /nonmagical/i.test(text) ? false : new RegExp("\\b" + type + "\\b", "i").test(text);
    if (names(defenses.immunities)) return {factor: 0, note: "immune to " + type};
    if (names(defenses.resistances)) return {factor: .5, note: "resists " + type};
    if (names(defenses.vulnerabilities)) return {factor: 2, note: "vulnerable to " + type};
    return {factor: 1, note: ""};
  }
  function areaAmount(area, row, outcome) {
    if (outcome === "table") return 0;
    let amount = area.amount;
    if (outcome === "succeeded") amount = area.save?.on_success === "half" ? Math.floor(amount / 2) : 0;
    return Math.floor(amount * defense(row, area.damage_type).factor);
  }
  const rollNow = new Set();
  document.addEventListener("dm-settings-change", () => { areasKey = null; if (room?.combat) renderAreas(); });
  function renderAreas() {
    const board = room.combat;
    const pending = (board.areas || []).filter(area => !area.results);
    // Zone spells: who starts this turn inside a lasting template.
    const current = board.running && board.rows.find(row => row.id === board.current);
    const zones = current ? (board.templates || []).filter(t => t.lasts === "concentration" && (t.inside || []).includes(current.id)) : [];
    const zoneNote = el("dm-zone-note");
    zoneNote.hidden = !zones.length;
    zoneNote.textContent = zones.map(t => {
      const caster = board.rows.find(row => row.damage_recipient === t.member_id)?.name || "its caster";
      return current.name + " starts its turn inside " + t.spell + " (" + caster + "). " + caster + " can send it again from their sheet.";
    }).join(" ");
    const key = JSON.stringify([pending, board.rows.map(r => [r.id, r.name]), room.members?.map(m => [m.member_id, m.inspection?.details?.saves]), busy]);
    if (key === areasKey) return;
    areasKey = key;
    el("dm-areas").hidden = !pending.length;
    let rolled = false;
    el("dm-area-list").replaceChildren(...pending.map(area => {
      const box = make("article", null, "dm-area");
      const caster = board.rows.find(row => row.damage_recipient === area.member_id)?.name || "A player";
      const save = area.save ? " · " + title(area.save.ability) + " save DC " + area.save.dc + (area.save.on_success === "half" ? ", half on success" : ", none on success") : " · no save";
      box.append(make("p", area.spell + " from " + caster + " · " + area.amount + " " + (area.damage_type || "") + " damage" + save, "dm-area-head"));
      const table = make("table");
      const head = make("tr");
      for (const label of ["Target", "Save", "Outcome", "Damage"]) head.append(make("th", label));
      table.append(head);
      const inputs = [];
      // Four wolves read as Wolf 1 to Wolf 4, in initiative order.
      const named = board.rows.filter(r => area.targets.includes(r.id));
      const seen = new Map();
      const label = new Map(named.map(row => {
        const twins = named.filter(other => other.name === row.name).length;
        const n = (seen.get(row.name) || 0) + 1;
        seen.set(row.name, n);
        return [row.id, twins > 1 ? row.name + " " + n : row.name];
      }));
      for (const row of named) {
        const target = row.id;
        const id = area.id + "/" + target;
        const companion = !row.enemy && !row.damage_recipient;
        const bonus = area.save ? saveBonus(row, area.save.ability) : null;
        if (area.save && bonus !== null && !areaRolls[id] && (dmSettings.get("autoSaves") || rollNow.has(area.id))) {
          areaRolls[id] = {d20: monsterAssist.die(20)};
          rolled = true;
        }
        const roll = areaRolls[id];
        const total = roll && bonus !== null ? roll.d20 + bonus : null;
        const suggested = companion ? "table" : !area.save ? "failed" : total === null ? "" : total >= area.save.dc ? "succeeded" : "failed";
        const choice = areaChoices.get(id) || {outcome: suggested, amount: null};
        areaChoices.set(id, choice);
        const tr = make("tr");
        tr.append(make("td", label.get(target) + (row.enemy && !row.enemy.revealed ? " (hidden)" : "")));
        tr.append(make("td", !area.save ? "—" : total === null ? (companion ? "At the table" : bonus !== null ? "Not rolled (" + (bonus >= 0 ? "+" : "−") + Math.abs(bonus) + ")" : "Unknown bonus") : "d20 " + roll.d20 + (bonus >= 0 ? " + " : " − ") + Math.abs(bonus) + " = " + total));
        const outcome = document.createElement("select");
        outcome.setAttribute("aria-label", "Outcome for " + label.get(target));
        if (!choice.outcome) outcome.append(new Option("Choose…", ""));
        for (const [value, label] of [["failed", area.save ? "Failed" : "Hit"], ["succeeded", "Succeeded"], ["table", "At the table"]])
          if (value !== "succeeded" || area.save) outcome.append(new Option(label, value));
        outcome.value = choice.outcome;
        const amount = Object.assign(document.createElement("input"), {type: "number", min: 0, max: 100000});
        amount.setAttribute("aria-label", "Damage to " + label.get(target));
        const fill = () => { amount.value = choice.outcome ? String(choice.amount ?? areaAmount(area, row, choice.outcome)) : ""; };
        fill();
        outcome.onchange = () => { choice.outcome = outcome.value; choice.amount = null; fill(); apply.disabled = !ready(); };
        amount.onchange = () => { choice.amount = amount.valueAsNumber; };
        const cell = make("td");
        cell.append(outcome);
        const note = defense(row, area.damage_type).note || (companion ? "companion" : "");
        if (note) cell.append(make("span", " " + note, "dm-area-note"));
        tr.append(cell);
        const damage = make("td");
        damage.append(amount);
        tr.append(damage);
        table.append(tr);
        inputs.push({row: target, choice, amount});
      }
      box.append(table);
      const ready = () => inputs.every(input => input.choice.outcome);
      const actions = make("div", null, "dm-area-actions");
      const apply = make("button", "Apply", "dm-primary");
      apply.type = "button";
      apply.disabled = busy || !ready();
      apply.onclick = async () => {
        const results = inputs.map(({row, choice, amount}) => ({row, amount: Math.max(0, Math.min(100000, Math.floor(amount.valueAsNumber) || 0)), save: choice.outcome}));
        if (await change({kind: "apply_area", id: area.id, results})) {
          for (const {row} of inputs) { areaChoices.delete(area.id + "/" + row); delete areaRolls[area.id + "/" + row]; }
          try { localStorage.setItem(AREA_ROLLS, JSON.stringify(areaRolls)); } catch {}
        }
      };
      const dismiss = make("button", "Dismiss");
      dismiss.type = "button";
      dismiss.disabled = busy;
      dismiss.onclick = () => change({kind: "dismiss_area", id: area.id});
      // With automatic saves off, Assist rolls only when asked.
      if (area.save && !dmSettings.get("autoSaves") && inputs.some(({row}) => !areaRolls[area.id + "/" + row])) {
        const roll = make("button", "Roll saves");
        roll.type = "button";
        roll.disabled = busy;
        roll.onclick = () => { rollNow.add(area.id); areasKey = null; renderAreas(); };
        actions.append(roll);
      }
      actions.append(apply, dismiss);
      box.append(actions);
      return box;
    }));
    if (rolled) try { localStorage.setItem(AREA_ROLLS, JSON.stringify(areaRolls)); } catch {}
  }

  return async state => {
    room = state;
    panel.hidden = !room?.combat || room.ended;
    if (panel.hidden) {
      signature = null;
      damageSignature = null;
      currentEnemy = null;
      if (dialog.open) dialog.close();
      renderActions(room, null, busy);
      return;
    }
    const board = room.combat;
    const next = JSON.stringify([room.room_id,board.id,board.revision]);
    const damageNext = JSON.stringify([
      room.members?.map(m => [m.member_id, m.name, m.online, m.inspection?.vitals?.effective_ac]),
      room.offers?.filter(offer => offer.effect.kind === "damage")
    ]);
    renderAreas();
    if (signature === next) {
      renderTurns();
      if (damageSignature !== damageNext) renderActions(room, selected(), busy);
      damageSignature = damageNext;
      return;
    }
    signature = next;
    damageSignature = damageNext;
    const prior = order.value, save = el("dm-saves").value;
    order.replaceChildren(...board.rows.map(row => new Option(
      (board.running && row.id === board.current ? "Current · " : "") + row.score + " · " + row.name
        + (row.enemy?.template?.pack.edition ? " · " + row.enemy.template.pack.edition : "")
        + (row.shared?.length ? " with " + row.shared.join(", ") : ""),row.id)));
    const activeEnemy = board.running && board.rows.find(row => row.id === board.current && row.enemy);
    order.value = activeEnemy && activeEnemy.id !== currentEnemy ? activeEnemy.id
      : board.rows.some(row => row.id === prior) ? prior : board.current || board.rows[0]?.id || "";
    currentEnemy = activeEnemy?.id;
    el("dm-saves").replaceChildren(...board.saves.map(name => new Option(name,name)));
    if (board.saves.includes(save)) el("dm-saves").value = save;
    el("dm-round").textContent = board.running ? "Round " + board.round : "Encounter inactive";
    controls();
  };
}
