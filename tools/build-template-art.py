"""Builds the Owlbear spell template textures in owlbear/effects/.

    python tools/build-template-art.py

Each look (fire, cold, ...) gets three images, one per template outline:
  <look>-disc.png  spheres, cylinders and emanations; the origin is the centre
  <look>-cone.png  cones; the origin is the apex, at the middle of the left edge
  <look>-rect.png  cubes; the origin is the middle of the left edge
  <look>-line.png  lines, 8:1; the origin is the middle of the left edge. Owlbear stretches it
                   to the line's length, so a 60 by 5 ft line is only mildly stretched.

The art is procedural (numpy noise and simple drawing), so there is nothing to license.
The output is deterministic for a given seed. Needs numpy and Pillow.
"""
import math
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 384
# Pixel size of the image being built; build() sets these per outline.
W = H = SIZE
DIMENSIONS = {"disc": (SIZE, SIZE), "cone": (SIZE, SIZE), "rect": (SIZE, SIZE), "line": (1024, 128)}
OUT = pathlib.Path(__file__).resolve().parent.parent / "owlbear" / "effects"


def coords(mask):
    """Normalised coordinates with the template origin at 0,0. Discs span -1..1; cones and
    rectangles span 0..1 along x and -0.5..0.5 across."""
    tx = (np.arange(W) + 0.5) / W
    ty = ((np.arange(H) + 0.5) / H - 0.5) * H / W
    if mask == "disc":
        return np.meshgrid(tx * 2 - 1, ty * 2)
    return np.meshgrid(tx, ty)


def value_noise(rng, cells):
    grid = rng.random((cells + 1, cells + 1))
    side = max(W, H)
    img = Image.fromarray((grid * 255).astype(np.uint8)).resize((side, side), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32)[:H, :W] / 255


def fbm(seed, base=4, octaves=5):
    rng = np.random.default_rng(seed)
    total = np.zeros((H, W), np.float32)
    amp, norm = 1.0, 0.0
    for octave in range(octaves):
        total += value_noise(rng, base * 2**octave) * amp
        norm += amp
        amp *= 0.5
    return total / norm


def ramp(t, stops):
    """Colour ramp: stops are (position, (r, g, b))."""
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        sel = (t >= p0) & (t <= p1)
        k = ((t - p0) / max(p1 - p0, 1e-6))[sel][:, None]
        out[sel] = np.array(c0) * (1 - k) + np.array(c1) * k
    return out


def smoothstep(a, b, x):
    k = np.clip((x - a) / (b - a), 0, 1)
    return k * k * (3 - 2 * k)


def outline_mask(mask, x, y):
    """1 inside the template outline with a soft rim, 0 outside, and the distance from the
    origin as a 0..1 fraction of the template's reach."""
    edge = 2.5 / W
    if mask == "disc":
        r = np.hypot(x, y)
        return smoothstep(1.0, 1.0 - edge * 4, r), np.clip(r, 0, 1)
    if mask == "cone":
        # Triangle with its apex at the origin, as wide as it is long.
        inside = np.minimum(0.5 * x - np.abs(y), 1.0 - x)
        return smoothstep(-edge, edge * 3, inside), np.clip(np.hypot(x, y) / 1.0, 0, 1)
    half = H / W / 2
    inside = np.minimum(np.minimum(x, 1 - x), half - np.abs(y))
    return smoothstep(-edge, edge * 3, inside), np.clip(x, 0, 1)


def polar(mask, x, y):
    return np.hypot(x, y), np.arctan2(y, x)


# Each look returns (rgb 0..1, alpha 0..1 before the outline mask) from the coordinates.
def fire(mask, x, y, reach):
    n = fbm(11, 3)
    warp = fbm(12, 6)
    heat = np.clip(1.15 - reach * 0.9 + (n - 0.5) * 0.9 + (warp - 0.5) * 0.4, 0, 1)
    rgb = ramp(heat, [(0, (0.45, 0.05, 0.02)), (0.4, (0.85, 0.2, 0.03)), (0.7, (1.0, 0.55, 0.08)), (1, (1.0, 0.92, 0.55))])
    return rgb, 0.35 + heat * 0.45


def cold(mask, x, y, reach):
    rng = np.random.default_rng(21)
    pts = rng.random((70, 2)) * [x.max() - x.min(), y.max() - y.min()] + [x.min(), y.min()]
    d = np.sqrt((x[..., None] - pts[:, 0]) ** 2 + (y[..., None] - pts[:, 1]) ** 2)
    d.sort(axis=-1)
    crack = 1 - smoothstep(0.0, 0.018, d[..., 1] - d[..., 0])
    frost = fbm(22, 6)
    base = ramp(frost * 0.7 + (1 - reach) * 0.3, [(0, (0.35, 0.6, 0.85)), (0.6, (0.65, 0.85, 0.98)), (1, (0.9, 0.97, 1.0))])
    rgb = base * (1 - crack[..., None]) + np.array([0.97, 1.0, 1.0]) * crack[..., None]
    return rgb, 0.4 + frost * 0.2 + crack * 0.35


def lightning(mask, x, y, reach):
    img = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(img)
    rng = np.random.default_rng(31)
    origin = (W / 2, H / 2) if mask == "disc" else (0, H / 2)

    def bolt(start, angle, length, width, depth):
        px, py = start
        steps = 9
        for _ in range(steps):
            angle += rng.normal(0, 0.45)
            nx, ny = px + math.cos(angle) * length / steps, py + math.sin(angle) * length / steps
            draw.line([(px, py), (nx, ny)], fill=255, width=max(1, int(width)))
            if depth and rng.random() < 0.3:
                bolt((nx, ny), angle + rng.choice([-0.8, 0.8]), length * 0.5, width * 0.6, depth - 1)
            px, py = nx, ny

    if mask == "line":
        # Jagged bolts that run the whole length and stay inside the band.
        for _ in range(3):
            pts = [(0, H / 2)]
            for step in range(1, 41):
                pts.append((W * step / 40, H / 2 + rng.uniform(-0.36, 0.36) * H))
            draw.line(pts, fill=255, width=3)
        count = 0
    else:
        count = 9 if mask == "disc" else 5
    for i in range(count):
        if mask == "disc":
            angle = i / count * math.tau + rng.normal(0, 0.2)
        else:
            angle = rng.normal(0, {"cone": 0.18, "line": 0.02}.get(mask, 0.05))
        bolt(origin, angle, W * (0.55 if mask == "disc" else 1.05), 4, 2)
    core = np.asarray(img, np.float32) / 255
    glow = np.asarray(img.filter(ImageFilter.GaussianBlur(7)), np.float32) / 255
    haze = fbm(32, 3)
    light = np.clip(core + glow * 1.6, 0, 1)
    rgb = ramp(light, [(0, (0.12, 0.2, 0.55)), (0.5, (0.45, 0.6, 1.0)), (1, (0.95, 0.97, 1.0))])
    return rgb, 0.18 + haze * 0.12 + light * 0.65


def bubbles(seed, count, rmin, rmax):
    img = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(img)
    rng = np.random.default_rng(seed)
    for _ in range(int(count * W * H / SIZE**2)):
        cx, cy, r = rng.random() * W, rng.random() * H, rmin + rng.random() * (rmax - rmin)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=255, width=3)
    return np.asarray(img.filter(ImageFilter.GaussianBlur(1)), np.float32) / 255


def acid(mask, x, y, reach):
    n = fbm(41, 5)
    ring = bubbles(42, 60, 4, 16)
    rgb = ramp(n, [(0, (0.25, 0.45, 0.05)), (0.6, (0.5, 0.78, 0.12)), (1, (0.78, 0.95, 0.35))])
    rgb = rgb * (1 - ring[..., None]) + np.array([0.9, 1.0, 0.6]) * ring[..., None]
    return rgb, 0.42 + n * 0.2 + ring * 0.3


def poison(mask, x, y, reach):
    r, a = polar(mask, x, y)
    swirl = fbm(51, 3)
    bands = 0.5 + 0.5 * np.sin(a * 3 + r * 9 + swirl * 6)
    n = fbm(52, 5)
    t = bands * 0.5 + n * 0.5
    rgb = ramp(t, [(0, (0.2, 0.35, 0.12)), (0.6, (0.38, 0.62, 0.2)), (1, (0.7, 0.85, 0.35))])
    return rgb, 0.3 + t * 0.35


def necrotic(mask, x, y, reach):
    n = fbm(61, 4)
    ridge = 1 - np.abs(fbm(62, 4) - 0.5) * 2
    wisps = ridge**6
    rgb = ramp(n * 0.6 + wisps * 0.5, [(0, (0.06, 0.02, 0.1)), (0.5, (0.25, 0.1, 0.38)), (1, (0.6, 0.85, 0.55))])
    return rgb, 0.5 + n * 0.2 + wisps * 0.2


def radiant(mask, x, y, reach):
    r, a = polar(mask, x, y)
    rays = 0.5 + 0.5 * np.cos(a * (14 if mask == "disc" else 24))
    rays = rays**3
    n = fbm(71, 4)
    glow = np.clip(1.1 - reach, 0, 1)
    t = np.clip(glow * 0.7 + rays * 0.35 * (0.6 + n * 0.4), 0, 1)
    rgb = ramp(t, [(0, (0.85, 0.6, 0.1)), (0.6, (1.0, 0.82, 0.3)), (1, (1.0, 0.98, 0.85))])
    return rgb, 0.25 + t * 0.5


def thunder(mask, x, y, reach):
    r, a = polar(mask, x, y)
    n = fbm(81, 4)
    rings = (0.5 + 0.5 * np.cos(r * 38 + n * 3)) ** 4
    rgb = ramp(rings * 0.7 + n * 0.3, [(0, (0.04, 0.35, 0.42)), (0.6, (0.15, 0.68, 0.75)), (1, (0.8, 1.0, 1.0))])
    return rgb, 0.28 + rings * 0.45


def force(mask, x, y, reach):
    scale = 14
    qx = x * scale * 2 / math.sqrt(3)
    qy = y * scale - qx * 0.5
    # Distance to the nearest edge of a hexagonal lattice, via cube coordinates.
    cx, cz = qx, qy
    cy = -cx - cz
    rx, ry, rz = np.round(cx), np.round(cy), np.round(cz)
    dx, dy, dz = np.abs(rx - cx), np.abs(ry - cy), np.abs(rz - cz)
    edge = np.maximum(np.maximum(dx, dy), dz)
    lines = smoothstep(0.38, 0.5, edge)
    n = fbm(91, 4)
    rgb = ramp(n * 0.5 + lines * 0.6, [(0, (0.3, 0.2, 0.65)), (0.6, (0.55, 0.42, 0.95)), (1, (0.9, 0.85, 1.0))])
    return rgb, 0.3 + n * 0.15 + lines * 0.4


def psychic(mask, x, y, reach):
    r, a = polar(mask, x, y)
    n = fbm(101, 3)
    spiral = (0.5 + 0.5 * np.sin(a * 2 - r * 22 + n * 4)) ** 2
    rgb = ramp(spiral * 0.7 + n * 0.3, [(0, (0.45, 0.1, 0.4)), (0.6, (0.88, 0.3, 0.62)), (1, (1.0, 0.75, 0.9))])
    return rgb, 0.3 + spiral * 0.4


def mist(mask, x, y, reach):
    n = fbm(111, 3, 6)
    rgb = ramp(n, [(0, (0.6, 0.65, 0.7)), (1, (0.95, 0.97, 1.0))])
    return rgb, 0.45 + n * 0.35


def darkness(mask, x, y, reach):
    n = fbm(121, 3, 6)
    rgb = ramp(n, [(0, (0.0, 0.0, 0.02)), (1, (0.12, 0.1, 0.18))])
    return rgb, 0.72 + n * 0.2


def nature(mask, x, y, reach):
    ridge = (1 - np.abs(fbm(131, 5) - 0.5) * 2) ** 8
    ridge2 = (1 - np.abs(fbm(132, 7) - 0.5) * 2) ** 10
    vines = np.clip(ridge + ridge2 * 0.7, 0, 1)
    n = fbm(133, 6)
    rgb = ramp(n * 0.4 + vines * 0.6, [(0, (0.2, 0.15, 0.05)), (0.45, (0.2, 0.45, 0.12)), (1, (0.5, 0.8, 0.25))])
    return rgb, 0.25 + vines * 0.6 + n * 0.1


def web(mask, x, y, reach):
    img = Image.new("L", (W, H), 0)
    draw = ImageDraw.Draw(img)
    rng = np.random.default_rng(141)
    centre = np.array([W / 2, H / 2])
    spokes = 14
    angles = np.sort(rng.random(spokes) * math.tau)
    for ang in angles:
        draw.line([tuple(centre), tuple(centre + [math.cos(ang) * W, math.sin(ang) * W])], fill=255, width=2)
    for ring in range(1, 30):
        radius = ring * SIZE / 22 * (1 + rng.normal(0, 0.04))
        pts = [tuple(centre + [math.cos(ang) * radius, math.sin(ang) * radius]) for ang in angles]
        draw.line(pts + [pts[0]], fill=255, width=2)
    threads = np.asarray(img.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    rgb = np.ones(x.shape + (3,), np.float32) * np.array([0.93, 0.93, 0.9])
    return rgb, 0.12 + threads * 0.7


LOOKS = {
    "fire": fire, "cold": cold, "lightning": lightning, "acid": acid, "poison": poison,
    "necrotic": necrotic, "radiant": radiant, "thunder": thunder, "force": force,
    "psychic": psychic, "mist": mist, "darkness": darkness, "nature": nature, "web": web,
}


FADE_OUT = {"fire", "radiant", "thunder", "lightning", "psychic", "poison", "mist"}


def build(look, mask):
    global W, H
    W, H = DIMENSIONS[mask]
    x, y = coords(mask)
    inside, reach = outline_mask(mask, x, y)
    rgb, alpha = LOOKS[look](mask, x, y, reach)
    if look in FADE_OUT:
        # Strongest at the origin, fading toward the far edge.
        alpha = alpha * (1 - 0.45 * reach**1.5)
    # Never fully opaque, so the map stays readable under the template. Darkness is the
    # exception, since hiding the map is the point.
    cap = 0.85 if look == "darkness" else 0.68
    alpha = np.clip(alpha * (1.0 if look == "darkness" else 0.82), 0, cap) * inside
    rgba = np.dstack([np.clip(rgb, 0, 1), alpha])
    return Image.fromarray((rgba * 255).round().astype(np.uint8), "RGBA")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for look in LOOKS:
        for mask in DIMENSIONS:
            build(look, mask).save(OUT / f"{look}-{mask}.png", optimize=True)
    print(f"Wrote {len(LOOKS) * len(DIMENSIONS)} images to {OUT}")


if __name__ == "__main__":
    main()
