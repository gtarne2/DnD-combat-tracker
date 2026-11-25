const encounterLibrary = (() => {
  const byId = (id) => document.getElementById(id);
  const activityDialog = byId("encounter-activity");
  const selector = byId("activity-encounter");
  const archiveList = byId("encounter-archives");
  const rosterSelect = byId("saved-rosters");

  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(text, action) {
    const control = node("button", text);
    control.type = "button";
    control.onclick = action;
    return control;
  }

  const formatDate = (value) => new Date(value).toLocaleString();
  const record = () => previewEncounter.current().progress;
  const archives = () => record()?.archives || [];
  const events = () => [...new Map([...archives().flatMap((entry) => entry.activity), ...(record()?.activity || [])]
    .map((event) => [event.id, event])).values()].reverse();

  function eventLink(id) {
    const event = events().find((entry) => entry.id === id);
    if (!event) return node("span", "Activity entry unavailable");
    return button(event.label, () => {
      const selected = (record()?.activity || []).some((entry) => entry.id === id) ? "current"
        : String(archives().find((archive) => archive.activity.some((entry) => entry.id === id))?.id);
      showActivity(selected, id);
    });
  }

  function renderActivity(current = selector.value) {
    selector.replaceChildren(new Option("Current encounter", "current"), ...[...archives()].reverse()
      .map((archive) => new Option(archive.title, String(archive.id))));
    selector.value = [...selector.options].some((choice) => choice.value === current) ? current : "current";
    const rows = selector.value === "current" ? record()?.activity || []
      : archives().find((archive) => String(archive.id) === selector.value)?.activity || [];
    const list = byId("encounter-log");
    const references = new Set(sheetReference.entries().map((entry) => entry.id));
    list.replaceChildren(...[...rows].reverse().map((event) => {
      const item = node("li");
      item.id = "activity-event-" + event.id;
      item.tabIndex = -1;
      const date = node("time", formatDate(event.at));
      date.dateTime = event.at;
      item.append(node("strong", event.label), date);
      if (event.round != null) item.append(node("small", "Round " + event.round));
      if (references.has(event.source)) item.append(sheetReference.link(event.source, "Open reference"));
      else if (event.source?.startsWith("effect:")) {
        const id = event.source.slice("effect:".length);
        const effect = document.querySelector(`[data-effect-id="${CSS.escape(id)}"]`);
        if (effect) item.append(button("Show effect", () => {
          activityDialog.close();
          if (effect.closest("details")) effect.closest("details").open = true;
          effect.focus();
          effect.scrollIntoView({block: "nearest"});
        }));
      }
      return item;
    }));
    if (!rows.length) list.append(node("li", "No activity recorded."));
  }

  function showActivity(key, id) {
    renderActivity(key);
    if (!activityDialog.open) activityDialog.showModal();
    if (id != null) {
      const event = byId("activity-event-" + id);
      event?.focus();
      event?.scrollIntoView({block: "nearest"});
    }
  }
  selector.onchange = () => renderActivity();

  const savedRosters = () => sessionView.get("encounterRosters") || [];
  function renderRosters(id = rosterSelect.value) {
    const saved = savedRosters();
    rosterSelect.replaceChildren(...saved.map((roster) => new Option(roster.name, roster.id)));
    if (saved.some((roster) => roster.id === id)) rosterSelect.value = id;
    byId("load-roster").disabled = byId("remove-roster").disabled = !saved.length;
  }

  byId("save-roster-form").onsubmit = (event) => {
    event.preventDefault();
    const name = event.target.elements.name.value.trim();
    if (!name) return;
    const state = previewEncounter.current();
    const rosters = savedRosters();
    const id = rosters.find((roster) => roster.name === name)?.id || crypto.randomUUID();
    const snapshot = {id, name, owner: state.companions?.owner ?? null, actors: structuredClone(state.progress?.actors || []),
      companions: structuredClone((state.companions?.cards || []).filter(companionControls.available))};
    sessionView.set("encounterRosters", [...rosters.filter((roster) => roster.id !== id), snapshot]);
    renderRosters(id);
    byId("roster-status").textContent = "Saved " + name + ".";
  };
  byId("remove-roster").onclick = () => {
    sessionView.set("encounterRosters", savedRosters().filter((roster) => roster.id !== rosterSelect.value));
    renderRosters();
    byId("roster-status").textContent = "Saved roster removed.";
  };
  byId("load-roster").onclick = () => {
    const roster = savedRosters().find((entry) => entry.id === rosterSelect.value);
    if (!roster) return;
    encounterTracker.update((progress, state) => {
      const companions = state.companions ||= {cards: [], sequence: 0, seen: [], owner: null};
      companions.owner = roster.owner;
      for (const saved of roster.actors) {
        const key = `${roster.id}:${saved.id}`;
        const actor = progress.actors.find((actor) => actor.rosterKey === key || actor.id === saved.id && actor.name === saved.name);
        if (actor) Object.assign(actor, {score: saved.score, rosterKey: key});
        else progress.actors.push({...saved, rosterKey: key, id: ++progress.sequence});
      }
      for (const saved of roster.companions) {
        const key = `${roster.id}:${saved.id}`;
        const active = companions.cards.find((card) => companionControls.available(card)
          && (card.rosterKey === key || card.id === saved.id && card.name === saved.name));
        if (active) Object.assign(active, {turn: saved.turn, initiative: saved.initiative, rosterKey: key});
        else companions.cards.push({...structuredClone(saved), rosterKey: key, id: ++companions.sequence});
      }
      byId("roster-status").textContent = "Loaded " + roster.name + ".";
      return "loading " + roster.name;
    });
  };

  function render() {
    if (activityDialog.open) renderActivity();
    archiveList.replaceChildren(...[...archives()].reverse().map((archive) => {
      const item = node("li");
      item.append(button(archive.title, () => showActivity(String(archive.id))),
        node("small", `${formatDate(archive.at)} · Round ${archive.round} · ${archive.activity.length} activities`),
        node("p", archive.roster.join(", ")));
      return item;
    }));
    if (!archives().length) archiveList.append(node("li", "No archived encounters."));
  }
  document.querySelector('[data-dialog="encounter-activity"]').addEventListener("click", () => renderActivity("current"));
  document.addEventListener("preview-encounter-change", render);
  renderRosters();
  render();
  return {events, eventLink};
})();
