/**
 * The per-frame dither, as a fragment shader.
 *
 * A port of the inner loop of src/dither/render.ts, and it has to stay one: the
 * CPU renderer writes every exported file, so anywhere these disagree the
 * preview is lying about the result.
 *
 * It deliberately starts further down the pipeline than the CPU function does.
 * The image it samples is the PREPARED source — already reduced to the working
 * grid and already sharpened — because those two steps happen once per settings
 * change rather than once per frame, and because reproducing them here would
 * mean matching a multi-step box reduction with bilinear taps. That is not a
 * translation, it is an approximation, and it would put a visible difference
 * between what is on screen and what gets saved.
 *
 * So: the host uploads the prepared grid, and the shader does exactly what the
 * per-pixel part of renderFrame does — warp, tone, threshold, quantise, map.
 */

export const VERTEX = `#version 300 es
in vec2 pos;
out vec2 uv;
void main() {
  // Y is flipped here, once. A framebuffer's first row is its bottom one and a
  // texture's first row is the top of the uploaded array, so without this the
  // preview is the export upside down — which is exactly the kind of thing that
  // survives a casual look at a symmetrical test image.
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

in vec2 uv;
out vec4 frag;

uniform sampler2D uImage;    // prepared source at grid size: rgb, plus lum in a
uniform sampler2D uMask;     // threshold tile, one value per texel in .r
uniform sampler2D uPalette;  // the ramp the host built, N x 1
uniform ivec2 uGrid;
uniform int uMaskSize;       // 0 means "no tile": evaluate grain instead
uniform ivec2 uMaskOffset;
uniform int uPaletteSize;

uniform float uExposure;     // already carries the breathing term
uniform float uContrast;
uniform float uGamma;
uniform bool  uInvert;
uniform bool  uColour;

uniform float uLevels;       // L = levels - 1
uniform float uSpread;
uniform float uShimmer;
uniform float uScan;
uniform float uT;

uniform float uWaveAmp;
uniform float uWaveLen;
uniform float uRippleAmp;
uniform float uRippleLen;
uniform float uSwirlAmp;
uniform float uPhase;
uniform int   uFrame;

const float TAU = 6.283185307179586;

/* The CPU hashes position and frame with these constants and 32-bit wrapping.
   Unsigned throughout, because JavaScript's '>>>' is a LOGICAL shift and
   GLSL's '>>' on a signed int is an ARITHMETIC one — on any negative
   intermediate the two fill the top bits differently and the shimmer stops
   matching the export. Unsigned overflow is also well defined here, where
   signed overflow is not. */
float hashNoise(int x, int y, int z) {
  uint h = uint(x * 374761393 + y * 668265263 + z * 1274126177);
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}

/* Present for completeness; the host keeps grain off this path. The constants
   are tuned for double precision and a single-precision fract() of a number
   around 20 has already lost the digits the result depends on. */
float ign(float x, float y) {
  return fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y));
}

/* Bilinear with edge clamp, addressed in grid pixels — the warp is expressed
   in grid pixels on the CPU, so both must agree what "one across" means. */
vec4 sampleGrid(vec2 g) {
  vec2 c = clamp(g, vec2(0.0), vec2(uGrid) - 1.0);
  return texture(uImage, (c + 0.5) / vec2(uGrid));
}

vec2 warp(vec2 g) {
  vec2 s = g;
  vec2 c = (vec2(uGrid) - 1.0) * 0.5;
  if (uWaveAmp > 0.0) {
    s.x += uWaveAmp * sin(TAU * (g.y / uWaveLen) + uPhase);
    s.y += uWaveAmp * 0.35 * cos(TAU * (g.x / uWaveLen) + uPhase);
  }
  if (uRippleAmp > 0.0) {
    vec2 d = g - c;
    float r = max(length(d), 0.0001);
    s += (d / r) * (uRippleAmp * sin(TAU * (r / uRippleLen) - uPhase));
  }
  if (uSwirlAmp > 0.0) {
    vec2 d = g - c;
    float maxR = max(length(c), 1.0);
    float a = uSwirlAmp * (1.0 - length(d) / maxR) * sin(uPhase);
    float cs = cos(a), sn = sin(a);
    s = c + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
  }
  return s;
}

float tone(float v, float y) {
  float o = v;
  if (uScan > 0.0) {
    float d = abs(mod(y / float(uGrid.y) - uT + 1.5, 1.0) - 0.5);
    o += uScan * exp(-(d * d) / 0.006);
  }
  o = clamp((o - 0.5) * uContrast + 0.5 + uExposure, 0.0, 1.0);
  if (uGamma != 1.0) o = pow(o, uGamma);
  return uInvert ? 1.0 - o : o;
}

float threshold(ivec2 p) {
  if (uMaskSize == 0) {
    return ign(float(p.x + uMaskOffset.x + uFrame * 13), float(p.y + uMaskOffset.y + uFrame * 7));
  }
  int mx = (p.x + uMaskOffset.x) % uMaskSize;
  int my = (p.y + uMaskOffset.y) % uMaskSize;
  if (mx < 0) mx += uMaskSize;
  if (my < 0) my += uMaskSize;
  return texelFetch(uMask, ivec2(mx, my), 0).r;
}

/* JavaScript's Math.round is half-up; GLSL's round() is
   implementation-defined at exactly .5. floor(x + 0.5) is half-up everywhere,
   which is the one that matches. */
float roundHalfUp(float x) { return floor(x + 0.5); }

void main() {
  ivec2 p = ivec2(floor(uv * vec2(uGrid)));
  vec2 g = vec2(p);
  vec4 texel = sampleGrid(warp(g));

  float th = threshold(p);
  if (uShimmer > 0.0) th += uShimmer * (hashNoise(p.x, p.y, uFrame) - 0.5);
  float bias = (th - 0.5) * uSpread * uLevels;

  if (uColour) {
    // The colour palette is the levels-cubed cube, so the quantised position
    // IS the colour and no lookup is needed.
    vec3 q = vec3(
      clamp(roundHalfUp((tone(texel.r, g.y) + bias) * uLevels), 0.0, uLevels),
      clamp(roundHalfUp((tone(texel.g, g.y) + bias) * uLevels), 0.0, uLevels),
      clamp(roundHalfUp((tone(texel.b, g.y) + bias) * uLevels), 0.0, uLevels)
    );
    frag = vec4(q / uLevels, 1.0);
  } else {
    // Luminance was computed on the CPU during preparation and travels in the
    // alpha channel, so the two renderers cannot disagree about the weights.
    float v = tone(texel.a, g.y);
    float q = clamp(roundHalfUp((v + bias) * uLevels), 0.0, uLevels);
    frag = vec4(texelFetch(uPalette, ivec2(int(q), 0), 0).rgb, 1.0);
  }
}`;
