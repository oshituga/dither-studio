import { memo, useEffect, useRef } from "react";
import { paint } from "../dither/render";
import type { RGB } from "../dither/palettes";

/**
 * Transport and filmstrip — one control surface, so they live in one file.
 *
 * The filmstrip is not decoration. A loop is judged on its join, and the only
 * way to judge a join is to put the last frame next to the first and look at
 * them — which a scrub bar cannot do and a strip of real frames does for free.
 * Every editing application that has ever been good at timing has had one.
 */

const Thumb = memo(function Thumb({
  indices,
  width,
  height,
  palette,
  active,
  onClick,
  index,
}: {
  indices: Uint8Array;
  width: number;
  height: number;
  palette: RGB[];
  active: boolean;
  onClick: () => void;
  index: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    c.getContext("2d")!.putImageData(paint(indices, palette, width, height), 0, 0);
  }, [indices, width, height, palette]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Frame ${index + 1}`}
      className="group relative shrink-0"
    >
      <canvas
        ref={ref}
        className="block h-[46px] w-auto rounded-[1px] transition-opacity duration-150"
        style={{
          imageRendering: "pixelated",
          opacity: active ? 1 : 0.42,
          boxShadow: active ? "0 0 0 1px rgb(var(--c-accent))" : "0 0 0 1px rgb(var(--c-line))",
          transitionTimingFunction: "var(--ease)",
        }}
      />
      <span
        className={`mt-1 block text-center font-mono text-[9px] tabular-nums tracking-[0.02em] ${
          active ? "text-accent" : "text-dim opacity-60 group-hover:opacity-100"
        }`}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
    </button>
  );
});

export function Filmstrip({
  frames,
  width,
  height,
  palette,
  current,
  onSeek,
}: {
  frames: Uint8Array[];
  width: number;
  height: number;
  palette: RGB[];
  current: number;
  onSeek: (i: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the playhead, but only once it has actually left the view.
  // Scrolling on every frame fights anyone who dragged the strip somewhere on
  // purpose.
  useEffect(() => {
    const el = scroller.current;
    const child = el?.children[current] as HTMLElement | undefined;
    if (!el || !child) return;
    const left = child.offsetLeft;
    const right = left + child.offsetWidth;
    if (left < el.scrollLeft || right > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: left - el.clientWidth / 2, behavior: "smooth" });
    }
  }, [current]);

  return (
    <div ref={scroller} className="panel-scroll flex shrink-0 items-start gap-1 overflow-x-auto">
      {frames.map((f, i) => (
        <Thumb
          key={i}
          index={i}
          indices={f}
          width={width}
          height={height}
          palette={palette}
          active={i === current}
          onClick={() => onSeek(i)}
        />
      ))}
    </div>
  );
}

export function Transport({
  playing,
  onPlay,
  frame,
  frames,
  fps,
  onSeek,
}: {
  playing: boolean;
  onPlay: (v: boolean) => void;
  frame: number;
  frames: number;
  fps: number;
  onSeek: (i: number) => void;
}) {
  const duration = frames / fps;
  // One tick per frame, drawn into the track. It is the cheapest possible way
  // to say how long the loop is in the unit the loop is actually edited in —
  // and it makes a 12-frame loop and a 60-frame loop look as different as they
  // are.
  const ticks = Math.min(frames, 120);

  return (
    <div className="flex shrink-0 items-center gap-3">
      <button
        type="button"
        onClick={() => onPlay(!playing)}
        aria-label={playing ? "Pause" : "Play"}
        className="btn btn--accent h-[30px] w-[34px] shrink-0 !p-0"
      >
        {playing ? (
          <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor">
            <rect x="0" y="0" width="3" height="10" />
            <rect x="6" y="0" width="3" height="10" />
          </svg>
        ) : (
          <svg width="9" height="10" viewBox="0 0 9 10" fill="currentColor">
            <path d="M0 0v10l9-5z" />
          </svg>
        )}
      </button>

      <div className="relative min-w-0 flex-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-[7px] -translate-y-1/2 opacity-45"
          style={{
            backgroundImage: "linear-gradient(90deg, rgb(var(--c-line)) 1px, transparent 1px)",
            backgroundSize: `${100 / ticks}% 100%`,
          }}
        />
        <input
          type="range"
          min={0}
          max={Math.max(0, frames - 1)}
          value={frame}
          onChange={(e) => {
            onPlay(false);
            onSeek(Number(e.target.value));
          }}
          aria-label="Scrub"
          className="relative"
          style={
            { "--fill": `${frames > 1 ? (frame / (frames - 1)) * 100 : 0}%` } as React.CSSProperties
          }
        />
      </div>

      <div className="flex shrink-0 items-baseline gap-2.5">
        <span className="value">
          <span className="text-accent">{String(frame + 1).padStart(2, "0")}</span>
          <span className="text-dim">/{String(frames).padStart(2, "0")}</span>
        </span>
        <span className="value text-dim">{duration.toFixed(2)}s</span>
      </div>
    </div>
  );
}
