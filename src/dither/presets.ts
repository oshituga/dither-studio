import { DEFAULTS, type Settings } from "./types";

/**
 * Looks, not knob positions.
 *
 * A preset here is a whole aesthetic — algorithm, palette, tone and motion
 * decided together — because those four are not independent: blue noise wants
 * shimmer and a halftone screen wants a slow breath, and picking them one
 * control at a time is how you end up with something that looks like a
 * settings panel rather than like a picture.
 *
 * They are rendered as live thumbnails of whatever image is loaded, so the row
 * is a contact sheet of the user's own photograph rather than ten stock
 * squares.
 */
export type Preset = { id: string; name: string; settings: Settings };

const make = (name: string, over: Partial<Settings>): Preset => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  settings: { ...DEFAULTS, ...over },
});

export const PRESETS: Preset[] = [
  make("Ink drift", {
    algorithm: "bayer4",
    palette: "ink",
    levels: 2,
    drift: 1,
    driftAngle: 135,
    contrast: 20,
    detail: 30,
  }),
  make("Newsprint", {
    algorithm: "cluster",
    palette: "paper",
    levels: 2,
    drift: 0,
    pulse: 34,
    contrast: 26,
    detail: 45,
    frames: 30,
    fps: 14,
  }),
  make("Blue hour", {
    algorithm: "blue",
    palette: "cyanotype",
    levels: 3,
    drift: 0,
    shimmer: 26,
    contrast: 14,
    detail: 22,
    frames: 20,
    fps: 16,
  }),
  make("CRT", {
    algorithm: "bayer8",
    palette: "phosphor",
    levels: 2,
    drift: 1,
    driftAngle: 90,
    scan: 62,
    shimmer: 14,
    contrast: 24,
    frames: 28,
    fps: 20,
  }),
  make("Amber", {
    algorithm: "lines",
    palette: "amber",
    levels: 2,
    drift: 2,
    driftAngle: 90,
    pulse: 40,
    contrast: 30,
    detail: 50,
    fps: 14,
  }),
  make("Riso", {
    algorithm: "bayer4",
    palette: "risograph",
    levels: 3,
    drift: 0,
    ripple: 32,
    rippleScale: 26,
    contrast: 22,
    detail: 35,
    frames: 30,
  }),
  make("Tide", {
    algorithm: "grain",
    palette: "mono",
    levels: 4,
    drift: 0,
    wave: 28,
    waveScale: 52,
    contrast: 12,
    frames: 32,
    fps: 16,
  }),
  make("Vapour", {
    algorithm: "bayer2",
    palette: "vapour",
    levels: 4,
    drift: 1,
    driftAngle: 45,
    swirl: 34,
    contrast: 16,
    frames: 36,
    fps: 18,
  }),
  make("Engraving", {
    algorithm: "lines",
    palette: "paper",
    levels: 2,
    drift: 2,
    driftAngle: 0,
    contrast: 34,
    detail: 70,
    resolution: 320,
  }),
  make("Game Boy", {
    algorithm: "bayer4",
    palette: "gameboy",
    levels: 4,
    drift: 1,
    driftAngle: 135,
    contrast: 28,
    detail: 40,
    resolution: 160,
  }),
  make("Fine ash", {
    algorithm: "floyd",
    palette: "mono",
    levels: 2,
    drift: 0,
    shimmer: 18,
    contrast: 16,
    detail: 20,
    frames: 16,
    fps: 12,
  }),
  make("Atkinson", {
    algorithm: "atkinson",
    palette: "paper",
    levels: 2,
    drift: 0,
    pulse: 24,
    contrast: 22,
    detail: 40,
    frames: 24,
  }),
];

/**
 * A random look that is still a look.
 *
 * Constrained rather than uniform: one motion at a time gets real amplitude,
 * palettes and algorithms are drawn from the same lists the pickers show, and
 * levels stay low. Fully random settings produce mush roughly nine times in
 * ten, and a shuffle button that mostly produces mush stops being pressed.
 */
export function shuffle(current: Settings): Settings {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const base = pick(PRESETS).settings;
  const motions = ["drift", "wave", "ripple", "swirl", "pulse", "scan", "shimmer"] as const;
  const lead = pick([...motions]);

  const zeroed: Partial<Settings> = {
    drift: 0,
    wave: 0,
    ripple: 0,
    swirl: 0,
    pulse: 0,
    scan: 0,
    shimmer: 0,
  };

  const amount =
    lead === "drift" ? pick([1, 1, 2, 3]) : Math.round(20 + Math.random() * 45);

  return {
    ...base,
    ...zeroed,
    [lead]: amount,
    driftAngle: pick([0, 45, 90, 135, 180, 225, 270, 315]),
    levels: pick([2, 2, 2, 3, 4]),
    cycles: pick([1, 1, 1, 2]),
    // Resolution and loop length are the user's framing decision, not the
    // shuffle's — changing them under a press would move the goalposts.
    resolution: current.resolution,
    frames: current.frames,
    fps: current.fps,
  };
}
