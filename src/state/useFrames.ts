import { useEffect, useMemo, useRef, useState } from "react";
import type { BakeJob, BakeMessage } from "./bake.worker";
import type { Clip } from "../dither/clip";
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

/** The first frame, prepared. Used by the scope and the contact sheet, which
    describe the clip rather than play it — and which must not pay for a
    48-frame reduction to draw one histogram. */
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

/**
 * Which frame of the clip a given loop position shows.
 *
 * The clip's own length and the loop's length are separate on purpose: the
 * footage was sampled once, at load, and the Frames control has to stay free
 * afterwards. Ping-pong walks the clip forward and back, which turns any piece
 * of footage into something that loops — most clips do not end where they
 * started, and without it the join is a jump cut.
 */
export function clipIndex(frame: number, frames: number, count: number, pingpong: boolean): number {
  if (count <= 1) return 0;
  const t = frames <= 1 ? 0 : frame / frames;
  if (!pingpong) return Math.min(count - 1, Math.floor(t * count));
  // Triangle wave: out to the last frame by halfway, back by the end.
  const span = (count - 1) * 2;
  const pos = Math.round(t * span) % span;
  return pos < count ? pos : span - pos;
}

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
    s.bloom,
    s.vignette,
    s.scanlines,
    s.chromatic,
    s.algorithm,
    s.levels,
    s.spread,
    s.algorithm === "custom" ? s.kernel.join("") : "",
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
    s.pingpong,
    // Colour changes what an index MEANS, so it belongs in the render key even
    // though the other palette choices deliberately do not.
    s.palette === SOURCE_PALETTE,
  ].join("|");
}

/**
 * One worker for the life of the page.
 *
 * Created lazily, because a browser without module workers should still get
 * the sliced main-thread path rather than a blank stage. Re-used across bakes
 * rather than spawned per job: starting a worker costs more than most bakes
 * take, and a stale job is abandoned by id inside the worker anyway.
 */
let worker: Worker | null | undefined;
function bakeWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  return worker;
}

let nextJobId = 1;

export function useFrames(clip: Clip | null, settings: Settings): Bake {
  const [bake, setBake] = useState<Bake>(EMPTY);
  const key = renderKey(settings);
  const latest = useRef(key);

  useEffect(() => {
    latest.current = key;
    if (!clip || clip.images.length === 0) {
      setBake(EMPTY);
      return;
    }

    const colour = settings.palette === SOURCE_PALETTE;
    const levels = colour ? Math.min(6, settings.levels) : settings.levels;
    const w = Math.max(8, Math.round(settings.resolution));
    const h = Math.max(8, Math.round((w * clip.height) / clip.width));
    const shape = { width: w, height: h, levels, colour };
    const total = settings.frames;

    /* One prepared frame is kept at a time, not all of them.
       Reducing a frame to the working grid costs about a megabyte and a few
       milliseconds; holding 48 of those is most of a hundred megabytes for no
       gain, because loop positions walk through the clip in order and each
       prepared frame is wanted once. A single slot covers both that walk and a
       loop longer than the clip, where consecutive positions repeat a frame. */
    let cachedIndex = -1;
    let cached: Source | null = null;
    const sourceFor = (frame: number): Source => {
      const idx = clipIndex(frame, total, clip.images.length, settings.pingpong);
      if (idx !== cachedIndex || !cached) {
        cached = prepareSource(clip.images[idx], clip.width, clip.height, settings);
        cachedIndex = idx;
      }
      return cached;
    };

    const frames: Uint8Array[] = [];
    let cancelled = false;

    /* A still has one source for the whole loop, so the whole loop can be
       handed to the worker at once. A clip needs a different frame reduced per
       loop position, and that reduction needs a canvas the worker does not
       have — so footage stays on the sliced main-thread path. It is also the
       case that footage is usually being dithered at a smaller grid, which is
       what made this the right place to draw the line. */
    const hired = clip.images.length === 1 ? bakeWorker() : null;

    if (hired) {
      const source = sourceFor(0);
      const id = nextJobId++;

      const onMessage = (e: MessageEvent<BakeMessage>) => {
        const msg = e.data;
        if (cancelled || msg.id !== id) return;
        if (msg.type === "frame") {
          frames[msg.index] = msg.frame;
          setBake({ frames: frames.slice(), progress: (msg.index + 1) / msg.total, ...shape });
        }
      };

      hired.addEventListener("message", onMessage);

      const job: BakeJob = {
        id,
        // Copied, not transferred: the main thread still needs this grid for
        // the scope and the GPU preview.
        lum: source.lum,
        rgb: source.rgb,
        glow: source.glow ?? null,
        width: source.width,
        height: source.height,
        settings,
        levels,
        colour,
      };
      hired.postMessage(job);

      return () => {
        cancelled = true;
        hired.removeEventListener("message", onMessage);
      };
    }

    let raf = 0;
    let i = 0;

    const tick = () => {
      if (cancelled) return;
      // 10ms of work per animation frame leaves the rest of the 16 for React
      // and the compositor, so the slider under the pointer keeps up.
      const until = performance.now() + 10;
      do {
        frames.push(renderFrame(sourceFor(i), settings, i, levels, undefined, colour));
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
  }, [clip, key]);

  return bake;
}
