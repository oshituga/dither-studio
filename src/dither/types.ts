/** Every knob in the tool, in one object. Serialised to the URL, so the names
    are short-ish and the shape is flat — a nested tree would encode to
    something nobody can read in an address bar. */
export type Settings = {
  /* ---- source ---- */
  /** Working width in pixels. This IS the dither resolution: the grid the
      image is reduced to before a single threshold is compared. Everything
      downstream is nearest-neighbour, so this number is the aesthetic. */
  resolution: number;

  /* ---- tone ---- */
  exposure: number; // -100..100
  contrast: number; // -100..100
  midtone: number; // -100..100, gamma
  detail: number; // 0..100, unsharp mask radius-1
  invert: boolean;

  /* ---- dither ---- */
  algorithm: AlgorithmId;
  /** Tones in the output, 2..12. */
  levels: number;
  /** Threshold strength, 0..200%. 100 is the textbook value. */
  spread: number;

  /* ---- colour ---- */
  palette: string;
  paletteInvert: boolean;
  /** The stops of the user's own ramp, dark to light, as hex. Part of the
      settings rather than component state so a shared link carries the
      colours — a link to a look that arrives in the wrong colours is not a
      link to the look. */
  custom: string[];

  /* ---- motion, layered: every one of these is independent and 0 means off --- */
  drift: number; // mask travel, tiles per loop
  driftAngle: number; // degrees
  wave: number; // horizontal sine displacement
  waveScale: number;
  ripple: number; // radial displacement
  rippleScale: number;
  swirl: number; // rotation about centre
  pulse: number; // exposure breathing
  scan: number; // a bright band sweeping down
  shimmer: number; // per-frame threshold noise
  /** How many times each periodic motion repeats over one loop. Integer, so
      the loop is seamless by construction rather than by eye. */
  cycles: number;
  /** A multiplier over every motion above, 0..200%. It exists so one slider
      can drive a whole look: the motions in a preset are balanced against each
      other, and someone who just wants "more of that" should not have to
      rebalance seven numbers to get it. */
  motionScale: number;

  /* ---- loop ---- */
  frames: number;
  fps: number;
};

export type AlgorithmId =
  | "bayer2"
  | "bayer4"
  | "bayer8"
  | "cluster"
  | "lines"
  | "blue"
  | "grain"
  | "floyd"
  | "atkinson"
  | "sierra";

export const ALGORITHMS: { id: AlgorithmId; name: string; note: string }[] = [
  { id: "bayer4", name: "Bayer 4", note: "The crosshatch everyone knows" },
  { id: "bayer2", name: "Bayer 2", note: "Coarsest ordered grid" },
  { id: "bayer8", name: "Bayer 8", note: "Finest ordered grid" },
  { id: "blue", name: "Blue noise", note: "Structureless — shimmers, never crawls" },
  { id: "grain", name: "Grain", note: "Interleaved gradient noise" },
  { id: "cluster", name: "Halftone", note: "Rotated clustered dot, like print" },
  { id: "lines", name: "Line screen", note: "Tone as stripe weight" },
  { id: "floyd", name: "Floyd–Steinberg", note: "Error diffusion, classic" },
  { id: "atkinson", name: "Atkinson", note: "Early Mac, blown highlights" },
  { id: "sierra", name: "Sierra Lite", note: "Crisper diffusion" },
];

export const DEFAULTS: Settings = {
  resolution: 260,
  exposure: 0,
  contrast: 18,
  midtone: 0,
  detail: 25,
  invert: false,
  algorithm: "bayer4",
  levels: 2,
  spread: 100,
  palette: "mono",
  paletteInvert: false,
  custom: ["#1B2A1F", "#8FA37A", "#F2EDDF"],
  drift: 1,
  driftAngle: 135,
  wave: 0,
  waveScale: 40,
  ripple: 0,
  rippleScale: 30,
  swirl: 0,
  pulse: 0,
  scan: 0,
  shimmer: 0,
  cycles: 1,
  motionScale: 100,
  frames: 24,
  fps: 12,
};
