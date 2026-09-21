import { useEffect, useRef, useState } from "react";
import { PRESETS, type Preset } from "../dither/presets";
import { buildPalette, PALETTES } from "../dither/palettes";
import { paint, renderFrame, type Source } from "../dither/render";

/**
 * The contact sheet.
 *
 * Every thumbnail is the user's own image, dithered by that preset — not a
 * stock square and not a swatch. Naming a look "Newsprint" tells you nothing
 * about what it will do to YOUR photograph, and the whole reason a preset row
 * exists is to let someone choose without reading.
 *
 * Hovering one plays it. A dither animation is motion, and a still frame of it
 * is the one thing that cannot communicate what it is — so the still is what
 * you get for free and the loop is what you get for looking.
 */

const THUMB_FRAMES = 10;

function PresetCard({
  preset,
  source,
  active,
  onApply,
}: {
  preset: Preset;
  source: Source | null;
  active: boolean;
  onApply: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const baked = useRef<Uint8Array[] | null>(null);
  const [hover, setHover] = useState(false);

  const palette = buildPalette(
    (PALETTES.find((p) => p.id === preset.settings.palette) ?? PALETTES[0]).ramp,
    preset.settings.levels,
    preset.settings.paletteInvert,
  );

  // Frame zero, on mount. Cheap enough at thumbnail size that the whole sheet
  // is up before the eye has finished travelling to it.
  useEffect(() => {
    if (!source || !canvas.current) return;
    const c = canvas.current;
    c.width = source.width;
    c.height = source.height;
    const settings = { ...preset.settings, frames: THUMB_FRAMES };
    const f0 = renderFrame(source, settings, 0, settings.levels);
    c.getContext("2d")!.putImageData(paint(f0, palette, source.width, source.height), 0, 0);
    baked.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, preset]);

  // The rest of the loop, on first hover only — twelve presets baking ten
  // frames each on load would be a second of work nobody asked for.
  useEffect(() => {
    if (!hover || !source || !canvas.current) return;
    const c = canvas.current;
    const ctx = c.getContext("2d")!;
    const settings = { ...preset.settings, frames: THUMB_FRAMES };

    if (!baked.current) {
      baked.current = Array.from({ length: THUMB_FRAMES }, (_, i) =>
        renderFrame(source, settings, i, settings.levels),
      );
    }

    let raf = 0;
    let last = 0;
    let i = 0;
    const step = 1000 / preset.settings.fps;
    const tick = (now: number) => {
      if (now - last >= step) {
        last = now;
        ctx.putImageData(
          paint(baked.current![i % THUMB_FRAMES], palette, source.width, source.height),
          0,
          0,
        );
        i++;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      // Park on frame zero so the sheet is a set of stills again, all in the
      // same phase — a grid left on random frames looks broken.
      if (baked.current) {
        ctx.putImageData(paint(baked.current[0], palette, source.width, source.height), 0, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, source, preset]);

  return (
    <button
      type="button"
      onClick={onApply}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className="group text-left"
    >
      <div
        className="overflow-hidden rounded-[2px] transition-shadow duration-150"
        style={{
          boxShadow: active ? "0 0 0 1px #FF9F1C" : "0 0 0 1px #2A1B0C",
          transitionTimingFunction: "var(--ease)",
        }}
      >
        <canvas
          ref={canvas}
          className="block aspect-[4/5] w-full object-cover transition-opacity duration-150"
          style={{ imageRendering: "pixelated", opacity: active || hover ? 1 : 0.62 }}
        />
      </div>
      <span
        className={`mt-1 block truncate font-mono text-[9px] uppercase tracking-[0.08em] ${
          active ? "text-accent" : "text-dim group-hover:text-text"
        }`}
      >
        {preset.name}
      </span>
    </button>
  );
}

export function Presets({
  source,
  activeId,
  onApply,
}: {
  source: Source | null;
  activeId: string | null;
  onApply: (p: Preset) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {PRESETS.map((p) => (
        <PresetCard
          key={p.id}
          preset={p}
          source={source}
          active={activeId === p.id}
          onApply={() => onApply(p)}
        />
      ))}
    </div>
  );
}
