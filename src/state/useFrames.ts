import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_PALETTE } from "../dither/palettes";
import { prepareSource, renderFrame, type Source } from "../dither/render";
import type { Settings } from "../dither/types";

/**
 * Baking the loop.
 *
 * Every frame is rendered once, up front, and kept as palette indices — around
 * 80KB a frame at the default resolution, so a 60-frame loop is under 5MB and
 * playback afterwards is a memcpy. The alternative, rendering on demand inside
 * the animation loop, means the preview runs at whatever the slowest algorithm
 * manages and the exported file has to be rendered a second time anyway.
 *
 * The baking is sliced across animation frames rather than run in one pass.
 * Sixty frames of Floyd-Steinberg at 320px is roughly a second of straight-line
 * work, and a second of blocked main thread while someone is dragging a slider
 * is the difference between an instrument and a form.
 *
 * A worker would be the textbook answer and is deliberately not used: the
 * renderer touches nothing but typed arrays, so slicing gets the same
 * responsiveness without the structured-clone round trip on every keystroke —
 * and the partially baked array stays paintable, which is what lets the stage
 * show the loop filling in instead of a spinner.
 */

export function useSource(
  image: CanvasImageSource | null,
  width: number,
  height: number,
  settings: Settings,
): Source | null {
  const { resolution, detail } = settings;
  return useMemo(() => {
    if (!image || !width || !height) return null;
    return prepareSource(image, width, height, { ...settings, resolution, detail });
    // Only the two controls that change the sampled image rebuild it. Tone and
    // motion are applied per frame, on top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, width, height, resolution, detail]);
}

export type Bake = {
  frames: Uint8Array[];
  /** 0..1. Below 1 the array is still filling, and every frame in it is real. */
  progress: number;
  /* The dimensions and tone count these particular frames were rendered at.
     They are carried with the frames rather than read from the live settings
     because the two disagree for a few milliseconds every time a control
     moves: the settings change instantly, the frames are rebaked over the next
     several animation frames, and anything painting from the new width with
     the old buffer walks off the end of the array — a half-drawn image, which
     is what "the screen breaks" looks like. Painting from these is always
     consistent, if briefly one step behind. */
  width: number;
  height: number;
  levels: number;
  colour: boolean;
};

const EMPTY: Bake = { frames: [], progress: 0, width: 0, height: 0, levels: 2, colour: false };

/** The settings that change the pixels. Palette is not among them — recolouring
    repaints from the same indices, which is why the swatches feel instant. */
function renderKey(s: Settings): string {
  return [
    s.resolution,
    s.exposure,
    s.contrast,
    s.midtone,
    s.detail,
    s.invert,
    s.algorithm,
    s.levels,
    s.spread,
    s.drift,
    s.driftAngle,
    s.wave,
    s.waveScale,
    s.ripple,
    s.rippleScale,
    s.swirl,
    s.pulse,
    s.scan,
    s.shimmer,
    s.cycles,
    s.motionScale,
    s.frames,
    // Colour changes what an index MEANS, so it belongs in the render key even
    // though the other palette choices deliberately do not.
    s.palette === SOURCE_PALETTE,
  ].join("|");
}

export function useFrames(source: Source | null, settings: Settings): Bake {
  const [bake, setBake] = useState<Bake>(EMPTY);
  const key = renderKey(settings);
  const latest = useRef(key);

  useEffect(() => {
    latest.current = key;
    if (!source) {
      setBake(EMPTY);
      return;
    }

    const colour = settings.palette === SOURCE_PALETTE;
    const levels = colour ? Math.min(6, settings.levels) : settings.levels;
    const shape = { width: source.width, height: source.height, levels, colour };
    const total = settings.frames;
    const frames: Uint8Array[] = [];
    let cancelled = false;
    let raf = 0;
    let i = 0;

    const tick = () => {
      if (cancelled) return;
      // 10ms of work per animation frame leaves the rest of the 16 for React
      // and the compositor, so the slider under the pointer keeps up.
      const until = performance.now() + 10;
      do {
        frames.push(renderFrame(source, settings, i, levels, undefined, colour));
        i++;
      } while (i < total && performance.now() < until);

      setBake({ frames: frames.slice(), progress: i / total, ...shape });
      if (i < total) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);

  return bake;
}
