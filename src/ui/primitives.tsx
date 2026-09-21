import type { ReactNode } from "react";
import { useState } from "react";

/**
 * The control vocabulary.
 *
 * Every row in the rail is dimensionally identical — same label size, same
 * height, numbers on the same right edge — because that is the only thing that
 * makes a panel this dense read as calm. The moment two rows disagree about
 * where their value sits, the eye starts hunting.
 */

export function Section({
  title,
  right,
  children,
  collapsible = true,
  defaultOpen = true,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = !collapsible || open;

  return (
    <section className="border-b border-line">
      <header className="flex h-[34px] items-center justify-between gap-3 px-4">
        <button
          type="button"
          disabled={!collapsible}
          onClick={() => setOpen((o) => !o)}
          className="group flex items-center gap-2"
        >
          {collapsible && (
            <svg
              width="7"
              height="7"
              viewBox="0 0 7 7"
              className="text-dim transition-transform duration-150 group-hover:text-text"
              style={{
                rotate: shown ? "90deg" : "0deg",
                transitionTimingFunction: "var(--ease)",
              }}
            >
              <path d="M1.5 0.5 5.5 3.5 1.5 6.5Z" fill="currentColor" />
            </svg>
          )}
          <span className="label group-hover:text-text">{title}</span>
        </button>
        {right}
      </header>
      {shown && <div className="flex flex-col gap-3.5 px-4 pb-4 pt-0.5">{children}</div>}
    </section>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
  active,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
  /** Draws the live dot. Used by the motion rows, where "is this one doing
      anything" is the question being asked twenty times a minute. */
  active?: boolean;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium tracking-[-0.01em] text-text">{label}</span>
          {active && <span className="h-[4px] w-[4px] rounded-full bg-accent" />}
        </span>
        <span className="value text-dim">
          {Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between py-0.5"
    >
      <span className="text-[12px] font-medium tracking-[-0.01em] text-text">{label}</span>
      <span
        className={`relative h-[16px] w-[28px] rounded-[2px] transition-colors duration-150 ${
          checked ? "bg-accent" : "bg-raised"
        }`}
        style={{ transitionTimingFunction: "var(--ease)" }}
      >
        <span
          className={`absolute top-[3px] h-[10px] w-[10px] rounded-[1px] transition-[left] duration-150 ${
            checked ? "left-[15px] bg-void" : "left-[3px] bg-dim"
          }`}
          style={{ transitionTimingFunction: "var(--ease)" }}
        />
      </span>
    </button>
  );
}

export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { value: T; label: string; note?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div className="grid gap-px" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            title={o.note}
            onClick={() => onChange(o.value)}
            className={`rounded-[2px] px-2 py-[7px] text-left text-[11px] font-medium tracking-[-0.01em] transition-colors duration-150 ${
              active
                ? "bg-accent text-void"
                : "bg-raised text-dim hover:bg-raised-hover hover:text-text"
            }`}
            style={{ transitionTimingFunction: "var(--ease)" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The drift compass.
 *
 * Direction is an angle, and an angle asked for as a number is a control nobody
 * touches. Eight arrows in the shape of the thing they do need no label, and
 * the centre being "off" puts the switch exactly where the eye already is.
 */
export function Compass({
  angle,
  amount,
  onAngle,
  onAmount,
}: {
  angle: number;
  amount: number;
  onAngle: (v: number) => void;
  onAmount: (v: number) => void;
}) {
  // Screen coordinates: y grows downward, so "up" is 270. Listed in reading
  // order to match the grid.
  const dirs = [225, 270, 315, 180, -1, 0, 135, 90, 45];
  return (
    <div className="grid grid-cols-3 gap-px">
      {dirs.map((d, i) => {
        const off = d === -1;
        const active = off ? amount === 0 : amount > 0 && angle === d;
        return (
          <button
            key={i}
            type="button"
            aria-label={off ? "No drift" : `Drift ${d} degrees`}
            onClick={() => {
              if (off) return onAmount(0);
              onAngle(d);
              if (amount === 0) onAmount(1);
            }}
            className={`flex aspect-square items-center justify-center rounded-[2px] transition-colors duration-150 ${
              active
                ? "bg-accent text-void"
                : "bg-raised text-dim hover:bg-raised-hover hover:text-text"
            }`}
            style={{ transitionTimingFunction: "var(--ease)" }}
          >
            {off ? (
              <span className="block h-[4px] w-[4px] bg-current" />
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" style={{ rotate: `${d + 90}deg` }}>
                <path
                  d="M6 1.5v9M6 1.5 3 4.5M6 1.5 9 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="square"
                />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
