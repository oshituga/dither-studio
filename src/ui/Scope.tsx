import { useEffect, useRef } from "react";
import type { Source } from "../dither/render";
import type { Settings } from "../dither/types";

/**
 * A luminance scope, the way a grading application has one.
 *
 * It reads the image AFTER tone and BEFORE dithering, which is the only place
 * the number is worth anything: dithering has no opinion about a histogram, it
 * just quantises whatever it is handed, so everything that decides whether the
 * result holds together happens upstream of this line.
 *
 * The vertical marks are the quantisation levels. That is the part no photo
 * application shows you and the part that matters here — a histogram with all
 * its mass sitting between two marks is exactly the picture that is about to
 * come out flat, and you can see it before you have spent a second wondering
 * why.
 */
export function Scope({
  source,
  settings,
  levels,
}: {
  source: Source | null;
  settings: Settings;
  levels: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = 256;
    const H = 46;
    c.width = W * 2; // drawn at 2x and scaled down: the bars are one pixel wide
    c.height = H * 2;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, W, H);

    if (!source) return;

    const bins = new Float32Array(W);
    const contrast = 1 + settings.contrast / 100;
    const gamma = Math.pow(2, -settings.midtone / 100);
    const exposure = settings.exposure / 100;

    for (let i = 0; i < source.lum.length; i++) {
      let v = (source.lum[i] - 0.5) * contrast + 0.5 + exposure;
      v = Math.min(1, Math.max(0, v));
      if (gamma !== 1) v = Math.pow(v, gamma);
      if (settings.invert) v = 1 - v;
      bins[Math.min(W - 1, Math.round(v * (W - 1)))]++;
    }

    // Clipped at the 99th percentile rather than the maximum. One spike — a
    // blown sky, a black background — otherwise flattens the entire rest of
    // the curve into the baseline.
    const sorted = Array.from(bins).sort((a, b) => a - b);
    const top = sorted[Math.floor(sorted.length * 0.99)] || 1;

    ctx.fillStyle = "#4A3D2E";
    for (let x = 0; x < W; x++) {
      const h = Math.min(1, bins[x] / top) * H;
      ctx.fillRect(x, H - h, 1, h);
    }

    // Level marks.
    ctx.fillStyle = "#FF9F1C";
    for (let i = 0; i < levels; i++) {
      const x = Math.round((i / (levels - 1)) * (W - 1));
      ctx.fillRect(x, 0, 1, H);
    }
  }, [source, settings, levels]);

  return (
    <canvas
      ref={ref}
      className="block h-[46px] w-full rounded-[2px] bg-raised"
      aria-label="Luminance scope"
    />
  );
}
