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
    panel.querySelector("[data-edit=reveal]").textContent = enemy?.revealed ? "Hide" : "Reveal";
    el("dm-advance").querySelector("button").disabled = busy || !board.running;
    el("dm-save").querySelector("button").disabled = busy;
    el("dm-enemy-detail").textContent = enemy ? [
      enemy.revealed ? "Revealed as " + enemy.alias : "Hidden from players", "HP " + (enemy.hp ?? "—") + " / " + (enemy.max_hp ?? "—"),
      "AC " + (enemy.ac ?? "—"), enemy.conditions, enemy.notes
    ].filter(Boolean).join(" · ") : "";
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
  order.onchange = controls;
  panel.addEventListener("click", async event => {
    const kind = event.target.dataset.edit;
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
    if (signature === next) {
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
