import { useEffect, useRef } from "react";
import { paint } from "../dither/render";
import type { RGB } from "../dither/palettes";

/**
 * The stage.
 *
 * A viewing surface, not a container: near-black, one soft light behind the
 * plate, registration marks at the corners and nothing else. The marks are the
 * one flourish and they earn it — they tell you exactly where the frame ends
 * when the image itself runs dark to its own edge, which at two tones it
 * constantly does.
 *
 * The canvas stays at working resolution and is stretched by the compositor
 * with `image-rendering: pixelated`. Drawing it large would mean either a
 * blurred dither or an upscale pass every frame; this way what is on screen is
 * bit-for-bit what the GIF encoder is handed.
 */
export function Stage({
  indices,
  blit,
  width,
  height,
  palette,
  progress,
  dragging,
  label,
  onPickFile,
}: {
  indices: Uint8Array | null;
  /** A canvas to show instead of the baked frame — the live GPU preview. When
      it is null the stage is showing the CPU's own frames, which are the ones
      that get exported. */
  blit: HTMLCanvasElement | null;
  width: number;
  height: number;
  palette: RGB[];
  progress: number;
  dragging: boolean;
  label: string;
  onPickFile: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageData | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !width || !height) return;
    if (blit) {
      if (c.width !== width || c.height !== height) {
        c.width = width;
        c.height = height;
      }
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(blit, 0, 0, width, height);
      return;
    }
    if (!indices) return;
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
      image.current = null;
    }
    // One ImageData for the life of the size. Allocating 300KB per displayed
    // frame is how a preview that should be free turns into garbage collection
    // in the middle of playback.
    if (!image.current || image.current.width !== width) {
      image.current = new ImageData(width, height);
    }
    paint(indices, palette, width, height, image.current);
    c.getContext("2d")!.putImageData(image.current, 0, 0);
  }, [indices, blit, width, height, palette]);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[3px] bg-void">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(100% 80% at 50% 42%, var(--stage-glow), var(--stage-fade) 70%)",
        }}
      />

      <div className="relative flex h-full w-full items-center justify-center p-7 pb-9 md:p-10 md:pb-12">
        {/* Height-first, with max-width as the escape hatch. The aspect ratio
            holds the other dimension, so a tall image fills the well
            vertically and a wide one fills it horizontally, and neither ever
            renders at the working resolution's own pixel size — which is
            260px and would leave the plate stranded in the middle of a large
            display. */}
        <div
          className="relative h-full w-auto max-w-full"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <canvas
            ref={canvas}
            className="block h-full w-full"
            style={{
              imageRendering: "pixelated",
              // A hard hairline, not a soft shadow. The plate is a print on a
              // table, not a card in a stack, and a blurred edge under a
              // hard-edged dither is the one thing that would make this look
              // like a web page again.
              boxShadow: "0 0 0 1px var(--plate-edge), 0 30px 70px -30px var(--plate-shadow)",
            }}
          />
          <Marks />
          <span className="value absolute -bottom-[20px] left-0 whitespace-nowrap text-dim">
            {label}
          </span>
        </div>
      </div>

      {/* Baking progress, as a hairline along the top. A spinner in the middle
          of the stage would cover the thing it is reporting on — and every
          frame already baked is on screen and correct. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left bg-accent transition-[transform,opacity] duration-150"
        style={{
          transform: `scaleX(${progress})`,
          opacity: progress >= 1 ? 0 : 1,
          transitionTimingFunction: "var(--ease)",
        }}
      />

      <button
        type="button"
        onClick={onPickFile}
        className={`absolute inset-2 flex items-center justify-center rounded-[3px] transition-opacity duration-150 ${
          dragging ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{
          background: "rgb(var(--c-void) / 0.86)",
          boxShadow: "inset 0 0 0 1px rgb(var(--c-accent))",
          transitionTimingFunction: "var(--ease)",
        }}
        tabIndex={dragging ? 0 : -1}
      >
        <span className="label text-accent">Drop to load</span>
      </button>
    </div>
  );
}

/** Corner registration marks. Four L-shaped ticks sitting just outside the
    plate — the frame edge stated, rather than implied by a shadow. */
function Marks() {
  const corners = [
    "left-[-9px] top-[-9px] border-l border-t",
    "right-[-9px] top-[-9px] border-r border-t",
    "left-[-9px] bottom-[-9px] border-b border-l",
    "right-[-9px] bottom-[-9px] border-b border-r",
  ];
  return (
    <>
      {corners.map((c) => (
        <span
          key={c}
          aria-hidden
          className={`pointer-events-none absolute h-[10px] w-[10px] border-text/25 ${c}`}
        />
      ))}
    </>
  );
}
