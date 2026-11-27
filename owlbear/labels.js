// Row labels for the DM's own screens. Enemies use the alias players know them by, numbered
// like the tracker, with the monster type after it when the alias doesn't already say it.
export const KIND = { enemy: "Enemy", player: "Player", companion: "Companion" };

export function rowLabel(row) {
  if (row.kind !== "enemy") return row.name || KIND[row.kind] || "Unknown";
  const name = row.name || row.template?.name || "Enemy";
  const type = row.template?.name;
  const typed = type && !name.toLowerCase().startsWith(type.toLowerCase()) ? `${name} · ${type}` : name;
  return row.revealed ? typed : `${typed} (hidden)`;
}
