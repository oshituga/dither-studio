# dither.studio

Turn an image into a looping dither animation, in the browser. Upload a
picture, choose how it breaks into dots, choose how those dots move, export a
GIF, an MP4 or a sprite sheet.

Nothing is uploaded. The image is decoded, reduced and dithered in the tab it
was dropped into, and the only thing that ever leaves is the file you export.

## What it does

**Ten dither kernels.** Bayer 2/4/8, a rotated clustered-dot halftone, a line
screen, interleaved gradient noise, real void-and-cluster blue noise, and three
error-diffusion kernels (Floyd–Steinberg, Atkinson, Sierra Lite).

**Layered motion.** Drift, wave, ripple, swirl, breathe, scan and shimmer are
independent and additive — a drifting grid with a slow breath under it is two
sliders, not a mode you have to choose. Every one of them is periodic over an
integer number of cycles per loop, so the loop is seamless by construction
rather than by eye: frame N and frame 0 are the same evaluation, and there is
no accumulated drift to hide behind a cross-fade.

**Tone before threshold.** Exposure, contrast, midtones and an unsharp mask,
with a luminance scope that reads the image after tone and before dithering —
with the quantisation levels drawn on it, because a histogram sitting entirely
between two marks is the picture that is about to come out flat.

**Export.** GIF, MP4/WebM, a still, or every frame on one sheet, at 1–4×
nearest-neighbour scale.

## Notes on the build

**The GIF encoder is written from scratch** (`src/dither/gif.ts`). Every GIF
library on npm exists to solve a problem this tool does not have: quantising
true-colour frames down to 256 and dithering the result. That work is already
done here — the renderer hands back a palette index per pixel against a table of
at most twelve colours — so importing a quantiser would mean re-dithering the
output of a dithering tool, and the export would stop matching the preview.
What is left is the container and LZW, which is about two hundred lines.

**Frames are baked, not rendered live.** Every frame is computed once, up front,
and kept as palette indices — about 80KB a frame at the default resolution. The
baking is sliced across animation frames rather than run in one pass, so
dragging a slider never blocks the main thread, and the partially baked loop
stays on screen and correct while it fills.

**It is desktop only, on purpose.** A stage, a filmstrip and thirty controls
that all have to be visible at once does not fold into 390 points, and every
honest attempt produces a worse tool wearing a responsive layout. A phone gets a
wall with the loop running on it.

## Running it

```bash
npm install
npm run dev
```

Requires Node 20+. `npm run build` produces a static `dist/` that can be hosted
anywhere — there is no server side.

## Licence

MIT. See [LICENSE](LICENSE).
