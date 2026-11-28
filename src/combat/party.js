// The launcher shares one lease across all copies of the current sheet or dashboard.
;(() => {
  const url = document.body.dataset.refreshUrl;
  if (!url) return;
  function heartbeat() {
    fetch(url + "/heartbeat", {method: "POST", cache: "no-store", referrerPolicy: "no-referrer"}).catch(() => {});
  }
  heartbeat();
  setInterval(heartbeat, 30_000);
  window.addEventListener("pageshow", heartbeat);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) heartbeat();
  });
})();

function initiativeWriter(request) {
  let retry;
  return async (state, edit) => {
    const command = {encounter_id:state.combat.id, expected_revision:state.combat.revision, edit};
    const signature = JSON.stringify([state.room_id, command.encounter_id, edit]);
    if (retry?.signature !== signature) retry = {signature, body:{room_id:state.room_id,command_id:crypto.randomUUID(),command}};
    try {
      await request("initiative", retry.body);
      retry = null;
    } catch (error) {
      if (/revision|review the updated order|invalid|forbidden|rejected/i.test(error.message)) retry = null;
      throw error;
    }
  };
}

;(() => {
  const root = document.getElementById("party-controls");
  if (!root) return;
  const url = document.body.dataset.partyUrl;
  const panel = document.createElement("details");
  panel.className = "party-panel";
  const title = document.createElement("summary");
  title.textContent = "Party";
  panel.append(title);
  root.append(panel);
  const status = document.createElement("p");
  status.className = "party-status";
  status.setAttribute("role", "status");
  panel.append(status);
  // Connection summary for styling and the sheet's header chip: online, pending, closed or offline.
  function connection(value, waiting = 0) {
    root.dataset.connection = value;
    const chip = document.getElementById("party-chip");
    if (!chip) return;
    chip.hidden = false;
    chip.dataset.connection = value;
    chip.querySelector(".party-chip-text").textContent = {online:"Party", pending:"Connecting", closed:"Party closed", offline:"Party offline", solo:"Solo"}[value];
    const badge = chip.querySelector(".party-chip-count");
    badge.hidden = !waiting;
    badge.textContent = String(waiting);
    chip.setAttribute("aria-label", "Party · " + chip.querySelector(".party-chip-text").textContent
      + (waiting ? " · " + waiting + (waiting === 1 ? " item needs" : " items need") + " your answer" : ""));
  }
  if (!url) {
    root.dataset.connection = "solo";
    status.textContent = "Playing solo. Use Party in the Windows launcher to host or join.";
    if (previewEncounter.current().progress?.partyClock) {
      const solo = document.getElementById("resume-solo-initiative");
      solo.hidden = false;
      solo.onclick = async () => {
        if (await previewEncounter.transact(draft => partyInitiative.release(draft.progress), {undo:false,boundary:true}) === "durable") solo.hidden = true;
      };
    }
    return;
  }
  panel.open = document.body.dataset.partyLobby === "true";
  document.getElementById("party-chip")?.addEventListener("click", () => { panel.open = true; });
  const roster = document.createElement("ul");
  roster.className = "party-roster";
  roster.setAttribute("aria-label", "Party members");
  const actions = document.createElement("div");
  actions.className = "party-actions";
  const feedback = document.createElement("p");
  feedback.className = "party-feedback";
  feedback.setAttribute("role", "status");
  panel.append(roster, actions, feedback);
  async function request(action, payload) {
    const response = await fetch(url + "/" + action, {method:"POST", cache:"no-store", referrerPolicy:"no-referrer",
      body: payload !== undefined ? JSON.stringify(payload) : undefined});
    if (!response.ok) throw new Error((await response.text()) || "Party operation unavailable.");
    return response.json();
  }
  const hasSheet = document.body.dataset.partyLobby !== "true";
  const restoreEpoch = hasSheet ? previewEncounter.restoreEpoch() : null;
  const announcements = document.createElement("ul");
  announcements.className = "party-announcements";
  announcements.setAttribute("aria-label", "DM announcements");
  announcements.hidden = true;
  panel.append(announcements);
  const windows = hasSheet ? setupPartyWindows(panel, request, refresh, restoreEpoch) : null;
  const offers = document.createElement("section");
  offers.className = "party-offers";
  const send = document.createElement("form");
  send.hidden = true;
  if (hasSheet) {
    send.className = "focus-form party-send";
    send.innerHTML = `<label>Party member <select name="recipient" required></select></label>
      <label>Offer <select name="kind"><option value="healing">Healing</option><option value="temporary_hp">Temporary HP</option></select></label>
      <label>Amount <input name="amount" type="number" min="1" max="4294967295" required></label>
      <label>Source <input name="source" maxlength="120" required></label>
      <button type="submit">Send to party member</button>`;
    offers.setAttribute("aria-label", "Party offers");
    panel.append(send, offers);
  } else {
    const damageOffers = document.createElement("details");
    const heading = document.createElement("summary");
    heading.textContent = "Damage offers";
    offers.setAttribute("aria-label", "Damage offers");
    damageOffers.hidden = true;
    damageOffers.append(heading, offers);
    panel.append(damageOffers);
  }
  const outgoing = document.createElement("p");
  if (hasSheet) panel.append(outgoing);
  const share = hasSheet ? setupPartySharing(panel, request) : null;
  const tokenLook = hasSheet ? setupTokenLook(request) : null;
  const initiative = hasSheet ? partyInitiative.setup(request, refresh) : setupDmInitiative(request, refresh);
  let view;
  let membersKey = "";
  let offersKey = "";
  let sendRetry;
  let busy = false;
  let refreshPending;
  const writeOffer = (room, command, commandId = crypto.randomUUID()) =>
    request("offer", {room_id: room, command_id: commandId, command});

  function setBusy(value) {
    busy = value;
    for (const button of [...send.querySelectorAll("button"), ...offers.querySelectorAll("button")]) {
      button.disabled = value;
    }
  }

  async function perform(work) {
    if (busy) return;
    setBusy(true);
    try { await work(); }
    catch (error) { feedback.textContent = error.message; }
    finally { setBusy(false); await refresh(); }
  }

  send.onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    const fields = send.elements;
    const room = view?.room_id;
    const source = fields.source.value.trim();
    if (!room || !source) return;
    const command = {kind: "send", recipient: fields.recipient.value, source,
      effect: {kind: fields.kind.value, amount: fields.amount.valueAsNumber}};
    const signature = JSON.stringify([room, command]);
    if (sendRetry?.signature !== signature) sendRetry = {signature, id: crypto.randomUUID()};
    perform(async () => {
      await writeOffer(room, command, sendRetry.id);
      sendRetry = null;
      fields.amount.value = "";
      feedback.textContent = "Offer sent.";
    });
  };

  async function decide(room, offer, choice, target) {
    const offer_id = offer.offer_id;
    const acknowledge = await previewEncounter.withWriter(async () => {
      if (restoreEpoch !== previewEncounter.restoreEpoch()) throw new Error("A backup was restored. Resume the party from the launcher.");
      if (previewEncounter.received(offer_id)) return true;
      if (choice === "decline") {
        await writeOffer(room, {kind: "decline", offer_id});
        return false;
      }
      if (choice === "retry") return false;
      const grant = offer.effect.kind === "grant" && offer.effect.amount;
      const buff = offer.effect.kind === "buff" && offer.effect.amount;
      if (choice === "apply" && grant && !attackModifiers.eligibleTargets(grant.category).has(target)) {
        throw new Error("Choose an eligible attack on your sheet.");
      }
      if (choice === "apply" && !grant && !buff && !encounterTracker.hp(previewEncounter.current())) {
        throw new Error("Set your HP on the combat sheet before accepting this offer.");
      }
      await writeOffer(room, {kind: "claim", offer_id});
      const saved = previewEncounter.receive(offer_id, (draft) => {
        if (choice === "handled") return false;
        const progress = draft.progress ||= previewEncounter.emptyProgress();
        const {kind, amount} = offer.effect;
        if (buff) {
          // R79: the caster's buff lands on this sheet as an effect with its stat changes.
          const mods = effectControls.fromWire(buff);
          if (!mods) return false;
          const sender = (view?.members || []).find(member => member.member_id === offer.sender);
          const seconds = Number.isInteger(buff.seconds) && buff.seconds > 0 ? buff.seconds : null;
          progress.effects ||= [];
          progress.effects.push({id: ++progress.sequence, name: offer.source, target: "owner", category: "effect",
            kind: seconds ? "seconds" : "manual", remaining: seconds, mods, partyOffer: offer_id,
            notes: effectControls.describeMods(mods) + (sender ? " · From " + sender.name : "")});
          previewEncounter.log(draft, "action", "Received " + offer.source + (sender ? " from " + sender.name : ""));
          return "applying " + offer.source;
        }
        if (grant) {
          (progress.partyGrants ||= {})[offer_id] = {...grant, target};
          previewEncounter.log(draft, "action", "Accepted " + offer.source);
          return "applying " + offer.source;
        }
        if (kind === "damage") {
          return concentrationControls.applyDamage(draft, amount).changed && "recording party damage";
        }
        const changed = kind === "healing" ? encounterTracker.healOwner(progress, "direct", amount)
          : kind === "temporary_hp" && encounterTracker.grantOwnerTemporaryHp(progress, amount);
        if (!changed) return false;
        const label = kind === "healing" ? "Party healing" : "Party temporary HP";
        previewEncounter.log(draft, kind, `${label} · ${offer.source}`);
        return label.toLowerCase();
      });
      if (saved !== "durable") throw new Error("Could not save the offer in browser storage. Try again.");
      return true;
    }, true);
    if (acknowledge) {
      try { await writeOffer(room, {kind: "accept", offer_id}); }
      catch { throw new Error("Offer saved locally. The receipt will retry when the party is reachable."); }
    }
  }

  function renderOffers(state) {
    const members = state.members || [];
    const recipients = members.filter(member => member.member_id !== state.self_id && member.member_id !== state.dm_id);
    const nextMembers = JSON.stringify(recipients);
    if (hasSheet) send.hidden = Boolean(state.ended || !recipients.length);
    if (hasSheet && nextMembers !== membersKey) {
      membersKey = nextMembers;
      const field = send.elements.recipient;
      const previous = field.value;
      field.replaceChildren(...recipients.map(member =>
        new Option(partyActions.memberLabel(member) + (member.online ? "" : " · Offline"), member.member_id)));
      if (recipients.some(member => member.member_id === previous)) field.value = previous;
    }
    const addressed = (state.offers || []).filter(offer => offer.effect.kind === "damage"
      || hasSheet && ["healing", "temporary_hp", "grant", "buff"].includes(offer.effect.kind));
    if (!hasSheet) offers.parentElement.hidden = !addressed.length;
    const nextOffers = JSON.stringify([state.room_id, state.ended, members, addressed]);
    if (nextOffers !== offersKey) {
      offersKey = nextOffers;
      offers.replaceChildren(...addressed.map(offer => {
        const row = document.createElement("article");
        row.dataset.offerId = offer.offer_id;
        const incoming = offer.recipient === state.self_id;
        row.className = "party-card";
        row.dataset.kind = offer.effect.kind;
        row.dataset.status = offer.status;
        row.dataset.direction = incoming ? "incoming" : "outgoing";
        const other = members.find(member => member.member_id === (incoming ? offer.sender : offer.recipient));
        const effect = {healing: "healing", temporary_hp: "temporary HP", damage: "damage"}[offer.effect.kind];
        const displayName = other && (hasSheet ? partyActions.memberLabel(other)
          : other.name + " · " + other.member_id.slice(0, 8));
        const names = displayName ? ` · ${incoming ? "From" : "To"} ${displayName}` : "";
        const heading = document.createElement("p");
        const grant = offer.effect.kind === "grant" && offer.effect.amount;
        const buff = offer.effect.kind === "buff" && offer.effect.amount;
        const mechanics = buff ? effectControls.describeMods(effectControls.fromWire(buff)) || "Buff" : grant ? `${grant.category} attack · ${grant.attack} to hit · ${grant.damage} damage · ${{short_rest: "ends on short or long rest", long_rest: "ends on long rest", source_ends: "ends with source"}[grant.end_rule]}` : `${offer.effect.amount} ${effect}`;
        heading.textContent = `${offer.source} · ${mechanics}${names} · ${offer.status[0].toUpperCase() + offer.status.slice(1)}`;
        row.append(heading);
        function action(label, work) {
          const control = document.createElement("button");
          control.type = "button";
          control.textContent = label;
          control.disabled = busy;
          control.onclick = () => perform(work);
          row.append(control);
        }
        let selection;
        if (incoming && grant && ["pending", "claimed"].includes(offer.status)) {
          selection = document.createElement("select");
          selection.setAttribute("aria-label", "Your " + grant.category + " attack");
          selection.add(new Option("Choose your attack…", ""));
          for (const [key, name] of attackModifiers.eligibleTargets(grant.category)) selection.add(new Option(name, key));
          row.append(selection);
        }
        if (incoming && offer.status === "pending" && !state.ended) {
          action("Accept", () => decide(state.room_id, offer, "apply", selection?.value));
          action("Decline", () => decide(state.room_id, offer, "decline"));
        } else if (incoming && offer.status === "claimed") {
          const note = document.createElement("p");
          note.textContent = "Review this claimed offer on your sheet before applying it.";
          row.append(note);
          action("Apply offer", () => decide(state.room_id, offer, "apply", selection?.value));
          action("Already handled", () => decide(state.room_id, offer, "handled"));
          action("Decline", () => decide(state.room_id, offer, "decline"));
        } else if (!incoming && offer.status === "pending" && !state.ended) {
          action("Withdraw", () => writeOffer(state.room_id, {kind: "withdraw", offer_id: offer.offer_id}));
        }
        if (offer.reversal_requested) {
          const correction = document.createElement("p");
          correction.textContent = incoming ? "The sender requests a correction. Review your activity and use Undo or adjust your sheet." : "Correction requested.";
          row.append(correction);
        } else if (!incoming && offer.status === "accepted" && !grant && !buff && !state.ended) {
          action("Request reversal", () => writeOffer(state.room_id, {kind: "request_reversal", offer_id: offer.offer_id}));
        }
        return row;
      }));
    }
    if (hasSheet && !busy) {
      const saved = addressed.find(offer => offer.recipient === state.self_id && offer.status === "claimed"
        && previewEncounter.received(offer.offer_id));
      // A buff from another player applies itself: there is nothing to choose (R79).
      const buff = !saved && !state.ended && addressed.find(offer => offer.recipient === state.self_id
        && offer.effect.kind === "buff" && offer.status === "pending");
      if (buff) {
        setBusy(true);
        decide(state.room_id, buff, "apply").catch(error => { feedback.textContent = error.message; })
          .finally(() => { setBusy(false); });
      } else if (saved) {
        setBusy(true);
        decide(state.room_id, saved, "retry").catch(error => { feedback.textContent = error.message; })
          .finally(() => { setBusy(false); });
      }
    }
  }
  async function syncActions(state) {
    if (restoreEpoch !== previewEncounter.restoreEpoch()) return;
    if (partyActions.hasEndedSource(previewEncounter.current(), previewEncounter.delivery())) {
      await previewEncounter.transact(() => true);
    }
    for (const offer of state.offers || []) {
      if (!["grant", "buff"].includes(offer.effect.kind) || offer.recipient !== state.self_id || offer.status !== "ended") continue;
      const receipt = "end:" + offer.offer_id;
      if (previewEncounter.received(receipt)) continue;
      await previewEncounter.withWriter(() => {
        if (previewEncounter.received(receipt)) return;
        const remove = offer.effect.kind === "buff" ? draft => {
          const effect = effectControls.entries(draft).find(entry => entry.partyOffer === offer.offer_id);
          if (!effect || !effectControls.active(effect)) return false;
          effect.ended = true;
          effect.endedBySource = true;
          return true;
        } : draft => {
          if (!draft.progress?.partyGrants?.[offer.offer_id]) return false;
          delete draft.progress.partyGrants[offer.offer_id];
          return true;
        };
        const result = previewEncounter.receive(receipt, draft => {
          if (!remove(draft)) return false;
          previewEncounter.log(draft, "expiration", offer.source + " ended");
          return true;
        }, {undo: false, rebase: remove});
        if (result !== "durable") throw new Error("Could not save the ended grant. Retrying.");
      }, true);
    }
    const entries = Object.entries(previewEncounter.delivery().outbox || {})
      .filter(([, entry]) => entry.room === state.room_id && entry.sender === state.self_id);
    // A restored or offline source can end before its original send leaves the sheet.
    // Publish its end first so that late delivery reaches the room already ended.
    const ending = new Set(entries.filter(([, entry]) => entry.command.kind === "end_grant")
      .map(([, entry]) => entry.command.grant_id));
    const ready = entries.filter(([, entry]) => !ending.has(entry.command.effect?.amount?.grant_id));
    const results = await Promise.allSettled(ready.map(async ([id, entry]) => {
      if (!state.ended) await writeOffer(entry.room, entry.command, id);
      await previewEncounter.finishCommand(id);
    }));
    const waiting = ready.filter((_, index) => results[index].status === "rejected").map(([, {command}]) => {
      const recipient = state.members?.find(member => member.member_id === command.recipient);
      return command.kind === "send" ? command.source + (recipient ? " → " + recipient.name : "") : "Ending grant";
    });
    outgoing.textContent = waiting.length ? "Waiting to deliver · " + waiting.join(", ") + ". Retrying." : "";
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
  async function loadState() {
    try {
      const state = await request("state");
      view = state;
      if (hasSheet) share(state);
      if (hasSheet) tokenLook(state);
      else renderDmParty(state);
      if (hasSheet) partyActions.setRoom(state);
      status.textContent = state.state + (state.role === "dm" ? " as DM" : "");
      roster.replaceChildren(...(state.members || []).map(member => {
        const item = document.createElement("li");
        item.textContent = member.name + (member.member_id === state.self_id ? " (you)" : "") + (member.online ? "" : " · Offline");
        item.dataset.presence = member.online ? "online" : "offline";
        if (member.member_id === state.dm_id) item.dataset.role = "dm";
        return item;
      }));
      const waiting = (state.questions || []).length + (state.offers || []).filter(offer => offer.recipient === state.self_id
        && (offer.status === "pending" || offer.status === "claimed")).length;
      connection(state.ended ? "closed" : /^(Connecting|Reconnecting)/.test(state.state) ? "pending" : "online", hasSheet ? waiting : 0);
      await initiative(state).catch(error => { feedback.textContent = error.message; });
      announcements.hidden = !state.announcements?.length;
      announcements.replaceChildren(...(state.announcements || []).map(text => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
      }));
      windows?.render(state);
      renderOffers(state);
      if (windows) await windows.sync(state).catch(error => { feedback.textContent = error.message; });
      if (hasSheet) await syncActions(state).catch(error => { feedback.textContent = error.message; });
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
      view = null;
      windows?.render(null);
      announcements.hidden = true;
      await initiative(null);
      if (hasSheet) share(null);
      else renderDmParty(null);
      if (hasSheet) partyActions.setRoom(null);
      renderOffers({ended: true});
      status.textContent = "Party helper disconnected. Resume from the launcher.";
      connection("offline");
      roster.replaceChildren(); actions.replaceChildren(); last = "";
    }
  }
  async function refresh() {
    if (!refreshPending) refreshPending = loadState().finally(() => { refreshPending = null; });
    return refreshPending;
  }
  async function poll() {
    await refresh();
    setTimeout(poll, 600);
  }
  panel.addEventListener("toggle", () => { if (panel.open) refresh(); });
  poll();
})();

// The player's class and round portrait go to the DM's tracker for their Owlbear token. Sent
// again after every reconnect (a new publication session) and whenever the portrait changes.
function setupTokenLook(request) {
  let session = null;
  let sent = null;
  let busy = false;
  let again = false;
  async function send() {
    if (!session || !window.portraitToken) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      const look = await window.portraitToken.look();
      const signature = JSON.stringify([session, look]);
      if (signature !== sent) {
        await request("token", look);
        sent = signature;
      }
    } catch {
      // Older DM helpers do not know this request; the token then keeps the class icon.
    } finally {
      busy = false;
      if (again) { again = false; void send(); }
    }
  }
  window.portraitToken?.onChange(() => { void send(); });
  return state => {
    const next = state?.dm_id && state.self_id && !state.ended ? state.publication_session || null : null;
    if (next !== session) { session = next; void send(); }
  };
}

// End-of-fight recap (R85) from the room's fight log, shared by the DM dashboard and the
// player sheet. Players' logs already name hidden enemies "A hidden creature".
function fightRecap(log) {
  const entries = Array.isArray(log) ? log : [];
  if (!entries.length) return null;
  const rounds = Math.max(1, ...entries.map(entry => entry.round || 1));
  const party = new Map();
  const person = named => {
    const key = named.member_id || named.id;
    if (!party.has(key)) party.set(key, {name: named.name, dealt: 0, taken: 0, best: null, downs: [], spells: [], reactions: []});
    return party.get(key);
  };
  const defeated = [];
  let unattributed = 0, enemyDamage = 0;
  for (const entry of entries) {
    if (entry.kind === "damage") {
      if (entry.to.enemy) {
        enemyDamage += entry.amount;
        if (entry.by && !entry.by.enemy) {
          const who = person(entry.by);
          who.dealt += entry.amount;
          if (!who.best || entry.amount > who.best.amount) who.best = {amount: entry.amount, what: entry.what, to: entry.to.name};
        } else if (!entry.by) unattributed += entry.amount;
      } else person(entry.to).taken += entry.amount;
    } else if (entry.kind === "down") {
      defeated.push(entry.who.name);
      if (entry.by && !entry.by.enemy) person(entry.by).downs.push(entry.who.name);
    } else if (entry.kind === "spell") person(entry.by).spells.push(entry.spell);
    else if (entry.kind === "reaction") person(entry.by).reactions.push(entry.note);
  }
  const count = list => {
    const tally = new Map();
    for (const item of list) tally.set(item, (tally.get(item) || 0) + 1);
    return [...tally].map(([name, n]) => n > 1 ? name + " ×" + n : name).join(", ");
  };
  const lines = [];
  lines.push(rounds + (rounds === 1 ? " round" : " rounds") + " · " + defeated.length + (defeated.length === 1 ? " enemy" : " enemies") + " defeated" + (enemyDamage ? " · " + enemyDamage + " damage to enemies" : ""));
  if (defeated.length) lines.push("Defeated: " + count(defeated));
  const people = [...party.values()].sort((a, b) => b.dealt - a.dealt || a.name.localeCompare(b.name));
  for (const who of people) {
    const parts = [];
    if (who.dealt) parts.push("dealt " + who.dealt);
    if (who.best) parts.push("biggest hit " + who.best.amount + (who.best.what ? " (" + who.best.what + ")" : "") + " on " + who.best.to);
    if (who.downs.length) parts.push("finished " + count(who.downs));
    if (who.taken) parts.push("took " + who.taken);
    if (who.spells.length) parts.push("cast " + count(who.spells));
    if (who.reactions.length) parts.push("reacted with " + count(who.reactions));
    if (parts.length) lines.push(who.name + ": " + parts.join(" · "));
  }
  if (unattributed) lines.push("Other damage to enemies: " + unattributed);
  return {rounds, defeated, people, lines, text: lines.join("\n")};
}
