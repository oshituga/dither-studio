import {
  buildPalette,
  CUSTOM_PALETTE,
  PALETTES,
  SOURCE_PALETTE,
} from "../dither/palettes";
import type { Settings } from "../dither/types";
import { CustomRamp } from "./CustomRamp";
import { Toggle } from "./primitives";

/**
 * Colour, shared by both panels.
 *
 * It is the one group that belongs in the simple view unchanged. Choosing
 * colours is not an expert operation — it is the part of this tool a person
 * with no interest in dithering came for — so nothing here is hidden behind
 * the full panel.
 */
export function ColourSection({
  settings,
  set,
  onPalette,
  onFromImage,
  canExtract,
}: {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  onPalette: (id: string) => void;
  onFromImage: () => void;
  canExtract: boolean;
}) {
  const colour = settings.palette === SOURCE_PALETTE;

  return (
    <>
      <button
        type="button"
        onClick={() => onPalette(SOURCE_PALETTE)}
        className={`flex items-center gap-2 rounded-[2px] p-2 text-left transition-colors duration-150 ${
          colour ? "bg-accent" : "bg-raised hover:bg-raised-hover"
        }`}
        style={{ transitionTimingFunction: "var(--ease)" }}
      >
        <span
          className="h-[14px] w-[14px] shrink-0 rounded-[1px]"
          style={{
            background:
              "conic-gradient(#ff0040, #ffd400, #22dd55, #00c8ff, #6a4bff, #ff0040)",
          }}
        />
        <span
          className={`text-[11px] font-medium tracking-[-0.01em] ${
            colour ? "text-panel" : "text-text"
          }`}
        >
          Keep the image's own colour
        </span>
      </button>

      <CustomRamp
        stops={settings.custom}
        levels={settings.levels}
        invert={settings.paletteInvert}
        active={settings.palette === CUSTOM_PALETTE}
        onChange={(custom) => set({ custom })}
        onActivate={() => onPalette(CUSTOM_PALETTE)}
        onFromImage={onFromImage}
        canExtract={canExtract}
      />

      <div className="grid grid-cols-2 gap-px">
        {PALETTES.map((p) => {
          const active = p.id === settings.palette;
          const swatch = buildPalette(
            p.ramp,
            Math.max(3, settings.levels),
            settings.paletteInvert,
          );
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPalette(p.id)}
              className={`flex items-center gap-2 rounded-[2px] p-1.5 text-left transition-colors duration-150 ${
                active ? "bg-accent" : "bg-raised hover:bg-raised-hover"
              }`}
              style={{ transitionTimingFunction: "var(--ease)" }}
            >
              <span className="flex h-[14px] w-[14px] shrink-0 overflow-hidden rounded-[1px]">
                {swatch.map((c, i) => (
                  <span
                    key={i}
                    className="h-full flex-1"
                    style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
                  />
                ))}
              </span>
              <span
                className={`truncate text-[11px] font-medium tracking-[-0.01em] ${
                  active ? "text-panel" : "text-dim"
                }`}
              >
                {p.name}
              </span>
            </button>
          );
        })}
      </div>

      {!colour && (
        <Toggle
          label="Flip light and dark"
          checked={settings.paletteInvert}
          onChange={(v) => set({ paletteInvert: v })}
        />
      )}
    </>
  );
}
