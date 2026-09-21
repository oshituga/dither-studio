import { bayer, blueNoise, clusterDot, hashNoise, ign, lineScreen, type Mask } from "./masks";
import type { RGB } from "./palettes";
import type { AlgorithmId, Settings } from "./types";

/**
 * The renderer.
 *
 * One frame in, one array of palette indices out. Indices rather than pixels
 * because they are what BOTH consumers want: the canvas builds an ImageData
 * from them in a single pass, and the GIF encoder needs exactly this — an index
 * per pixel against a fixed table — so nothing has to quantise a second time
 * and the export is guaranteed identical to the preview, pixel for pixel.
 *
 * Every frame is computed from the loop position alone, never from the frame
 * before it. That is what makes the loop seamless: frame 0 and frame N are the
 * same evaluation, so there is no accumulated drift to hide with a cross-fade.
 */

export type Source = {
  width: number;
  height: number;
  /** Luminance, 0..1, at working resolution. */
  lum: Float32Array;
};

/**
 * Reduce the uploaded image to the working grid and pull out luminance.
 *
 * Done in two steps rather than one drawImage: browsers do a poor job of
 * downscaling by a large factor in one hop (it samples rather than averages,
 * which throws away exactly the detail a dither needs), so this halves
 * repeatedly until within 2x and lets the last hop do the rest.
 */
export function prepareSource(
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  settings: Settings,
): Source {
  const w = Math.max(8, Math.round(settings.resolution));
  const h = Math.max(8, Math.round((w * srcH) / srcW));

  let cw = srcW;
  let ch = srcH;
  let canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  let ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, cw, ch);

  while (cw / 2 > w) {
    const nw = Math.max(w, Math.floor(cw / 2));
    const nh = Math.max(h, Math.floor(ch / 2));
    const next = document.createElement("canvas");
    next.width = nw;
    next.height = nh;
    const nctx = next.getContext("2d")!;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(canvas, 0, 0, nw, nh);
    canvas = next;
    ctx = nctx;
    cw = nw;
    ch = nh;
  }

  const final = document.createElement("canvas");
  final.width = w;
  final.height = h;
  const fctx = final.getContext("2d", { willReadFrequently: true })!;
  fctx.imageSmoothingQuality = "high";
  fctx.drawImage(canvas, 0, 0, w, h);

  const rgba = fctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    // Rec. 709 on sRGB values. Linearising first is more correct and looks
    // worse here — it drags the midtones down until portraits go to mud at two
    // levels, which is the one case this tool has to be good at.
    const a = rgba[p + 3] / 255;
    const v = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
    // Transparent pixels read as white, so a cut-out subject dithers against
    // paper rather than against a black rectangle.
    lum[i] = v * a + (1 - a);
  }

  if (settings.detail > 0) unsharp(lum, w, h, settings.detail / 100);

  return { width: w, height: h, lum };
}

/**
 * Unsharp mask. Dithering destroys local contrast — it has one bit to say it
 * with — so lifting edges BEFORE the threshold is what keeps an eye or a
 * skyline legible at two levels. This is the single most valuable control in
 * the tool and the reason it defaults on.
 */
function unsharp(lum: Float32Array, w: number, h: number, amount: number) {
  const blur = new Float32Array(lum.length);
  // Separable 1-2-1, run twice: cheap, and a wider radius starts haloing.
  const tmp = new Float32Array(lum.length);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? lum : blur;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = src[y * w + Math.max(0, x - 1)];
        const c = src[y * w + x];
        const r = src[y * w + Math.min(w - 1, x + 1)];
        tmp[y * w + x] = (l + 2 * c + r) / 4;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = tmp[Math.max(0, y - 1) * w + x];
        const c = tmp[y * w + x];
        const d = tmp[Math.min(h - 1, y + 1) * w + x];
        blur[y * w + x] = (u + 2 * c + d) / 4;
      }
    }
  }
  for (let i = 0; i < lum.length; i++) {
    lum[i] = Math.min(1, Math.max(0, lum[i] + (lum[i] - blur[i]) * amount * 3));
  }
}

function maskFor(algorithm: AlgorithmId): Mask | null {
  switch (algorithm) {
    case "bayer2":
      return bayer(2);
    case "bayer4":
      return bayer(4);
    case "bayer8":
      return bayer(8);
    case "cluster":
      return clusterDot(8);
    case "lines":
      return lineScreen(8);
    case "blue":
      return blueNoise(64);
    default:
      return null;
  }
}

const DIFFUSION: Record<string, [number, number, number][]> = {
  // [dx, dy, weight/divisor]
  floyd: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
  sierra: [
    [1, 0, 2 / 4],
    [-1, 1, 1 / 4],
    [0, 1, 1 / 4],
  ],
};

/** Bilinear sample with edge clamp. Wrapping a photograph looks like a mistake;
    clamping looks like the frame is being pushed. */
function sample(lum: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(w - 1, Math.max(0, x));
  const cy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const a = lum[y0 * w + x0];
  const b = lum[y0 * w + x1];
  const c = lum[y1 * w + x0];
  const d = lum[y1 * w + x1];
  return a + (b - a) * fx + (c - a + (d - b - c + a) * fx) * fy;
}

/**
 * Render one frame of the loop.
 *
 * `frame` is an index; `settings.frames` is the length. t is frame/frames and
 * never reaches 1, which is the whole trick — every periodic term below is
 * evaluated at an integer number of cycles across [0,1), so the last frame
 * hands back to the first with nothing to smooth over.
 */
export function renderFrame(
  src: Source,
  settings: Settings,
  frame: number,
  levels: number,
  out?: Uint8Array,
): Uint8Array {
  const { width: w, height: h, lum } = src;
  const indices = out ?? new Uint8Array(w * h);
  const t = (frame % settings.frames) / settings.frames;
  const TAU = Math.PI * 2;
  const phase = TAU * settings.cycles * t;

  const mask = maskFor(settings.algorithm);
  const diffusion = DIFFUSION[settings.algorithm];

  /* ---- motion terms, all resolved once per frame ---- */

  // Mask travel. Expressed in whole tiles per loop so the offset returns to
  // zero exactly when the loop does — a fractional speed would land the last
  // frame on a different phase of the grid and the loop would tick.
  const rad = (settings.driftAngle * Math.PI) / 180;
  const tilesX = Math.round(settings.drift * Math.cos(rad));
  const tilesY = Math.round(settings.drift * Math.sin(rad));
  const maskSize = mask ? mask.size : 1;
  const offX = Math.round(t * tilesX * maskSize);
  const offY = Math.round(t * tilesY * maskSize);

  const waveAmp = (settings.wave / 100) * (w * 0.08);
  const waveLen = Math.max(4, settings.waveScale);
  const rippleAmp = (settings.ripple / 100) * (w * 0.06);
  const rippleLen = Math.max(4, settings.rippleScale);
  const swirlAmp = (settings.swirl / 100) * 0.9;
  const pulseAmp = (settings.pulse / 100) * 0.35;
  const scanAmp = (settings.scan / 100) * 0.55;
  const shimmerAmp = (settings.shimmer / 100) * 0.5;

  const warping = waveAmp > 0 || rippleAmp > 0 || swirlAmp > 0;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const maxR = Math.hypot(cx, cy) || 1;

  /* ---- tone ---- */
  const exposure = settings.exposure / 100 + pulseAmp * Math.sin(phase);
  const contrast = 1 + settings.contrast / 100;
  const gamma = Math.pow(2, -settings.midtone / 100);
  const L = levels - 1;
  const spread = (settings.spread / 100) * (1 / Math.max(1, L));

  // Error diffusion needs a mutable copy of the (already warped and toned)
  // image, because it writes the error back into pixels it has not reached yet.
  const work = diffusion ? new Float32Array(w * h) : null;

  const tone = (v: number, y: number): number => {
    let out = v;
    if (scanAmp > 0) {
      // A band sweeping down the frame, wrapping. The distance is measured on
      // a circle so the band crosses the bottom edge and reappears at the top
      // without a seam.
      const d = Math.abs(((y / h - t + 1.5) % 1) - 0.5);
      out += scanAmp * Math.exp(-(d * d) / 0.006);
    }
    out = (out - 0.5) * contrast + 0.5 + exposure;
    out = Math.min(1, Math.max(0, out));
    if (gamma !== 1) out = Math.pow(out, gamma);
    return settings.invert ? 1 - out : out;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number;
      if (warping) {
        let sx = x;
        let sy = y;
        if (waveAmp > 0) {
          sx += waveAmp * Math.sin(TAU * (y / waveLen) + phase);
          sy += waveAmp * 0.35 * Math.cos(TAU * (x / waveLen) + phase);
        }
        if (rippleAmp > 0) {
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.hypot(dx, dy) || 0.0001;
          const d = rippleAmp * Math.sin(TAU * (r / rippleLen) - phase);
          sx += (dx / r) * d;
          sy += (dy / r) * d;
        }
        if (swirlAmp > 0) {
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.hypot(dx, dy);
          // Falls off from the centre, so the edges of the frame stay put and
          // the twist reads as depth rather than as the whole image rotating.
          const a = swirlAmp * (1 - r / maxR) * Math.sin(phase);
          const c = Math.cos(a);
          const s = Math.sin(a);
          sx = cx + dx * c - dy * s;
          sy = cy + dx * s + dy * c;
        }
        v = sample(lum, w, h, sx, sy);
      } else {
        v = lum[y * w + x];
      }
      const toned = tone(v, y);
      if (work) work[y * w + x] = toned;
      else {
        let th: number;
        if (mask) {
          const mx = (((x + offX) % mask.size) + mask.size) % mask.size;
          const my = (((y + offY) % mask.size) + mask.size) % mask.size;
          th = mask.data[my * mask.size + mx];
        } else {
          // "grain" — evaluated per pixel, and advanced by the frame so it
          // moves with the loop instead of sitting still on top of it.
          th = ign(x + offX + frame * 13, y + offY + frame * 7);
        }
        if (shimmerAmp > 0) th += shimmerAmp * (hashNoise(x, y, frame) - 0.5);
        const q = Math.round((toned + (th - 0.5) * spread * L) * L);
        indices[y * w + x] = Math.min(L, Math.max(0, q));
      }
    }
  }

  if (work && diffusion) {
    const taps = diffusion;
    for (let y = 0; y < h; y++) {
      // Serpentine. Scanning every row left to right lets the error march in
      // one direction and leaves a visible diagonal grain; alternating cancels
      // it out.
      const leftToRight = y % 2 === 0;
      for (let i = 0; i < w; i++) {
        const x = leftToRight ? i : w - 1 - i;
        let v = work[y * w + x];
        if (shimmerAmp > 0) v += shimmerAmp * 0.35 * (hashNoise(x, y, frame) - 0.5);
        const q = Math.min(L, Math.max(0, Math.round(v * L)));
        indices[y * w + x] = q;
        const err = (v - q / L) * (settings.spread / 100);
        for (const [dx, dy, weight] of taps) {
          const nx = x + (leftToRight ? dx : -dx);
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          work[ny * w + nx] += err * weight;
        }
      }
    }
  }

  return indices;
}

/** Indices to pixels. Separate from the render so a palette change repaints
    without re-dithering — which is the difference between a colour picker that
    feels instant and one that stutters. */
export function paint(
  indices: Uint8Array,
  palette: RGB[],
  w: number,
  h: number,
  target?: ImageData,
): ImageData {
  const img = target ?? new ImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
    const c = palette[indices[i]] ?? palette[palette.length - 1];
    d[p] = c[0];
    d[p + 1] = c[1];
    d[p + 2] = c[2];
    d[p + 3] = 255;
  }
  return img;
}
