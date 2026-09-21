/**
 * A palette is a ramp, not a fixed set of swatches.
 *
 * The number of tones on screen is the `levels` control, and it moves
 * independently of which palette is chosen — so a two-colour palette asked for
 * six levels has to produce six colours. Storing each palette as an ordered
 * ramp from dark to light and sampling it at `levels` points is what makes that
 * work: two stops give a duotone gradient, four give the banded look the
 * console palettes are known for, and nothing has to special-case the count.
 */

export type RGB = [number, number, number];

export type Palette = {
  id: string;
  name: string;
  /** Dark to light. Sampled, so two stops is a legitimate palette. */
  ramp: string[];
};

/** The id that means "do not replace the colours — quantise the ones already
    there". Handled by the renderer rather than by a ramp, so it is a constant
    here and not an entry in the list below. */
export const SOURCE_PALETTE = "source";

/** The largest number of steps per channel that still fits a GIF colour table:
    6^3 is 216, and 7^3 would be 343. Not a rendering limit — a format one. */
export const MAX_SOURCE_LEVELS = 6;

/**
 * Every colour a per-channel quantisation can produce, in the order the
 * renderer indexes them: red major, then green, then blue. The table is
 * levels^3 entries, which is why levels is capped at six here.
 */
export function buildSourcePalette(levels: number): RGB[] {
  const n = Math.min(MAX_SOURCE_LEVELS, Math.max(2, levels));
  const step = 255 / (n - 1);
  const out: RGB[] = [];
  for (let r = 0; r < n; r++) {
    for (let g = 0; g < n; g++) {
      for (let b = 0; b < n; b++) {
        out.push([Math.round(r * step), Math.round(g * step), Math.round(b * step)]);
      }
    }
  }
  return out;
}

/** The id for the ramp the user has built themselves. Its stops live in the
    settings, so a shared link carries the colours with it. */
export const CUSTOM_PALETTE = "custom";

/**
 * Pull a ramp out of the photograph itself, by median cut.
 *
 * Repeatedly split the box of colours along whichever channel is currently
 * widest, then average each bucket — which lands the stops where the image
 * actually has colour rather than on an even division of a space that is
 * mostly empty. Sorted dark to light at the end, because a ramp is an ordered
 * thing and the buckets come out in whatever order the splitting left them.
 *
 * Every fourth pixel is enough: this is choosing five or six colours, and the
 * answer does not move once a few thousand samples are in.
 */
export function extractRamp(rgb: Float32Array, count: number): string[] {
  const pixels: RGB[] = [];
  for (let i = 0; i < rgb.length; i += 12) {
    pixels.push([rgb[i] * 255, rgb[i + 1] * 255, rgb[i + 2] * 255]);
  }
  if (pixels.length === 0) return ["#000000", "#FFFFFF"];

  let boxes: RGB[][] = [pixels];
  while (boxes.length < count) {
    // Split the box with the widest spread; if none can be split, stop.
    let target = -1;
    let widest = -1;
    let axis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const px of box) {
          if (px[c] < lo) lo = px[c];
          if (px[c] > hi) hi = px[c];
        }
        if (hi - lo > widest) {
          widest = hi - lo;
          target = i;
          axis = c;
        }
      }
    });
    if (target < 0) break;
    const box = boxes[target].slice().sort((a, b) => a[axis] - b[axis]);
    const mid = box.length >> 1;
    boxes = boxes.filter((_, i) => i !== target).concat([box.slice(0, mid), box.slice(mid)]);
  }

  const stops = boxes.map((box) => {
    const sum = box.reduce((acc, px) => [acc[0] + px[0], acc[1] + px[1], acc[2] + px[2]], [0, 0, 0]);
    return [
      Math.round(sum[0] / box.length),
      Math.round(sum[1] / box.length),
      Math.round(sum[2] / box.length),
    ] as RGB;
  });

  const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  stops.sort((a, b) => lum(a) - lum(b));
  return stops.map(
    (c) => `#${c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`,
  );
}

export const PALETTES: Palette[] = [
  // The site's own two colours. The default, because this tool is his.
  { id: "ink", name: "Ink on cream", ramp: ["#26345B", "#FFFCF8"] },
  { id: "mono", name: "Mono", ramp: ["#000000", "#FFFFFF"] },
  { id: "paper", name: "Newsprint", ramp: ["#1A1A17", "#EDE8DD"] },
  { id: "gameboy", name: "Game Boy", ramp: ["#0F380F", "#306230", "#8BAC0F", "#9BBC0F"] },
  { id: "amber", name: "Amber CRT", ramp: ["#180C00", "#FFB000"] },
  { id: "phosphor", name: "Phosphor", ramp: ["#001B00", "#00FF41"] },
  { id: "cyanotype", name: "Cyanotype", ramp: ["#08234A", "#7FB2D9", "#F2F6F7"] },
  { id: "risograph", name: "Riso", ramp: ["#20124D", "#FF4F58", "#FFE8A3"] },
  { id: "sepia", name: "Sepia", ramp: ["#2B1B10", "#A8754A", "#F4E4CE"] },
  { id: "vapour", name: "Vapour", ramp: ["#2B0B3F", "#D6008C", "#00E5FF", "#FFF5FB"] },
];

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Sample a ramp at `levels` evenly spaced points, interpolating between stops.
 *
 * Returned dark-to-light. `invert` flips the mapping rather than the image, so
 * an inverted two-stop palette is cream-on-ink with the same tonal structure,
 * not a negative of the source with its shadows blown out.
 */
export function buildPalette(ramp: string[], levels: number, invert = false): RGB[] {
  const stops = ramp.map(hexToRgb);
  const out: RGB[] = [];

  for (let i = 0; i < levels; i++) {
    // levels === 1 would divide by zero, and a one-tone image is a solid
    // rectangle anyway — clamp to the dark end.
    const t = levels === 1 ? 0 : i / (levels - 1);
    const p = t * (stops.length - 1);
    const lo = Math.floor(p);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = p - lo;
    out.push([
      Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f),
      Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f),
      Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f),
    ]);
  }

  return invert ? out.reverse() : out;
}
