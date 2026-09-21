import type { Config } from "tailwindcss";

/**
 * An instrument, not a website.
 *
 * Tonal work is judged against a dark neutral — that is why every darkroom,
 * every grading suite and every serious image application is near-black. A
 * light interface puts the brightest thing on screen next to the image and
 * drags every judgement about exposure with it.
 *
 * So: a near-black that is very slightly warm (a true #000 panel next to a
 * dithered photograph reads as a hole), one signal colour for the thing that is
 * currently true, and nothing else. The artwork supplies the colour.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      colors: {
        /* Sampled from shreygups.com/work/olive, which sets them as CSS
           variables: --bg #140c08, --ink #fff6e8, --accent #ff9f1c,
           --link #ffc8a0. A warm brown-black rather than a neutral one, which
           is the whole difference — every dithered image on the stage picks up
           the cast of what surrounds it, and a warm ground makes a
           two-tone image read as a print rather than as a screenshot. */
        void: "#140C08", // the stage and the page behind everything
        panel: "#1A100A", // chrome, one step up from the stage
        raised: "#241709", // controls at rest
        "raised-hover": "#31200D",
        line: "#2A1B0C", // the site's --line is 5% accent over bg; this is a
        // touch stronger, because a control here has to
        // survive being next to a photograph.
        text: "#FFF6E8",
        /* Muted is the ink at 45% over the background rather than a grey:
           a neutral grey against this brown reads as dirty. */
        dim: "#7E756D",
        accent: "#FF9F1C",
        "accent-hover": "#FFB347",
        /* The site's --link. Used for figures, so numbers sit a half-step
           warmer than the labels beside them. */
        warm: "#FFC8A0",
      },
      fontFamily: {
        sans: ["'Inter Tight'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "Menlo", "monospace"],
      },
      borderRadius: {
        DEFAULT: "3px",
      },
    },
  },
  plugins: [],
};

export default config;
