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

export type Palette = {
  id: string;
  name: string;
  /** Dark to light. Sampled, so two stops is a legitimate palette. */
  ramp: string[];
};

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

export type RGB = [number, number, number];

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
