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
        void: "#0A0A0B", // the stage and the page behind everything
        panel: "#101012", // chrome
        raised: "#17171A", // controls at rest
        "raised-hover": "#212126",
        line: "#26262B",
        text: "#F2F2F4",
        dim: "#8C8C96",
        // Signal orange. Reads as instrument rather than brand, and it is the
        // one hue that stays legible against every palette the tool can
        // produce — an accent that vanishes inside the artwork is not an
        // accent.
        accent: "#FF4A1C",
        "accent-hover": "#FF6338",
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
