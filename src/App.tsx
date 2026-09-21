import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPalette, PALETTES } from "./dither/palettes";
import { PRESETS, shuffle, type Preset } from "./dither/presets";
import { prepareSource } from "./dither/render";
import { drawSamplePlate } from "./dither/sample";
import { ALGORITHMS, DEFAULTS, type Settings } from "./dither/types";
import { decode, encode } from "./state/url";
import { useFrames, useSource } from "./state/useFrames";
import { ExportSheet } from "./ui/ExportSheet";
import { Presets } from "./ui/Presets";
import { Rail } from "./ui/Rail";
import { Stage } from "./ui/Stage";
import { Filmstrip, Transport } from "./ui/Transport";
import { MobileWall } from "./ui/MobileWall";
import { Section } from "./ui/primitives";

const ALGORITHM_NAMES = Object.fromEntries(ALGORITHMS.map((a) => [a.id, a.name]));

type Loaded = { image: CanvasImageSource; width: number; height: number; name: string };

/**
 * The desktop gate.
 *
 * A media query would hide the interface; this stops it existing. Nothing is
 * baked, no frames are held in memory and the sample plate is never reduced —
 * which matters, because the device being turned away is also the one with the
 * least memory and the slowest single core.
 */
function useIsDesktop(): boolean {
  const query = "(min-width: 1024px)";
  const [ok, setOk] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setOk(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return ok;
}

export default function Root() {
  return useIsDesktop() ? <App /> : <MobileWall />;
}

function App() {
  const [settings, setSettings] = useState<Settings>(() => ({
    ...DEFAULTS,
    ...decode(window.location.hash),
  }));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* ---- history ------------------------------------------------------------
     Undo covers settings only, never the image. Dragging a slider ten pixels
     is one intention and would otherwise be ten steps to undo, so pushes
     inside the same half-second collapse into one. */
  const past = useRef<Settings[]>([]);
  const future = useRef<Settings[]>([]);
  const lastPush = useRef(0);

  const set = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const now = performance.now();
      if (now - lastPush.current > 500) {
        past.current.push(prev);
        if (past.current.length > 80) past.current.shift();
        future.current = [];
      }
      lastPush.current = now;
      return { ...prev, ...patch };
    });
  }, []);

  const jump = useCallback((next: Settings) => {
    setSettings((prev) => {
      past.current.push(prev);
      future.current = [];
      lastPush.current = 0;
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setSettings((prev) => {
      const p = past.current.pop();
      if (!p) return prev;
      future.current.push(prev);
      lastPush.current = 0;
      return p;
    });
  }, []);

  const redo = useCallback(() => {
    setSettings((prev) => {
      const f = future.current.pop();
      if (!f) return prev;
      past.current.push(prev);
      lastPush.current = 0;
      return f;
    });
  }, []);

  /* ---- image --------------------------------------------------------------- */

  useEffect(() => {
    const plate = drawSamplePlate();
    setLoaded({ image: plate, width: plate.width, height: plate.height, name: "Plate" });
  }, []);

  const openFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setToast("That is not an image");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      setLoaded({
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        name: file.name.replace(/\.[^.]+$/, ""),
      });
      setFrame(0);
    } catch {
      // HEIC and some CMYK JPEGs land here. The <img> path decodes a few of
      // them that createImageBitmap refuses outright, so it is worth a second
      // attempt before giving up on the file.
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setLoaded({
          image: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          name: file.name.replace(/\.[^.]+$/, ""),
        });
        setFrame(0);
      };
      img.onerror = () => setToast("This browser cannot open that image");
      img.src = url;
    }
  }, []);

  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) openFile(file);
    };
    const paste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? [])[0];
      if (file) openFile(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [openFile]);

  /* ---- render -------------------------------------------------------------- */

  const source = useSource(loaded?.image ?? null, loaded?.width ?? 0, loaded?.height ?? 0, settings);
  const { frames, progress } = useFrames(source, settings);

  // A separate, much smaller reduction for the contact sheet. Reusing the main
  // source would render twelve previews at full working resolution, which is
  // more work than the image being edited.
  const thumbSource = useMemo(() => {
    if (!loaded) return null;
    return prepareSource(loaded.image, loaded.width, loaded.height, {
      ...settings,
      resolution: 96,
      detail: 35,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const palette = useMemo(() => {
    const p = PALETTES.find((x) => x.id === settings.palette) ?? PALETTES[0];
    return buildPalette(p.ramp, settings.levels, settings.paletteInvert);
  }, [settings.palette, settings.levels, settings.paletteInvert]);

  /* ---- playback ------------------------------------------------------------ */

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = 1000 / settings.fps;
    const tick = (now: number) => {
      acc += now - last;
      last = now;
      if (acc >= step) {
        // Modulo rather than subtract: a tab that was backgrounded for two
        // seconds comes back to one frame advance, not a 24-frame sprint.
        acc %= step;
        setFrame((f) => (f + 1) % frames.length);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frames.length, settings.fps]);

  // While the bake is still filling, hold on the last frame that exists rather
  // than showing an empty stage.
  const shown = frames.length ? frames[Math.min(frame, frames.length - 1)] : null;

  /* ---- url ----------------------------------------------------------------- */

  useEffect(() => {
    const q = encode(settings);
    const url = `${window.location.pathname}${q ? `#${q}` : ""}`;
    window.history.replaceState(null, "", url);
  }, [settings]);

  /* ---- shortcuts ----------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        }
        return;
      }
      if (typing && e.key !== "Escape") return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        setFrame((f) => (f - 1 + frames.length) % Math.max(1, frames.length));
      } else if (e.key === "ArrowRight") {
        setPlaying(false);
        setFrame((f) => (f + 1) % Math.max(1, frames.length));
      } else if (e.key.toLowerCase() === "r") {
        jump(shuffle(settings));
      } else if (e.key.toLowerCase() === "e") {
        setExporting(true);
      } else if (e.key.toLowerCase() === "o") {
        fileInput.current?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frames.length, settings, jump, undo, redo]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const activePreset =
    PRESETS.find((p) => JSON.stringify(p.settings) === JSON.stringify(settings))?.id ?? null;

  const applyPreset = (p: Preset) => {
    // The framing decisions the user has already made are theirs. A preset
    // changes the look, not the size of the grid or the length of the loop.
    jump({
      ...p.settings,
      resolution: settings.resolution,
      frames: settings.frames,
      fps: settings.fps,
    });
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast("Link copied — it carries the settings, not the image");
    } catch {
      setToast("Could not reach the clipboard");
    }
  };

  const stat = [
    `${source?.width ?? 0}×${source?.height ?? 0}`,
    ALGORITHM_NAMES[settings.algorithm],
    `${settings.levels} tones`,
    `${settings.frames}f @ ${settings.fps}fps`,
    `${(settings.frames / settings.fps).toFixed(2)}s`,
  ].join("  ·  ");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel">
      <header
        className="flex h-[42px] shrink-0 items-center justify-between gap-4 border-b border-line px-3"
        style={{ animation: "enter 500ms var(--ease) both" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-[0.1em] text-text">
            <span className="h-[6px] w-[6px] bg-accent" />
            dither<span className="text-dim">.studio</span>
          </span>
          <span className="h-[14px] w-px bg-line" />
          <span className="value truncate text-dim">{loaded?.name}</span>
        </div>

        <div className="flex items-center gap-px">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])}
          />
          <button
            type="button"
            className="btn btn--ghost !border-0 !shadow-none"
            onClick={() => jump(shuffle(settings))}
            title="Shuffle (R)"
          >
            Shuffle
          </button>
          <button
            type="button"
            className="btn btn--ghost !border-0 !shadow-none"
            onClick={share}
            title="Copy a link to these settings"
          >
            Share
          </button>
          <button
            type="button"
            className="btn btn--ghost !border-0 !shadow-none"
            onClick={() => fileInput.current?.click()}
            title="Open an image (O)"
          >
            Image
          </button>
          <button
            type="button"
            className="btn btn--accent ml-1.5"
            onClick={() => setExporting(true)}
            title="Export (E)"
          >
            Export
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
        <div
          className="flex min-h-0 flex-col gap-3 p-3"
          style={{ animation: "enter 600ms 60ms var(--ease) both" }}
        >
          <Stage
            indices={shown}
            width={source?.width ?? 1}
            height={source?.height ?? 1}
            palette={palette}
            progress={progress}
            dragging={dragging}
            label={`${source?.width ?? 0} × ${source?.height ?? 0} px`}
            onPickFile={() => fileInput.current?.click()}
          />
          <Transport
            playing={playing}
            onPlay={setPlaying}
            frame={Math.min(frame, Math.max(0, frames.length - 1))}
            frames={Math.max(1, frames.length)}
            fps={settings.fps}
            onSeek={setFrame}
          />
          {source && frames.length > 1 && (
            <Filmstrip
              frames={frames}
              width={source.width}
              height={source.height}
              palette={palette}
              current={Math.min(frame, frames.length - 1)}
              onSeek={(i) => {
                setPlaying(false);
                setFrame(i);
              }}
            />
          )}
        </div>

        <aside
          className="panel-scroll min-h-0 overflow-y-auto border-l border-line bg-panel"
          style={{ animation: "enter 600ms 120ms var(--ease) both" }}
        >
          <Section
            title="Looks"
            collapsible={false}
            right={
              <button
                type="button"
                className="value text-dim hover:text-accent"
                onClick={() => jump({ ...DEFAULTS })}
              >
                Reset
              </button>
            }
          >
            <Presets source={thumbSource} activeId={activePreset} onApply={applyPreset} />
          </Section>
          <Rail
            settings={settings}
            set={set}
            source={source}
            sourceLabel={`${loaded?.width ?? 0}×${loaded?.height ?? 0}`}
          />
        </aside>
      </main>

      {/* The status line. Everything the loop currently is, in one row, in the
          same place it was a second ago — so nothing above has to repeat it. */}
      <footer className="flex h-[26px] shrink-0 items-center justify-between gap-4 border-t border-line px-3">
        <span className="value truncate text-dim">{stat}</span>
        <span className="value shrink-0 text-dim/70">
          SPACE play · ←→ step · R shuffle · E export · ⌘Z undo
        </span>
      </footer>

      <ExportSheet
        open={exporting}
        onClose={() => setExporting(false)}
        frames={frames}
        width={source?.width ?? 1}
        height={source?.height ?? 1}
        palette={palette}
        settings={settings}
        currentFrame={Math.min(frame, Math.max(0, frames.length - 1))}
        onToast={setToast}
      />

      {toast && (
        <div
          className="pointer-events-none fixed bottom-9 left-1/2 z-50 -translate-x-1/2 rounded-[2px] border border-line bg-raised px-3 py-2 font-mono text-[11px] tracking-[0.02em] text-text"
          style={{ animation: "enter 240ms var(--ease) both" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
