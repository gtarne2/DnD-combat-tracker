(() => {
  const byId = (id) => document.getElementById(id);
  const profile = document.body.dataset.profile;
  const keys = {
    encounter: `aurora-combat-encounter-v1:${profile}`,
    layout: `aurora-combat-layout-v1:${profile}`,
    view: `aurora-combat-view-v1:${profile}`,
    journal: JSON.stringify(["aurora-session-writing", profile || location.pathname, "Journal"]),
    notes: JSON.stringify(["aurora-session-writing", profile || location.pathname, "Notes"]),
  };
  const status = byId("session-file-status");
  const preview = byId("restore-session-preview");
  const format = "aurora-combat-tracker";
  let pending;

  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = (value) => typeof value === "string";
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const integer = Number.isSafeInteger;
  const flag = (value) => typeof value === "boolean";
  const nullable = (value, validate) => value == null || validate(value);
  const list = (value, validate) => Array.isArray(value) && value.every(validate);
  const map = (value, validate) => object(value) && Object.entries(value)
    .every(([key, item]) => !["__proto__", "prototype", "constructor"].includes(key) && validate(item));
  const named = (value) => object(value) && count(value.id) && text(value.name);
  const hp = (value) => object(value) && count(value.current) && nullable(value.max, count) && nullable(value.temporary, count);
  const fields = (value, validators) => object(value) && Object.entries(validators)
    .every(([key, validate]) => nullable(value[key], validate));
  const texts = (value) => list(value, text);
  const textMap = (value) => map(value, text);
  const flags = (value) => map(value, flag);
  const actionMap = (value) => map(value, flags);
  const activity = (value) => list(value, (entry) => object(entry) && count(entry.id) && text(entry.at)
    && text(entry.label) && text(entry.kind) && nullable(entry.source, text) && nullable(entry.round, count));
  const companion = (card) => named(card) && fields(card, {currentHp: count, maxHp: count, temporary: count,
    timerUnit: text, remaining: count, rounds: count, initiative: integer, turn: text, zeroHp: text,
    duration: text, kind: text, armor: text, speed: text, stats: text, attacks: text, abilities: text, command: text, templateId: text,
    resources: (items) => list(items, (item) => named(item) && count(item.remaining) && count(item.capacity))});
  const actor = (entry) => named(entry) && nullable(entry.hp, count) && nullable(entry.score, integer);
  const effect = (entry) => object(entry) && text(entry.name) && text(entry.kind) && text(entry.target)
    && fields(entry, {notes: text, anchor: text, category: text, remaining: count, ended: flag, endedByRest: flag});

  function snapshot(value) {
    return fields(value, {
      spent: (value) => map(value, count), importedStacks: (value) => map(value, (amount) => nullable(amount, count)),
      focus: (focus) => object(focus) && count(focus.sequence) && list(focus.pending, (hit) => object(hit) && count(hit.id) && count(hit.dc) && count(hit.damage))
        && nullable(focus.active, (cast) => named(cast) && text(cast.label) && nullable(cast.remaining, count)),
      companions: (roster) => object(roster) && count(roster.sequence) && texts(roster.seen)
        && nullable(roster.owner, integer) && list(roster.cards, companion),
      progress: (progress) => object(progress) && count(progress.sequence) && count(progress.round) && progress.round > 0
        && map(progress.used, count) && list(progress.resources, (pool) => object(pool) && text(pool.name) && text(pool.key) && count(pool.capacity))
        && list(progress.actors, actor) && nullable(progress.hp, hp)
        && fields(progress, {current: text, active: flag, elapsedSeconds: count, effects: (items) => list(items, (entry) => count(entry?.id) && effect(entry)),
          abilities: (items) => list(items, (ability) => named(ability) && fields(ability, {kind: text, active: flag, uses: count, cost: count,
            pool: text, source: text, link: text, description: text, notes: text, followup: text})),
          activity, archives: (items) => list(items, (entry) => object(entry) && count(entry.id) && text(entry.at) && text(entry.title)
            && count(entry.round) && texts(entry.roster) && activity(entry.activity)), removedResources: texts,
          infusions: texts, prepared: flags, economyEnabled: flags, economyOverrides: actionMap, economyUsed: actionMap,
          followupUses: (items) => map(items, count), turnSequence: count, itemChargeBindings: textMap,
          attunedItems: flags, attackSequence: (entry) => object(entry) && count(entry.turn) && count(entry.count), sneakAttackTurn: count}),
    });
  }

  function validate(value) {
    if (!object(value) || value.format !== format || value.version !== 1 || !text(value.character)
        || !object(value.data) || Object.keys(keys).some((key) => !Object.hasOwn(value.data, key))) return false;
    return fields(value.data, {
      encounter: (state) => snapshot(state) && nullable(state.undo, (undo) => list(undo, (entry) => snapshot(entry?.before ?? entry))),
      layout: (layout) => fields(layout, {pins: texts, order: texts, hidden: texts, overrides: textMap, pinnedResources: texts,
        quickActions: (items) => list(items, (entry) => Array.isArray(entry) && entry.length === 2 && entry.every(text))}),
      view: (view) => fields(view, {values: (values) => fields(values, {currencyEdits: textMap, effectPresets: (items) => list(items, effect),
        referenceNotes: (notes) => map(notes, (entry) => fields(entry, {text, gear: text})),
        featureGroups: (items) => list(items, (group) => object(group) && text(group.id) && text(group.name) && texts(group.entries)),
        journalEntries: (items) => list(items, (entry) => object(entry) && [entry.id, entry.title, entry.body, entry.date, entry.reference, entry.created].every(text)),
        encounterRosters: (items) => list(items, (roster) => object(roster) && text(roster.id) && text(roster.name)
          && nullable(roster.owner, integer) && list(roster.actors, actor) && list(roster.companions, companion))}), disclosures: flags,
        positions: (items) => map(items, Number.isFinite)}),
      journal: text, notes: text,
    });
  }

  function savedData() {
    const data = Object.fromEntries(Object.entries(keys).map(([part, key]) => {
      const value = localStorage.getItem(key);
      return [part, ["journal", "notes"].includes(part) ? value : JSON.parse(value)];
    }));
    if (!data.encounter) {
      const spent = JSON.parse(localStorage.getItem(`aurora-combat-consumables-v1:${profile}`));
      if (spent) data.encounter = {spent};
    }
    return data;
  }

  function summary(data) {
    const progress = data.encounter?.progress;
    return `Round ${progress?.round || 1}, ${progress?.actors?.length || 0} combatants, ${data.encounter?.companions?.cards?.length || 0} companions, `
      + `${progress?.effects?.length || 0} effects, ${data.layout?.pins?.length || 0} pins, ${data.journal?.length || 0} journal and ${data.notes?.length || 0} notes characters`;
  }

  byId("export-session").onclick = () => {
    try {
      sessionView.save();
      const data = savedData();
      const backup = {format, version: 1, character: document.querySelector("h1").textContent, exportedAt: new Date().toISOString(), data};
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {type: "application/json"}));
      const link = document.createElement("a");
      link.href = url;
      link.download = "aurora-tracker-backup.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      status.textContent = "Tracker backup download started.";
    } catch { status.textContent = "Could not read this tracker session for export."; }
  };

  byId("import-session").onchange = async (event) => {
    const field = event.target;
    const file = field.files[0];
    const request = {};
    pending = request;
    preview.hidden = true;
    status.textContent = "";
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("Tracker backup is too large.");
      const backup = JSON.parse(await file.text());
      if (pending !== request) return;
      if (!validate(backup)) throw new Error("This file is not a valid version 1 tracker backup.");
      request.backup = backup;
      byId("restore-session-summary").textContent = `${backup.character} backup: ${summary(backup.data)}. Current session: ${summary(savedData())}. Layout, pins, and local edits will also be replaced.`;
      preview.hidden = false;
    } catch (error) {
      if (pending === request) status.textContent = "Could not preview backup. " + error.message;
    } finally {
      if (pending === request) field.value = "";
    }
  };

  byId("confirm-restore-session").onclick = () => {
    const backup = pending?.backup;
    if (!backup) return;
    const restore = () => {
      const previous = new Map();
      try {
        for (const [part, key] of Object.entries(keys)) {
          previous.set(key, localStorage.getItem(key));
          const value = backup.data[part];
          if (value === null && part !== "encounter") localStorage.removeItem(key);
          else localStorage.setItem(key, ["journal", "notes"].includes(part) ? value : JSON.stringify(value ?? {}));
        }
        sessionView.suspend();
        location.reload();
      } catch {
        for (const [key, value] of [...previous].reverse()) {
          try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
        }
        status.textContent = "Could not write the backup to browser storage.";
      }
    };
    if (navigator.locks && profile) navigator.locks.request(keys.encounter, restore).catch(() => {
      status.textContent = "Could not lock this tracker session for restore.";
    });
    else restore();
  };
})();
