const signedStat = value => (value >= 0 ? "+" : "") + value;
const monsterPackLabel = pack => [pack.source,pack.edition,pack.source_version,pack.id].filter(Boolean).join(" · ");
const monsterLicense = license => license && [license.name,license.url].filter(Boolean).join(" · ");

function renderMonsterStatBlock(target, snapshot) {
  target.replaceChildren();
  if (!snapshot) return;
  const {pack, monster} = snapshot;
  const s = monster.stats, d = s.defenses || {}, details = s.details || {};
  let parent = target;
  const add = (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  };
  const group = className => {
    const node = document.createElement("div");
    node.className = className;
    target.append(node);
    parent = node;
    return node;
  };
  // Keep each line's text as "Label · value" so search, copy and the rehearsals read the same words.
  const field = (label, value) => {
    if (value == null || value === "") return;
    const line = document.createElement("p");
    line.className = "sb-field";
    const name = document.createElement("span");
    name.className = "sb-label";
    name.textContent = label;
    const separator = document.createElement("span");
    separator.className = "sb-sep";
    separator.textContent = " · ";
    line.append(name, separator, String(value));
    parent.append(line);
  };
  group("sb-head");
  add("h3", monster.name, "sb-name");
  field("Creature", [s.size || details.sizes?.join(" or "), s.creature_type].filter(Boolean).join(" "));
  if (s.size && details.sizes?.length) field("Size choices", details.sizes.join(" or "));
  field("Alignment", details.alignment);
  group("sb-core");
  field("Armor Class", [d.ac ?? "Unknown", d.armor].filter(v => v != null).join(" · "));
  for (const armor of d.conditional_ac || [])
    field("Conditional AC", [armor.ac,armor.qualifier].filter(v => v != null).join(" · "));
  const initiative = details.initiative;
  if (initiative) field("Initiative", [
    initiative.modifier != null ? signedStat(initiative.modifier) : null,
    initiative.score != null ? "(" + initiative.score + ")" : null,
    initiative.qualifier
  ].filter(Boolean).join(" "));
  field("HP", (s.hp ?? "Unknown") + (s.hit_dice ? " (" + s.hit_dice + ")" : ""));
  field("Speed", s.speed);
  const abilityOrder = ["str","dex","con","int","wis","cha"];
  const rank = name => (abilityOrder.indexOf(name.slice(0, 3).toLowerCase()) + 7) % 7;
  const abilities = Object.entries(s.abilities || {}).sort(([a], [b]) => rank(a) - rank(b));
  if (abilities.length) {
    const grid = document.createElement("dl");
    grid.className = "sb-abilities";
    for (const [name, value] of abilities) {
      const cell = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = name.slice(0, 3).toUpperCase();
      term.title = name;
      const score = document.createElement("dd");
      score.textContent = value + (Number.isFinite(value) ? " (" + signedStat(Math.floor((value - 10) / 2)) + ")" : "");
      cell.append(term, score);
      grid.append(cell);
    }
    target.append(grid);
  }
  group("sb-details");
  for (const [label, values] of [["Saves",s.saves],["Skills",s.skills]]) {
    field(label, Object.entries(values || {}).map(([name, value]) => name + " " + signedStat(value)).join(", "));
  }
  field("Save notes",details.saves_text);
  field("Skill notes",details.skills_text);
  for (const [label, value] of [
    ["Vulnerabilities",d.vulnerabilities], ["Resistances",d.resistances],
    ["Immunities",d.immunities], ["Condition immunities",d.condition_immunities],
    ["Senses",s.senses], ["Languages",s.languages], ["Gear",details.gear]
  ]) field(label, value);
  field("Challenge", s.challenge);
  field("Challenge notes", details.challenge_notes);
  field("XP", details.xp);
  field("Proficiency bonus", details.proficiency_bonus != null ? signedStat(details.proficiency_bonus) : null);
  if (s.notes) add("p", s.notes);
  parent = target;
  const names = new Map((s.actions || []).map(action => [action.id, action.name]));
  for (const [key,label] of [
    ["traits","Traits"],["actions","Actions"],["bonus_actions","Bonus actions"],
    ["reactions","Reactions"],["legendary_actions","Legendary actions"]
  ]) {
    const preamble = key === "legendary_actions" && details.legendary_preamble;
    if (!s[key]?.length && !preamble) continue;
    add("h4",label);
    if (preamble) add("p",preamble);
    for (const a of s[key] || []) {
      const entry = document.createElement("div");
      entry.className = "sb-entry";
      target.append(entry);
      parent = entry;
      add("h5",a.name);
      add("p",a.text);
      const range = a.range_ft;
      const damage = (a.damage || []).map(d => [
        d.average, d.dice && "(" + d.dice + ")", d.damage_type
      ].filter(v => v != null && v !== "").join(" "));
      const save = a.resolution?.save;
      const outcome = {full:"full damage",half:"half damage",none:"no damage"};
      const mechanics = [
        a.attack_bonus != null && signedStat(a.attack_bonus) + " to hit",
        a.reach_ft != null && "Reach " + a.reach_ft + " ft",
        range && "Range " + range.normal + (range.long != null ? "/" + range.long : "") + " ft",
        save ? "DC " + save.dc + " " + save.ability + " save (" + outcome[save.on_failure]
          + " on failure, " + outcome[save.on_success] + " on success)"
          : a.save_dc != null && "Save DC " + a.save_dc + " (see rules text)",
        ...damage,
        a.uses && a.uses.count + " uses" + (a.uses.reset ? " / " + a.uses.reset : ""),
        a.recharge && "Recharge " + a.recharge.minimum + "–" + a.recharge.die + " on d" + a.recharge.die,
        a.resolution?.legendary_cost && "Legendary action cost " + a.resolution.legendary_cost,
        a.multiattack?.length && a.multiattack.map(id => names.get(id) || id).join(", ")
      ].filter(Boolean);
      if (mechanics.length) add("p",mechanics.join(" · "),"sb-mechanics");
      if (a.resolution?.manual_note) add("p",a.resolution.manual_note,"sb-note");
      parent = target;
    }
  }
  for (const section of details.sections || []) {
    add("h4",section.title);
    add("p",section.text);
  }
  group("sb-credits");
  add("p", [pack.edition, pack.source, pack.source_version].filter(Boolean).join(" · "));
  add("p", pack.attribution);
  field("License", monsterLicense(pack.license));
  const source = monster.source_locator;
  if (source) field("Source entry", [
    source.entry_id, source.section, source.page != null && "Page " + source.page, source.source_version
  ].filter(Boolean).join(" · "));
}

function compareChallenge(left, right) {
  const fraction = value => {
    const match = /^(\d{1,6})(?:\/(\d{1,6}))?$/.exec(value);
    return match && Number(match[2] ?? 1) > 0 ? [Number(match[1]),Number(match[2] ?? 1)] : null;
  };
  const a = fraction(left), b = fraction(right);
  if (a && b) return a[0]*b[1] - b[0]*a[1] || left.localeCompare(right);
  if (a || b) return a ? -1 : 1;
  return left.localeCompare(right);
}

function setupMonsterLibrary(request, addToEncounter) {
  const el = id => document.getElementById(id);
  const library = el("dm-monster-library");
  const packChoice = el("monster-pack");
  const search = el("monster-search");
  const matches = el("monster-matches");
  const preview = el("monster-preview");
  const status = el("monster-status");
  const confirm = el("monster-confirm");
  const packForm = el("monster-pack-form");
  const templateForm = el("monster-template-form");
  const add = el("monster-add");
  const loadControls = [packChoice,el("monster-import"),el("monster-aurora"),el("monster-fivetools"),
    el("monster-fivetools-folder"),el("monster-new-pack")];
  const filters = [
    [el("monster-type"), s => [s.creature_type]],
    [el("monster-size"), s => s.details?.sizes?.length ? s.details.sizes : [s.size]],
    [el("monster-challenge"), s => [s.challenge],compareChallenge]
  ];
  let loaded, pendingImport, packMode, editing, busy = false;
  const api = (action, data) => request("monsters/" + action,data);
  const monster = () => loaded?.pack.monsters.find(m => m.id === matches.value);
  preview.className = "monster-stat-block";
  for (const button of document.querySelectorAll("[data-close]")) {
    button.onclick = () => button.closest("dialog").close();
  }
  async function run(feedback, task, control) {
    if (busy) return;
    busy = true;
    for (const field of loadControls) field.disabled = true;
    if (control) control.disabled = true;
    feedback.textContent = "";
    try { await task(); }
    catch (error) { feedback.textContent = error.message; }
    finally {
      busy = false;
      for (const field of loadControls) field.disabled = false;
      if (control) control.disabled = false;
      selection();
    }
  }
  const submit = (form, task) => {
    form.onsubmit = event => {
      event.preventDefault();
      run(form.querySelector("[role=status]") || status,task,event.submitter);
    };
  };

  function selection() {
    const selected = monster();
    const score = add.elements.score;
    const selectionId = selected ? loaded.revision + ":" + selected.id : "";
    if (score.dataset.template !== selectionId) {
      score.dataset.template = selectionId;
      score.value = selected?.stats.details?.initiative?.score ?? 0;
      add.elements.alias.value = "";
      add.elements.alias.placeholder = selected?.name || "Same as name";
    }
    el("monster-export").disabled = !loaded;
    el("monster-new").disabled = !loaded;
    el("monster-edit").disabled = !selected;
    add.querySelector("button").disabled = !selected;
    renderMonsterStatBlock(preview, selected && {pack:loaded.pack.info,monster:selected});
    preview.hidden = !selected;
  }

  function populateMatches(selected = matches.value) {
    const tokens = search.value.trim().toLowerCase().split(/\s+/);
    const visible = (loaded?.pack.monsters || []).filter(m => {
      const name = m.name.toLowerCase();
      return tokens.every(token => name.includes(token))
        && filters.every(([field, values]) => !field.value || values(m.stats).includes(field.value));
    }).sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    matches.replaceChildren(...visible.map(m => Object.assign(new Option(
      [m.name,loaded.pack.info.edition,m.stats.challenge ? "CR " + m.stats.challenge : m.stats.creature_type || "Template"]
        .filter(Boolean).join(" · "),m.id), {title:m.id})));
    matches.value = visible.some(m => m.id === selected) ? selected : visible[0]?.id ?? "";
    selection();
  }

  async function loadPack(selected) {
    try { loaded = packChoice.value ? await api("get", packChoice.value) : null; }
    catch (error) { packChoice.value = loaded?.pack.info.id ?? ""; throw error; }
    const info = loaded?.pack.info;
    el("monster-attribution").textContent = info
      ? [info.attribution,monsterLicense(info.license)].filter(Boolean).join(" · ") : "";
    el("monster-pack-credits").hidden = !loaded;
    for (const [field, values, compare] of filters) {
      const options = [...new Set((loaded?.pack.monsters || []).flatMap(m => values(m.stats)).filter(Boolean))].sort(compare);
      field.replaceChildren(new Option("All",""), ...options.map(value => new Option(value,value)));
    }
    populateMatches(selected);
  }

  async function reload(packId = packChoice.value, selected) {
    const packs = await api("list");
    packChoice.replaceChildren(...packs.map(({info}) => new Option(monsterPackLabel(info),info.id)));
    packChoice.value = packs.some(({info}) => info.id === packId) ? packId : packs[0]?.info.id ?? "";
    await loadPack(selected);
    if (!packs.length) status.textContent = "Import a pack or create one to add monsters.";
  }

  // Bestiary files the launcher lists load in the background when the DM room starts.
  let launcherBestiary;
  async function bestiaryReport() {
    if (launcherBestiary?.done) return;
    launcherBestiary = await api("bestiary");
    if (!launcherBestiary) return;
    if (!launcherBestiary.done) {
      status.textContent = "Loading 5etools bestiary files from the launcher…";
      setTimeout(() => { if (library.open && !busy) run(status, async () => { await bestiaryReport(); await reload(); }); }, 1500);
      return;
    }
    const {packs = [], problems = []} = launcherBestiary;
    const total = packs.reduce((sum, pack) => sum + pack.count, 0);
    status.textContent = [packs.length
      ? "Loaded " + packs.length + (packs.length === 1 ? " bestiary book" : " bestiary books")
        + " from the launcher (" + total.toLocaleString() + " monsters)."
      : "", ...problems].filter(Boolean).join(" ");
  }

  el("dm-open-library").onclick = () => {
    library.showModal();
    run(status, async () => {
      await bestiaryReport().catch(() => {});
      await reload();
    });
  };
  packChoice.onchange = () => run(status, () => loadPack());
  search.oninput = () => populateMatches();
  for (const [field] of filters) field.onchange = () => populateMatches();
  matches.onchange = selection;

  async function reviewImport(pack, warnings = []) {
    return reviewImports([{pack,warnings}]);
  }

  // One review for any number of packs, such as every book in a 5etools folder.
  async function reviewImports(imports, problems = []) {
    const items = [];
    for (const {pack, warnings = []} of imports)
      items.push({pack, warnings, before:await api("validate",pack)});
    const many = items.length > 1;
    const warnings = [...problems, ...items.flatMap(({pack, warnings}) =>
      warnings.map(text => many ? pack.info.source + ": " + text : text))];
    const notes = el("monster-import-warnings");
    notes.hidden = !warnings.length;
    notes.querySelector("summary").textContent = warnings.length + " not imported or incomplete";
    notes.querySelector("ul").replaceChildren(...warnings.map(text => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    pendingImport = items.map(({pack, before}) => ({pack,expected_revision:before?.revision ?? null}));
    const replaced = items.filter(item => item.before);
    if (many) {
      const total = items.reduce((sum, {pack}) => sum + pack.monsters.length, 0);
      el("monster-import-description").textContent = items.length + " packs · " + total.toLocaleString() + " templates."
        + (replaced.length === 1 ? " 1 replaces the copy already in the library."
          : replaced.length ? " " + replaced.length + " replace the copies already in the library." : "");
      el("monster-import-credits").textContent = items.map(({pack}) =>
        monsterPackLabel(pack.info) + " · " + pack.monsters.length + " templates").join("\n");
    } else {
      const [{pack, before}] = items;
      const after = monsterPackLabel(pack.info) + " · " + pack.monsters.length + " templates.";
      el("monster-import-description").textContent = before
        ? "This replaces " + monsterPackLabel(before.info) + " (" + before.count + " templates) with " + after
        : after;
      el("monster-import-credits").textContent = (before ? [before.info,pack.info] : [pack.info])
        .map(info => [monsterPackLabel(info),info.attribution,monsterLicense(info.license)].filter(Boolean).join(" · "))
        .join("\n");
    }
    el("monster-confirm-save").textContent = many ? "Import " + items.length + " packs"
      : replaced.length ? "Replace pack" : "Import pack";
    confirm.querySelector("[role=status]").textContent = "";
    confirm.closest("dialog").showModal();
  }

  // Matches the launcher's filter: lore, the index and other lists in a 5etools folder are not bestiaries.
  const bestiaryFile = file => /\.json$/i.test(file.name) && !/^fluff/i.test(file.name)
    && !/^(index|foundry|legendarygroups|template)\.json$/i.test(file.name);
  async function importFiveTools(files) {
    files = files.filter(bestiaryFile)
      .sort((a,b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name,"en"));
    // A whole 5etools data folder also holds adventures and spell lists.
    if (files.some(file => /^bestiary/i.test(file.name))) files = files.filter(file => /^bestiary/i.test(file.name));
    if (!files.length) throw new Error("Choose 5etools bestiary JSON files, such as bestiary-mm.json.");
    const imports = [], problems = [];
    let other = 0;
    for (const [index, file] of files.entries()) {
      status.textContent = "Reading " + file.name + (files.length > 1 ? " (" + (index + 1) + " of " + files.length + ")…" : "…");
      if (file.size > 16 * 1024 * 1024) { problems.push(file.name + ": 5etools files are limited to 16 MiB."); continue; }
      const json = await file.text();
      // Spell, item and other 5etools lists in the same folder have no monster list.
      if (files.length > 1 && !json.includes('"monster"')) { other++; continue; }
      try { imports.push(await api("fivetools",{file_name:file.name,json})); }
      catch (error) { problems.push(file.name + ": " + error.message); }
    }
    status.textContent = "";
    if (!imports.length) throw new Error(problems.join(" ") || "No bestiary files found among " + other + " files.");
    await reviewImports(imports, problems);
  }
  for (const [button, input] of [["monster-fivetools","monster-fivetools-files"],["monster-fivetools-folder","monster-fivetools-dir"]]) {
    el(button).onclick = () => el(input).click();
    el(input).onchange = event => {
      const files = [...event.target.files];
      event.target.value = "";
      if (files.length) run(status, () => importFiveTools(files));
    };
  }

  el("monster-import").onchange = event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    run(status, async () => {
      if (file.size > 16 * 1024 * 1024) throw new Error("Monster packs are limited to 16 MiB.");
      const pack = JSON.parse(await file.text());
      if (pack && pack.schema_version == null && Array.isArray(pack.monster))
        throw new Error("This looks like a 5etools bestiary. Use Import 5etools files instead.");
      await reviewImport(pack);
    });
  };

  submit(confirm, async () => {
    const saving = pendingImport;
    for (const [index, item] of saving.entries()) {
      try { await api("save",item); }
      catch (error) {
        throw new Error((index ? "Imported " + index + " of " + saving.length + " packs. " : "")
          + item.pack.info.source + ": " + error.message);
      }
    }
    confirm.closest("dialog").close();
    search.value = "";
    await reload(saving[0].pack.info.id);
    status.textContent = "Imported " + (saving.length > 1 ? saving.length + " packs" : saving[0].pack.info.source) + ".";
  });

  el("monster-export").onclick = () => {
    if (!loaded) return;
    const blob = new Blob([JSON.stringify(loaded.pack) + "\n"],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = loaded.pack.info.id + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  };

  function openPackForm(mode) {
    packMode = mode;
    packForm.reset();
    const fields = packForm.elements;
    const aurora = mode === "aurora";
    fields.id.value = aurora ? "aurora-local" : "homebrew-" + crypto.randomUUID();
    fields.edition.value = "2014";
    fields.source.value = aurora ? "Local Aurora companions" : "Local homebrew";
    fields.attribution.value = aurora ? "Imported from local Aurora XML." : "Private homebrew.";
    fields.folder.required = aurora;
    el("monster-xml-label").hidden = !aurora;
    packForm.querySelector("[role=status]").textContent = "";
    packForm.closest("dialog").showModal();
  }
  el("monster-aurora").onclick = () => openPackForm("aurora");
  el("monster-new-pack").onclick = () => openPackForm("create");

  submit(packForm, async () => {
    const f = packForm.elements;
    const info = Object.fromEntries(["id","edition","source","source_version","attribution"].map(name => [name,f[name].value.trim()]));
    info.source_version ||= null;
    const license = f.license.value.trim();
    if (license) info.license = {name:license,url:f.license_url.value.trim() || null};
    else if (f.license_url.value.trim()) throw new Error("Enter a license name for the URL.");
    if (packMode === "aurora") {
      const xml = [...f.folder.files].filter(file => /\.xml$/i.test(file.name))
        .sort((a,b) => a.webkitRelativePath.localeCompare(b.webkitRelativePath,"en"));
      if (!xml.length) throw new Error("Choose a folder containing Aurora XML files.");
      if (xml.reduce((size,file) => size + file.size,0) > 24 * 1024 * 1024)
        throw new Error("Choose an Aurora folder with up to 24 MiB of XML.");
      await reviewImport(await api("aurora",{info,files:await Promise.all(xml.map(file => file.text()))}));
      packForm.closest("dialog").close();
    } else {
      packForm.closest("dialog").close();
      openTemplate({pack:{schema_version:2,info,monsters:[]},revision:null});
    }
  });

  function openTemplate(base, original) {
    editing = {base, original};
    templateForm.reset();
    const stats = original?.stats || {};
    const f = templateForm.elements;
    f.name.value = original?.name || "";
    for (const [field,key] of [["type","creature_type"],["size","size"],["challenge","challenge"],["hp","hp"]])
      f[field].value = stats[key] ?? "";
    f.ac.value = stats.defenses?.ac ?? "";
    const locator = original?.source_locator;
    el("monster-source-locator").hidden = base.pack.schema_version === 1;
    for (const key of ["entry_id","page","section"]) f[key].value = locator?.[key] ?? "";
    f.entry_version.value = locator?.source_version ?? "";
    const {creature_type,size,challenge,hp,defenses,...extra} = stats;
    const {ac,...otherDefenses} = defenses || {};
    f.details.value = JSON.stringify({actions:[],traits:[],reactions:[],legendary_actions:[],...extra,defenses:otherDefenses},null,2);
    templateForm.querySelector("[role=status]").textContent = "";
    templateForm.closest("dialog").showModal();
  }

  el("monster-add-rule").onclick = () => {
    const f = templateForm.elements;
    const status = templateForm.querySelector("[role=status]");
    try {
      const stats = JSON.parse(f.details.value);
      const key = f.rule_category.value;
      if (!f.rule_name.value.trim() || !f.rule_text.value.trim()) throw new Error("Enter a rule name and text.");
      (stats[key] ||= []).push({id:crypto.randomUUID(),name:f.rule_name.value.trim(),text:f.rule_text.value});
      f.details.value = JSON.stringify(stats,null,2);
      f.rule_name.value = f.rule_text.value = "";
      status.textContent = "Added the rule to the template.";
    } catch (error) { status.textContent = error.message; }
  };

  el("monster-new").onclick = () => openTemplate(loaded);
  el("monster-edit").onclick = () => openTemplate(loaded,monster());
  submit(templateForm, async () => {
    const f = templateForm.elements;
    const stats = JSON.parse(f.details.value);
    const object = value => value && typeof value === "object" && !Array.isArray(value);
    if (!object(stats) || stats.defenses != null && !object(stats.defenses))
      throw new Error("Enter JSON objects for additional stats and defenses.");
    const {base, original} = editing;
    const template = {id:original?.id || crypto.randomUUID(),name:f.name.value.trim(),stats:{
      ...stats,creature_type:f.type.value.trim() || null,size:f.size.value.trim() || null,
      challenge:f.challenge.value.trim() || null,hp:f.hp.value === "" ? null : f.hp.valueAsNumber,
      defenses:{...stats.defenses,ac:f.ac.value === "" ? null : f.ac.valueAsNumber}
    }};
    if (base.pack.schema_version === 2) {
      const locator = {entry_id:f.entry_id.value.trim() || null,page:f.page.valueAsNumber || null,
        section:f.section.value.trim() || null, source_version:f.entry_version.value.trim() || null};
      if (Object.values(locator).some(Boolean)) template.source_locator = locator;
    }
    const pack = {...base.pack, monsters:original
      ? base.pack.monsters.map(m => m.id === original.id ? template : m)
      : [...base.pack.monsters,template]};
    await api("save",{pack,expected_revision:base.revision});
    templateForm.closest("dialog").close();
    search.value = "";
    await reload(pack.info.id,template.id);
    status.textContent = "Saved " + template.name + ".";
  });

  submit(add, async () => {
    const selected = monster();
    if (!selected) return;
    const template = {schema_version:loaded.pack.schema_version,pack:loaded.pack.info,revision:loaded.revision,monster:selected};
    const {count,score,alias} = add.elements;
    const edit = {kind:"add_monsters",template,count:count.valueAsNumber,score:score.valueAsNumber};
    if (alias.value.trim()) edit.alias = alias.value.trim();
    if (await addToEncounter(edit)) {
      library.close();
    } else throw new Error(el("dm-initiative-status").textContent || "Encounter unavailable.");
  });
}
