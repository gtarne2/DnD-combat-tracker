function setupPartyWindows(panel, request, refresh, restoreEpoch) {
  const section = document.createElement("section");
  section.setAttribute("aria-label", "DM questions");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const correction = document.createElement("p");
  const forms = document.createElement("div");
  section.append(status, correction, forms);
  section.hidden = true;
  panel.append(section);
  const answers = {
    attack:{pass:"Pass", hit:"Hit", miss:"Miss"},
    magic_missile:{pass:"Pass", hit:"Damage applies", miss:"Damage prevented"},
    save:{pass:"Pass", save_success:"Save succeeded", save_failure:"Save failed"}
  };
  const headings = {
    attack:"Does the attack hit?",
    magic_missile:"Does Magic Missile deal damage?",
    save:"What was the saving throw result?"
  };
  const key = window => "window:" + window.id + "/" + window.version;
  const send = (room_id, command, command_id = crypto.randomUUID()) => request("window", {room_id, command_id, command});
  let state, busy = false, signature;

  function render(view) {
    state = view;
    const questions = view?.questions || [];
    const ledger = previewEncounter.delivery();
    const correctionNeeded = Object.values(ledger.staleWindowReactions || {}).includes(view?.room_id);
    correction.hidden = !correctionNeeded;
    correction.textContent = correctionNeeded
      ? "A reaction reply arrived after its window closed. To correct the spend, use Undo if it is still available, or adjust Turn actions, Resources and Effects on your sheet." : "";
    section.hidden = !questions.length && !correctionNeeded && !status.textContent;
    const entries = questions.map(({window, question}) => ({window, question,
      received: previewEncounter.received(key(window)),
      reactions: concentrationControls.interruptionReactions(previewEncounter.current(), question)}));
    const next = JSON.stringify([view?.room_id, entries]);
    if (next === signature) return;
    signature = next;
    forms.replaceChildren(...entries.map(({window, question, received, reactions}) => {
      const form = document.createElement("form");
      form.className = "focus-form";
      form.dataset.windowId = window.id;
      const heading = document.createElement("strong");
      heading.textContent = headings[question];
      form.append(heading);
      if (received) {
        form.append(" · Reply saved. Sending to the DM.");
        return form;
      }
      const choice = document.createElement("select");
      const reaction = document.createElement("select");
      for (const [value, label] of Object.entries(answers[question])) choice.add(new Option(label, value));
      reaction.add(new Option("No reaction", ""));
      for (const [i, option] of reactions.entries()) reaction.add(new Option(option.label, String(i)));
      function field(label, control) {
        const node = document.createElement("label");
        control.setAttribute("aria-label", label);
        node.append(label + " ", control);
        form.append(node);
      }
      field("Table answer", choice);
      if (reactions.length) field("Use reaction", reaction);
      const submit = document.createElement("button");
      submit.textContent = "Send reply";
      form.append(submit);
      form.onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        const room = view.room_id, player = view.self_id;
        const selected = reaction.value === "" ? null : reactions[Number(reaction.value)];
        const answer = choice.value;
        if (selected && answer === "pass") {
          status.textContent = "Choose the outcome after the reaction, or pass without spending it.";
          return;
        }
        busy = submit.disabled = true;
        try {
          await previewEncounter.withWriter(async () => {
            if (restoreEpoch !== previewEncounter.restoreEpoch()) throw Error("A backup was restored. Resume the party from the launcher.");
            if (previewEncounter.received(key(window))) return;
            if (selected) {
              const cursor = previewEncounter.delivery().clocks?.[room + "/" + player] || 0;
              if ((await request("clock", cursor)).length) throw Error("A turn change is waiting. Let the sheet update before replying.");
            }
            await send(room, {kind:"check", window});
            const command = {kind:"reply", window, reply:{answer, reacted:Boolean(selected)}};
            const result = previewEncounter.receive(key(window), draft => {
              if (!selected) return false;
              if (!concentrationControls.applyInterruptionReaction(draft, question, selected.key, selected.pool)) {
                throw Error("That reaction or spell slot is no longer available. Review your choices.");
              }
              return "using " + selected.name + " in response to the DM";
            }, {windowReply:{room_id:room, player, command_id:crypto.randomUUID(), command}});
            if (result !== "durable") throw Error("Could not save the reply in browser storage. Try again.");
          }, true);
          status.textContent = "";
        } catch (error) {
          status.textContent = error.message === "Window no longer open"
            ? "This window has closed. Give the DM your ruling at the table." : error.message;
        } finally {
          busy = submit.disabled = false;
          await refresh();
        }
      };
      return form;
    }));
  }

  async function sync(view) {
    if (restoreEpoch !== previewEncounter.restoreEpoch()) return;
    for (const [id, reply] of Object.entries(previewEncounter.delivery().windowReplies || {})) {
      if (reply.room_id !== view.room_id || reply.player !== view.self_id) continue;
      let stale = false;
      try { await send(reply.room_id, reply.command, reply.command_id); }
      catch (error) {
        if (error.message !== "Window no longer open") {
          status.textContent = "Saved reply waiting for the DM. Retrying.";
          continue;
        }
        stale = true;
      }
      await previewEncounter.finishWindowReply(id, stale);
      status.textContent = stale ? "This window has closed. Give the DM your ruling at the table." : "";
    }
    render(view);
  }
  document.addEventListener("preview-encounter-change", () => render(state));
  return {render, sync};
}
