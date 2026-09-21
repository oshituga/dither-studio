/**
 * Threshold masks — the tiled field of values every ordered dither compares
 * against.
 *
 * All of them are returned as a flat Float32Array of size n*n holding values in
 * [0,1), and every one is built once and cached. They are the difference
 * between the algorithms in the picker: the dithering code is identical for a
 * Bayer matrix, a halftone screen and a blue-noise mask, and only the field
 * changes.
 */

const cache = new Map<string, { size: number; data: Float32Array }>();

export type Mask = { size: number; data: Float32Array };

function memo(key: string, build: () => Mask): Mask {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = build();
  cache.set(key, made);
  return made;
}

/**
 * Bayer / recursive dispersed dot. The classic crosshatch.
 *
 * Built by recursion rather than typed out: the 8x8 matrix is 64 numbers that
 * are easy to get subtly wrong, and the recurrence is the definition anyway.
 */
export function bayer(n: 2 | 4 | 8 | 16): Mask {
  return memo(`bayer${n}`, () => {
    let m = [[0, 2], [3, 1]];
    while (m.length < n) {
      const s = m.length;
      const next: number[][] = Array.from({ length: s * 2 }, () => new Array(s * 2).fill(0));
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const v = m[y][x] * 4;
          next[y][x] = v;
          next[y][x + s] = v + 2;
          next[y + s][x] = v + 3;
          next[y + s][x + s] = v + 1;
        }
      }
      m = next;
    }
    const data = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) data[y * n + x] = m[y][x] / (n * n);
    }
    return { size: n, data };
  });
}

/**
 * Clustered dot — a halftone screen. Dots grow from the centre of each cell
 * outward, which is what print does and what Bayer deliberately does not.
 *
 * The 45-degree rotation is why it reads as a newspaper rather than a grid:
 * an unrotated screen lines its dots up with the pixel rows and the eye picks
 * out the rows instead of the tone.
 */
export function clusterDot(n = 8): Mask {
  return memo(`cluster${n}`, () => {
    const data = new Float32Array(n * n);
    const c = (n - 1) / 2;
    const cells: { i: number; d: number }[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        // Rotate the sampling coordinates 45 degrees about the cell centre.
        const dx = x - c;
        const dy = y - c;
        const rx = (dx + dy) * Math.SQRT1_2;
        const ry = (dy - dx) * Math.SQRT1_2;
        cells.push({ i: y * n + x, d: Math.hypot(rx, ry) });
      }
    }
    cells.sort((a, b) => a.d - b.d);
    cells.forEach((cell, rank) => {
      data[cell.i] = rank / cells.length;
    });
    return { size: n, data };
  });
}

/** A line screen. Tone becomes stripe weight — the engraving look. */
export function lineScreen(n = 8): Mask {
  return memo(`lines${n}`, () => {
    const data = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        // Diagonal, for the same reason the halftone screen is rotated.
        const v = ((x + y) % n) / n;
        data[y * n + x] = v;
      }
    }
    return { size: n, data };
  });
}

/**
 * Blue noise, built with void-and-cluster (Ulichney, 1993).
 *
 * This is the one mask that costs something to make — roughly 16M operations
 * for a 64x64 tile — so it is built lazily on first use and cached for the
 * session. It is worth it: blue noise has no visible structure at all, which
 * means an animated blue-noise dither shimmers like film grain instead of
 * crawling like a grid, and it is the only mask here that stays clean when the
 * loop is played back fast.
 *
 * The algorithm: scatter a binary pattern, then repeatedly move the point in
 * the tightest cluster into the largest void until the pattern is
 * evenly spread. Ranking every pixel by when it enters or leaves that pattern
 * produces a threshold mask whose every level is itself blue noise.
 */
export function blueNoise(n = 64): Mask {
  return memo(`blue${n}`, () => {
    const N = n * n;
    const binary = new Uint8Array(N);
    const energy = new Float32Array(N);

    // Gaussian of sigma 1.5, as the paper specifies. Precomputed over a 9x9
    // window: past that the weight is under 0.0002 and contributes nothing but
    // work.
    const R = 4;
    const sigma = 1.5;
    const kernel: number[] = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        kernel.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
      }
    }

    const splat = (index: number, sign: number) => {
      const px = index % n;
      const py = (index / n) | 0;
      let k = 0;
      for (let dy = -R; dy <= R; dy++) {
        const y = (py + dy + n) % n;
        for (let dx = -R; dx <= R; dx++, k++) {
          const x = (px + dx + n) % n;
          energy[y * n + x] += sign * kernel[k];
        }
      }
    };

    // Deterministic start. A Math.random() seed would give a different mask on
    // every reload, and two renders of the same settings must be identical or
    // the exported GIF does not match the preview.
    let seed = 0x9e3779b9;
    const rand = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 1000000) / 1000000;
    };

    const initial = Math.max(1, Math.round(N * 0.1));
    let placed = 0;
    while (placed < initial) {
      const i = Math.floor(rand() * N);
      if (binary[i]) continue;
      binary[i] = 1;
      splat(i, 1);
      placed++;
    }

    const tightestCluster = () => {
      let best = -1;
      let bestE = -Infinity;
      for (let i = 0; i < N; i++) {
        if (binary[i] && energy[i] > bestE) {
          bestE = energy[i];
          best = i;
        }
      }
      return best;
    };

    const largestVoid = () => {
      let best = -1;
      let bestE = Infinity;
      for (let i = 0; i < N; i++) {
        if (!binary[i] && energy[i] < bestE) {
          bestE = energy[i];
          best = i;
        }
      }
      return best;
    };

    // Phase 1 — settle the initial pattern.
    for (;;) {
      const c = tightestCluster();
      binary[c] = 0;
      splat(c, -1);
      const v = largestVoid();
      if (v === c) {
        binary[c] = 1;
        splat(c, 1);
        break;
      }
      binary[v] = 1;
      splat(v, 1);
    }

    const rank = new Int32Array(N).fill(-1);
    const snapshot = binary.slice();
    const snapEnergy = energy.slice();

    // Phase 2 — rank the points already in the pattern, removing the tightest
    // cluster each time, counting down.
    for (let r = placed - 1; r >= 0; r--) {
      const c = tightestCluster();
      binary[c] = 0;
      splat(c, -1);
      rank[c] = r;
    }

    // Phase 3 — the rest, filling the largest void each time, counting up.
    binary.set(snapshot);
    energy.set(snapEnergy);
    for (let r = placed; r < N; r++) {
      const v = largestVoid();
      binary[v] = 1;
      splat(v, 1);
      rank[v] = r;
    }

    const data = new Float32Array(N);
    for (let i = 0; i < N; i++) data[i] = rank[i] / N;
    return { size: n, data };
  });
}

/**
 * A mask from painted values.
 *
 * Not cached by content — the whole point is that it changes while a finger is
 * on it — but building one is 64 divisions, so there is nothing to cache.
 * Values arrive as 0..35 because that is one base-36 character each in a
 * shareable link, and 36 levels of threshold is finer than the eye can follow
 * across an 8x8 tile.
 */
export function paintedMask(values: number[], size = 8): Mask {
  const data = new Float32Array(size * size);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.min(35, Math.max(0, values[i] ?? 0)) / 36;
  }
  return { size, data };
}

/**
 * Interleaved gradient noise (Jimenez, 2014).
 *
 * Not a tile — it is evaluated per pixel — so it is exposed as a function
 * rather than a mask. Cheap, and its structure is fine enough to read as grain
 * while still being stable frame to frame, which is what separates it from
 * plain white noise.
 */
export function ign(x: number, y: number): number {
  const v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1);
  return v % 1;
}

/** White noise, hashed from position and frame so it is repeatable. */
export function hashNoise(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
