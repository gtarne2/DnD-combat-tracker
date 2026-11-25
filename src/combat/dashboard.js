(() => {
  const byId = (id) => document.getElementById(id);
  const workspace = byId("combat");
  const inspector = byId("option-inspector");
  const optionList = byId("all-options");
  const columns = optionList.parentElement;
  const divider = byId("inspector-divider");
  const toggle = byId("toggle-inspector");
  const skillToggle = byId("toggle-skills-dock");
  const skillsDock = byId("skills-dock");
  const skillPanel = byId("character-skills").cloneNode(true);
  skillPanel.removeAttribute("id");
  skillsDock.append(skillPanel);
  const query = byId("option-search");
  const showUnprepared = byId("show-unprepared");
  showUnprepared.closest("label").hidden = !playbook.hasPreparation;
  const groups = [...workspace.querySelectorAll("[data-group]")];
  const tabs = () => [...workspace.querySelectorAll("[data-nav], [data-filter]")];
  const wide = matchMedia("(min-width: 1080px)");
  const kindOf = (card) => card.querySelector("[data-kind]").dataset.kind;
  const pages = new Map([
    ["combat", workspace], ["character", byId("character-dialog")], ["companions", byId("companion-roster-dialog")],
    ["features", byId("features-page")],
    ["inventory", byId("inventory-page")], ["journal", byId("journal-page")],
  ]);
  const navigation = document.querySelector(".command-nav");
  let page;
  let filter = sessionView.get("filter");
  let selected;
  let split = layoutPreferences.inspectorSplit;
  let collapsed = sessionView.get("inspectorCollapsed") === true;
  let docked = sessionView.get("skillsDocked") === true;
  query.value = typeof sessionView.get("query") === "string" ? sessionView.get("query") : "";
  showUnprepared.checked = playbook.hasPreparation && sessionView.get("showUnprepared") === true;

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
    const showingSkills = wide.matches && docked && !collapsed;
    skillsDock.hidden = !showingSkills;
    inspector.hidden = showingSkills;
    skillToggle.setAttribute("aria-pressed", String(showingSkills));
    toggle.textContent = collapsed || showingSkills ? "Show details" : "Hide details";
    toggle.setAttribute("aria-expanded", String(!collapsed && !showingSkills));
    if (selected) {
      const control = selected.querySelector("[data-inspect]");
      control.setAttribute("aria-expanded", String(!wide.matches || (!collapsed && !showingSkills)));
      if (wide.matches) control.setAttribute("aria-controls", inspector.id);
      else control.removeAttribute("aria-controls");
    }
  }

  function splitBounds() {
    const width = columns.clientWidth;
    if (!width || !wide.matches || collapsed) return null;
    const style = getComputedStyle(columns);
    const minimum = parseFloat(style.getPropertyValue("--list-min"));
    const maximum = width - parseFloat(style.getPropertyValue("--inspector-min")) - divider.offsetWidth;
    return {width, minimum, maximum: Math.max(minimum, maximum)};
  }

  function updateDivider() {
    const bounds = splitBounds();
    if (!bounds) return;
    const {width, minimum, maximum} = bounds;
    divider.setAttribute("aria-valuemin", String(Math.round(100 * minimum / width)));
    divider.setAttribute("aria-valuemax", String(Math.round(100 * maximum / width)));
    divider.setAttribute("aria-valuenow", String(Math.round(100 * optionList.offsetWidth / width)));
  }

  function setSplit(position, save = false) {
    const bounds = splitBounds();
    if (!bounds) return;
    const {width, minimum, maximum} = bounds;
    split = 100 * Math.max(minimum, Math.min(position, maximum)) / width;
    columns.style.setProperty("--list-width", split + "%");
    updateDivider();
    if (save) layoutPreferences.setInspectorSplit(split);
  }

  function setCollapsed(value) {
    collapsed = value;
    sessionView.set("inspectorCollapsed", value);
    updateInspectorVisibility();
    updateDivider();
    if (!collapsed) sessionView.restoreScroll(inspector);
  }

  columns.style.setProperty("--list-width", split + "%");
  updateInspectorVisibility();
  new ResizeObserver(updateDivider).observe(columns);
  function setDocked(value) {
    docked = value;
    sessionView.set("skillsDocked", value);
    setCollapsed(false);
  }
  toggle.onclick = () => docked ? setDocked(false) : setCollapsed(!collapsed);
  skillToggle.onclick = () => wide.matches ? setDocked(!docked) : rollReference.open("skills");
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
    attackModifiers.updateOption(card, state);
    const availability = tools.querySelector("[data-option-availability]");
    const badge = card.querySelector("[data-option-badge]");
    const cast = tools.querySelector("[data-cast-spell]");
    const stack = tools.querySelector("[data-consumable]");
    const feature = tools.querySelector("[data-feature-use]");
    const charges = chargedItems.render(tools, state);
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
      const pending = consumableCards.pending(state, stack.dataset.consumable);
      unavailable = pending || remaining == null || remaining === 0;
      stack.querySelector("[data-use]").disabled = unavailable;
      stack.querySelector("[data-remaining]").textContent = remaining ?? "Unavailable";
      if (unavailable) reason = pending ? "Review the imported quantity before using this stack."
        : remaining === 0 ? "None remaining." : "Quantity unavailable in the Aurora save.";
    } else if (feature) {
      const use = playbook.featureUse(card.dataset.pin, state);
      feature.hidden = !use;
      feature.disabled = Boolean(use?.reason);
      if (use) {
        const title = card.querySelector(".option-title").textContent;
        feature.textContent = card.classList.contains("option-row") ? use.shortLabel || use.label : use.label;
        feature.setAttribute("aria-label", use.label + " " + title);
        unavailable = Boolean(use.reason);
        reason = use.reason || use.summary;
        if (unavailable) summary = "No uses";
      }
      if (tools.hasAttribute("data-feature-level-blocked")) {
        feature.disabled = true;
        unavailable = true;
        reason = "This variant requires the listed class level.";
        summary = "Level required";
      }
    }
    if (charges) {
      unavailable = charges.uses === 0 || charges.requiresAttunement;
      reason = charges.requiresAttunement ? tools.dataset.attunementNote : reason;
      summary = charges.requiresAttunement ? "Attunement required"
        : charges.pool ? `${charges.uses} ${charges.uses === 1 ? "use" : "uses"} left` : "No charge pool";
    }
    const run = tools.querySelector("[data-record-attack], [data-cast-spell], [data-use], [data-feature-use], [data-charge-key]");
    const continuingAttack = run?.matches("[data-record-attack]") && combatTools.continuesAttack(state, tools.dataset.turnCost);
    const turnLimit = run && !run.hidden && !continuingAttack && feature?.textContent !== "Deactivate"
      ? actionEconomy.reason(state, "owner", tools.dataset.turnCost) : "";
    if (run?.matches("[data-record-attack]")) run.disabled = false;
    if (turnLimit && !cast?.hasAttribute("data-ritual-cast")) {
      run.disabled = true;
      unavailable = true;
      reason = turnLimit;
      summary = "Turn action unavailable";
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

  function optionKey(card) {
    const body = card.querySelector(".option-body");
    const stack = card.querySelector("[data-consumable]")?.dataset.consumable;
    return JSON.stringify([
      body.dataset.actionGroup,
      card.dataset.pin || card.querySelector(".option-title").textContent,
      stack || body.dataset.inventoryIndex || "",
    ]);
  }

  function prepareDescription(description, key) {
    if (!description) return;
    description.dataset.viewDisclosure = key;
    description.open = true;
    sessionView.restoreDisclosure(description);
  }

  function select(card) {
    if (selected === card) return;
    sessionView.rememberScroll(inspector);
    if (selected) {
      selected.classList.remove("selected-option");
      selected.querySelector("[data-inspect]").setAttribute("aria-expanded", "false");
    }
    selected = card;
    inspector.replaceChildren();
    if (!card) {
      delete inspector.dataset.viewScroll;
      const message = document.createElement("p");
      message.className = "empty";
      message.textContent = "Select an option to read its details.";
      inspector.append(message);
      return;
    }
    card.classList.add("selected-option");
    updateInspectorVisibility();
    const article = document.createElement("article");
    article.dataset.sheetEntry = card.dataset.sheetEntry || "";
    if (card.dataset.pin) article.dataset.pin = card.dataset.pin;
    const heading = document.createElement("h3");
    heading.className = "option-title";
    heading.textContent = card.querySelector(".option-title").textContent;
    const body = card.querySelector(".option-body").cloneNode(true);
    const kind = body.querySelector(".kind");
    const badges = card.querySelector(".option-badges").cloneNode(true);
    badges.querySelector(".row-quantity")?.remove();
    const tools = card.querySelector(".option-execute").cloneNode(true);
    const key = "option-description:" + optionKey(card);
    prepareDescription(body.querySelector("details"), key);
    prepareDescription(card.querySelector(".option-body details"), key);
    const header = document.createElement("header");
    header.append(kind, heading, badges, tools);
    const quickPin = quick.pinButton(card);
    if (quickPin) tools.append(quickPin);
    article.append(header, body);
    sheetReference.addOptionLinks(article, card.dataset.sheetEntry);
    inspector.append(article);
    inspector.dataset.viewScroll = key;
    updateAction(article, previewEncounter.current());
    sessionView.restoreScroll(inspector);
  }

  function showOptions() {
    const available = tabs().filter((tab) => !tab.hidden);
    if (!available.some((tab) => (tab.dataset.nav || tab.dataset.filter) === filter)) {
      const first = available[0];
      filter = first.dataset.nav || first.dataset.filter;
    }
    const term = query.value.trim().toLowerCase();
    const filteringSpells = combatTools.filtering();
    const shown = filteringSpells || term && !["pinned", "traits"].includes(filter) ? "all" : filter;
    const changedView = workspace.dataset.view !== shown;
    if (changedView) sessionView.rememberScroll(optionList);
    workspace.dataset.view = shown;
    optionList.dataset.viewScroll = "option-list:" + shown;
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
          && (!unprepared || showUnprepared.checked || filteringSpells)
          && combatTools.filterSpells(card)
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
    matches += showFollowups(term);
    byId("no-options").textContent = term ? "No matching options." : "No options to display.";
    byId("no-options").hidden = matches > 0 || (!filteringSpells && !term && (!byId("no-groups").hidden
      || shown === "pinned" || active.some((section) => section.querySelector(":scope > .empty"))));
    byId("no-groups").classList.toggle("view-hidden", shown === "pinned");
    const previous = sessionView.get("selection:" + shown);
    const preferred = previous && candidates.find((card) => optionKey(card) === previous);
    if ((changedView && preferred) || !candidates.includes(selected)) {
      select(preferred || (wide.matches ? candidates[0] : null));
    }
    if (changedView) sessionView.restoreScroll(optionList);
    const state = previewEncounter.current();
    for (const card of candidates) updateAction(card, state);
    const detail = inspector.querySelector("article");
    if (detail) updateAction(detail, state);
    quick.render();
  }

  function showFollowups(term) {
    const visible = !combatTools.filtering() && ["bonus-action", "all"].includes(workspace.dataset.view) && !byId("bonus-action").hidden;
    let count = 0;
    for (const row of byId("bonus-followup-list").children) {
      const matches = row.textContent.toLowerCase().includes(term);
      row.hidden = !matches;
      if (matches) count += 1;
    }
    byId("bonus-followups").hidden = !visible || count === 0;
    byId("bonus-action").querySelector(":scope > .empty")?.toggleAttribute("hidden", count > 0 || Boolean(term));
    return visible ? count : 0;
  }
  document.addEventListener("followups-changed", showOptions);
  showUnprepared.addEventListener("change", () => {
    sessionView.set("showUnprepared", showUnprepared.checked);
    showOptions();
  });

  function restoreVisibleScroll() {
    document.querySelectorAll("[data-view-scroll]").forEach(sessionView.restoreScroll);
  }

  function navigate(next) {
    if (!pages.has(next) || page === next) return;
    if (page) {
      document.querySelectorAll("[data-view-scroll]").forEach(sessionView.rememberScroll);
      if (!wide.matches) sessionView.setPosition("page:" + page, window.scrollY);
    }
    page = next;
    document.body.dataset.sessionPage = next;
    for (const [name, section] of pages) section.hidden = name !== next;
    companionControls.place(next === "companions");
    for (const control of navigation.querySelectorAll("[data-session-nav]")) {
      if (control.dataset.sessionNav === next) control.setAttribute("aria-current", "page");
      else control.removeAttribute("aria-current");
    }
    if (next === "combat") showOptions();
    restoreVisibleScroll();
    if (!wide.matches) window.scrollTo(0, sessionView.position("page:" + next));
    sessionView.set("page", next);
  }
  document.addEventListener("preview-encounter-change", showOptions);
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-session-nav]");
    if (!control) return;
    event.preventDefault();
    navigate(control.dataset.sessionNav);
    if (control.classList.contains("brand")) {
      const character = pages.get("character");
      character.scrollTop = 0;
      if (!wide.matches) character.scrollIntoView({block: "start"});
    }
  });
  window.addEventListener("scroll", () => {
    if (page && !wide.matches) sessionView.setPosition("page:" + page, window.scrollY);
  });

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
      sessionView.set("filter", filter);
      sessionView.set("query", "");
      showOptions();
      return;
    }
    const button = event.target.closest("[data-inspect]");
    const card = event.target.closest(".option-row");
    if (!card || (!button && event.target.closest("button, .option-body"))) return;
    if (!button) card.querySelector("[data-inspect]").focus();
    if (wide.matches && docked) setDocked(false);
    if (wide.matches && collapsed) setCollapsed(false);
    if (!wide.matches && card === selected) {
      sessionView.set("selection:" + workspace.dataset.view, null);
      select(null);
    } else {
      sessionView.set("selection:" + workspace.dataset.view, optionKey(card));
      select(card);
    }
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
      if (!attack.disabled) encounterTracker.recordAttack(attack.dataset.recordAttack, attack.closest("article"));
      return;
    }
    const feature = event.target.closest("[data-feature-use]");
    if (feature && !feature.disabled) {
      playbook.activateFeature(feature.closest("article").dataset.pin, actionEconomy.timing(feature));
      return;
    }
    const resource = event.target.closest("[data-resource-detail]");
    if (resource) {
      if (resource.dataset.resourceDetail === "Resource:moxie") {
        const moxie = sheetReference.entries().find((entry) => entry.moxiePool);
        if (moxie) sheetReference.open(moxie.id);
        else byId("configure-moxie").click();
        return;
      }
      const card = groups.flatMap((group) => [...group.querySelectorAll("[data-pin]")])
        .find((card) => card.dataset.pin === resource.dataset.resourceDetail);
      if (!card) return;
      if (page !== "combat") {
        const content = card.querySelector(".option-body").cloneNode(true);
        content.querySelector("[data-track-feature]")?.remove();
        const rules = content.querySelector("details");
        if (rules) {
          rules.removeAttribute("data-view-disclosure");
          rules.open = true;
        }
        byId("resource-reference-title").textContent = card.querySelector(".option-title").textContent;
        byId("resource-reference-content").replaceChildren(content);
        byId("resource-reference").showModal();
        return;
      }
      filter = "traits";
      query.value = "";
      sessionView.set("filter", filter);
      sessionView.set("query", "");
      sessionView.set("selection:traits", optionKey(card));
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
  query.addEventListener("input", () => {
    sessionView.set("query", query.value);
    showOptions();
  });
  wide.addEventListener("change", () => {
    updateInspectorVisibility();
    if (selected) {
      const scope = wide.matches ? inspector : selected;
      const description = scope.querySelector(".option-body details");
      if (description) sessionView.restoreDisclosure(description);
    }
    showOptions();
    restoreVisibleScroll();
  });
  document.addEventListener("combat-options-change", showOptions);
  const rows = groups.flatMap((group) => [...group.querySelectorAll(".option-row")]);
  sheetReference.setup(rows);
  setupReferencePages(rows);
  consumableCards.start();
  setupFeatureGroups();
  document.querySelectorAll("details[data-view-disclosure]").forEach(sessionView.restoreDisclosure);
  document.documentElement.classList.add("dashboard-ready");
  const hash = location.hash.slice(1);
  const savedPage = sessionView.get("page");
  const legacyNotes = ["notes", "notes-page"].includes(hash) || (!hash && savedPage === "notes");
  let initialPage = legacyNotes || hash === "journal-page" ? "journal" : pages.has(savedPage) ? savedPage : "combat";
  if (["full-sheet", "character-dialog", "character-overview"].includes(hash)) initialPage = "character";
  else if (hash === "combat" || hash === "pinned" || groups.some((group) => group.id === hash)) {
    initialPage = "combat";
    if (hash !== "combat") {
      filter = hash;
      query.value = "";
      sessionView.set("filter", filter);
      sessionView.set("query", "");
    }
  }
  navigate(initialPage);
  if (legacyNotes) byId("notes-content").scrollIntoView({block: "nearest"});
  if (hash === "sheet-layout") byId(hash).closest("dialog").showModal();
})();
