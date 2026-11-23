(() => {
  const byId = (id) => document.getElementById(id);
  const workspace = byId("combat");
  const inspector = byId("option-inspector");
  const optionList = byId("all-options");
  const query = byId("option-search");
  const groups = [...workspace.querySelectorAll("[data-group]")];
  const tabs = () => [...workspace.querySelectorAll("[data-nav], [data-filter]")];
  const wide = matchMedia("(min-width: 1080px)");
  let filter;
  let selected;

  const categories = [
    ["Attack", "Attacks"], ["Spell", "Spells"], ["Feature", "Features"],
    ["Scroll", "Scrolls"], ["Item", "Items"],
  ];
  for (const group of groups) {
    for (const [kind, label] of categories) {
      const cards = [...group.querySelectorAll(":scope > .option-row")]
        .filter((card) => card.querySelector(".kind").textContent === kind);
      if (!cards.length) continue;
      const category = document.createElement("div");
      category.className = "option-category";
      const heading = document.createElement("h3");
      heading.textContent = label;
      const count = document.createElement("span");
      heading.append(count);
      category.append(heading, ...cards);
      group.append(category);
    }
  }

  function select(card) {
    if (selected) {
      selected.classList.remove("selected-option");
      selected.querySelector("[data-inspect]").setAttribute("aria-expanded", "false");
    }
    selected = card;
    inspector.replaceChildren();
    if (!card) {
      const message = document.createElement("p");
      message.className = "empty";
      message.textContent = "Select an option to read its details.";
      inspector.append(message);
      return;
    }
    card.classList.add("selected-option");
    card.querySelector("[data-inspect]").setAttribute("aria-expanded", "true");
    const article = document.createElement("article");
    const heading = document.createElement("h3");
    heading.textContent = card.querySelector(".option-title").textContent;
    const body = card.querySelector(".option-body").cloneNode(true);
    const description = body.querySelector("details");
    if (description) description.open = true;
    article.append(heading, body);
    inspector.append(article);
    inspector.scrollTop = 0;
  }

  function showOptions() {
    const available = tabs().filter((tab) => !tab.hidden);
    if (!available.some((tab) => (tab.dataset.nav || tab.dataset.filter) === filter)) {
      const first = available[0];
      filter = first.dataset.nav || first.dataset.filter;
    }
    const term = query.value.trim().toLowerCase();
    const shown = term && filter !== "pinned" ? "all" : filter;
    workspace.dataset.view = shown;
    for (const tab of tabs()) {
      tab.toggleAttribute("data-current", (tab.dataset.nav || tab.dataset.filter) === shown);
      if (tab.hasAttribute("data-current")) tab.setAttribute("aria-current", "true");
      else tab.removeAttribute("aria-current");
    }
    for (const group of groups) {
      group.classList.toggle("view-hidden", shown !== "all" && shown !== group.id);
    }
    const active = shown === "pinned" ? [byId("pinned")] : groups.filter(
      (group) => !group.hidden && !group.classList.contains("view-hidden"),
    );
    const candidates = [];
    let matches = 0;
    for (const section of active) {
      for (const card of section.querySelectorAll(".option-row")) {
        const match = !term || card.textContent.toLowerCase().includes(term);
        card.classList.toggle("search-hidden", !match);
        if (match) {
          candidates.push(card);
          matches += 1;
        }
      }
      for (const card of section.querySelectorAll(".stat-card")) {
        const match = !term || card.textContent.toLowerCase().includes(term);
        card.classList.toggle("search-hidden", !match);
        if (match) matches += 1;
      }
      for (const category of section.querySelectorAll(".option-category")) {
        const count = category.querySelectorAll(".option-row:not(.search-hidden)").length;
        category.hidden = count === 0;
        category.querySelector("h3 span").textContent = count;
      }
    }
    byId("no-options").hidden = !term || matches > 0;
    byId("no-groups").classList.toggle("view-hidden", shown === "pinned");
    if (!candidates.includes(selected)) select(wide.matches ? candidates[0] : null);
  }

  workspace.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-nav], [data-filter]");
    if (tab) {
      event.preventDefault();
      filter = tab.dataset.nav || tab.dataset.filter;
      query.value = "";
      showOptions();
      optionList.scrollTop = 0;
      return;
    }
    const button = event.target.closest("[data-inspect]");
    if (!button) return;
    const card = button.closest(".option-row");
    select(card === selected && !wide.matches ? null : card);
  });

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-dialog]");
    if (!control) return;
    const dialog = byId(control.dataset.dialog);
    if (control.dataset.reveal) byId(control.dataset.reveal).open = true;
    if (!dialog.open) dialog.showModal();
  });
  query.addEventListener("input", showOptions);
  wide.addEventListener("change", showOptions);
  document.addEventListener("combat-options-change", showOptions);
  document.documentElement.classList.add("dashboard-ready");
  const hash = location.hash.slice(1);
  if (["sheet-layout", "full-sheet"].includes(hash)) {
    byId(hash).closest("dialog").showModal();
  } else if (hash === "pinned" || groups.some((group) => group.id === hash)) {
    filter = hash;
  }
  showOptions();
})();
