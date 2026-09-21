import { buildPalette } from "../dither/palettes";

/**
 * The user's own ramp.
 *
 * Each stop is a native colour input wearing a swatch. That is deliberate and
 * it is the whole reason this is three controls rather than a colour-picker
 * component: the system picker has an eyedropper, recent colours, hex entry and
 * every OS affordance for free, it is the one everybody already knows, and it
 * updates live as the cursor moves inside it — so the dither on the stage
 * recolours under the pointer while a colour is being chosen.
 *
 * Stops are held dark to light. The tool samples a ramp at however many tones
 * are set, so two stops is a duotone gradient and five is a banded palette, and
 * nothing has to be told which is which.
 */
export function CustomRamp({
  stops,
  levels,
  invert,
  active,
  onChange,
  onActivate,
  onFromImage,
  canExtract,
}: {
  stops: string[];
  levels: number;
  invert: boolean;
  active: boolean;
  onChange: (stops: string[]) => void;
  onActivate: () => void;
  onFromImage: () => void;
  canExtract: boolean;
}) {
  const preview = buildPalette(stops, Math.max(3, levels), invert);

  const setStop = (i: number, value: string) => {
    const next = stops.slice();
    next[i] = value;
    onChange(next);
  };

  const add = () => {
    // The new stop lands between the last two rather than at an end, so adding
    // one never changes what the darkest and lightest colours are.
    const next = stops.slice();
    const a = next[next.length - 2] ?? next[0];
    const b = next[next.length - 1];
    next.splice(next.length - 1, 0, mix(a, b));
    onChange(next);
  };

  return (
    <div
      className={`rounded-[2px] p-2 transition-colors duration-150 ${
        active ? "bg-accent/12 shadow-[inset_0_0_0_1px_#FF9F1C]" : "bg-raised"
      }`}
      style={{ transitionTimingFunction: "var(--ease)" }}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onActivate}
          className={`text-[11px] font-medium tracking-[-0.01em] ${
            active ? "text-accent" : "text-text hover:text-accent"
          }`}
        >
          Your own colours
        </button>
        <span className="value text-dim">{stops.length} stops</span>
      </div>

      {/* The ramp as it will actually be sampled, so the stops above are read
          as the recipe and this is the result. */}
      <div className="mt-2 flex h-[10px] overflow-hidden rounded-[1px]">
        {preview.map((c, i) => (
          <span key={i} className="h-full flex-1" style={{ background: `rgb(${c.join(",")})` }} />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {stops.map((hex, i) => (
          <span key={i} className="group relative">
            <input
              type="color"
              value={hex}
              aria-label={`Colour stop ${i + 1}`}
              onChange={(e) => {
                setStop(i, e.target.value);
                if (!active) onActivate();
              }}
              className="h-[26px] w-[26px] cursor-pointer appearance-none rounded-[2px] border-0 bg-transparent p-0"
              style={{ boxShadow: "inset 0 0 0 1px rgba(255,246,232,0.18)" }}
            />
            {stops.length > 2 && (
              <button
                type="button"
                aria-label={`Remove stop ${i + 1}`}
                onClick={() => onChange(stops.filter((_, j) => j !== i))}
                className="absolute -right-1 -top-1 hidden h-[13px] w-[13px] items-center justify-center rounded-full bg-accent text-[9px] leading-none text-void group-hover:flex"
              >
                ×
              </button>
            )}
          </span>
        ))}

        {stops.length < 8 && (
          <button
            type="button"
            onClick={add}
            aria-label="Add a colour stop"
            className="h-[26px] w-[26px] rounded-[2px] text-[14px] leading-none text-dim transition-colors duration-150 hover:text-accent"
            style={{ boxShadow: "inset 0 0 0 1px #2A1B0C" }}
          >
            +
          </button>
        )}
      </div>

      <button
        type="button"
        disabled={!canExtract}
        onClick={onFromImage}
        className="mt-2 w-full rounded-[2px] py-[6px] font-mono text-[10px] uppercase tracking-[0.08em] text-dim transition-colors duration-150 hover:text-accent disabled:opacity-40"
        style={{ boxShadow: "inset 0 0 0 1px #2A1B0C" }}
      >
        Take the colours from the image
      </button>
    </div>
  );
}

/** Midpoint of two hex colours, for the stop that "+" inserts. */
function mix(a: string, b: string): string {
  const parse = (h: string) => {
    const n = parseInt(h.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const to = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return `#${to((r1 + r2) / 2)}${to((g1 + g2) / 2)}${to((b1 + b2) / 2)}`;
}
