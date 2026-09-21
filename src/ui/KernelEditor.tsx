import { useRef } from "react";

/**
 * Paint the threshold matrix.
 *
 * This is the control that makes the whole engine legible. Everything else in
 * the Dither section is a named algorithm you either know or don't; here the
 * 8x8 tile that decides which pixels survive is on screen, editable, applying
 * live. Drag across it and you can watch a crosshatch become a halftone become
 * something nobody has a name for.
 *
 * Darker cells threshold lower, so they turn light sooner. That is the only
 * thing anyone needs to know to use it, and it is learnable in about four
 * seconds of dragging — which is why there is no legend.
 */
const SIZE = 8;
const MAX = 35;

export function KernelEditor({
  kernel,
  brush,
  onBrush,
  onChange,
}: {
  kernel: number[];
  brush: number;
  onBrush: (v: number) => void;
  onChange: (kernel: number[]) => void;
}) {
  // Painting continues while the pointer is down, including outside the grid,
  // so a drag that leaves and re-enters does not break into two strokes.
  const painting = useRef(false);

  const paint = (i: number) => {
    if (kernel[i] === brush) return;
    const next = kernel.slice();
    next[i] = brush;
    onChange(next);
  };

  const fill = (fn: (x: number, y: number) => number) => {
    const next: number[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) next.push(Math.round(fn(x, y)));
    }
    onChange(next);
  };

  const presets: { name: string; fn: () => void }[] = [
    {
      name: "Bayer",
      fn: () => {
        // The recurrence, rather than 64 numbers typed out.
        let m = [[0, 2], [3, 1]];
        while (m.length < SIZE) {
          const s = m.length;
          const next = Array.from({ length: s * 2 }, () => new Array(s * 2).fill(0));
          for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
              const v = m[y][x] * 4;
              next[y][x] = v;
              next[y][x + s] = v + 2;
              next[y + s][x] = v + 3;
              next[y + s][x + s] = v + 1;
            }
          }
          m = next;
        }
        fill((x, y) => (m[y][x] / (SIZE * SIZE)) * MAX);
      },
    },
    {
      name: "Dots",
      fn: () => {
        const c = (SIZE - 1) / 2;
        fill((x, y) => {
          const dx = x - c;
          const dy = y - c;
          const rx = (dx + dy) * Math.SQRT1_2;
          const ry = (dy - dx) * Math.SQRT1_2;
          return Math.min(MAX, (Math.hypot(rx, ry) / (c * 1.15)) * MAX);
        });
      },
    },
    { name: "Lines", fn: () => fill((x, y) => (((x + y) % SIZE) / SIZE) * MAX) },
    { name: "Noise", fn: () => fill(() => Math.random() * MAX) },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div
        className="grid select-none gap-px rounded-[2px] bg-line p-px"
        style={{ gridTemplateColumns: `repeat(${SIZE}, 1fr)` }}
        onPointerDown={() => (painting.current = true)}
        onPointerUp={() => (painting.current = false)}
        onPointerLeave={() => (painting.current = false)}
      >
        {kernel.map((v, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Cell ${i + 1}, threshold ${v}`}
            className="aspect-square w-full"
            style={{
              // The cell's own threshold as a grey. A number in each square
              // would be unreadable at this size and would turn a picture of
              // the matrix into a table of it.
              background: `rgb(var(--c-text) / ${(v / MAX) * 0.92 + 0.04})`,
            }}
            onPointerDown={() => {
              painting.current = true;
              paint(i);
            }}
            onPointerEnter={() => painting.current && paint(i)}
          />
        ))}
      </div>

      <label className="block">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium tracking-[-0.01em] text-text">Brush</span>
          <span className="value text-dim">{Math.round((brush / MAX) * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={MAX}
          value={brush}
          onChange={(e) => onBrush(Number(e.target.value))}
          style={{ "--fill": `${(brush / MAX) * 100}%` } as React.CSSProperties}
        />
      </label>

      <div className="grid grid-cols-4 gap-px">
        {presets.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={p.fn}
            className="rounded-[2px] bg-raised py-[6px] font-mono text-[10px] uppercase tracking-[0.06em] text-dim transition-colors duration-150 hover:bg-raised-hover hover:text-text"
            style={{ transitionTimingFunction: "var(--ease)" }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-[15px] tracking-[-0.01em] text-dim">
        Darker cells turn light sooner. Drag across the grid — the image follows
        as you paint, and the matrix travels with a shared link.
      </p>
    </div>
  );
}
