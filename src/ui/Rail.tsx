import { MAX_SOURCE_LEVELS, SOURCE_PALETTE } from "../dither/palettes";
import { useState } from "react";
import { ColourSection } from "./ColourSection";
import { KernelEditor } from "./KernelEditor";
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
  onPalette,
  onFromImage,
  source,
  theme,
  sourceLabel,
  clipFrames,
}: {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  onPalette: (id: string) => void;
  onFromImage: () => void;
  source: Source | null;
  theme: string;
  sourceLabel: string;
  /** Frames in the loaded clip. One means a photograph, and the controls that
      only mean something for footage stay out of the way. */
  clipFrames: number;
}) {
  const colour = settings.palette === SOURCE_PALETTE;
  // The brush is a tool, not a setting: it says nothing about the picture, so
  // it does not belong in the settings or in a shared link.
  const [brush, setBrush] = useState(0);
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
        <Scope source={source} settings={settings} levels={settings.levels} theme={theme} />
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
        {settings.algorithm === "custom" && (
          <KernelEditor
            kernel={settings.kernel}
            brush={brush}
            onBrush={setBrush}
            onChange={(kernel) => set({ kernel })}
          />
        )}
        <Slider
          label={colour ? "Steps per channel" : "Tones"}
          value={settings.levels}
          min={2}
          max={colour ? MAX_SOURCE_LEVELS : 12}
          onChange={(v) => set({ levels: v })}
        />
        {colour && (
          <p className="text-[11px] leading-[15px] tracking-[-0.01em] text-dim">
            {settings.levels ** 3} colours. Capped at six steps because a GIF
            colour table holds 256 and seven cubed is 343.
          </p>
        )}
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
        <ColourSection
          settings={settings}
          set={set}
          onPalette={onPalette}
          onFromImage={onFromImage}
          canExtract={Boolean(source)}
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
        <Slider
          label="All motion"
          value={settings.motionScale}
          min={0}
          max={200}
          suffix="%"
          active={settings.motionScale !== 100}
          onChange={(v) => set({ motionScale: v })}
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
        {clipFrames > 1 && (
          <>
            <Toggle
              label="Ping-pong"
              checked={settings.pingpong}
              onChange={(v) => set({ pingpong: v })}
            />
            <p className="text-[11px] leading-[15px] tracking-[-0.01em] text-dim">
              Plays the {clipFrames} frames out and back. Most footage does not
              end where it started, and without this the join is a jump cut.
            </p>
          </>
        )}
      </Section>
    </>
  );
}
