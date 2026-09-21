import { paint } from "./render";
import type { RGB } from "./palettes";

/**
 * Everything that leaves the tool.
 *
 * The GIF has its own file — it is the only format that needs a codec writing
 * by hand. These are the ones the browser already knows how to make: a video
 * through MediaRecorder, and PNGs through the canvas.
 */

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next turn rather than immediately: Safari has not always
  // finished reading the object URL by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A nearest-neighbour blit of one frame onto a canvas at export scale. */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  indices: Uint8Array,
  palette: RGB[],
  w: number,
  h: number,
  scale: number,
  scratch: HTMLCanvasElement,
) {
  const sctx = scratch.getContext("2d")!;
  sctx.putImageData(paint(indices, palette, w, h), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, w * scale, h * scale);
}

function scratchFor(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export type VideoOptions = {
  frames: Uint8Array[];
  palette: RGB[];
  width: number;
  height: number;
  scale: number;
  fps: number;
  /** How many times the loop is written into the file. One loop is enough for
      a player that loops; three is what makes an autoplaying preview on social
      read as a loop rather than as a clip. */
  loops: number;
  onProgress?: (done: number, total: number) => void;
};

/** The first container the browser admits to being able to write. MP4 leads
    because it is the one that plays everywhere a link gets pasted. */
function pickMime(): { mime: string; ext: string } | null {
  const candidates = [
    { mime: "video/mp4;codecs=avc1.42E01E", ext: "mp4" },
    { mime: "video/mp4", ext: "mp4" },
    { mime: "video/webm;codecs=vp9", ext: "webm" },
    { mime: "video/webm;codecs=vp8", ext: "webm" },
    { mime: "video/webm", ext: "webm" },
  ];
  if (typeof MediaRecorder === "undefined") return null;
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

export const VIDEO_SUPPORT = pickMime();

export async function encodeVideo(opts: VideoOptions): Promise<{ blob: Blob; ext: string }> {
  const support = pickMime();
  if (!support) throw new Error("This browser cannot record video.");

  const { frames, palette, width, height, scale, fps, loops, onProgress } = opts;
  const canvas = scratchFor(width * scale, height * scale);
  const ctx = canvas.getContext("2d")!;
  const scratch = scratchFor(width, height);

  // captureStream(0) hands over frame timing entirely: nothing is captured
  // until requestFrame is called, so a dropped rAF cannot put a duplicate
  // frame in the file. Where that is unsupported the stream is driven at fps
  // and the real-time pacing below carries it.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const manual = typeof track?.requestFrame === "function";

  const recorder = new MediaRecorder(stream, {
    mimeType: support.mime,
    videoBitsPerSecond: 12_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();

  const total = frames.length * loops;
  const step = 1000 / fps;
  const started = performance.now();

  for (let i = 0; i < total; i++) {
    drawFrame(ctx, frames[i % frames.length], palette, width, height, scale, scratch);
    if (manual) track.requestFrame();
    onProgress?.(i + 1, total);
    // Sleep until this frame's slot is up, measured from the start rather than
    // accumulated per frame — otherwise every millisecond a draw runs long is
    // added to the length of the clip.
    const due = started + (i + 1) * step;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  // The last frame needs to be on screen for its own duration, or the loop is
  // one frame short and visibly hitches at the join.
  await new Promise((r) => setTimeout(r, step));
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());

  return { blob: new Blob(chunks, { type: support.mime }), ext: support.ext };
}

export async function encodePng(
  indices: Uint8Array,
  palette: RGB[],
  width: number,
  height: number,
  scale: number,
): Promise<Blob> {
  const canvas = scratchFor(width * scale, height * scale);
  const ctx = canvas.getContext("2d")!;
  drawFrame(ctx, indices, palette, width, height, scale, scratchFor(width, height));
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"),
  );
}

/** Every frame on one sheet, left to right, top to bottom — for dropping the
    loop into a game engine or an After Effects comp. */
export async function encodeSheet(
  frames: Uint8Array[],
  palette: RGB[],
  width: number,
  height: number,
  scale: number,
): Promise<Blob> {
  const cols = Math.min(frames.length, 6);
  const rows = Math.ceil(frames.length / cols);
  const canvas = scratchFor(width * scale * cols, height * scale * rows);
  const ctx = canvas.getContext("2d")!;
  const scratch = scratchFor(width, height);
  ctx.imageSmoothingEnabled = false;

  frames.forEach((f, i) => {
    const sctx = scratch.getContext("2d")!;
    sctx.putImageData(paint(f, palette, width, height), 0, 0);
    const x = (i % cols) * width * scale;
    const y = Math.floor(i / cols) * height * scale;
    ctx.drawImage(scratch, x, y, width * scale, height * scale);
  });

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"),
  );
}
