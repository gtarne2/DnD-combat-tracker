;(() => {
  const root = document.getElementById("party-controls");
  if (!root) return;
  const url = document.body.dataset.partyUrl;
  const panel = document.createElement("details");
  const title = document.createElement("summary");
  title.textContent = "Party";
  panel.append(title);
  root.append(panel);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  panel.append(status);
  if (!url) {
    status.textContent = "Playing solo. Use Party in the Windows launcher to host or join.";
    return;
  }
  panel.open = document.body.dataset.partyLobby === "true";
  const roster = document.createElement("ul");
  const actions = document.createElement("div");
  const feedback = document.createElement("p");
  panel.append(roster, actions, feedback);
  async function request(action) {
    const response = await fetch(url + "/" + action, {method:"POST", cache:"no-store", referrerPolicy:"no-referrer"});
    if (!response.ok) throw new Error("Party operation unavailable.");
    return response.json();
  }
  let last = "";
  function button(label, action, confirmText) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label;
    actions.append(b);
    b.onclick = async () => {
      if (confirmText && !window.confirm(confirmText)) return;
      b.disabled = true;
      try {
        const result = await request(action);
        if (action === "invite") {
          await navigator.clipboard.writeText(result.invite);
          feedback.textContent = "Invitation copied.";
        } else feedback.textContent = "";
        await refresh();
      } catch (error) { feedback.textContent = error.message; }
      finally { b.disabled = false; }
    };
  }
  async function refresh() {
    try {
      const state = await request("state");
      status.textContent = state.state + (state.role === "dm" ? " as DM" : "");
      roster.replaceChildren(...(state.members || []).map(member => {
        const item = document.createElement("li");
        item.textContent = member.name + (member.member_id === state.self_id ? " (you)" : "") + (member.online ? "" : " · Offline");
        return item;
      }));
      const key = JSON.stringify([state.role,state.ended,state.open]);
      if (key === last) return;
      last = key; actions.replaceChildren();
      if (state.ended) return;
      if (state.role === "guest") button("Leave party","leave","Leave this party?");
      else if (state.role === "host" || state.role === "dm") {
        if (state.open) button("Copy invite","invite");
        button(state.open ? "Replace invite" : "Open invitations","rotate");
        if (state.open) button("Close invitations","seal");
        button("End room","end","End membership for everyone in this room?");
      }
    } catch {
      status.textContent = "Party helper disconnected. Resume from the launcher.";
      roster.replaceChildren(); actions.replaceChildren(); last = "";
    }
  }
  async function poll() {
    if (panel.open && !document.hidden) await refresh();
    setTimeout(poll, 1200);
  }
  panel.addEventListener("toggle", () => { if (panel.open) refresh(); });
  poll();
})();
