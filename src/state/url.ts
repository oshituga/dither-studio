import { DEFAULTS, type Settings } from "../dither/types";

/**
 * Settings in the address bar.
 *
 * Only the values that differ from the defaults are written, so a link to a
 * two-change look is short enough to paste into a message. The image itself is
 * never encoded — it stays on the machine it was opened on, and a shared link
 * is an invitation to apply the same look to your own photograph.
 */

const KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

export function encode(settings: Settings): string {
  const params = new URLSearchParams();
  for (const k of KEYS) {
    if (settings[k] === DEFAULTS[k]) continue;
    const v = settings[k];
    params.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return params.toString();
}

export function decode(hash: string): Partial<Settings> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const raw = params.get(k);
    if (raw === null) continue;
    const fallback = DEFAULTS[k];
    if (typeof fallback === "boolean") out[k] = raw === "1";
    else if (typeof fallback === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = n;
    } else out[k] = raw;
  }
  return out as Partial<Settings>;
}
