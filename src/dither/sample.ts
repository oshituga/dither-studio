/**
 * The plate the tool opens on.
 *
 * Drawn rather than shipped: a photograph would be a licence to track and a
 * megabyte to download, and the one thing that has to be true of the opening
 * image is that it dithers beautifully at two levels. That means a smooth,
 * wide tonal ramp with one hard edge in it — which is exactly a lit sphere
 * above a horizon, and is why every dithering demo since 1985 has been one.
 */
export function drawSamplePlate(): HTMLCanvasElement {
  const W = 1100;
  const H = 1375;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  // Sky: a long vertical ramp, dark at the top. Banding here is not a defect —
  // it is the thing being demonstrated.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0a0d16");
  sky.addColorStop(0.55, "#4a5570");
  sky.addColorStop(0.72, "#b9bfcd");
  sky.addColorStop(1, "#f6f3ee");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const cx = W * 0.5;
  const cy = H * 0.44;
  const r = W * 0.3;

  // Ground, with the horizon just under the sphere's centre.
  const ground = ctx.createLinearGradient(0, H * 0.7, 0, H);
  ground.addColorStop(0, "#151a26");
  ground.addColorStop(1, "#3c4354");
  ctx.fillStyle = ground;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);

  // The sphere: key light from the upper left, a terminator, and a lifted
  // shadow side from the bounce. Three stops is enough to give the dither
  // something to do across the whole range.
  const lit = ctx.createRadialGradient(cx - r * 0.42, cy - r * 0.45, r * 0.05, cx, cy, r * 1.05);
  lit.addColorStop(0, "#ffffff");
  lit.addColorStop(0.25, "#d8d2c8");
  lit.addColorStop(0.62, "#6a6f7d");
  lit.addColorStop(0.88, "#1d2230");
  lit.addColorStop(1, "#0d1119");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = lit;
  ctx.fill();

  // Contact shadow. Without it the sphere floats and the horizon reads as a
  // stripe behind it rather than a surface it is sitting on.
  const shade = ctx.createRadialGradient(cx, H * 0.72, r * 0.1, cx, H * 0.72, r * 1.4);
  shade.addColorStop(0, "rgba(0,0,0,0.75)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(cx, H * 0.725, r * 1.3, r * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  // A low sun behind, so the upper half is not an empty gradient.
  const glow = ctx.createRadialGradient(W * 0.78, H * 0.2, 0, W * 0.78, H * 0.2, W * 0.4);
  glow.addColorStop(0, "rgba(255,240,215,0.55)");
  glow.addColorStop(1, "rgba(255,240,215,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  return c;
}
