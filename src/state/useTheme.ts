import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "dither.theme";

/**
 * Light and dark.
 *
 * The starting value is whatever the operating system is set to, and a choice
 * made here overrides it permanently — the usual arrangement, and the right one
 * for a tool somebody might use at a desk in daylight and on a sofa at
 * midnight.
 *
 * The attribute is written to <html> rather than held in React state alone,
 * because the interface is themed by nine CSS variables on that element and
 * nothing below it needs to know. The first value is also set by a script in
 * index.html, before paint: React cannot run early enough to stop a dark-mode
 * user being shown a white page for a frame, and that flash is the one thing
 * a theme switch must never do.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) || "dark",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Private browsing. The theme still applies for this session.
    }
  }, [theme]);

  // Follow the system only while the user has not expressed a preference.
  useEffect(() => {
    let chosen = false;
    try {
      chosen = localStorage.getItem(KEY) !== null;
    } catch {
      chosen = false;
    }
    if (chosen) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const on = () => setTheme(mq.matches ? "light" : "dark");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return [theme, setTheme];
}
