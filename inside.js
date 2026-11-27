// Stage O4: who is inside a template, by the half-square rule (2014 DMG, "Areas of Effect" on
// a grid): a square counts when the area covers at least half of it, and a creature is
// inside when any square of its space counts.
//
// Pure geometry, so it can be checked without Owlbear. Works on square grids only.

const EPSILON = 1e-6;

/** A template item's outline in scene coordinates: its points, scaled, rotated and moved. */
export function outline(item) {
  const scale = item.scale || { x: 1, y: 1 };
  const angle = ((item.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (item.points || []).map((p) => {
    const x = p.x * scale.x;
    const y = p.y * scale.y;
    return { x: item.position.x + x * cos - y * sin, y: item.position.y + x * sin + y * cos };
  });
}

function area(polygon) {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// Clip a polygon to one side of an axis-aligned line (Sutherland–Hodgman, one edge).
function clip(polygon, inside, cross) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i];
    const previous = polygon[(i + polygon.length - 1) % polygon.length];
    const inNow = inside(current);
    const inBefore = inside(previous);
    if (inNow) {
      if (!inBefore) out.push(cross(previous, current));
      out.push(current);
    } else if (inBefore) {
      out.push(cross(previous, current));
    }
  }
  return out;
}

const atX = (x) => (a, b) => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
const atY = (y) => (a, b) => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });

/** Fraction of the square [x0, x0+size] × [y0, y0+size] the polygon covers. */
export function coverage(polygon, x0, y0, size) {
  let p = polygon;
  p = clip(p, (q) => q.x >= x0, atX(x0));
  if (p.length) p = clip(p, (q) => q.x <= x0 + size, atX(x0 + size));
  if (p.length) p = clip(p, (q) => q.y >= y0, atY(y0));
  if (p.length) p = clip(p, (q) => q.y <= y0 + size, atY(y0 + size));
  return p.length < 3 ? 0 : area(p) / (size * size);
}

/** Grid squares, as "column,row" keys, that the polygon covers by half or more. */
export function countedSquares(polygon, dpi) {
  const squares = new Set();
  if (polygon.length < 3) return squares;
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const left = Math.floor(Math.min(...xs) / dpi);
  const right = Math.ceil(Math.max(...xs) / dpi);
  const top = Math.floor(Math.min(...ys) / dpi);
  const bottom = Math.ceil(Math.max(...ys) / dpi);
  for (let col = left; col < right; col++) {
    for (let row = top; row < bottom; row++) {
      if (coverage(polygon, col * dpi, row * dpi, dpi) >= 0.5 - EPSILON) squares.add(`${col},${row}`);
    }
  }
  return squares;
}

/**
 * The squares a creature occupies: `cells` across, centred on its token. A creature smaller
 * than a square occupies the square its centre is in.
 */
export function space(position, cells, dpi) {
  if (cells < 1) return [`${Math.floor(position.x / dpi)},${Math.floor(position.y / dpi)}`];
  const across = Math.round(cells);
  const col = Math.round(position.x / dpi - across / 2);
  const row = Math.round(position.y / dpi - across / 2);
  const keys = [];
  for (let c = col; c < col + across; c++) for (let r = row; r < row + across; r++) keys.push(`${c},${r}`);
  return keys;
}

/**
 * Rows inside a template. `creatures` are {row, position, cells, caster}; the caster is left
 * out of their own emanation, which surrounds them.
 */
export function rowsInside(polygon, creatures, dpi, { skipCaster = false } = {}) {
  const counted = countedSquares(polygon, dpi);
  return creatures
    .filter((c) => !(skipCaster && c.caster))
    .filter((c) => space(c.position, c.cells, dpi).some((key) => counted.has(key)))
    .map((c) => c.row);
}
