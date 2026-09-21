import { useEffect, useState } from "react";
import { encodeGif } from "../dither/gif";
import { download, encodePng, encodeSheet, encodeVideo, VIDEO_SUPPORT } from "../dither/export";
import type { RGB } from "../dither/palettes";
import type { Settings } from "../dither/types";

type Format = "gif" | "video" | "png" | "sheet";

/**
 * Export.
 *
 * Four formats, and the panel says what each one is FOR rather than what it is
 * — nobody choosing between a GIF and an MP4 is choosing a container, they are
 * choosing where they are about to paste it.
 *
 * Scale is nearest-neighbour and integer only. A 2.5x dither is a blurred
 * dither, and an export that quietly softens the thing the tool exists to make
 * would be the worst bug in here.
 */
export function ExportSheet({
  open,
  onClose,
  frames,
  width,
  height,
  palette,
  settings,
  currentFrame,
  ready,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  frames: Uint8Array[];
  width: number;
  height: number;
  palette: RGB[];
  settings: Settings;
  currentFrame: number;
  /** False while frames are still baking. Exporting then would write a loop
      that is missing its ending — silently, and only visible once the file is
      open somewhere else. */
  ready: boolean;
  onToast: (message: string) => void;
}) {
  const [format, setFormat] = useState<Format>("gif");
  const [scale, setScale] = useState(2);
  const [loops, setLoops] = useState(3);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const out = { w: width * scale, h: height * scale };
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `dither-${settings.algorithm}-${stamp}`;

  const options: { id: Format; title: string; note: string; disabled?: boolean }[] = [
    { id: "gif", title: "GIF", note: "Loops anywhere, no player needed" },
    {
      id: "video",
      title: VIDEO_SUPPORT?.ext === "mp4" ? "MP4" : "WebM",
      note: "Smaller, smoother, for posts and decks",
      disabled: !VIDEO_SUPPORT,
    },
    { id: "png", title: "PNG", note: "The frame on screen, as a still" },
    { id: "sheet", title: "Sprite sheet", note: "Every frame on one image" },
  ];

  const run = async () => {
    setBusy(true);
    setProgress(0);
    try {
      if (format === "gif") {
        const blob = await encodeGif({
          frames,
          width,
          height,
          palette,
          delay: 1000 / settings.fps,
          scale,
          onProgress: (d, t) => setProgress(d / t),
        });
        download(blob, `${name}.gif`);
      } else if (format === "video") {
        const { blob, ext } = await encodeVideo({
          frames,
          palette,
          width,
          height,
          scale,
          fps: settings.fps,
          loops,
          onProgress: (d, t) => setProgress(d / t),
        });
        download(blob, `${name}.${ext}`);
      } else if (format === "png") {
        const blob = await encodePng(frames[currentFrame], palette, width, height, scale);
        download(blob, `${name}-${String(currentFrame + 1).padStart(2, "0")}.png`);
      } else {
        const blob = await encodeSheet(frames, palette, width, height, scale);
        download(blob, `${name}-sheet.png`);
      }
      onToast("Saved to your downloads");
      onClose();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 p-3 backdrop-blur-[3px] md:items-center"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-[420px] rounded-[3px] border border-line bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[34px] items-center justify-between border-b border-line px-4">
          <span className="label text-text">Export</span>
          <span className="value text-dim">
            {out.w}×{out.h}
            {format !== "png" ? ` · ${frames.length}f` : ""}
          </span>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 gap-px">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled}
                onClick={() => setFormat(o.id)}
                className={`rounded-[2px] p-2.5 text-left transition-colors duration-150 disabled:opacity-30 ${
                  format === o.id ? "bg-accent" : "bg-raised hover:bg-raised-hover"
                }`}
                style={{ transitionTimingFunction: "var(--ease)" }}
              >
                <span
                  className={`block font-mono text-[11px] uppercase tracking-[0.08em] ${
                    format === o.id ? "text-void" : "text-text"
                  }`}
                >
                  {o.title}
                </span>
                <span
                  className={`mt-1 block text-[10px] leading-[13px] tracking-[-0.01em] ${
                    format === o.id ? "text-void/70" : "text-dim"
                  }`}
                >
                  {o.note}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <span className="label">Scale</span>
            <div className="mt-1.5 grid grid-cols-4 gap-px">
              {[1, 2, 3, 4].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScale(s)}
                  className={`rounded-[2px] py-[7px] font-mono text-[11px] tracking-[0.04em] transition-colors duration-150 ${
                    scale === s
                      ? "bg-accent text-void"
                      : "bg-raised text-dim hover:bg-raised-hover hover:text-text"
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {format === "video" && (
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium tracking-[-0.01em] text-text">
                  Repeats in file
                </span>
                <span className="value text-dim">{loops}</span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                value={loops}
                onChange={(e) => setLoops(Number(e.target.value))}
                style={{ "--fill": `${((loops - 1) / 7) * 100}%` } as React.CSSProperties}
              />
              <p className="text-[10px] leading-[13px] tracking-[-0.01em] text-dim">
                Recorded in real time, so this is also how long the export takes:{" "}
                {((frames.length / settings.fps) * loops).toFixed(1)}s.
              </p>
            </div>
          )}

          <div className="mt-4 flex items-center gap-px">
            <button
              type="button"
              className="btn btn--accent flex-1"
              onClick={run}
              disabled={busy || !ready || frames.length === 0}
            >
              {busy
                ? `${Math.round(progress * 100)}%`
                : !ready
                  ? "Baking frames…"
                  : `Save ${format === "png" ? "still" : "loop"}`}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>

          {busy && (
            <div className="mt-3 h-px w-full bg-line">
              <div
                className="h-full origin-left bg-accent transition-transform duration-150"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
