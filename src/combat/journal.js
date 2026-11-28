const journalControls = (() => {
  const byId = (id) => document.getElementById(id);
  const dialog = byId("journal-entry-editor");
  const form = byId("journal-entry-form");
  const query = byId("journal-search");
  const list = byId("journal-entries");
  const add = byId("add-journal-entry");
  const reference = form.elements.reference;
  let editing;

  const journal = () => sessionView.get("journalEntries") || [];
  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function linked(value) {
    if (value.startsWith("activity:")) return encounterLibrary.eventLink(Number(value.slice(9)));
    const id = value.slice("sheet:".length);
    const entry = sheetReference.entries().find((entry) => entry.id === id);
    return entry ? sheetReference.link(id, entry.name) : node("span", "Sheet reference unavailable");
  }
  function options(title, entries) {
    const group = node("optgroup");
    group.label = title;
    group.append(...entries);
    return group;
  }
  function open(entry) {
    editing = entry?.id;
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    form.elements.title.value = entry?.title || "";
    form.elements.date.value = entry?.date || local;
    form.elements.body.value = entry?.body || "";
    reference.replaceChildren(new Option("No link", ""),
      options("Encounter activity", encounterLibrary.events().map((event) => new Option(event.label, `activity:${event.id}`))),
      options("Sheet references", [...sheetReference.entries()].sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => new Option(entry.name, `sheet:${entry.id}`))));
    if (entry?.reference && ![...reference.options].some((option) => option.value === entry.reference)) {
      reference.add(new Option("Unavailable link", entry.reference));
    }
    reference.value = entry?.reference || "";
    byId("remove-journal-entry").hidden = !editing;
    dialog.showModal();
  }
  function render() {
    const term = query.value.trim().toLowerCase();
    const entries = [...journal()].sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created));
    list.replaceChildren();
    for (const entry of entries) {
      const link = entry.reference ? linked(entry.reference) : null;
      if (!`${entry.title} ${entry.date} ${entry.body} ${link?.textContent || ""}`.toLowerCase().includes(term)) continue;
      const article = node("article");
      article.className = "journal-entry";
      const date = node("time", entry.date);
      date.dateTime = entry.date;
      const edit = node("button", "Edit entry");
      edit.type = "button";
      edit.setAttribute("aria-label", "Edit " + entry.title);
      edit.onclick = () => open(entry);
      article.append(node("h3", entry.title), date, edit, node("p", entry.body));
      if (link) article.append(link);
      list.append(article);
    }
    if (!list.childElementCount) list.append(node("p", term ? "No journal entries match." : "No dated entries yet."));
  }
  function save(entries) {
    sessionView.set("journalEntries", entries);
    sessionView.save();
    dialog.close();
    render();
    add.focus();
  }
  add.onclick = () => open();
  query.oninput = render;
  byId("cancel-journal-entry").onclick = () => dialog.close();
  byId("remove-journal-entry").onclick = () => save(journal().filter((entry) => entry.id !== editing));
  form.onsubmit = (event) => {
    event.preventDefault();
    const title = form.elements.title.value.trim();
    const body = form.elements.body.value.trim();
    if (!title || !body) return;
    const previous = journal().find((entry) => entry.id === editing);
    const entry = {id: editing || crypto.randomUUID(), title, body, date: form.elements.date.value,
      reference: reference.value, created: previous?.created || new Date().toISOString()};
    save([...journal().filter((item) => item.id !== entry.id), entry]);
  };
  document.addEventListener("preview-encounter-change", render);
  render();
  // Opens the entry editor with a title and text filled in, such as a fight recap.
  return {draft: (title, body) => open({title, body})};
})();
