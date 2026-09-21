/**
 * Loading what gets dithered.
 *
 * A clip is one or more frames. A photograph is a clip of length one, and
 * everything downstream treats it that way — which is the reason video support
 * did not turn into a second pipeline. The renderer still takes one image and
 * one loop position; the only new idea is that the image can differ per frame.
 *
 * Frames are decoded once, at a capped size, and held as bitmaps. They are NOT
 * held at working resolution: the grid is a control the user moves constantly,
 * and re-reducing from the original each time is what keeps a 48-frame clip
 * responding to that slider instead of re-decoding the file.
 */

export type Clip = {
  images: CanvasImageSource[];
  width: number;
  height: number;
  name: string;
  kind: "still" | "video";
  /** Frames per second of the source, where there was one. Used to suggest a
      playback rate that matches the footage rather than the tool's default. */
  fps?: number;
};

/** Enough to carry a gesture, few enough to stay inside a few hundred MB once
    reduced. A longer clip is sampled across its whole length rather than
    truncated — the loop is the clip, and half a gesture is not a loop. */
const MAX_FRAMES = 48;

/** Long edge of the decoded frames. The working grid is at most 520px, and
    reducing from much more than double that buys nothing a dither can show. */
const MAX_EDGE = 1100;

function fit(w: number, h: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

async function toBitmap(source: CanvasImageSource, w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return createImageBitmap(canvas);
}

export type LoadProgress = (done: number, total: number) => void;

export async function loadClip(file: File, onProgress?: LoadProgress): Promise<Clip> {
  const name = file.name.replace(/\.[^.]+$/, "");
  if (file.type.startsWith("video/")) return loadVideo(file, name, onProgress);

  // An animated GIF or WebP is a clip too, and the only way to reach its
  // frames in a browser is ImageDecoder. Where it is missing the file still
  // loads — as its first frame, which is what an <img> would have given.
  if (/gif|webp|apng/.test(file.type) && "ImageDecoder" in window) {
    const frames = await loadAnimatedImage(file, name, onProgress);
    if (frames) return frames;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = fit(bitmap.width, bitmap.height);
  return {
    images: [await toBitmap(bitmap, width, height)],
    width,
    height,
    name,
    kind: "still",
  };
}

async function loadAnimatedImage(
  file: File,
  name: string,
  onProgress?: LoadProgress,
): Promise<Clip | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Decoder = (window as any).ImageDecoder;
    const decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const count = track?.frameCount ?? 1;
    if (count <= 1) return null;

    const first = await decoder.decode({ frameIndex: 0 });
    const { width, height } = fit(first.image.displayWidth, first.image.displayHeight);

    const images: CanvasImageSource[] = [];
    const step = Math.max(1, Math.ceil(count / MAX_FRAMES));
    let totalDuration = 0;
    for (let i = 0; i < count; i += step) {
      const { image } = await decoder.decode({ frameIndex: i });
      totalDuration += image.duration ?? 0;
      images.push(await toBitmap(image, width, height));
      image.close?.();
      onProgress?.(images.length, Math.ceil(count / step));
    }
    first.image.close?.();

    // Durations come back in microseconds when they come back at all.
    const fps = totalDuration > 0 ? images.length / (totalDuration / 1_000_000) : undefined;
    return { images, width, height, name, kind: "video", fps };
  } catch {
    // Any decoder trouble falls through to the still path rather than failing
    // the load: a first frame is a worse result than an animation, and a much
    // better one than an error.
    return null;
  }
}

async function loadVideo(file: File, name: string, onProgress?: LoadProgress): Promise<Clip> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This browser cannot decode that video"));
    });

    const duration = await trueDuration(video);
    const { width, height } = fit(video.videoWidth, video.videoHeight);
    // Around 12 samples a second, which is the rate this tool plays at by
    // default — enough that a gesture survives, few enough that a long clip
    // does not take a minute to seek through.
    const count = Math.max(2, Math.min(MAX_FRAMES, Math.round(duration * 12)));

    const images: CanvasImageSource[] = [];
    for (let i = 0; i < count; i++) {
      // Sampled across the whole clip rather than truncated at some cut-off.
      // The loop IS the clip, and the last tenth of a gesture is exactly the
      // part you cannot lose.
      const t = (i / count) * duration;
      await seek(video, t);
      images.push(await toBitmap(video, width, height));
      onProgress?.(i + 1, count);
    }

    return { images, width, height, name, kind: "video", fps: count / duration };
  } finally {
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

/**
 * How long the clip really is.
 *
 * `video.duration` is authoritative for a normally encoded file and a lie for
 * anything MediaRecorder wrote — a screen recording, a clip exported by
 * another web app — which report Infinity, or a fraction of the real length,
 * because the container was written as a stream and never remuxed with a final
 * duration. Sampling against that number quietly clamps most of the seeks to
 * the last frame, and the result is a clip of 48 identical frames.
 *
 * Seeking past the end and reading back where the browser actually landed is
 * the standard way to find the true end, and it costs one seek.
 */
async function trueDuration(video: HTMLVideoElement): Promise<number> {
  const stated = video.duration;
  await seek(video, 1e7);
  const found = video.currentTime;
  await seek(video, 0);
  if (found > 0.05 && Number.isFinite(found)) {
    // Trust whichever is longer: a well-formed file agrees with itself, and a
    // stream-written one always understates.
    return Number.isFinite(stated) && stated > found ? stated : found;
  }
  return Number.isFinite(stated) && stated > 0 ? stated : 1;
}

/** Seek and wait. Some containers fire `seeked` before the frame is actually
    presentable, so where it exists the frame callback is the real signal. */
function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    video.onseeked = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withCallback = video as any;
      if (typeof withCallback.requestVideoFrameCallback === "function") {
        withCallback.requestVideoFrameCallback(() => done());
        // A paused video may never present a new frame to that callback, so
        // there has to be a way out — but it has to be long enough that a slow
        // decode is not cut off, or every seek captures the previous frame.
        setTimeout(done, 400);
      } else {
        // Two frames: the first is when the seek is acknowledged, the second is
        // when what it produced is actually on the element.
        requestAnimationFrame(() => requestAnimationFrame(done));
      }
    };
    video.currentTime = time;
    // Nothing in this path is allowed to hang the load.
    setTimeout(done, 3000);
  });
}
