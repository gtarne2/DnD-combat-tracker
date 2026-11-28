(() => {
  const byId = (id) => document.getElementById(id);
  const report = byId("import-report");
  const refresh = byId("refresh-aurora");
  const apply = byId("apply-aurora-refresh");
  const status = byId("aurora-refresh-status");
  const url = document.body.dataset.refreshUrl;
  const supported = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[a-f0-9]{32}$/.test(url || "");
  let staged;

  function inventory(doc) {
    return new Map([...doc.querySelectorAll(".option-body[data-inventory-key]")].map((entry) => [entry.dataset.inventoryKey, [
      entry.closest("article").querySelector(".option-title").textContent, entry.dataset.inventoryQuantity || "unknown",
      entry.hasAttribute("data-equipped") ? "equipped" : "unequipped",
    ]]));
  }

  function read(doc) {
    const definitions = JSON.parse(doc.getElementById("import-definitions").textContent);
    const stats = new Map([...doc.querySelectorAll("#import-stat-baselines [data-import-stat]")].map((stat) => [
      stat.dataset.importStat, stat.textContent.trim(),
    ]));
    const options = new Map([...doc.querySelectorAll("#action-groups .option-row")].filter((row) => row.dataset.pin)
      .map((row) => [row.dataset.pin, [row.querySelector(".option-title").textContent,
        ...[...row.querySelectorAll(".option-facts, .description, .spell-concentration")].map((part) => part.textContent.trim())]]));
    const resources = new Map([...doc.querySelectorAll("#encounter-baseline [data-resource]")]
      .map((entry) => [entry.dataset.resource, [entry.textContent, entry.dataset.capacity]]));
    return {definitions, stats, options, inventory: inventory(doc), resources, name: doc.querySelector("h1").textContent};
  }

  const imported = read(document);

  function changes(before, next) {
    const result = [];
    if (before.name !== next.name) result.push(`Character name: ${before.name} → ${next.name}`);
    for (const [key, value] of next.stats) {
      if (before.stats.get(key) !== value) result.push(`${key.toUpperCase()}: ${before.stats.get(key) || "Unavailable"} → ${value}`);
    }
    const compare = (label, old, latest) => {
      for (const [id, [name, ...details]] of latest) {
        if (!old.has(id)) result.push(`${label} added: ${name}`);
        else if (JSON.stringify(old.get(id)) !== JSON.stringify([name, ...details])) {
          const quantity = label === "Inventory" || label === "Resource";
          result.push(`${label} changed: ${name}${quantity ? ` (${old.get(id).slice(1).join(", ")} → ${details.join(", ")})` : ""}`);
        }
      }
      for (const [id, [name]] of old) if (!latest.has(id)) result.push(`${label} removed: ${name}`);
    };
    compare("Definition", new Map(before.definitions.map(([id, ...row]) => [id, row])), new Map(next.definitions.map(([id, ...row]) => [id, row])));
    compare("Inventory", before.inventory, next.inventory);
    compare("Combat option", before.options, next.options);
    compare("Resource", before.resources, next.resources);
    return [...new Set(result)];
  }

  function list(target, values) {
    target.replaceChildren(...values.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
  }

  function show(data, pending) {
    staged = pending;
    const missing = data.definitions.filter((row) => !row[3]);
    const sources = [...new Set(data.definitions.map((row) => row[3]).filter(Boolean))].sort();
    const unavailable = [...data.stats].filter(([, value]) => !value || ["—", "Unavailable"].includes(value)).map(([name]) => name.toUpperCase());
    byId("import-unavailable").textContent = unavailable.length ? `Unavailable stats: ${unavailable.join(", ")}.` : "All displayed key stats were available.";
    byId("import-missing-summary").textContent = `${missing.length} unresolved definitions`;
    byId("import-sources-summary").textContent = `${sources.length} definition sources`;
    list(byId("import-missing"), missing.map(([id, name]) => name === id ? id : `${name} (${id})`));
    list(byId("import-sources"), sources.length ? sources : ["Save only or no matching XML definitions"]);
    const difference = pending ? changes(imported, data) : [];
    byId("import-changes").hidden = !pending;
    list(byId("import-changes").querySelector("ul"), difference.length ? difference : ["No significant imported changes."]);
    byId("apply-refresh-status").textContent = "";
    apply.hidden = !pending;
    report.showModal();
  }

  async function request(route) {
    const response = await fetch(url + route, {method: "POST", cache: "no-store", signal: AbortSignal.timeout(120000)});
    const body = await response.text();
    if (!response.ok) throw new Error(body || "The launcher could not complete the import.");
    return body;
  }

  byId("view-import-report").onclick = () => show(imported, null);
  refresh.onclick = async () => {
    if (!supported) {
      status.textContent = "Open this character through the Windows launcher to enable refresh.";
      return;
    }
    refresh.disabled = true;
    status.textContent = "Reading Aurora save and content…";
    try {
      const content = await request("/stage");
      const candidate = new DOMParser().parseFromString(content, "text/html");
      if (candidate.body.dataset.profile !== document.body.dataset.profile) throw new Error("The refreshed sheet has a different session key.");
      status.textContent = "";
      show(read(candidate), candidate.body.dataset.refreshRevision);
    } catch (error) {
      status.textContent = `Refresh failed. Your current sheet remains open. ${error.message === "Failed to fetch" ? "Check that the launcher is running and allow local network access if prompted." : error.message}`;
    } finally { refresh.disabled = false; }
  };
  apply.onclick = async () => {
    if (!/^[a-f0-9]{32}$/.test(staged || "")) return;
    apply.disabled = true;
    try {
      await request("/apply/" + staged);
      sessionView.save();
      location.reload();
    } catch (error) {
      byId("apply-refresh-status").textContent = "Could not apply the refresh. " + error.message;
    } finally { apply.disabled = false; }
  };
})();
