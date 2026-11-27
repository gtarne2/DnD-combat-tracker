// Stage O3: spell templates. The room keeps each player's templates; the DM's background page
// works out where they go, and the caster's own extension draws them so the caster owns the
// drawing. If the caster's extension does not answer, the DM's extension draws it instead.
//
// Template metadata holds only the tracker room and template IDs.
import { buildCurve } from "./obr-sdk-3.1.0.js";

export const TEMPLATE = "com.aurora-tracker/template";
export const CHANNEL = "com.aurora-tracker/templates";
const COLOURS = ["#ff7043", "#42a5f5", "#ab47bc", "#66bb6a", "#ffca28", "#ec407a", "#26c6da"];
const SHAPES = new Set(["sphere", "cylinder", "cone", "cube", "line", "emanation"]);
const CIRCLE_POINTS = 48;
const MAX_POINTS = 64;

const HEX = /^#[0-9a-f]{6}$/i;

/** One colour per caster, so a table can tell whose template is whose. */
export function colourFor(memberId) {
  let hash = 0;
  for (const ch of String(memberId || "")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length];
}

/** Grid cells a token spans, from its image size, image grid and scale. */
export function tokenCells(item) {
  const width = item?.image?.width;
  const dpi = item?.grid?.dpi;
  const scale = Math.abs(item?.scale?.x || 1);
  return width && dpi ? Math.max(0.5, (width / dpi) * scale) : 1;
}

/** Pixels per foot from the scene grid; Owlbear's default is 5 ft per 150 px square. */
export function pixelsPerFoot(dpi, scale) {
  const parsed = scale?.parsed;
  const feet = parsed && parsed.multiplier > 0 && /^(ft|feet|')?$/i.test(parsed.unit || "") ? parsed.multiplier : 5;
  return dpi / feet;
}

function circle(radius) {
  return Array.from({ length: CIRCLE_POINTS }, (_, i) => {
    const angle = (i / CIRCLE_POINTS) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

/**
 * Where a template goes. `caster` is the caster's token ({id, position, cells}); `aim` is a
 * point or null. Cones, lines and cubes start at the edge of the caster's space and point at
 * the aim, or north. Spheres and cylinders sit on the aim, or just north of the caster.
 * Emanations surround the caster's space and move with the token.
 */
export function placement(template, caster, aim, dpi, perFoot) {
  const half = (caster.cells * dpi) / 2;
  const size = template.size * perFoot;
  let dx = aim ? aim.x - caster.position.x : 0;
  let dy = aim ? aim.y - caster.position.y : -1;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const edge = { x: caster.position.x + dx * half, y: caster.position.y + dy * half };
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
  switch (template.shape) {
    case "cone":
      return { position: edge, rotation, points: [{ x: 0, y: 0 }, { x: size, y: -size / 2 }, { x: size, y: size / 2 }] };
    case "line":
    case "cube": {
      const width = template.shape === "cube" ? size : (template.width || 5) * perFoot;
      return {
        position: edge,
        rotation,
        points: [{ x: 0, y: -width / 2 }, { x: size, y: -width / 2 }, { x: size, y: width / 2 }, { x: 0, y: width / 2 }],
      };
    }
    case "emanation":
      return { position: { ...caster.position }, rotation: 0, points: circle(size + half), attachedTo: caster.id };
    default: {
      const centre = aim ? { ...aim } : { x: caster.position.x, y: caster.position.y - half - size };
      return { position: centre, rotation: 0, points: circle(size) };
    }
  }
}

const SHAPE_NAMES = { sphere: "sphere", cylinder: "cylinder", cone: "cone", cube: "cube", line: "line", emanation: "around caster" };

/** Everything a caster's extension needs to draw the template. Plain data, sent by broadcast. */
export function drawSpec(room, template, place) {
  return {
    room,
    id: template.id,
    name: `${template.spell} · ${template.size} ft ${SHAPE_NAMES[template.shape] || template.shape}`,
    colour: colourFor(template.member_id),
    // The spell's own colour fills the area; the outline stays the caster's.
    fill: HEX.test(template.colour || "") ? template.colour : colourFor(template.member_id),
    ...place,
  };
}

const finite = (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7;
const point = (p) => p && finite(p.x) && finite(p.y);

/** Check a spec from a broadcast before building anything from it. */
export function validSpec(spec) {
  return Boolean(
    spec &&
      typeof spec.room === "string" && spec.room.length <= 64 &&
      typeof spec.id === "string" && spec.id.length <= 64 &&
      typeof spec.name === "string" && spec.name.length <= 160 &&
      HEX.test(spec.colour) &&
      (spec.fill === undefined || HEX.test(spec.fill)) &&
      point(spec.position) && finite(spec.rotation) &&
      Array.isArray(spec.points) && spec.points.length >= 3 && spec.points.length <= MAX_POINTS && spec.points.every(point) &&
      (spec.attachedTo === undefined || (typeof spec.attachedTo === "string" && spec.attachedTo.length <= 64)),
  );
}

export function buildTemplate(spec) {
  let builder = buildCurve()
    .points(spec.points)
    .closed(true)
    .tension(0)
    .position(spec.position)
    .rotation(spec.rotation)
    .fillColor(spec.fill || spec.colour)
    .fillOpacity(0.25)
    .strokeColor(spec.colour)
    .strokeWidth(4)
    .name(spec.name)
    .layer("DRAWING")
    .locked(false)
    .metadata({ [TEMPLATE]: { room: spec.room, id: spec.id } });
  if (spec.attachedTo) builder = builder.attachedTo(spec.attachedTo);
  return builder.build();
}

export function isShape(shape) {
  return SHAPES.has(shape);
}
