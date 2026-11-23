const sessionView = (() => {
  const profile = document.body.dataset.profile;
  const storageKey = profile && "aurora-combat-view-v1:" + profile;
  let stored;
  if (storageKey) {
    try { stored = JSON.parse(localStorage.getItem(storageKey)); } catch {}
  }
  const values = new Map(Object.entries(stored?.values || {}));
  const positions = new Map(Object.entries(stored?.positions || {}));
  const disclosures = new Map(Object.entries(stored?.disclosures || {}));
  let pending;

  function save() {
    clearTimeout(pending);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        values: Object.fromEntries(values),
        positions: Object.fromEntries(positions),
        disclosures: Object.fromEntries(disclosures),
      }));
    } catch {
      // The current tab can still keep its place when local storage is unavailable.
    }
  }

  function queueSave() {
    clearTimeout(pending);
    if (storageKey) pending = setTimeout(save, 150);
  }

  function set(key, value) {
    if (values.get(key) === value) return;
    values.set(key, value);
    queueSave();
  }

  function setPosition(key, value) {
    if (positions.get(key) === value) return;
    positions.set(key, value);
    queueSave();
  }

  function restoreScroll(node) {
    if (!node.getClientRects().length || node.scrollHeight <= node.clientHeight) return;
    const position = positions.get(node.dataset.viewScroll);
    node.scrollTop = Number.isFinite(position) ? position : 0;
  }

  function restoreDisclosure(node) {
    const open = disclosures.get(node.dataset.viewDisclosure);
    if (typeof open === "boolean") node.open = open;
  }

  function rememberScroll(node) {
    if (node.dataset?.viewScroll && node.getClientRects().length && node.scrollHeight > node.clientHeight) {
      setPosition(node.dataset.viewScroll, node.scrollTop);
    }
  }

  document.addEventListener("scroll", (event) => rememberScroll(event.target), true);
  document.addEventListener("toggle", (event) => {
    const node = event.target;
    if (!node.dataset?.viewDisclosure || !node.getClientRects().length) return;
    if (disclosures.get(node.dataset.viewDisclosure) !== node.open) {
      disclosures.set(node.dataset.viewDisclosure, node.open);
      queueSave();
    }
  }, true);
  window.addEventListener("pagehide", save);

  return {
    get: (key) => values.get(key),
    set,
    setPosition,
    position: (key) => positions.get(key) || 0,
    rememberScroll,
    restoreScroll,
    restoreDisclosure,
  };
})();
