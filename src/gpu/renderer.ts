import { bayer, blueNoise, clusterDot, lineScreen, paintedMask, type Mask } from "../dither/masks";
import type { RGB } from "../dither/palettes";
import type { Source } from "../dither/render";
import type { AlgorithmId, Settings } from "../dither/types";
import { FRAGMENT, VERTEX } from "./shader";

/**
 * The live renderer.
 *
 * It exists for one reason: the CPU bakes a whole loop before anything moves,
 * which is right for export and wrong for a hand on a slider. This draws the
 * single frame you are looking at, now, at any grid size, and the bake keeps
 * running behind it. Once the bake lands the picture goes back to being the
 * CPU's — so what you settle on, and what you export, is always the exact one.
 *
 * Ordered kernels only. Error diffusion carries its error from pixel to pixel
 * in scan order, which is the one thing a fragment shader cannot do.
 */

/* Everything the shader can reproduce EXACTLY.
   Error diffusion is absent because it carries its error from pixel to pixel in
   scan order, which a fragment shader cannot do at all. Grain is absent for a
   subtler reason: interleaved gradient noise multiplies the pixel coordinate by
   0.0671 and takes the fractional part, and by the time the frame offset has
   pushed that product past 20 a single-precision float has already lost the
   digits the answer depends on. It is off by a few percent of pixels and cannot
   be fixed without float64, so it stays on the CPU where it is correct. */
const ORDERED: AlgorithmId[] = [
  "bayer2",
  "bayer4",
  "bayer8",
  "cluster",
  "lines",
  "blue",
  "custom",
];

export function canRunOnGpu(settings: Settings): boolean {
  return ORDERED.includes(settings.algorithm);
}

function maskFor(settings: Settings): Mask | null {
  switch (settings.algorithm) {
    case "custom":
      return paintedMask(settings.kernel);
    case "bayer2":
      return bayer(2);
    case "bayer4":
      return bayer(4);
    case "bayer8":
      return bayer(8);
    case "cluster":
      return clusterDot(8);
    case "lines":
      return lineScreen(8);
    case "blue":
      return blueNoise(64);
    default:
      return null; // grain, evaluated per pixel in the shader
  }
}

export class GpuDither {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private imageTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private maskKey = "";
  private sourceKey = "";

  readonly canvas: HTMLCanvasElement;

  readonly filtersFloats: boolean;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, linear: boolean) {
    this.canvas = canvas;
    this.gl = gl;
    this.filtersFloats = linear;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) ?? "shader failed to compile");
      }
      return sh;
    };

    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "program failed to link");
    }
    this.program = program;
    gl.useProgram(program);

    // One triangle covering the viewport. Two would share an edge, and the
    // seam is a classic source of a one-pixel line down the middle.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    this.imageTex = this.makeTexture(linear ? gl.LINEAR : gl.NEAREST);
    this.maskTex = this.makeTexture(gl.NEAREST);
    this.paletteTex = this.makeTexture(gl.NEAREST);
  }

  static create(): GpuDither | null {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2", {
        antialias: false,
        preserveDrawingBuffer: true,
        premultipliedAlpha: false,
      });
      if (!gl) return null;
      /* Float textures carry the prepared grid without a quantisation of their
         own, which would put the two renderers a level apart before the dither
         even ran. But WebGL2 core cannot FILTER a 32-bit float texture: without
         OES_texture_float_linear a LINEAR sampler leaves the texture
         incomplete, and sampling silently returns (0,0,0,1) — which reads as
         "every pixel is pure white" and is exactly what the first version of
         this did. Where the extension is missing the sampler drops to NEAREST,
         which is identical for every unwarped pixel because those sample texel
         centres exactly, and slightly harder-edged under wave, ripple and
         swirl. */
      const linear = Boolean(gl.getExtension("OES_texture_float_linear"));
      return new GpuDither(canvas, gl, linear);
    } catch {
      return null;
    }
  }

  private makeTexture(filter: number) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private u(name: string) {
    if (!this.uniforms.has(name)) {
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    }
    return this.uniforms.get(name)!;
  }

  /** Upload the prepared grid: rgb in the colour channels, luminance in alpha
      so the shader never has to recompute it with weights of its own. */
  private uploadSource(source: Source, key: string) {
    if (key === this.sourceKey) return;
    const gl = this.gl;
    const { width: w, height: h } = source;
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = source.rgb[i * 3];
      data[i * 4 + 1] = source.rgb[i * 3 + 1];
      data[i * 4 + 2] = source.rgb[i * 3 + 2];
      data[i * 4 + 3] = source.lum[i];
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    this.sourceKey = key;
  }

  private uploadMask(settings: Settings) {
    const mask = maskFor(settings);
    const key = `${settings.algorithm}:${settings.algorithm === "custom" ? settings.kernel.join("") : ""}`;
    if (key === this.maskKey) return mask;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    if (mask) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, mask.size, mask.size, 0, gl.RED, gl.FLOAT, mask.data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
    }
    this.maskKey = key;
    return mask;
  }

  private uploadPalette(palette: RGB[]) {
    const gl = this.gl;
    const data = new Uint8Array(palette.length * 4);
    palette.forEach((c, i) => {
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 255;
    });
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, palette.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /**
   * Draw one frame. `sourceKey` tells it when the prepared grid has changed —
   * uploading a megabyte of floats on every frame of playback would cost more
   * than the dither it is accelerating.
   */
  render(
    source: Source,
    sourceKey: string,
    settings: Settings,
    frame: number,
    levels: number,
    colour: boolean,
    palette: RGB[],
  ) {
    const gl = this.gl;
    const { width: w, height: h } = source;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);

    this.uploadSource(source, sourceKey);
    const mask = this.uploadMask(settings);
    this.uploadPalette(palette);

    gl.uniform1i(this.u("uImage"), 0);
    gl.uniform1i(this.u("uMask"), 1);
    gl.uniform1i(this.u("uPalette"), 2);

    const TAU = Math.PI * 2;
    const t = (frame % settings.frames) / settings.frames;
    const phase = TAU * settings.cycles * t;
    const m = Math.max(0, settings.motionScale) / 100;

    const rad = (settings.driftAngle * Math.PI) / 180;
    const maskSize = mask ? mask.size : 1;
    const tilesX = Math.round(settings.drift * m * Math.cos(rad));
    const tilesY = Math.round(settings.drift * m * Math.sin(rad));

    const L = Math.max(1, levels - 1);
    const pulseAmp = ((settings.pulse * m) / 100) * 0.35;

    gl.uniform2i(this.u("uGrid"), w, h);
    gl.uniform1i(this.u("uMaskSize"), mask ? mask.size : 0);
    gl.uniform2i(
      this.u("uMaskOffset"),
      Math.round(t * tilesX * maskSize),
      Math.round(t * tilesY * maskSize),
    );
    gl.uniform1i(this.u("uPaletteSize"), palette.length);

    gl.uniform1f(this.u("uExposure"), settings.exposure / 100 + pulseAmp * Math.sin(phase));
    gl.uniform1f(this.u("uContrast"), 1 + settings.contrast / 100);
    gl.uniform1f(this.u("uGamma"), Math.pow(2, -settings.midtone / 100));
    gl.uniform1i(this.u("uInvert"), settings.invert ? 1 : 0);
    gl.uniform1i(this.u("uColour"), colour ? 1 : 0);

    gl.uniform1f(this.u("uLevels"), L);
    gl.uniform1f(this.u("uSpread"), (settings.spread / 100) * (1 / L));
    gl.uniform1f(this.u("uShimmer"), ((settings.shimmer * m) / 100) * 0.5);
    gl.uniform1f(this.u("uScan"), ((settings.scan * m) / 100) * 0.55);
    gl.uniform1f(this.u("uT"), t);

    gl.uniform1f(this.u("uWaveAmp"), ((settings.wave * m) / 100) * (w * 0.08));
    gl.uniform1f(this.u("uWaveLen"), Math.max(4, settings.waveScale));
    gl.uniform1f(this.u("uRippleAmp"), ((settings.ripple * m) / 100) * (w * 0.06));
    gl.uniform1f(this.u("uRippleLen"), Math.max(4, settings.rippleScale));
    gl.uniform1f(this.u("uSwirlAmp"), ((settings.swirl * m) / 100) * 0.9);
    gl.uniform1f(this.u("uPhase"), phase);
    gl.uniform1i(this.u("uFrame"), frame);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
