const partyInitiative = (() => {
  let view, left = null;
  let sendEdit = null, refreshView = null;
  const clearing = new Set();
  function rows(state) {
    const clock = state.progress.partyClock;
    if (view?.combat?.id === clock.encounter && view.combat.rows.length)
      return view.combat.rows.map(row => ({...row, rank: 3}));
    return [{key:state.progress.current, name:state.progress.current === "owner" ? "Your turn" : "Party turn", rank:3}];
  }

  function release(progress) {
    if (!progress?.partyClock) return false;
    Object.assign(progress, progress.partyClock.solo);
    delete progress.partyClock;
    return true;
  }
  // Keep only fields the clock changed. The owner can repair a mistaken
  // boundary after the DM corrects the pointer, including expired focus.
  function outcomeFields(state) {
    const fields = new Map();
    const progress = state.progress || {};
    const add = (id, object, key) => fields.set(id, {object,key});
    for (const key of ["elapsedSeconds","economyUsed","economyOverrides","spellTurnReminder","turnSequence"])
      add(key, progress, key);
    for (const key of ["active","pending"]) add("focus/" + key, state.focus, key);
    for (const effect of progress.effects || [])
      for (const key of ["remaining","clockLimit","ended","endedByConcentration","targetRemoved","anchorRemoved"])
        add("effect/" + effect.id + "/" + key,effect,key);
    for (const card of state.companions?.cards || [])
      for (const key of ["remaining","timerUnit","rounds"]) add("companion/" + card.id + "/" + key,card,key);
    return fields;
  }

  function remember(before, after) {
    const old = outcomeFields(before);
    const changes = [];
    for (const [id, {object,key}] of outcomeFields(after)) {
      const previous = old.get(id);
      if (!previous) continue;
      const prior = previous.object[previous.key], value = object[key];
      if (JSON.stringify(prior) !== JSON.stringify(value)) changes.push({id,prior,value});
    }
    if (changes.length) after.progress.partyClock.repair = {id:crypto.randomUUID(),changes};
  }

  function repair(state, id) {
    const clock = state.progress?.partyClock;
    if (!clock?.repair || clock.repair.id !== id) return false;
    const fields = outcomeFields(state);
    for (const change of clock.repair.changes) {
      const slot = fields.get(change.id);
      if (!slot || JSON.stringify(slot.object[slot.key]) !== JSON.stringify(change.value)) continue;
      if (change.prior === undefined) delete slot.object[slot.key];
      else slot.object[slot.key] = structuredClone(change.prior);
    }
    delete clock.repair;
    previewEncounter.log(state, "override", "Corrected my last DM clock update");
    return "correcting my clock outcomes";
  }

  function apply(state, key, tick) {
    const progress = state.progress ||= previewEncounter.emptyProgress();
    if (tick.phase === "exit") return progress.partyClock?.key === key && release(progress);
    if (progress.partyClock?.key !== key) release(progress);
    progress.partyClock ||= {key, solo:{current:progress.current, round:progress.round, active:progress.active !== false}};
    Object.assign(progress.partyClock, {encounter:tick.encounter_id, separate:tick.separate});
    progress.active = true;
    progress.round = tick.wrap ? tick.round - 1 : tick.round;
    if (tick.phase === "step" || tick.phase === "enter")
      encounterTracker.enterTurn(state, tick.phase === "step" ? tick.from : null, tick.to, tick.wrap);
    if (tick.phase === "time") {
      if (tick.rounds) effectControls.advanceRounds(state, tick.rounds);
      else effectControls.advanceTime(state, tick.seconds);
    }
    progress.current = tick.to;
    progress.round = tick.round;
    return true;
  }

  function setup(request, refresh) {
    const panel = document.getElementById("party-initiative");
    const form = panel.querySelector("form");
    const leave = panel.querySelector(".party-leave");
    const status = panel.querySelector("[role=status]");
    const correct = panel.querySelector(".clock-repair");
    correct.onclick = async () => {
      const id = previewEncounter.current().progress?.partyClock?.repair?.id;
      if (!id) return;
      await previewEncounter.transact(draft => repair(draft,id));
      await refresh();
    };
    const send = initiativeWriter(request);
    sendEdit = send;
    refreshView = refresh;
    const epoch = previewEncounter.restoreEpoch();
    let busy = false;
    let choices = "";
    let order = "";
    async function change(edit) {
      if (busy || !view?.combat) return;
      busy = true;
      try {
        await send(view, edit);
        // Leaving returns this sheet to solo turns for this encounter; submitting again rejoins.
        left = edit.kind === "leave" ? view.room_id + "/" + view.combat.id : null;
        status.textContent = edit.kind === "leave" ? "Left the shared encounter." : "Initiative submitted.";
      } catch (error) { status.textContent = error.message; railError(error.message); }
      finally { busy = false; await refresh(); }
    }
    function railError(message) {
      const note = document.getElementById("party-encounter-note");
      note.textContent = message;
      note.dataset.error = "true";
      setTimeout(() => { delete note.dataset.error; document.dispatchEvent(new Event("preview-encounter-change")); }, 6000);
    }
    const submit = score => {
      const companions = [...form.querySelectorAll("[data-companion]")].map(input => ({
        name:input.dataset.name, local_id:Number(input.dataset.companion), initiative:input.value === "" ? null : input.valueAsNumber
      }));
      return change({kind:"submit", score, companions});
    };
    form.onsubmit = event => {
      event.preventDefault();
      submit(form.elements.score.valueAsNumber);
    };
    leave.onclick = () => change({kind:"leave"});
    // Combat rail: join with a roll, and end the turn when the current row is mine.
    const join = document.getElementById("party-join-form");
    join.onsubmit = event => {
      event.preventDefault();
      submit(join.elements.score.valueAsNumber);
    };
    const endTurn = document.getElementById("end-my-turn");
    endTurn.onclick = async () => {
      const id = endTurn.dataset.row;
      if (!id || busy || !view?.combat) return;
      busy = true;
      endTurn.disabled = true;
      try {
        await send(view, {kind:"end_turn", id});
        status.textContent = "";
      } catch (error) {
        railError(error.message);
      } finally { busy = false; endTurn.disabled = false; await refresh(); }
    };
    return async state => {
      const hadBoard = Boolean(board());
      view = state;
      panel.hidden = !state?.combat || state.ended;
      if (hadBoard && !board()) { order = ""; document.dispatchEvent(new Event("preview-encounter-change")); }
      if (!state?.room_id || !state.self_id || state.role === "host") return;
      const key = state.room_id + "/" + state.self_id;
      if (!state.combat && previewEncounter.current().progress?.partyClock?.key !== key && !state.ended) return;
      const saved = previewEncounter.delivery().clocks?.[key] || 0;
      // A restored portable snapshot contains the solo pointer. Read the last
      // consumed position as well, so resuming never repeats its mechanics.
      const align = saved > 0 && state.combat?.joined && state.combat.running && !previewEncounter.current().progress?.partyClock;
      let after = align ? saved - 1 : saved;
      for (;;) {
        const events = await request("clock", after);
        for (const {cursor, event} of events) {
          const positionOnly = align && cursor === saved && event.tick.phase !== "exit";
          const mechanical = !positionOnly && ["step","enter","time"].includes(event.tick.phase);
          await previewEncounter.applyClock({key, cursor, epoch, align:positionOnly, mechanical},
            draft => apply(draft, key, positionOnly ? {...event.tick,phase:"position"} : event.tick));
          after = cursor;
        }
        if (events.length < 128) break;
      }
      if (panel.hidden) return;
      await syncTemplates(state);
      const mine = state.combat.rows.find(row => row.key === "owner");
      const sheet = previewEncounter.current();
      const cards = (sheet.companions?.cards || []).filter(companionControls.available);
      const next = JSON.stringify([cards.map(c => [c.id,c.name,c.turn,c.initiative]),mine]);
      if (next !== choices) {
        choices = next;
        form.elements.score.value = mine?.score ?? sheet.companions?.owner ?? "";
        const target = form.querySelector(".party-companions");
        target.replaceChildren();
        for (const card of cards) {
          const label = document.createElement("label");
          label.textContent = card.name + " initiative (blank to act with you) ";
          const input = document.createElement("input");
          const prior = mine?.companions?.find(c => c.local_id === card.id);
          Object.assign(input, {type:"number",value:prior ? prior.initiative ?? "" : card.turn === "separate" ? card.initiative ?? "" : ""});
          Object.assign(input.dataset, {companion:card.id,name:card.name});
          label.append(input); target.append(label);
        }
      }
      leave.hidden = !state.combat.joined;
      correct.hidden = !sheet.progress?.partyClock?.repair;
      const signature = JSON.stringify([state.combat.rows, state.combat.running, state.combat.current, state.combat.round, state.combat.joined, companionsAtTable()]);
      if (signature !== order) {
        order = signature;
        document.dispatchEvent(new Event("preview-encounter-change"));
      }
    };
  }
  // Owlbear spell templates. The room keeps them; the DM's Owlbear extension draws them.
  const SHAPES = {sphere:"sphere", cylinder:"cylinder", cone:"cone", cube:"cube", line:"line", emanation:"around me"};
  async function templateEdit(edit) {
    if (!sendEdit || !board()?.joined) throw new Error("Join the party encounter to place templates.");
    for (let attempt = 1; ; attempt++) {
      try { await sendEdit(view, edit); break; }
      catch (error) {
        // Another edit landed first. A joined sheet's view of the room can lag by a couple of
        // seconds, so wait for a newer revision and try again.
        if (attempt === 4 || !/revision|updated order/i.test(error.message)) throw error;
        await new Promise(resolve => setTimeout(resolve, 1200));
        await refreshView();
      }
    }
    await refreshView();
  }
  async function syncTemplates(state) {
    const host = document.getElementById("party-templates");
    const templates = state.combat?.templates || [];
    const focus = previewEncounter.current().focus?.active?.id ?? null;
    // Concentration templates go when this sheet's concentration ends or changes.
    for (const template of templates) {
      if (template.lasts !== "concentration" || template.focus === focus || clearing.has(template.id)) continue;
      clearing.add(template.id);
      // Keep the ID after success: this sheet's view can show the template for a moment longer.
      templateEdit({kind:"clear_template", id:template.id}).catch(() => clearing.delete(template.id));
    }
    if (!host) return;
    const signature = JSON.stringify(templates.map(t => [t.id, t.spell, t.shape, t.size]));
    if (host.dataset.signature === signature) return;
    host.dataset.signature = signature;
    host.hidden = !templates.length;
    host.replaceChildren(...(templates.length ? [Object.assign(document.createElement("span"), {textContent:"On the map:"})] : []),
      ...templates.map(template => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "quiet-button";
        button.textContent = template.spell + " · " + template.size + " ft " + SHAPES[template.shape] + " ✕";
        button.title = "Remove this template from Owlbear";
        button.onclick = async () => {
          button.disabled = true;
          try { await templateEdit({kind:"clear_template", id:template.id}); }
          catch (error) { button.disabled = false; button.title = error.message; }
        };
        return button;
      }));
  }
  const templates = {
    available: () => Boolean(board()?.joined),
    // Rows a cone or line can point at. Hidden enemies are left out.
    targets: () => (board()?.rows || []).filter(row => row.key !== "owner" && row.score !== null).map(row => ({id:row.id, name:row.name})),
    place: template => templateEdit({kind:"place_template", template}),
  };
  // The shared encounter as this player sees it, whether or not they have joined it yet.
  function board() {
    if (!view?.combat || view.ended || !view.self_id || view.role === "host") return null;
    if (!view.combat.joined && left === view.room_id + "/" + view.combat.id) return null;
    return view.combat;
  }
  // Other players in the room, for the combat rail. The DM is left out.
  function companionsAtTable() {
    if (!board()) return [];
    return (view.members || []).filter(member => member.member_id !== view.self_id && member.member_id !== view.dm_id)
      .map(member => member.name);
  }
  return {rows, setup, release, remember, board, players: companionsAtTable, templates};
})();
