import { createCanvas } from "canvas";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..");

function drawIcon(size) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  const r = size * 0.18;

  // Red rounded-rect background
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, r);
  ctx.fill();

  // White map-pin teardrop
  const cx = size / 2, cy = size * 0.38, pr = size * 0.22;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx, cy, pr, Math.PI, 0);   // top semicircle
  ctx.lineTo(cx, size * 0.72);        // point
  ctx.closePath();
  ctx.fill();

  // Red hole in pin
  ctx.fillStyle = "#e63946";
  ctx.beginPath();
  ctx.arc(cx, cy, pr * 0.42, 0, Math.PI * 2);
  ctx.fill();

  return c.toBuffer("image/png");
}

for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["icon-192.png",         192],
  ["icon-512.png",         512],
]) {
  writeFileSync(join(outDir, name), drawIcon(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
