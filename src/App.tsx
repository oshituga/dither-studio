import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildPalette,
  buildSourcePalette,
  CUSTOM_PALETTE,
  extractRamp,
  MAX_SOURCE_LEVELS,
  PALETTES,
  SOURCE_PALETTE,
} from "./dither/palettes";
import { loadClip, type Clip } from "./dither/clip";
import { PRESETS, shuffle, type Preset } from "./dither/presets";
import { prepareSource } from "./dither/render";
import { drawSamplePlate } from "./dither/sample";
import { ALGORITHMS, DEFAULTS, type Settings } from "./dither/types";
import { decode, encode } from "./state/url";
import { canRunOnGpu, GpuDither } from "./gpu/renderer";
import { useFrames, useSource } from "./state/useFrames";
import { useTheme } from "./state/useTheme";
import { SimplePanel } from "./ui/SimplePanel";
import { ExportSheet } from "./ui/ExportSheet";
import { Presets } from "./ui/Presets";
import { Rail } from "./ui/Rail";
import { Stage } from "./ui/Stage";
import { Filmstrip, Transport } from "./ui/Transport";
import { MobileWall } from "./ui/MobileWall";
import { Section } from "./ui/primitives";

const ALGORITHM_NAMES = Object.fromEntries(ALGORITHMS.map((a) => [a.id, a.name]));

/** What is loaded is a clip: a photograph is one of length one. */

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
  const [loaded, setLoaded] = useState<Clip | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useTheme();
  /* Which panel is showing. Remembered per browser, deliberately not put in
     the URL: it is how this person likes to work, not part of the look being
     shared, and a link that reorganised the recipient's interface would be a
     rude thing to send. */
  const [full, setFull] = useState(() => {
    try {
      return localStorage.getItem("dither.panel") === "full";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("dither.panel", full ? "full" : "simple");
    } catch {
      // Private browsing; the choice still holds for this session.
    }
  }, [full]);
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
    setLoaded({
      images: [plate],
      width: plate.width,
      height: plate.height,
      name: "Plate",
      kind: "still",
    });
  }, []);

  const openFile = useCallback(async (file: File) => {
    const ok = file.type.startsWith("image/") || file.type.startsWith("video/");
    if (!ok) {
      setToast("That is not an image or a video");
      return;
    }
    setLoading(0);
    try {
      const clip = await loadClip(file, (done, total) => setLoading(done / total));
      setLoaded(clip);
      setFrame(0);
      if (clip.kind === "video") {
        // Footage brings its own movement. Leaving the grid drifting on top of
        // it is two motions fighting, and the first thing anyone wants to see
        // is their clip dithered — so the drift stands down and the loop
        // adopts the clip's own length and rate.
        /* Ping-pong walks the clip out and back, which is 2(n-1) steps — 13
           frames become a 24-step cycle. Setting the loop to exactly that maps
           one loop position to one clip frame; any other length resamples the
           triangle and repeats a frame or two at the turns, which reads as a
           stutter in an otherwise smooth move. */
        const span = Math.min(72, Math.max(2, (clip.images.length - 1) * 2));
        jump({
          ...settings,
          drift: 0,
          frames: span,
          fps: Math.round(Math.min(30, Math.max(6, clip.fps ?? 12))),
          pingpong: true,
        });
        setToast(`${clip.images.length} frames — ping-pong on, so it loops`);
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not open that file");
    } finally {
      setLoading(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

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

  const source = useSource(loaded?.images[0] ?? null, loaded?.width ?? 0, loaded?.height ?? 0, settings);
  const bake = useFrames(loaded, settings);

  /* Hold the last loop that actually had frames in it.
     A rebake starts empty and fills over the next few animation frames, so for
     that moment the live bake has no frames and no dimensions — and anything
     painting from it collapses: the stage loses its aspect ratio, the filmstrip
     empties, the label reads 0 × 0. Dragging a slider is a continuous stream of
     those moments, which is why it read as the screen breaking rather than as a
     single flash. Showing the previous loop until the next one has a frame
     costs one render of staleness and removes the flicker entirely. */
  const settled = useRef(bake);
  if (bake.frames.length > 0) settled.current = bake;
  const view = bake.frames.length > 0 ? bake : settled.current;

  const frames = view.frames;
  const progress = bake.progress;

  // A separate, much smaller reduction for the contact sheet. Reusing the main
  // source would render twelve previews at full working resolution, which is
  // more work than the image being edited.
  const thumbSource = useMemo(() => {
    if (!loaded) return null;
    return prepareSource(loaded.images[0], loaded.width, loaded.height, {
      ...settings,
      resolution: 96,
      detail: 35,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Built from the BAKE's tone count, never the live one. An index is only
  // meaningful against the table it was quantised into, and during the
  // handful of frames between moving the Tones slider and the rebake landing,
  // the two do not match.
  /* The live preview.
     The CPU bakes a whole loop before anything moves, which is right for
     export and wrong for a hand on a slider. This draws the frame being looked
     at, now, at any grid size — and only until the bake lands, at which point
     the picture goes back to being the CPU's. So what anybody settles on, and
     what leaves in a file, is always the exact one.

     Stills only: a clip would need its own frame reduced per loop position,
     which is the expensive work this is trying to stay ahead of. Ordered
     kernels only: error diffusion cannot be done in a fragment shader, and
     grain cannot be done in single precision. */
  const gpu = useMemo(() => GpuDither.create(), []);
  const oneFrameClip = (loaded?.images.length ?? 1) === 1;
  const liveGpu =
    Boolean(gpu) && oneFrameClip && canRunOnGpu(settings) && progress < 1 && Boolean(source);

  /* What the stage is showing, in pixels.
     The settled bake first, and the prepared source whenever there is not one
     yet. Sizing from the bake alone collapses the stage to a single pixel for
     the first moments after every change — which is most of a slider drag, and
     is exactly the window the live preview exists to fill. The source knows the
     grid the moment the settings do, and the two always agree once both
     exist. */
  const showW = view.width || source?.width || 1;
  const showH = view.height || source?.height || 1;

  const palette = useMemo(() => {
    if (view.colour) return buildSourcePalette(view.levels);
    const ramp =
      settings.palette === CUSTOM_PALETTE
        ? settings.custom
        : (PALETTES.find((x) => x.id === settings.palette) ?? PALETTES[0]).ramp;
    return buildPalette(ramp, Math.max(2, view.levels), settings.paletteInvert);
  }, [settings.palette, settings.custom, settings.paletteInvert, view.colour, view.levels]);

  // The prepared grid only changes with these, so the texture upload is keyed
  // on them rather than on every render.
  const sourceKey = `${loaded?.name}:${source?.width}x${source?.height}:${settings.detail}`;

  useEffect(() => {
    if (!liveGpu || !gpu || !source) return;
    const colour = settings.palette === SOURCE_PALETTE;
    const levels = colour ? Math.min(MAX_SOURCE_LEVELS, settings.levels) : settings.levels;
    const live = colour ? buildSourcePalette(levels) : palette;
    gpu.render(source, sourceKey, settings, frame, levels, colour, live);
  }, [liveGpu, gpu, source, sourceKey, settings, frame, palette]);

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
      const el = e.target as HTMLElement | null;
      const range = el?.tagName === "INPUT" && (el as HTMLInputElement).type === "range";
      const typing = (el?.tagName === "INPUT" && !range) || el?.isContentEditable === true;

      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        }
        return;
      }
      if (typing && e.key !== "Escape") return;
      // A focused slider keeps its own arrows and space — nudging a value is
      // what those keys mean while a slider has the focus. Every other
      // shortcut still works, because the alternative is that touching one
      // control silently disables the keyboard for the rest of the session.
      if (range && (e.key === " " || e.key.startsWith("Arrow"))) return;
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

  const choosePalette = (id: string) => {
    if (id === SOURCE_PALETTE) {
      set({ palette: id, levels: Math.min(settings.levels, MAX_SOURCE_LEVELS) });
    } else {
      set({ palette: id });
    }
  };

  /** Seed the custom ramp from the photograph, and switch to it — asking for
      the image's colours and then having to go and turn them on would be two
      steps for one intention. */
  const rampFromImage = () => {
    if (!source) return;
    const stops = extractRamp(source.rgb, Math.max(3, Math.min(5, settings.levels)));
    jump({ ...settings, custom: stops, palette: CUSTOM_PALETTE });
    setToast("Ramp taken from the image");
  };

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
    `${showW}×${showH}`,
    ALGORITHM_NAMES[settings.algorithm],
    view.colour ? `${view.levels ** 3} colours` : `${view.levels} tones`,
    `${settings.frames}f @ ${settings.fps}fps`,
    liveGpu ? "gpu" : null,
    `${(settings.frames / settings.fps).toFixed(2)}s`,
  ]
    .filter(Boolean)
    .join("  ·  ");

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
          <span className="value truncate text-dim">
            {loaded?.name}
            {loaded && loaded.images.length > 1 ? ` · ${loaded.images.length} frames` : ""}
          </span>
        </div>

        <div className="flex items-center gap-px">
          <input
            ref={fileInput}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])}
          />
          <div className="mr-1.5 flex items-center gap-px rounded-[3px] bg-raised p-px">
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setFull(v)}
                className={`rounded-[2px] px-2.5 py-[6px] font-mono text-[10px] uppercase tracking-[0.08em] transition-colors duration-150 ${
                  full === v ? "bg-accent text-panel" : "text-dim hover:text-text"
                }`}
                style={{ transitionTimingFunction: "var(--ease)" }}
              >
                {v ? "Full" : "Simple"}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--ghost !border-0 !shadow-none !px-2.5"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                <circle cx="7" cy="7" r="3" />
                <path d="M7 .8v1.6M7 11.6v1.6M1.2 7h1.6M11.2 7h1.6M2.9 2.9l1.1 1.1M10 10l1.1 1.1M11.1 2.9 10 4M4 10l-1.1 1.1" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor">
                <path d="M12.4 8.6A5.8 5.8 0 0 1 5.4 1.6 5.8 5.8 0 1 0 12.4 8.6Z" />
              </svg>
            )}
          </button>

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
            blit={liveGpu && gpu ? gpu.canvas : null}
            width={showW}
            height={showH}
            palette={palette}
            progress={loading !== null ? loading : progress}
            dragging={dragging}
            label={`${showW} × ${showH} px`}
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
          {view.width > 0 && frames.length > 1 && (
            <Filmstrip
              frames={frames}
              width={view.width}
              height={view.height}
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
          {full ? (
            <Rail
              settings={settings}
              set={set}
              onPalette={choosePalette}
              onFromImage={rampFromImage}
              source={source}
              theme={theme}
              sourceLabel={`${loaded?.width ?? 0}×${loaded?.height ?? 0}`}
              clipFrames={loaded?.images.length ?? 1}
            />
          ) : (
            <SimplePanel
              settings={settings}
              set={set}
              onPalette={choosePalette}
              onFromImage={rampFromImage}
              canExtract={Boolean(source)}
              clipFrames={loaded?.images.length ?? 1}
            />
          )}
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
        width={showW}
        height={showH}
        palette={palette}
        settings={settings}
        currentFrame={Math.min(frame, Math.max(0, frames.length - 1))}
        ready={progress >= 1}
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
