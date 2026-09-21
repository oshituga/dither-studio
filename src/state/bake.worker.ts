/// <reference lib="webworker" />
import { renderFrame, type Source } from "../dither/render";
import type { Settings } from "../dither/types";

/**
 * The bake, off the main thread.
 *
 * The main thread slices this work across animation frames so the interface
 * stays responsive, and that works — but slicing does not make the work
 * smaller, it spreads it. Error diffusion at a 500px grid is a second of
 * straight-line arithmetic per loop, and a second spread across sixty frames
 * is still a second before the filmstrip fills.
 *
 * Here it runs in parallel with the interface instead of taking turns with it,
 * so the slider stays at sixty while the loop bakes at whatever the machine
 * can do.
 *
 * What it deliberately does NOT do is prepare the source. That needs a canvas
 * to reduce the image, and moving it here would mean transferring bitmaps away
 * from the main thread, which still needs them for the scope, the contact sheet
 * and the GPU preview. The prepared grid is copied in once per bake instead —
 * a couple of megabytes against the many seconds of dithering it feeds.
 */

export type BakeJob = {
  id: number;
  lum: Float32Array;
  rgb: Float32Array;
  glow: Float32Array | null;
  width: number;
  height: number;
  settings: Settings;
  levels: number;
  colour: boolean;
};

export type BakeMessage =
  | { type: "frame"; id: number; index: number; total: number; frame: Uint8Array }
  | { type: "done"; id: number };

/** The job currently being worked on. A newer one arriving abandons it — the
    settings that produced it are already stale by then. */
let current = 0;

self.onmessage = (e: MessageEvent<BakeJob>) => {
  const job = e.data;
  current = job.id;

  const source: Source = {
    width: job.width,
    height: job.height,
    lum: job.lum,
    rgb: job.rgb,
    glow: job.glow ?? undefined,
  };

  const total = job.settings.frames;
  for (let i = 0; i < total; i++) {
    // Checked every frame rather than every batch: a 60-frame bake of a slow
    // kernel is seconds long, and there is no reason to finish one the user
    // has already moved past.
    if (current !== job.id) return;
    const frame = renderFrame(source, job.settings, i, job.levels, undefined, job.colour);
    const message: BakeMessage = { type: "frame", id: job.id, index: i, total, frame };
    // Transferred, not copied: the worker has no further use for the buffer.
    (self as unknown as Worker).postMessage(message, [frame.buffer]);
  }

  const done: BakeMessage = { type: "done", id: job.id };
  (self as unknown as Worker).postMessage(done);
};
