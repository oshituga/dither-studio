import {
  bayer,
  blueNoise,
  clusterDot,
  hashNoise,
  ign,
  lineScreen,
  paintedMask,
  type Mask,
} from "./masks";
import type { RGB } from "./palettes";
import type { Settings } from "./types";

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
  /** A heavily blurred copy of the luminance, for bloom. Built only when it is
      asked for — it is a second full-size buffer and most looks never use it. */
  glow?: Float32Array;
  /** The same pixels as RGB, 0..1, interleaved. Kept alongside luminance
      rather than derived on demand: the colour path needs all three channels
      per pixel per frame, and the scope and every ramp palette need the single
      luminance figure, so both are paid for once here instead of per frame. */
  rgb: Float32Array;
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
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    // Rec. 709 on sRGB values. Linearising first is more correct and looks
    // worse here — it drags the midtones down until portraits go to mud at two
    // levels, which is the one case this tool has to be good at.
    const a = rgba[p + 3] / 255;
    const v = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
    // Transparent pixels read as white, so a cut-out subject dithers against
    // paper rather than against a black rectangle.
    lum[i] = v * a + (1 - a);
    // Transparency composites onto white here too, so a cut-out subject keeps
    // the same background in colour as it has in monochrome.
    rgb[i * 3] = (rgba[p] / 255) * a + (1 - a);
    rgb[i * 3 + 1] = (rgba[p + 1] / 255) * a + (1 - a);
    rgb[i * 3 + 2] = (rgba[p + 2] / 255) * a + (1 - a);
  }

  if (settings.detail > 0) {
    const amount = settings.detail / 100;
    unsharp(lum, w, h, amount);
    // Each channel separately. Sharpening luminance alone and reapplying it
    // would need a colour space this tool does not otherwise have, and at the
    // resolutions being dithered the difference is not visible.
    const plane = new Float32Array(w * h);
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < plane.length; i++) plane[i] = rgb[i * 3 + c];
      unsharp(plane, w, h, amount);
      for (let i = 0; i < plane.length; i++) rgb[i * 3 + c] = plane[i];
    }
  }

  let glow: Float32Array | undefined;
  if (settings.bloom > 0) {
    glow = lum.slice();
    // Wide and cheap: bloom is a halo, so the radius matters and the exact
    // falloff does not.
    for (let i = 0; i < 3; i++) boxBlur(glow, w, h, 3);
  }

  return { width: w, height: h, lum, rgb, glow };
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

/** A separable box blur, run a few times because three boxes approximate a
    gaussian closely enough for a glow and cost a fraction of one. */
function boxBlur(data: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(data.length);
  const span = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let d = -r; d <= r; d++) sum += data[y * w + Math.min(w - 1, Math.max(0, x + d))];
      tmp[y * w + x] = sum / span;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let d = -r; d <= r; d++) sum += tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x];
      data[y * w + x] = sum / span;
    }
  }
}

function maskFor(settings: Settings): Mask | null {
  switch (settings.algorithm) {
    case "custom":
      return paintedMask(settings.kernel);
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

/** The three-channel version of the sampler above. Written out rather than
    called three times: the weights are the expensive part and they are the
    same for all three channels. */
function sample3(
  rgb: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  out: [number, number, number],
) {
  const cx = Math.min(w - 1, Math.max(0, x));
  const cy = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const i00 = (y0 * w + x0) * 3;
  const i01 = (y0 * w + x1) * 3;
  const i10 = (y1 * w + x0) * 3;
  const i11 = (y1 * w + x1) * 3;
  for (let c = 0; c < 3; c++) {
    const a = rgb[i00 + c];
    const b = rgb[i01 + c];
    const d = rgb[i10 + c];
    const e = rgb[i11 + c];
    out[c] = a + (b - a) * fx + (d - a + (e - b - d + a) * fx) * fy;
  }
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
  /** Quantise the image's own red, green and blue instead of mapping its
      luminance onto a ramp. The index written is then a position in the
      levels^3 cube that buildSourcePalette lays out, not a tone. */
  colour = false,
): Uint8Array {
  const { width: w, height: h, lum } = src;
  const indices = out ?? new Uint8Array(w * h);
  const t = (frame % settings.frames) / settings.frames;
  const TAU = Math.PI * 2;
  const phase = TAU * settings.cycles * t;

  const mask = maskFor(settings);
  const diffusion = DIFFUSION[settings.algorithm];

  /* ---- motion terms, all resolved once per frame ---- */

  // One multiplier over every motion below. Drift is scaled before it is
  // rounded to whole tiles, so the loop stays seamless at any setting.
  const m = Math.max(0, settings.motionScale) / 100;

  // Mask travel. Expressed in whole tiles per loop so the offset returns to
  // zero exactly when the loop does — a fractional speed would land the last
  // frame on a different phase of the grid and the loop would tick.
  const rad = (settings.driftAngle * Math.PI) / 180;
  const tilesX = Math.round(settings.drift * m * Math.cos(rad));
  const tilesY = Math.round(settings.drift * m * Math.sin(rad));
  const maskSize = mask ? mask.size : 1;
  const offX = Math.round(t * tilesX * maskSize);
  const offY = Math.round(t * tilesY * maskSize);

  const waveAmp = ((settings.wave * m) / 100) * (w * 0.08);
  const waveLen = Math.max(4, settings.waveScale);
  const rippleAmp = ((settings.ripple * m) / 100) * (w * 0.06);
  const rippleLen = Math.max(4, settings.rippleScale);
  const swirlAmp = ((settings.swirl * m) / 100) * 0.9;
  const pulseAmp = ((settings.pulse * m) / 100) * 0.35;
  const scanAmp = ((settings.scan * m) / 100) * 0.55;
  const shimmerAmp = ((settings.shimmer * m) / 100) * 0.5;

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

  /** Where this pixel reads from, once every spatial motion has been applied.
      Shared by both paths so colour and monochrome cannot drift apart. */
  const warpAt = (x: number, y: number): [number, number] => {
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
      // Falls off from the centre, so the edges of the frame stay put and the
      // twist reads as depth rather than the whole image rotating.
      const a = swirlAmp * (1 - r / maxR) * Math.sin(phase);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      sx = cx + dx * c - dy * sn;
      sy = cy + dx * sn + dy * c;
    }
    return [sx, sy];
  };

  /** The threshold this pixel is compared against, drifted by the loop. */
  const thresholdAt = (x: number, y: number): number => {
    if (mask) {
      const mx = (((x + offX) % mask.size) + mask.size) % mask.size;
      const my = (((y + offY) % mask.size) + mask.size) % mask.size;
      return mask.data[my * mask.size + mx];
    }
    // "grain" — evaluated per pixel, and advanced by the frame so it moves
    // with the loop instead of sitting still on top of it.
    return ign(x + offX + frame * 13, y + offY + frame * 7);
  };

  // Error diffusion needs a mutable copy of the (already warped and toned)
  // image, because it writes the error back into pixels it has not reached yet.
  const work = diffusion ? new Float32Array(w * h) : null;

  const bloomAmt = (settings.bloom / 100) * 0.9;
  const vignetteAmt = settings.vignette / 100;
  const scanAmt = (settings.scanlines / 100) * 0.7;
  const chromaAmt = (settings.chromatic / 100) * (w * 0.02);

  const tone = (v: number, y: number, x = 0, i = -1): number => {
    let out = v;
    if (bloomAmt > 0 && src.glow && i >= 0) {
      // Screen rather than add: adding blows the highlights to a flat disc,
      // screening lifts them and leaves the shape in them.
      const g = src.glow[i] * bloomAmt;
      out = 1 - (1 - out) * (1 - g);
    }
    if (vignetteAmt > 0) {
      const dx = (x - cx) / (w * 0.5);
      const dy = (y - cy) / (h * 0.5);
      const r = Math.min(1, Math.hypot(dx, dy) / 1.414);
      out *= 1 - vignetteAmt * r * r;
    }
    if (scanAmt > 0 && y % 2 === 1) out *= 1 - scanAmt;
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

  /* ---- colour ----------------------------------------------------------
     The image's own colour, quantised per channel against the same threshold
     field the monochrome path uses. Three channels through one mask is what
     keeps it reading as one dithered image rather than three that happen to be
     stacked — a different mask per channel produces colour fringing on every
     edge.

     Error diffusion carries three errors instead of one; everything else is
     the monochrome path with the loop run three times. */
  if (colour) {
    const n = Math.min(6, Math.max(2, levels));
    const CL = n - 1;
    const cSpread = (settings.spread / 100) * (1 / Math.max(1, CL));
    const work3 = diffusion ? new Float32Array(w * h * 3) : null;
    const px: [number, number, number] = [0, 0, 0];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (chromaAmt > 0) {
          // Red pulled one way, blue the other, along the vector from centre —
          // which is where a lens would put it.
          const [wx, wy] = warping ? warpAt(x, y) : [x, y];
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.hypot(dx, dy) || 1;
          const ox = (dx / r) * chromaAmt;
          const oy = (dy / r) * chromaAmt;
          const a: [number, number, number] = [0, 0, 0];
          sample3(src.rgb, w, h, wx + ox, wy + oy, a);
          px[0] = a[0];
          sample3(src.rgb, w, h, wx, wy, a);
          px[1] = a[1];
          sample3(src.rgb, w, h, wx - ox, wy - oy, a);
          px[2] = a[2];
        } else if (warping) {
          const [sx, sy] = warpAt(x, y);
          sample3(src.rgb, w, h, sx, sy, px);
        } else {
          const i = (y * w + x) * 3;
          px[0] = src.rgb[i];
          px[1] = src.rgb[i + 1];
          px[2] = src.rgb[i + 2];
        }

        if (work3) {
          const i = (y * w + x) * 3;
          work3[i] = tone(px[0], y, x, y * w + x);
          work3[i + 1] = tone(px[1], y, x, y * w + x);
          work3[i + 2] = tone(px[2], y, x, y * w + x);
          continue;
        }

        let th = thresholdAt(x, y);
        if (shimmerAmp > 0) th += shimmerAmp * (hashNoise(x, y, frame) - 0.5);
        const bias = (th - 0.5) * cSpread * CL;
        let index = 0;
        for (let c = 0; c < 3; c++) {
          const q = Math.min(CL, Math.max(0, Math.round((tone(px[c], y, x, y * w + x) + bias) * CL)));
          index = index * n + q;
        }
        indices[y * w + x] = index;
      }
    }

    if (work3 && diffusion) {
      for (let y = 0; y < h; y++) {
        const leftToRight = y % 2 === 0;
        for (let i = 0; i < w; i++) {
          const x = leftToRight ? i : w - 1 - i;
          let index = 0;
          for (let c = 0; c < 3; c++) {
            let v = work3[(y * w + x) * 3 + c];
            if (shimmerAmp > 0) v += shimmerAmp * 0.35 * (hashNoise(x, y + c * 977, frame) - 0.5);
            const q = Math.min(CL, Math.max(0, Math.round(v * CL)));
            index = index * n + q;
            const err = (v - q / CL) * (settings.spread / 100);
            for (const [dx, dy, weight] of diffusion) {
              const nx = x + (leftToRight ? dx : -dx);
              const ny = y + dy;
              if (nx < 0 || nx >= w || ny >= h) continue;
              work3[(ny * w + nx) * 3 + c] += err * weight;
            }
          }
          indices[y * w + x] = index;
        }
      }
    }

    return indices;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v: number;
      if (warping) {
        const [sx, sy] = warpAt(x, y);
        v = sample(lum, w, h, sx, sy);
      } else {
        v = lum[y * w + x];
      }
      const toned = tone(v, y, x, y * w + x);
      if (work) work[y * w + x] = toned;
      else {
        let th = thresholdAt(x, y);
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
