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
    // Arrays are compared by content; every other value by identity.
    const same = Array.isArray(settings[k])
      ? JSON.stringify(settings[k]) === JSON.stringify(DEFAULTS[k])
      : settings[k] === DEFAULTS[k];
    if (same) continue;
    const v = settings[k];
    if (Array.isArray(v)) {
      if (typeof v[0] === "number") {
        // A painted kernel: 64 values of 0..35, one base-36 character each.
        // Comma-separating them would be 190 characters of link for a matrix
        // that fits in 64.
        params.set(k, v.map((n) => Number(n).toString(36)).join(""));
      } else {
        // Hex stops, without the hashes — a '#' in a hash fragment ends the
        // fragment.
        params.set(k, v.map((c) => String(c).replace("#", "")).join(","));
      }
    } else {
      params.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
    }
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
    if (Array.isArray(fallback) && typeof fallback[0] === "number") {
      const values = raw.split("").map((c) => parseInt(c, 36));
      if (values.length === fallback.length && values.every((n) => Number.isFinite(n))) {
        out[k] = values;
      }
    } else if (Array.isArray(fallback)) {
      const stops = raw
        .split(",")
        .map((c) => `#${c.replace(/[^0-9a-f]/gi, "").slice(0, 6)}`)
        .filter((c) => c.length === 7);
      if (stops.length >= 2) out[k] = stops;
    } else if (typeof fallback === "boolean") out[k] = raw === "1";
    else if (typeof fallback === "number") {
      const n = Number(raw);
      if (Number.isFinite(n)) out[k] = n;
    } else out[k] = raw;
  }
  return out as Partial<Settings>;
}
