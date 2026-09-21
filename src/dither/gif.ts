import type { RGB } from "./palettes";

/**
 * A GIF89a encoder, written here rather than pulled in.
 *
 * Every GIF library on npm exists to solve a problem this tool does not have:
 * quantising true-colour frames down to 256 and dithering the result. That work
 * is already done — the renderer hands back an index per pixel against a
 * palette of at most twelve colours — so all that is left is the container and
 * LZW, which is about two hundred lines. Pulling in a worker-based quantiser to
 * skip them would mean re-dithering the output of a dithering tool, and the
 * export would no longer match the preview exactly.
 *
 * The output is a single-palette, full-frame, infinitely looping GIF: the
 * simplest thing the format can express, and the thing every renderer on every
 * platform agrees on.
 */

class ByteStream {
  private buf = new Uint8Array(1 << 16);
  private len = 0;

  private grow(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < this.len + extra) next *= 2;
    const bigger = new Uint8Array(next);
    bigger.set(this.buf.subarray(0, this.len));
    this.buf = bigger;
  }

  byte(v: number) {
    this.grow(1);
    this.buf[this.len++] = v & 255;
  }

  /** Little-endian 16-bit — the only multi-byte number the format uses. */
  short(v: number) {
    this.byte(v);
    this.byte(v >> 8);
  }

  bytes(src: ArrayLike<number>) {
    this.grow(src.length);
    for (let i = 0; i < src.length; i++) this.buf[this.len++] = src[i] as number;
  }

  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/**
 * LZW, packed LSB-first and emitted as the format's 255-byte sub-blocks.
 *
 * The dictionary is keyed on (prefix << 8) | pixel, which is a plain integer
 * because the palette never exceeds 256 entries and a prefix never exceeds
 * 4095 — so the whole thing fits in twenty bits and the Map never has to hash
 * a string.
 */
function lzw(indices: Uint8Array, minCodeSize: number, out: ByteStream) {
  const clearCode = 1 << minCodeSize;
  const eoi = clearCode + 1;

  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();

  // Sub-block accumulator. A GIF image is a chain of blocks of at most 255
  // bytes, each preceded by its length, terminated by a zero.
  const block = new Uint8Array(255);
  let blockLen = 0;
  let bitBuffer = 0;
  let bitCount = 0;

  const flushBlock = () => {
    if (blockLen === 0) return;
    out.byte(blockLen);
    out.bytes(block.subarray(0, blockLen));
    blockLen = 0;
  };

  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block[blockLen++] = bitBuffer & 255;
      bitBuffer >>= 8;
      bitCount -= 8;
      if (blockLen === 255) flushBlock();
    }
    // Widen AFTER writing, and against the dictionary as it stood before this
    // code's own entry was added.
    //
    // This one line is the whole format. A decoder's table runs exactly one
    // entry behind the encoder's — it cannot add an entry until it has seen
    // the code that follows — so an encoder that widens the moment its own
    // table fills writes the next code one bit wider than the decoder is about
    // to read it. Everything after that point decodes to noise, and the file
    // still opens: the header is fine, the dimensions are fine, and the first
    // few pixels are fine, which is exactly how you end up staring at a
    // corrupt GIF looking for a bug in the dithering.
    if (next > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
  };

  emit(clearCode);

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next);
      next++;
    } else {
      // Dictionary full. Start again — the decoder resets on this code too.
      emit(clearCode);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    }
    prefix = k;
  }

  emit(prefix);
  emit(eoi);

  if (bitCount > 0) {
    block[blockLen++] = bitBuffer & 255;
    if (blockLen === 255) flushBlock();
  }
  flushBlock();
  out.byte(0);
}

/** Nearest-neighbour upscale on the index buffer, before any pixels exist.
    Scaling the rendered image instead would either blur the dither or cost a
    full canvas round trip per frame. */
function upscale(indices: Uint8Array, w: number, h: number, scale: number): Uint8Array {
  if (scale === 1) return indices;
  const W = w * scale;
  const out = new Uint8Array(W * h * scale);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let sy = 0; sy < scale; sy++) {
      const orow = (y * scale + sy) * W;
      for (let x = 0; x < w; x++) {
        const v = indices[row + x];
        const ox = orow + x * scale;
        for (let sx = 0; sx < scale; sx++) out[ox + sx] = v;
      }
    }
  }
  return out;
}

export type GifOptions = {
  frames: Uint8Array[];
  width: number;
  height: number;
  palette: RGB[];
  /** Frame delay in milliseconds. */
  delay: number;
  scale: number;
  /** 0 is forever, which is the point of the tool. */
  loops?: number;
  onProgress?: (done: number, total: number) => void;
};

export async function encodeGif(opts: GifOptions): Promise<Blob> {
  const { frames, palette, delay, scale, loops = 0, onProgress } = opts;
  const w = opts.width * scale;
  const h = opts.height * scale;

  // The colour table has to be a power of two, at least two entries. The
  // palette is usually 2-12 colours, so most files carry a 4- or 16-entry
  // table and the unused slots are black.
  let tableBits = 1;
  while (1 << tableBits < palette.length) tableBits++;
  const tableSize = 1 << tableBits;
  // The size field in the descriptor is log2(size) - 1, so a 2-entry table is
  // 0. Code size has its own floor of 2 regardless.
  const sizeField = Math.max(0, tableBits - 1);
  const minCodeSize = Math.max(2, tableBits);

  const s = new ByteStream();
  s.ascii("GIF89a");
  s.short(w);
  s.short(h);
  s.byte(0x80 | (7 << 4) | sizeField); // global table, 8-bit colour resolution
  s.byte(0); // background index
  s.byte(0); // pixel aspect ratio: square

  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] ?? [0, 0, 0];
    s.byte(c[0]);
    s.byte(c[1]);
    s.byte(c[2]);
  }

  // NETSCAPE2.0 — the de facto standard for "loop forever". Without it a GIF
  // plays once and stops, which would make every export a disappointment.
  s.byte(0x21);
  s.byte(0xff);
  s.byte(11);
  s.ascii("NETSCAPE2.0");
  s.byte(3);
  s.byte(1);
  s.short(loops);
  s.byte(0);

  // Centiseconds, and never below 2: a delay of 0 or 1 is widely rewritten to
  // 10 by browsers, which would turn a 24fps loop into a slideshow.
  const cs = Math.max(2, Math.round(delay / 10));

  for (let i = 0; i < frames.length; i++) {
    s.byte(0x21); // graphic control extension
    s.byte(0xf9);
    s.byte(4);
    s.byte(0x04); // disposal 1: leave the frame in place, no transparency
    s.short(cs);
    s.byte(0);
    s.byte(0);

    s.byte(0x2c); // image descriptor
    s.short(0);
    s.short(0);
    s.short(w);
    s.short(h);
    s.byte(0); // no local table, not interlaced

    s.byte(minCodeSize);
    lzw(upscale(frames[i], opts.width, opts.height, scale), minCodeSize, s);

    onProgress?.(i + 1, frames.length);
    // Yield between frames. Encoding sixty frames of a 1000px GIF is seconds
    // of straight-line work, and without this the progress bar it reports to
    // would never paint.
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }

  s.byte(0x3b); // trailer
  const bytes = s.finish();
  return new Blob([bytes.buffer as ArrayBuffer], { type: "image/gif" });
}
