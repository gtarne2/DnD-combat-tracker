// Which Owlbear player is which tracker member, kept in the DM's browser only.
// Member IDs are room credentials in practice, so they never go into Owlbear metadata.
const PREFIX = "aurora-obr-players:";

export function loadMatches(room) {
  try { return JSON.parse(localStorage.getItem(PREFIX + room) || "{}"); } catch { return {}; }
}

export function saveMatch(room, playerId, memberId) {
  const matches = loadMatches(room);
  if (memberId) matches[playerId] = memberId;
  else delete matches[playerId];
  try { localStorage.setItem(PREFIX + room, JSON.stringify(matches)); } catch {}
  return matches;
}

/** Pair unmatched Owlbear players with tracker players of the same name, when unambiguous. */
export function autoMatch(room, players, rows) {
  const matches = loadMatches(room);
  const taken = new Set(Object.values(matches));
  const members = rows.filter((row) => row.kind === "player");
  let changed = false;
  for (const player of players) {
    if (matches[player.id]) continue;
    const name = String(player.name || "").trim().toLowerCase();
    const same = members.filter((row) => String(row.name || "").trim().toLowerCase() === name && !taken.has(row.member_id));
    if (same.length === 1) {
      matches[player.id] = same[0].member_id;
      taken.add(same[0].member_id);
      changed = true;
    }
  }
  if (changed) {
    try { localStorage.setItem(PREFIX + room, JSON.stringify(matches)); } catch {}
  }
  return matches;
}
