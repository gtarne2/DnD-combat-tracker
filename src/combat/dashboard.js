(() => {
  const byId = (id) => document.getElementById(id);
  const workspace = byId("combat");
  const inspector = byId("option-inspector");
  const optionList = byId("all-options");
  const columns = optionList.parentElement;
  const divider = byId("inspector-divider");
  const toggle = byId("toggle-inspector");
  const query = byId("option-search");
  const showUnprepared = byId("show-unprepared");
  showUnprepared.closest("label").hidden = !playbook.hasPreparation;
  const groups = [...workspace.querySelectorAll("[data-group]")];
  const tabs = () => [...workspace.querySelectorAll("[data-nav], [data-filter]")];
  const wide = matchMedia("(min-width: 1080px)");
  const kindOf = (card) => card.querySelector("[data-kind]").dataset.kind;
  const rosterDialog = byId("companion-roster-dialog");
  let filter;
  let selected;
  let split = layoutPreferences.inspectorSplit;
  let collapsed = false;
  const remembered = new Map();

  const categories = [
    ["Attack", "Attacks"], ["Spell", "Spells"], ["Feature", "Features"],
    ["Scroll", "Scrolls"], ["Item", "Items"],
  ];
  for (const group of groups) {
    for (const [kind, label] of categories) {
      const cards = [...group.querySelectorAll(":scope > .option-row")]
        .filter((card) => kindOf(card) === kind);
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

  function updateInspectorVisibility() {
    columns.classList.toggle("inspector-collapsed", collapsed);
    toggle.textContent = collapsed ? "Show details" : "Hide details";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    selected?.querySelector("[data-inspect]").setAttribute("aria-expanded", String(!wide.matches || !collapsed));
  }

  function setSplit(position, save = false) {
    const width = columns.clientWidth;
    if (!width || !wide.matches || collapsed) return;
    const style = getComputedStyle(columns);
    const minimum = parseFloat(style.getPropertyValue("--list-min"));
    const maximum = width - parseFloat(style.getPropertyValue("--inspector-min")) - divider.offsetWidth;
    const clamped = Math.max(minimum, Math.min(position, maximum));
    split = 100 * clamped / width;
    columns.style.setProperty("--list-width", split + "%");
    divider.setAttribute("aria-valuemin", String(Math.round(100 * minimum / width)));
    divider.setAttribute("aria-valuemax", String(Math.round(100 * maximum / width)));
    divider.setAttribute("aria-valuenow", String(Math.round(split)));
    if (save) layoutPreferences.setInspectorSplit(split);
  }

  function setCollapsed(value) {
    collapsed = value;
    updateInspectorVisibility();
    if (!collapsed) setSplit(columns.clientWidth * split / 100);
  }

  columns.style.setProperty("--list-width", split + "%");
  new ResizeObserver(() => setSplit(columns.clientWidth * split / 100)).observe(columns);
  toggle.onclick = () => setCollapsed(!collapsed);
  divider.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    divider.setPointerCapture(event.pointerId);
    columns.classList.add("resizing");
    event.preventDefault();
  });
  divider.addEventListener("pointermove", (event) => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    setSplit(event.clientX - columns.getBoundingClientRect().left - divider.offsetWidth / 2);
  });
  divider.addEventListener("lostpointercapture", () => {
    columns.classList.remove("resizing");
    layoutPreferences.setInspectorSplit(split);
  });
  divider.addEventListener("keydown", (event) => {
    const width = optionList.offsetWidth;
    const next = { ArrowLeft: width - 24, ArrowRight: width + 24, Home: 0, End: columns.clientWidth };
    if (!Object.hasOwn(next, event.key)) return;
    event.preventDefault();
    setSplit(next[event.key], true);
  });

  function updateAction(card, state) {
    const tools = card.querySelector(".option-execute");
    const availability = tools.querySelector("[data-option-availability]");
    const badge = card.querySelector("[data-option-badge]");
    const cast = tools.querySelector("[data-cast-spell]");
    const stack = tools.querySelector("[data-consumable]");
    const feature = tools.querySelector("[data-feature-use]");
    let reason = "";
    let summary = "";
    let unavailable = false;
    if (cast) {
      const level = cast.hasAttribute("data-cast-level") ? Number(cast.dataset.castLevel) : null;
      const unprepared = !playbook.isPrepared(card.dataset.pin, state);
      unavailable = unprepared && !cast.hasAttribute("data-ritual-cast");
      cast.disabled = unavailable;
      if (unprepared) {
        reason = unavailable ? "This spell is unprepared." : "Unprepared. Ritual casting is available if your character can cast it as a ritual.";
        summary = "Unprepared";
      } else if (level !== 0 && !concentrationControls.availableSlots(state, level).length) {
        reason = "No eligible spell slots remain. Casting without a slot is available.";
        summary = "No slots";
      }
    } else if (stack) {
      const remaining = consumableCards.remaining(state, stack.dataset.consumable);
      unavailable = remaining == null || remaining === 0;
      stack.querySelector("[data-use]").disabled = unavailable;
      stack.querySelector("[data-remaining]").textContent = remaining ?? "Unavailable";
      if (unavailable) reason = remaining === 0 ? "None remaining." : "Quantity unavailable in the Aurora save.";
    } else if (feature) {
      const use = playbook.featureUse(card.dataset.pin, state);
      feature.hidden = !use;
      feature.disabled = Boolean(use?.reason);
      if (use) {
        const title = card.querySelector(".option-title").textContent;
        feature.textContent = use.label;
        feature.setAttribute("aria-label", use.label + " " + title);
        unavailable = Boolean(use.reason);
        reason = use.reason || use.summary;
        if (unavailable) summary = "No uses";
      }
    }
    card.classList.toggle("option-unavailable", unavailable);
    availability.textContent = reason;
    availability.hidden = !reason;
    badge.textContent = summary;
    badge.hidden = !summary;
    if (reason) tools.title = reason;
    else tools.removeAttribute("title");
  }

  const quick = setupQuickActions(groups, updateAction);
  companionControls.start();

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
    updateInspectorVisibility();
    const article = document.createElement("article");
    if (card.dataset.pin) article.dataset.pin = card.dataset.pin;
    const heading = document.createElement("h3");
    heading.className = "option-title";
    heading.textContent = card.querySelector(".option-title").textContent;
    const body = card.querySelector(".option-body").cloneNode(true);
    const kind = body.querySelector(".kind");
    const badges = card.querySelector(".option-badges").cloneNode(true);
    badges.querySelector(".row-quantity")?.remove();
    const tools = card.querySelector(".option-execute").cloneNode(true);
    const description = body.querySelector("details");
    if (description) description.open = true;
    const header = document.createElement("header");
    header.append(kind, heading, badges, tools);
    const quickPin = quick.pinButton(card);
    if (quickPin) tools.append(quickPin);
    article.append(header, body);
    inspector.append(article);
    updateAction(article, previewEncounter.current());
    inspector.scrollTop = 0;
  }

  function showOptions() {
    const available = tabs().filter((tab) => !tab.hidden);
    if (!available.some((tab) => (tab.dataset.nav || tab.dataset.filter) === filter)) {
      const first = available[0];
      filter = first.dataset.nav || first.dataset.filter;
    }
    const term = query.value.trim().toLowerCase();
    const shown = term && !["pinned", "traits"].includes(filter) ? "all" : filter;
    workspace.dataset.view = shown;
    for (const tab of tabs()) {
      tab.toggleAttribute("data-current", (tab.dataset.nav || tab.dataset.filter) === shown);
      if (tab.hasAttribute("data-current")) tab.setAttribute("aria-current", "true");
      else tab.removeAttribute("aria-current");
    }
    for (const group of groups) {
      group.classList.toggle("view-hidden", !["all", "traits", group.id].includes(shown));
    }
    const active = shown === "pinned" ? [byId("pinned")] : groups.filter(
      (group) => !group.hidden && !group.classList.contains("view-hidden"),
    );
    const candidates = [];
    let matches = 0;
    for (const section of active) {
      for (const card of section.querySelectorAll(".option-row")) {
        const unprepared = !playbook.isPrepared(card.dataset.pin);
        const kind = kindOf(card);
        const match = (shown !== "traits" || kind === "Feature")
          && (!unprepared || showUnprepared.checked)
          && (!term || card.textContent.toLowerCase().includes(term));
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
    byId("no-options").textContent = term ? "No matching options." : "No options to display.";
    byId("no-options").hidden = matches > 0 || (!term && (!byId("no-groups").hidden
      || shown === "pinned" || active.some((section) => section.querySelector(":scope > .empty"))));
    showFollowups();
    byId("no-groups").classList.toggle("view-hidden", shown === "pinned");
    if (!candidates.includes(selected)) {
      const previous = remembered.get(shown);
      const preferred = previous && candidates.find(card => card.dataset.pin === previous);
      select(wide.matches ? preferred || candidates[0] : null);
    }
    const state = previewEncounter.current();
    for (const card of candidates) updateAction(card, state);
    const detail = inspector.querySelector("article");
    if (detail) updateAction(detail, state);
    quick.render();
  }

  function showFollowups() {
    const visible = ["bonus-action", "all"].includes(workspace.dataset.view);
    const hasFollowups = Boolean(byId("bonus-followup-list").children.length);
    byId("bonus-followups").hidden = !visible || !hasFollowups;
    byId("bonus-action").querySelector(":scope > .empty")?.toggleAttribute("hidden", hasFollowups);
  }
  document.addEventListener("followups-changed", showFollowups);
  showUnprepared.addEventListener("change", showOptions);

  function navigate(next, control) {
    workspace.hidden = next !== "combat";
    document.body.classList.toggle("reading-page", next !== "combat");
    byId("character-dialog").hidden = next !== "character";
    rosterDialog.hidden = next !== "companions";
    byId("reference-dialog").hidden = next !== "reference";
    companionControls.place(next === "companions");
    document.querySelectorAll(".command-nav [aria-current]").forEach(link => link.removeAttribute("aria-current"));
    control.setAttribute("aria-current", "page");
    window.scrollTo(0, 0);
  }
  document.addEventListener("preview-encounter-change", showOptions);
  byId("companions-nav").onclick = event => navigate("companions", event.currentTarget);
  byId("character-nav").onclick = event => navigate("character", event.currentTarget);
  byId("combat-nav").onclick = event => {
    event.preventDefault();
    navigate("combat", event.currentTarget);
    showOptions();
  };

  // The backdrop dispatches events to the dialog itself. Padding clicks stay inside.
  for (const dialog of document.querySelectorAll("dialog")) {
    let outsidePress = false;
    const outside = (event) => {
      const rect = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    dialog.addEventListener("pointerdown", (event) => { outsidePress = outside(event); });
    dialog.addEventListener("click", (event) => {
      if (outsidePress && outside(event)) dialog.close();
      outsidePress = false;
    });
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
    const card = event.target.closest(".option-row");
    if (!card || (!button && event.target.closest("button, .option-body"))) return;
    if (!button) card.querySelector("[data-inspect]").focus();
    remembered.set(workspace.dataset.view, card.dataset.pin);
    if (wide.matches && collapsed) setCollapsed(false);
    if (card !== selected) select(card);
    else if (!wide.matches) select(null);
  });

  document.addEventListener("click", (event) => {
    const ability = event.target.closest("[data-ability]");
    if (ability) {
      byId("ability-title").textContent = ability.dataset.ability;
      byId("ability-modifier").textContent = ability.querySelector("strong").textContent;
      byId("ability-check").textContent = ability.dataset.check;
      byId("ability-save").textContent = ability.querySelector("[data-stat]").textContent;
      byId("ability-dialog").showModal();
      return;
    }
    const attack = event.target.closest("[data-record-attack]");
    if (attack) {
      encounterTracker.recordAttack(attack.dataset.recordAttack);
      return;
    }
    const feature = event.target.closest("[data-feature-use]");
    if (feature && !feature.disabled) {
      playbook.activateFeature(feature.closest("article").dataset.pin);
      return;
    }
    const resource = event.target.closest("[data-resource-detail]");
    if (resource) {
      const card = groups.flatMap((group) => [...group.querySelectorAll("[data-pin]")])
        .find((card) => card.dataset.pin === resource.dataset.resourceDetail);
      if (!card) return;
      filter = "traits";
      query.value = "";
      showOptions();
      if (wide.matches) setCollapsed(false);
      select(card);
      card.querySelector("[data-inspect]").focus();
      return;
    }
    const control = event.target.closest("[data-dialog]");
    if (!control) return;
    const dialog = byId(control.dataset.dialog);
    if (!dialog.open) dialog.showModal();
  });
  for (const control of document.querySelectorAll("[data-reference]")) {
    control.addEventListener("click", () => {
      const title = control.dataset.reference;
      const content = byId("reference-content");
      content.replaceChildren();
      byId("reference-title").textContent = title;
      if (title === "Inventory") {
        for (const row of groups.flatMap(group => [...group.querySelectorAll(".option-row")])) {
          if (!["Scroll", "Item"].includes(kindOf(row))) continue;
          const entry = document.createElement("details");
          const label = document.createElement("summary");
          label.textContent = row.querySelector(".option-title").textContent + " " + (row.querySelector(".row-quantity")?.textContent || "");
          entry.append(label, row.querySelector(".description")?.cloneNode(true) || "");
          content.append(entry);
        }
        if (!content.children.length) content.textContent = "No inventory items in this sheet.";
      } else {
        for (const field of byId("full-sheet").querySelectorAll("dt")) {
          const isNote = field.textContent === "Notes";
          if (title === "Notes" ? !isNote : isNote || field.closest("section")?.querySelector("h2")?.textContent !== "Lore") continue;
          const heading = document.createElement("h3");
          heading.textContent = field.textContent;
          content.append(heading, field.nextElementSibling.cloneNode(true));
        }
        const label = document.createElement("label");
        label.textContent = title === "Notes" ? "Session notes" : "Session journal";
        const area = document.createElement("textarea");
        const key = JSON.stringify(["aurora-session-writing", document.body.dataset.profile || location.pathname, title]);
        const status = document.createElement("p");
        status.setAttribute("role", "status");
        try { area.value = localStorage.getItem(key) || ""; } catch { status.textContent = "Local storage unavailable."; }
        area.oninput = () => {
          try { localStorage.setItem(key, area.value); status.textContent = "Saved locally"; }
          catch { status.textContent = "Could not save locally."; }
        };
        label.append(area);
        content.append(label, status);
      }
      navigate("reference", control);
    });
  }
  query.addEventListener("input", showOptions);
  wide.addEventListener("change", () => {
    updateInspectorVisibility();
    showOptions();
  });
  document.addEventListener("combat-options-change", showOptions);
  document.documentElement.classList.add("dashboard-ready");
  const hash = location.hash.slice(1);
  if (hash === "full-sheet") byId("character-nav").click();
  else if (hash === "sheet-layout") {
    byId(hash).closest("dialog").showModal();
  } else if (hash === "pinned" || groups.some((group) => group.id === hash)) {
    filter = hash;
  }
  showOptions();
})();
