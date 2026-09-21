/**
 * Generates public/og.png — the card a link to this tool renders as.
 *
 * It is dithered by the same rules the tool applies, in Node, with no canvas:
 * the plate is evaluated analytically per pixel and thresholded against an 8x8
 * Bayer matrix. That is the point. A link preview for a dithering tool that was
 * exported from a design file would be a picture of the idea rather than the
 * thing, and it would go stale the first time the palette changed — this one is
 * regenerated with `npm run og`.
 *
 * Run it after changing the theme colours below, and commit the result.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../public/og.png");

const W = 1200;
const H = 630;
/** The art occupies the right of the card; the words sit left of this. */
const ART_X = 660;

const INK = [20, 12, 8]; // --c-void
const CREAM = [255, 246, 232]; // --c-text
const ACCENT = [255, 159, 28]; // --c-accent

/** Recursive Bayer, same construction as src/dither/masks.ts. */
function bayer(n) {
  let m = [[0, 2], [3, 1]];
  while (m.length < n) {
    const s = m.length;
    const next = Array.from({ length: s * 2 }, () => new Array(s * 2).fill(0));
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + s] = v + 2;
        next[y + s][x] = v + 3;
        next[y + s][x + s] = v + 1;
      }
    }
    m = next;
  }
  return m.map((row) => row.map((v) => v / (n * n)));
}

/**
 * The plate: a lit sphere above a horizon, evaluated rather than drawn.
 *
 * The same subject the tool opens on, for the same reason — it is a smooth
 * wide tonal ramp with one hard edge in it, which is exactly what shows what a
 * dither does.
 */
function luminance(x, y) {
  const w = W - ART_X;
  // Work in the art panel's own pixels. Doing the sphere in normalised
  // coordinates meant correcting for the panel's aspect twice, which is how it
  // ended up an ellipse clipped by the right edge.
  const ax = x - ART_X;
  const ay = y;
  const v = ay / H;

  const horizon = H * 0.74;

  // Sky: dark overhead, opening up towards the horizon.
  let l = 0.03 + Math.pow(v, 0.9) * 0.85;
  // Ground: a shallow ramp, never flat black, so it still carries dither.
  if (ay > horizon) l = 0.3 - (ay - horizon) / (H - horizon) * 0.18;

  const cx = w * 0.5;
  const cy = H * 0.44;
  const r = Math.min(w, H) * 0.3;
  const d = Math.hypot(ax - cx, ay - cy) / r;

  if (d <= 1) {
    const nx = (ax - cx) / r;
    const ny = (ay - cy) / r;
    const nz = Math.sqrt(Math.max(0, 1 - d * d));
    // Key from the upper left, normalised — an unnormalised direction was
    // what pushed the lit side past white and flattened the whole ball.
    const L = [-0.46, -0.58, 0.67];
    const key = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    // Bounce off the ground keeps the shadow side from going to paper black.
    const bounce = Math.max(0, -ny) * 0.1;
    l = 0.04 + Math.pow(key, 1.1) * 0.86 + bounce;
    // A small specular so the very top of the range is occupied.
    l += Math.pow(key, 40) * 0.5;
    // Darken the rim away from the light, which is what reads as roundness.
    l *= 0.82 + 0.18 * nz;
  } else {
    // Contact shadow, an ellipse under the sphere.
    const sd = Math.hypot((ax - cx) / (r * 1.25), (ay - (cy + r * 0.92)) / (r * 0.2));
    if (sd < 1) l *= 0.2 + 0.8 * sd * sd;
  }

  // A low glow behind, upper right, so the sky is not an empty ramp.
  const g = Math.max(0, 1 - Math.hypot((ax - w * 0.84) / (w * 0.6), (ay - H * 0.2) / (H * 0.5)));
  l += g * g * 0.3;

  return Math.min(1, Math.max(0, l));
}

async function main() {
  const mask = bayer(8);
  const raw = Buffer.alloc(W * H * 3);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 3;
      let colour;
      if (x < ART_X) {
        colour = INK;
      } else {
        // Contrast lifted the way the tool's default does, then thresholded.
        const l = Math.min(1, Math.max(0, (luminance(x, y) - 0.5) * 1.25 + 0.5));
        const t = mask[y % 8][x % 8];
        colour = l + (t - 0.5) > 0.5 ? CREAM : INK;
      }
      raw[p] = colour[0];
      raw[p + 1] = colour[1];
      raw[p + 2] = colour[2];
    }
  }

  // A hairline down the join, so the art reads as a plate rather than as the
  // right half of the canvas.
  for (let y = 0; y < H; y++) {
    const p = (y * W + ART_X) * 3;
    raw[p] = ACCENT[0];
    raw[p + 1] = ACCENT[1];
    raw[p + 2] = ACCENT[2];
  }

  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const text = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <g font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
      <rect x="74" y="150" width="9" height="9" fill="${hex(ACCENT)}"/>
      <text x="96" y="159" font-size="21" letter-spacing="2.4" fill="${hex(CREAM)}"
            font-family="Menlo, monospace">DITHER<tspan fill="${hex(CREAM)}" opacity="0.5">.STUDIO</tspan></text>
      <text x="74" y="266" font-size="56" font-weight="600" letter-spacing="-2" fill="${hex(CREAM)}">Turn an image into</text>
      <text x="74" y="330" font-size="56" font-weight="600" letter-spacing="-2" fill="${hex(ACCENT)}">a looping dither.</text>
      <text x="74" y="400" font-size="23" letter-spacing="-0.4" fill="${hex(CREAM)}" opacity="0.62">Ten kernels, motion that loops by construction,</text>
      <text x="74" y="434" font-size="23" letter-spacing="-0.4" fill="${hex(CREAM)}" opacity="0.62">GIF and MP4 out. Nothing is uploaded.</text>
      <text x="74" y="520" font-size="17" letter-spacing="1.6" font-family="Menlo, monospace"
            fill="${hex(ACCENT)}" opacity="0.8">BAYER 8 · 2 TONES · IN THE BROWSER</text>
    </g>
  </svg>`;

  await mkdir(dirname(OUT), { recursive: true });
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(text), top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(OUT, png);
  console.log(`og.png written — ${W}x${H}, ${(png.length / 1024).toFixed(0)}KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
