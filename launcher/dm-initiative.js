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
      room.members?.map(m => [m.member_id, m.name]),
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
