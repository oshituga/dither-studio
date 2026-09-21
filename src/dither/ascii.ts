import type { RGB } from "./palettes";

/**
 * Glyphs instead of pixels.
 *
 * The dither is unchanged and still decides the tone of every cell; ASCII only
 * changes what gets drawn there. That is why this is a renderer rather than a
 * mode in the engine — the index buffer coming out of renderFrame already says
 * "this cell is at level 3 of 6", and a ramp of characters is just a different
 * way of saying the same thing to the eye.
 *
 * The output is thresholded back to the palette's two ends afterwards, so the
 * result still contains exactly two colours and the GIF still carries a
 * two-entry table. Text is drawn anti-aliased — there is no way to ask a
 * browser not to — and without that pass the grey fringes would quietly turn a
 * 400-byte frame into a 40KB one.
 */

export const CHARSETS: { id: string; name: string; chars: string }[] = [
  // Dark to light in every case, because the index is a tone.
  { id: "blocks", name: "Blocks", chars: " ░▒▓█" },
  { id: "classic", name: "Classic", chars: " .:-=+*#%@" },
  { id: "minimal", name: "Minimal", chars: " .oO@" },
  { id: "binary", name: "Binary", chars: " 01" },
  { id: "dots", name: "Dots", chars: " ⠁⠃⠇⠧⠷⠿" },
  { id: "lines", name: "Lines", chars: " ｜／－＼" },
  { id: "hash", name: "Hash", chars: " `'\"^*#%@" },
];

export function charsFor(id: string): string {
  return (CHARSETS.find((c) => c.id === id) ?? CHARSETS[0]).chars;
}

/** The glyph a level maps to, dark end first. */
function glyphFor(index: number, levels: number, chars: string): string {
  const t = levels <= 1 ? 0 : index / (levels - 1);
  return chars[Math.min(chars.length - 1, Math.round(t * (chars.length - 1)))];
}

export type AsciiOptions = {
  indices: Uint8Array;
  width: number;
  height: number;
  levels: number;
  chars: string;
  /** Pixels per character. */
  cell: number;
  palette: RGB[];
  /** Reuse a canvas across frames rather than allocating one per frame. */
  target?: HTMLCanvasElement;
};

export function renderAscii(opts: AsciiOptions): HTMLCanvasElement {
  const { indices, width, height, levels, chars, cell, palette } = opts;
  const canvas = opts.target ?? document.createElement("canvas");
  const W = width * cell;
  const H = height * cell;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const back = palette[0];
  const fore = palette[palette.length - 1];

  ctx.fillStyle = `rgb(${back[0]},${back[1]},${back[2]})`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `rgb(${fore[0]},${fore[1]},${fore[2]})`;
  // A cell is taller than it is wide in every monospace face, so the type is
  // set to the cell's width and the rows simply sit closer together. Sizing it
  // to the height instead makes the glyphs overlap their neighbours.
  ctx.font = `${Math.round(cell * 1.15)}px ui-monospace, "JetBrains Mono", Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = glyphFor(indices[y * width + x], levels, chars);
      if (ch === " ") continue;
      ctx.fillText(ch, x * cell + cell / 2, y * cell + cell / 2);
    }
  }

  // Back to two colours. Anti-aliasing put a few hundred greys around every
  // glyph; left in, they would be quantised again by the GIF encoder into a
  // table that no longer fits the look.
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const mid = (back[0] + back[1] + back[2] + fore[0] + fore[1] + fore[2]) / 6;
  const foreIsLighter = fore[0] + fore[1] + fore[2] > back[0] + back[1] + back[2];
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    const isFore = foreIsLighter ? l > mid : l < mid;
    const c = isFore ? fore : back;
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The same frame as text, for anyone who wants to paste it somewhere. */
export function asciiToText(
  indices: Uint8Array,
  width: number,
  height: number,
  levels: number,
  chars: string,
): string {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) row += glyphFor(indices[y * width + x], levels, chars);
    rows.push(row.replace(/\s+$/, ""));
  }
  return rows.join("\n");
}
