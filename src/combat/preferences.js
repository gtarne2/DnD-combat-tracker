(() => {
  const byId = (id) => document.getElementById(id);
  const collect = (selector, key) =>
    new Map([...document.querySelectorAll(selector)].map((node) => [key(node), node]));
  const groups = collect("[data-group]", (node) => node.id);
  const links = collect("[data-nav]", (node) => node.dataset.nav);
  const settings = collect("[data-setting]", (node) => node.dataset.setting);
  const stats = collect("[data-stat]", (node) => node.dataset.stat);
  const originalStats = new Map([...stats].map(([key, node]) => [key, node.textContent]));
  const sources = new Map();
  for (const card of document.querySelectorAll("[data-pin]")) {
    const key = card.dataset.pin;
    if (!sources.has(key)) sources.set(key, []);
    sources.get(key).push(card);
  }
  const profile = document.body.dataset.profile;
  const storageKey = profile && `aurora-combat-layout-v1:${profile}`;
  const status = byId("layout-status");
  const form = byId("stat-settings");

  function readPreferences() {
    if (!storageKey) return {};
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch {
      return {};
    }
  }

  const stored = readPreferences();
  const keysIn = (values, allowed) =>
    Array.isArray(values) ? [...new Set(values.filter((key) => allowed.has(key)))] : [];
  const storedOrder = keysIn(stored.order, groups);
  const order = [...storedOrder, ...[...groups.keys()].filter((id) => !storedOrder.includes(id))];
  const hidden = new Set(keysIn(stored.hidden, groups));
  const pins = keysIn(stored.pins, sources);
  const overrides = new Map(
    Object.entries(stored.overrides || {}).filter(([key, value]) =>
      stats.has(key) && typeof value === "string" && value.trim() && value.length <= 80),
  );

  function savePreferences(message) {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          order, hidden: [...hidden], pins, overrides: Object.fromEntries(overrides),
        }));
        status.textContent = message;
        return;
      } catch {
        status.textContent = "Browser storage is unavailable. These changes apply to this tab.";
        return;
      }
    }
    status.textContent = "These changes apply to this tab.";
  }

  function renderOrder() {
    for (const [index, id] of order.entries()) {
      const group = groups.get(id);
      const link = links.get(id);
      const setting = settings.get(id);
      const isHidden = hidden.has(id);
      group.hidden = isHidden;
      link.hidden = isHidden;
      setting.querySelector("[data-visible]").checked = !isHidden;
      setting.querySelector('[data-move="-1"]').disabled = index === 0;
      setting.querySelector('[data-move="1"]').disabled = index === order.length - 1;
      byId("action-groups").append(group);
      byId("group-navigation").append(link);
      byId("section-settings").append(setting);
    }
    byId("no-groups").hidden = order.some((id) => !hidden.has(id));
  }

  function renderPins() {
    for (const [key, cards] of sources) {
      const pressed = pins.includes(key);
      for (const card of cards) {
        const button = card.querySelector("[data-pin-toggle]");
        const verb = pressed ? "Unpin" : "Pin";
        button.setAttribute("aria-pressed", String(pressed));
        button.setAttribute("aria-label", `${verb} ${button.dataset.pinToggle}`);
        button.textContent = verb;
      }
    }
    const copies = pins.flatMap((key) => sources.get(key).map((card) => card.cloneNode(true)));
    byId("pinned-cards").replaceChildren(...copies);
    byId("pinned").hidden = copies.length === 0;
    byId("pinned-link").hidden = copies.length === 0;
  }

  function renderStats() {
    for (const [key, node] of stats) {
      node.textContent = overrides.get(key) || originalStats.get(key);
      form.elements.namedItem(key).value = overrides.get(key) || "";
    }
  }

  function openPanel(hash) {
    const panel = byId(hash.slice(1));
    if (panel instanceof HTMLDetailsElement) panel.open = true;
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-open-panel]");
    if (link) openPanel(link.hash);

    const pin = event.target.closest("[data-pin-toggle]");
    if (pin) {
      const key = pin.closest("[data-pin]").dataset.pin;
      const index = pins.indexOf(key);
      const pinnedCopy = byId("pinned").contains(pin);
      if (index >= 0) pins.splice(index, 1);
      else pins.push(key);
      renderPins();
      if (pinnedCopy) {
        const original = sources.get(key).find((node) => node.getClientRects().length);
        (original?.querySelector("[data-pin-toggle]") || byId("sheet-layout").querySelector("summary")).focus();
      }
      savePreferences(index >= 0 ? "Pin removed." : "Pin saved.");
    }

    const move = event.target.closest("[data-move]");
    if (move) {
      const row = move.closest("[data-setting]");
      const index = order.indexOf(row.dataset.setting);
      const destination = index + Number(move.dataset.move);
      if (destination < 0 || destination >= order.length) return;
      [order[index], order[destination]] = [order[destination], order[index]];
      renderOrder();
      (move.disabled ? row.querySelector("[data-visible]") : move).focus();
      savePreferences("Section order saved.");
    }
  });

  byId("section-settings").addEventListener("change", (event) => {
    const control = event.target;
    if (!control.matches("[data-visible]")) return;
    const id = control.closest("[data-setting]").dataset.setting;
    if (control.checked) hidden.delete(id);
    else hidden.add(id);
    renderOrder();
    control.focus();
    savePreferences("Section visibility saved.");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    for (const [key, input] of new FormData(form)) {
      if (!stats.has(key)) continue;
      const value = input.trim();
      if (value) overrides.set(key, value);
      else overrides.delete(key);
    }
    renderStats();
    renderPins();
    savePreferences("Stat overrides saved.");
  });

  renderOrder();
  renderStats();
  renderPins();
  openPanel(location.hash);
})();
