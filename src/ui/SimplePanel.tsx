import type { Settings } from "../dither/types";
import { ColourSection } from "./ColourSection";
import { Section, Slider } from "./primitives";

/**
 * The simple panel.
 *
 * Six controls, and not one of them names a technique. Somebody who has never
 * heard the word "dither" arrived here because they saw a picture they liked,
 * and the fastest route from that to their own picture is: pick a look, decide
 * how chunky, fix the brightness, choose the colours, decide how much it moves.
 * Everything else in this tool is a way of adjusting those five decisions more
 * precisely.
 *
 * It is not a different tool, and it is not a subset that loses work. It writes
 * the same settings the full panel does, so switching across mid-edit shows the
 * same image with more dials around it — which is what makes it safe to start
 * here.
 */
export function SimplePanel({
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
  /* Pixel size, not grid width. They are the same number read from opposite
     ends — a bigger grid means smaller pixels — and "how big are the dots" is
     the question people actually have. Inverting it here rather than in the
     settings keeps one meaning in the engine and one in the interface. */
  const MIN = 48;
  const MAX = 520;
  const pixel = MIN + MAX - settings.resolution;

  return (
    <>
      <Section title="Size" collapsible={false}>
        <Slider
          label="Pixel size"
          value={pixel}
          min={MIN}
          max={MAX}
          step={4}
          onChange={(v) => set({ resolution: MIN + MAX - v })}
        />
        <p className="text-[11px] leading-[15px] tracking-[-0.01em] text-dim">
          Bigger pixels look more like a print. Smaller ones keep more of the
          photograph.
        </p>
      </Section>

      <Section title="Light" collapsible={false}>
        <Slider
          label="Brightness"
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
      </Section>

      <Section title="Colour" collapsible={false}>
        <ColourSection
          settings={settings}
          set={set}
          onPalette={onPalette}
          onFromImage={onFromImage}
          canExtract={canExtract}
        />
      </Section>

      <Section
        title="Movement"
        collapsible={false}
        right={<span className="value text-dim">{(settings.frames / settings.fps).toFixed(1)}s</span>}
      >
        <Slider
          label="How much it moves"
          value={settings.motionScale}
          min={0}
          max={200}
          suffix="%"
          active={settings.motionScale > 0}
          onChange={(v) => set({ motionScale: v })}
        />
        <Slider
          label="Speed"
          value={settings.fps}
          min={2}
          max={30}
          suffix="fps"
          onChange={(v) => set({ fps: v })}
        />
        <p className="text-[11px] leading-[15px] tracking-[-0.01em] text-dim">
          Each look moves in its own way. This is how much of it you get — the
          full panel has the seven motions separately.
        </p>
      </Section>
    </>
  );
}
