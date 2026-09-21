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
  /** The painted threshold matrix, 64 values of 0..35, used when the algorithm
      is "custom". Part of the settings so a link carries the kernel: a look
      built on a matrix somebody drew is not reproducible without it. */
  kernel: number[];

  /* ---- effects, all applied BEFORE the threshold ----
     That placement is the whole design. An effect applied after dithering
     introduces colours the palette does not contain, which costs the GIF its
     tiny colour table and costs the output its discipline. Applied before, the
     result is still exactly N tones — the effect changes which pixels survive,
     not what they are made of. */
  bloom: number;
  vignette: number;
  scanlines: number;
  chromatic: number;

  /* ---- ascii ---- */
  /** Draw glyphs instead of pixels. The dither still decides the tone of each
      cell; this decides what gets drawn there. */
  ascii: boolean;
  asciiSet: string;
  /** Pixels per character. Also the thing that decides whether it reads as a
      terminal or as a texture. */
  asciiCell: number;

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
  /** Play the clip out and back, so footage that does not end where it began
      still loops. Meaningless for a still, and hidden for one. */
  pingpong: boolean;
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
  | "sierra"
  | "custom";

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
  { id: "custom", name: "Draw your own", note: "Paint the threshold matrix yourself" },
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
  // Bayer 8 as the starting point, so the editor opens on something that works
  // and is recognisable rather than on an empty grid.
  kernel: [
    0, 18, 5, 23, 1, 19, 6, 24, 27, 9, 32, 14, 28, 10, 33, 15, 7, 25, 2, 20, 8,
    26, 3, 21, 34, 16, 29, 11, 35, 17, 30, 12, 1, 20, 6, 24, 0, 18, 5, 23, 29,
    11, 33, 15, 27, 9, 32, 14, 8, 26, 3, 21, 7, 25, 2, 20, 35, 17, 30, 12, 34,
    16, 29, 11,
  ],
  bloom: 0,
  vignette: 0,
  scanlines: 0,
  chromatic: 0,
  ascii: false,
  asciiSet: "blocks",
  asciiCell: 10,
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
  pingpong: false,
  fps: 12,
};
