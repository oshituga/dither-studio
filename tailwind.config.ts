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
        /* Every colour is a CSS variable holding bare RGB channels, so the
           whole interface flips by rewriting nine custom properties on <html>
           rather than by carrying a second set of classes on every element.
           The channels are bare (not `rgb(...)`) so Tailwind's opacity
           modifiers — bg-accent/12 and friends — still work, which they cannot
           against a var holding a finished colour.

           Dark is the olive from shreygups.com/work/olive. Light is the same
           hues turned over: the ground becomes the paper that palette's cream
           implies, and the accent holds its place in both because amber is
           legible on warm dark AND warm light, which is most of why it was
           the right accent to take. */
        void: "rgb(var(--c-void) / <alpha-value>)",
        panel: "rgb(var(--c-panel) / <alpha-value>)",
        raised: "rgb(var(--c-raised) / <alpha-value>)",
        "raised-hover": "rgb(var(--c-raised-hover) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        text: "rgb(var(--c-text) / <alpha-value>)",
        dim: "rgb(var(--c-dim) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "accent-hover": "rgb(var(--c-accent-hover) / <alpha-value>)",
        warm: "rgb(var(--c-warm) / <alpha-value>)",
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
