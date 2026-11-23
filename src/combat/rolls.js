const rollReference = (() => {
  const dialog = document.getElementById("roll-dialog");
  const search = document.getElementById("roll-search");
  const empty = document.getElementById("roll-empty");
  const sections = [...dialog.querySelectorAll("[data-roll-section]")].map((node) => ({
    node, heading: node.querySelector("h3"), entries: [...node.querySelectorAll("[data-roll-entry]")].map((entry) => ({
      entry, words: `${(entry.querySelector("summary") || entry).textContent} ${entry.querySelector("abbr")?.title || ""}`.toLowerCase(),
    })),
  }));
  const tabs = [...dialog.querySelectorAll("[data-roll-tab]")];
  const saves = [...dialog.querySelectorAll("[data-roll-save]")].map((entry) => {
    const total = entry.querySelector("summary > strong");
    const override = entry.querySelector("[data-save-override]");
    return { key: entry.dataset.rollSave, total, override, imported: total.textContent };
  });
  let selected = "skills";

  function render() {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const searching = terms.length > 0;
    let matches = false;
    for (const {node, heading, entries} of sections) {
      const category = heading.textContent.toLowerCase();
      let found = false;
      for (const {entry, words} of entries) {
        entry.hidden = !terms.every((term) => `${words} ${category}`.includes(term));
        found ||= !entry.hidden;
      }
      node.hidden = searching ? !found : node.dataset.rollSection !== selected;
      heading.hidden = !searching;
      for (const hint of node.querySelectorAll("[data-roll-unfiltered]")) hint.hidden = searching;
      matches ||= found;
    }
    empty.hidden = !searching || matches;
    for (const tab of tabs) tab.setAttribute("aria-pressed", String(!searching && tab.dataset.rollTab === selected));
    dialog.querySelector(".roll-results").scrollTop = 0;
  }

  search.addEventListener("input", render);
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dialog.close();
  });
  function renderOverrides() {
    for (const {key, total, override, imported} of saves) {
      const value = layoutPreferences.statOverride(key);
      total.textContent = value || imported;
      override.hidden = !value;
      override.querySelector("dd").textContent = value || "";
      override.previousElementSibling.querySelector("dt").textContent = value ? "Imported total" : "Total";
    }
    for (const value of document.querySelectorAll("[data-glance-save]")) {
      value.dataset.imported ??= value.textContent;
      value.textContent = layoutPreferences.statOverride(value.dataset.glanceSave) || value.dataset.imported;
    }
  }
  document.addEventListener("preview-stat-overrides", renderOverrides);
  renderOverrides();
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      selected = tab.dataset.rollTab;
      search.value = "";
      render();
    });
  }
  function open(group, name) {
    selected = group;
    search.value = "";
    render();
    if (!dialog.open) dialog.showModal();
    const section = sections.find(({node}) => node.dataset.rollSection === group);
    const entry = section?.entries.find(({entry}) => entry.dataset.rollName === name)?.entry;
    if (entry instanceof HTMLDetailsElement) {
      entry.open = true;
      entry.querySelector("summary").focus();
    }
    entry?.scrollIntoView({block: "nearest"});
  }
  document.addEventListener("click", (event) => {
    const key = event.target.closest("[data-open-roll]")?.dataset.openRoll;
    if (key) open(...key.split("|"));
  });
  return {open};
})();
