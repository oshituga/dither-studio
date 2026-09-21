import { buildPalette, PALETTES } from "../dither/palettes";
import type { Source } from "../dither/render";
import { ALGORITHMS, type Settings } from "../dither/types";
import { Chips, Compass, Section, Slider, Toggle } from "./primitives";
import { Scope } from "./Scope";

/**
 * The rail.
 *
 * Ordered the way the decision is actually made, not the way the pipeline
 * runs: you pick a look, fix the exposure, then decide how it moves. Dither and
 * colour sit in the middle because they are the two people come back to; loop
 * length is last because it is set once and left.
 *
 * Every motion row is independent and additive. There is no "mode" here — a
 * drifting grid with a slow breath under it is two sliders, and forcing a
 * choice between them would remove the only thing that makes the output look
 * composed rather than generated.
 */
export function Rail({
  settings,
  set,
  source,
  sourceLabel,
}: {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  source: Source | null;
  sourceLabel: string;
}) {
  const motion = (
    label: string,
    key: keyof Settings,
    scaleKey?: keyof Settings,
    scaleLabel?: string,
  ) => {
    const value = settings[key] as number;
    return (
      <div key={String(key)}>
        <Slider
          label={label}
          value={value}
          min={0}
          max={100}
          active={value > 0}
          onChange={(v) => set({ [key]: v } as Partial<Settings>)}
        />
        {scaleKey && value > 0 && (
          <div className="mt-1 border-l border-line pl-3">
            <Slider
              label={scaleLabel ?? "Scale"}
              value={settings[scaleKey] as number}
              min={6}
              max={120}
              onChange={(v) => set({ [scaleKey]: v } as Partial<Settings>)}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Section title="Source" right={<span className="value text-dim">{sourceLabel}</span>}>
        <Slider
          label="Grid"
          value={settings.resolution}
          min={48}
          max={520}
          step={4}
          suffix="px"
          onChange={(v) => set({ resolution: v })}
        />
        <p className="text-[11px] leading-[15px] tracking-[-0.01em] text-dim">
          The width the image is reduced to before anything is dithered. This
          one control decides whether the result reads as a print or as a
          screen.
        </p>
      </Section>

      <Section title="Tone">
        <Scope source={source} settings={settings} levels={settings.levels} />
        <Slider
          label="Exposure"
          value={settings.exposure}
          min={-100}
          max={100}
          onChange={(v) => set({ exposure: v })}
        />
        <Slider
          label="Contrast"
          value={settings.contrast}
          min={-100}
          max={100}
          onChange={(v) => set({ contrast: v })}
        />
        <Slider
          label="Midtones"
          value={settings.midtone}
          min={-100}
          max={100}
          onChange={(v) => set({ midtone: v })}
        />
        <Slider
          label="Detail"
          value={settings.detail}
          min={0}
          max={100}
          onChange={(v) => set({ detail: v })}
        />
        <Toggle label="Invert" checked={settings.invert} onChange={(v) => set({ invert: v })} />
      </Section>

      <Section title="Dither">
        <Chips
          options={ALGORITHMS.map((a) => ({ value: a.id, label: a.name, note: a.note }))}
          value={settings.algorithm}
          onChange={(v) => set({ algorithm: v })}
        />
        <p className="text-[11px] leading-[15px] tracking-[-0.01em] text-dim">
          {ALGORITHMS.find((a) => a.id === settings.algorithm)?.note}
        </p>
        <Slider
          label="Tones"
          value={settings.levels}
          min={2}
          max={12}
          onChange={(v) => set({ levels: v })}
        />
        <Slider
          label="Threshold"
          value={settings.spread}
          min={0}
          max={200}
          suffix="%"
          onChange={(v) => set({ spread: v })}
        />
      </Section>

      <Section title="Colour">
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
                onClick={() => set({ palette: p.id })}
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
                    active ? "text-void" : "text-dim"
                  }`}
                >
                  {p.name}
                </span>
              </button>
            );
          })}
        </div>
        <Toggle
          label="Flip light and dark"
          checked={settings.paletteInvert}
          onChange={(v) => set({ paletteInvert: v })}
        />
      </Section>

      <Section title="Motion" right={<span className="value text-dim">{settings.cycles}× / loop</span>}>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="text-[12px] font-medium tracking-[-0.01em] text-text">Drift</span>
              {settings.drift > 0 && <span className="h-[4px] w-[4px] rounded-full bg-accent" />}
            </span>
            <span className="value text-dim">{settings.drift} tiles</span>
          </div>
          <div className="flex gap-2.5">
            <div className="w-[88px] shrink-0">
              <Compass
                angle={settings.driftAngle}
                amount={settings.drift}
                onAngle={(v) => set({ driftAngle: v })}
                onAmount={(v) => set({ drift: v })}
              />
            </div>
            <div className="flex flex-1 flex-col justify-center gap-2">
              <Slider
                label="Speed"
                value={settings.drift}
                min={0}
                max={6}
                onChange={(v) => set({ drift: v })}
              />
              <p className="text-[10px] leading-[13px] tracking-[-0.01em] text-dim">
                Whole tiles per loop, so the grid lands where it started.
              </p>
            </div>
          </div>
        </div>

        {motion("Wave", "wave", "waveScale", "Wavelength")}
        {motion("Ripple", "ripple", "rippleScale", "Wavelength")}
        {motion("Swirl", "swirl")}
        {motion("Breathe", "pulse")}
        {motion("Scan", "scan")}
        {motion("Shimmer", "shimmer")}

        <Slider
          label="Cycles"
          value={settings.cycles}
          min={1}
          max={6}
          onChange={(v) => set({ cycles: v })}
        />
      </Section>

      <Section
        title="Loop"
        right={<span className="value text-dim">{(settings.frames / settings.fps).toFixed(2)}s</span>}
      >
        <Slider
          label="Frames"
          value={settings.frames}
          min={2}
          max={72}
          onChange={(v) => set({ frames: v })}
        />
        <Slider
          label="Frame rate"
          value={settings.fps}
          min={2}
          max={30}
          suffix="fps"
          onChange={(v) => set({ fps: v })}
        />
      </Section>
    </>
  );
}
