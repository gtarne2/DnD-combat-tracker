// Spell template looks: a texture image or a stepped fade under each template outline, plus an
// outline style per look. The outline curve is still the template: it is what players drag and
// rotate and what "who is inside" reads. The art is attached to it, cannot be clicked, and only
// carries ART metadata, so nothing else mistakes it for a template.
import { buildCurve, buildImage } from "./obr-sdk-3.1.0.js";

export const ART = "com.aurora-tracker/template-art";
const BASE = new URL(".", import.meta.url).href;
/** Texture sizes in pixels per outline; see tools/build-template-art.py. */
const TEXTURE = { disc: [384, 384], cone: [384, 384], rect: [384, 384], line: [1024, 128] };

/**
 * Looks by name. The sheet sends a look from the mechanics overlay or the spell's damage type.
 * `texture` names images in effects/; without one the template gets a stepped fade in its fill
 * colour. `dash` is the outline's dash pattern in scene pixels.
 */
export const LOOKS = {
  fire: { texture: true, width: 4, dash: [] },
  cold: { texture: true, width: 3, dash: [] },
  lightning: { texture: true, width: 3, dash: [18, 10] },
  acid: { texture: true, width: 3, dash: [10, 6] },
  poison: { texture: true, width: 3, dash: [6, 10] },
  necrotic: { texture: true, width: 4, dash: [24, 8, 4, 8] },
  radiant: { texture: true, width: 5, dash: [4, 8] },
  thunder: { texture: true, width: 4, dash: [30, 10] },
  force: { texture: true, width: 4, dash: [] },
  psychic: { texture: true, width: 5, dash: [2, 10] },
  mist: { texture: true, width: 3, dash: [12, 12] },
  darkness: { texture: true, width: 4, dash: [] },
  nature: { texture: true, width: 3, dash: [20, 6] },
  web: { texture: true, width: 3, dash: [3, 6] },
};
const FADE = { texture: false, width: 4, dash: [] };
/** Fill opacity of the outline itself, and of each fade step stacked inside it. */
const BASE_FILL = 0.15;
const FADE_STEPS = [0.75, 0.5, 0.25];
const FADE_FILL = 0.12;

export const LOOK_NAME = /^[a-z]{1,20}$/;

export function lookFor(name) {
  return (typeof name === "string" && Object.hasOwn(LOOKS, name) && LOOKS[name]) || FADE;
}

/** Which texture outline fits a template shape. */
export function maskFor(shape) {
  if (shape === "cone") return "cone";
  if (shape === "line") return "line";
  if (shape === "cube") return "rect";
  return "disc";
}

function bounds(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Points scaled toward the template's origin: discs and cones shrink evenly, lines and cubes
 *  shorten along their length only. */
export function stepPoints(points, mask, k) {
  return points.map((p) => (mask === "rect" || mask === "line" ? { x: p.x * k, y: p.y } : { x: p.x * k, y: p.y * k }));
}

/** The outline style for a look: [fill opacity, stroke width, dash]. */
export function outlineStyle(look) {
  const style = lookFor(look);
  // A textured template keeps a faint fill so the area still catches clicks and drags.
  return { fillOpacity: style.texture ? 0.04 : BASE_FILL, strokeWidth: style.width, dash: style.dash };
}

/**
 * Items drawn under the outline `curve` for a draw spec. `dpi` is the scene's grid DPI, which
 * sets an image's size at scale 1.
 */
export function artItems(spec, curve) {
  const look = lookFor(spec.look);
  const mask = maskFor(spec.shape);
  const meta = { [ART]: { room: spec.room, id: spec.id } };
  const dpi = spec.dpi || 150;
  const z = curve.zIndex;
  if (look.texture) {
    const box = bounds(spec.points);
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    if (!(width > 0 && height > 0)) return [];
    const [pxW, pxH] = TEXTURE[mask];
    // With the image's grid DPI at its width, it is one grid square wide at scale 1.
    const image = buildImage(
      { url: `${BASE}effects/${spec.look}-${mask}.png`, mime: "image/png", width: pxW, height: pxH },
      // The offset is the texture pixel that sits on the template's origin.
      { dpi: pxW, offset: { x: (-box.minX / width) * pxW, y: (-box.minY / height) * pxH } },
    )
      .name(`${spec.name} (look)`)
      .position(spec.position)
      .rotation(spec.rotation)
      .scale({ x: width / dpi, y: height / ((dpi * pxH) / pxW) })
      .layer("DRAWING")
      .zIndex(z - 1)
      .locked(true)
      .disableHit(true)
      .attachedTo(curve.id)
      .metadata(meta)
      .build();
    return [image];
  }
  return FADE_STEPS.map((k, i) =>
    buildCurve()
      .points(stepPoints(spec.points, mask, k))
      .closed(true)
      .tension(0)
      .position(spec.position)
      .rotation(spec.rotation)
      .fillColor(spec.fill || spec.colour)
      .fillOpacity(FADE_FILL)
      .strokeWidth(0)
      .strokeOpacity(0)
      .name(`${spec.name} (fade)`)
      .layer("DRAWING")
      .zIndex(z - 1 - i)
      .locked(true)
      .disableHit(true)
      .attachedTo(curve.id)
      .metadata(meta)
      .build(),
  );
}
