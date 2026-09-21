import { useEffect, useRef, useState } from "react";
import { buildPalette, PALETTES } from "../dither/palettes";
import { paint, prepareSource, renderFrame } from "../dither/render";
import { drawSamplePlate } from "../dither/sample";
import { DEFAULTS } from "../dither/types";

/**
 * The phone.
 *
 * This tool is a filmstrip, a stage and about thirty controls that have to be
 * visible at the same time, and every honest attempt to fold that into 390
 * points produces a worse tool wearing a responsive layout. So it says so, and
 * it says so while running — the loop above the copy is the real renderer on
 * the real sample plate, so the thing being described is on screen even on the
 * device that cannot edit it.
 */
export function MobileWall() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const plate = drawSamplePlate();
    const settings = {
      ...DEFAULTS,
      resolution: 132,
      algorithm: "bayer4" as const,
      levels: 2,
      contrast: 26,
      detail: 35,
      drift: 1,
      driftAngle: 135,
      frames: 20,
    };
    const source = prepareSource(plate, plate.width, plate.height, settings);
    const palette = buildPalette(PALETTES[1].ramp, 2);
    const frames = Array.from({ length: settings.frames }, (_, i) =>
      renderFrame(source, settings, i, 2),
    );

    c.width = source.width;
    c.height = source.height;
    const ctx = c.getContext("2d")!;

    let raf = 0;
    let last = 0;
    let i = 0;
    const step = 1000 / 12;
    const tick = (now: number) => {
      if (now - last >= step) {
        last = now;
        ctx.putImageData(paint(frames[i % frames.length], palette, source.width, source.height), 0, 0);
        i++;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-7 text-center">
      <canvas
        ref={canvas}
        className="w-[150px] max-w-[60vw]"
        style={{
          imageRendering: "pixelated",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.14), 0 30px 70px -30px rgba(0,0,0,0.9)",
        }}
      />

      <div className="flex flex-col items-center gap-3">
        <span className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.1em] text-text">
          <span className="h-[6px] w-[6px] bg-accent" />
          dither<span className="text-dim">.studio</span>
        </span>
        <h1 className="max-w-[24ch] text-[19px] font-medium leading-[1.25] tracking-[-0.02em] text-text">
          This one wants a bigger screen.
        </h1>
        <p className="max-w-[34ch] text-[13px] leading-[19px] tracking-[-0.01em] text-dim">
          It is a stage, a filmstrip and thirty controls that all have to be
          visible at once. Squeezing that onto a phone would make it a worse
          tool, so it waits for a laptop instead. The loop above is the real
          thing running — you are just not holding the right screen for it yet.
        </p>
      </div>

      <button type="button" className="btn btn--ghost" onClick={copy}>
        {copied ? "Link copied" : "Copy the link"}
      </button>
    </div>
  );
}
