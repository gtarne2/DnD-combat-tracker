// Row labels for the DM's own screens. The DM sees hidden enemies by template name.
export const KIND = { enemy: "Enemy", player: "Player", companion: "Companion" };

export function rowLabel(row) {
  if (row.kind === "enemy" && !row.revealed) return `${row.template?.name || "Enemy"} (hidden)`;
  return row.name || KIND[row.kind] || "Unknown";
}
