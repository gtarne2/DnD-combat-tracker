// Player-sheet settings: assists and tracking the player can switch on or off. Kept in this
// browser, for every character. Other modules read them with sheetSettings.get(name) and
// listen for "sheet-settings-change".
const sheetSettings = (() => {
  const KEY = "aurora-sheet-settings-v1";
  const DEFAULTS = {trackActions: true, autoRollArea: false};
  let values = {...DEFAULTS};
  try { Object.assign(values, JSON.parse(localStorage.getItem(KEY)) || {}); } catch {}
  const status = document.getElementById("sheet-settings-status");
  const inputs = [...document.querySelectorAll("[data-sheet-setting]")];
  function render() {
    for (const input of inputs) input.checked = Boolean(values[input.dataset.sheetSetting]);
  }
  for (const input of inputs) {
    input.addEventListener("change", () => {
      values[input.dataset.sheetSetting] = input.checked;
      try {
        localStorage.setItem(KEY, JSON.stringify(values));
        status.textContent = "Saved.";
      } catch {
        status.textContent = "Browser storage is unavailable. This applies to this tab.";
      }
      document.dispatchEvent(new Event("sheet-settings-change"));
    });
  }
  render();
  return {get: (name) => Boolean(values[name] ?? DEFAULTS[name])};
})();
