/**
 * Rasterize grouped ink strokes into the normalized RGB strip the recognizer
 * consumes: model input height is 48 px, width scales with aspect ratio.
 */
import type { InkLine, InkLineImage } from "./types";

const MODEL_H = 48;
const MAX_W = 3200;
const PAD = 10;

export function renderLineToImage(line: InkLine): InkLineImage {
  const w = Math.max(1, line.maxX - line.minX);
  const h = Math.max(1, line.maxY - line.minY);
  // render at up to 2× model height for quality, then downscale
  const scale = Math.min(4, 96 / h) * (MODEL_H / 48);
  const cw = Math.max(1, Math.ceil((w + PAD * 2) * scale));
  const ch = Math.max(1, Math.ceil((h + PAD * 2) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.translate(PAD * scale - line.minX * scale, PAD * scale - line.minY * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#101018";
  // stroke width expressed in *final* pixels: canvas content shrinks by
  // MODEL_H/ch — a ≥3px floor keeps thin pen strokes visible to the model
  const lwFloor = 3 * (ch / MODEL_H);
  for (const s of line.strokes) {
    const lw = Math.max(lwFloor, s.strokeWidth * scale * 1.1);
    ctx.lineWidth = lw;
    const pts = s.points;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * scale, pts[0][1] * scale, lw / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#101018";
      ctx.fill();
      continue;
    }
    // average pressure widens the stroke a touch — closer to real ink
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = ((pts[i][0] + pts[i + 1][0]) / 2) * scale;
      const my = ((pts[i][1] + pts[i + 1][1]) / 2) * scale;
      ctx.quadraticCurveTo(pts[i][0] * scale, pts[i][1] * scale, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0] * scale, pts[pts.length - 1][1] * scale);
    ctx.stroke();
  }
  // downscale to model height
  const nh = MODEL_H;
  const nw = Math.min(MAX_W, Math.max(10, Math.round((cw * nh) / ch)));
  const small = document.createElement("canvas");
  small.width = nw;
  small.height = nh;
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas, 0, 0, nw, nh);
  const rgba = sctx.getImageData(0, 0, nw, nh).data;
  const rgb = new Uint8Array(nw * nh * 3);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgb[i] = rgba[j];
    rgb[i + 1] = rgba[j + 1];
    rgb[i + 2] = rgba[j + 2];
  }
  return { pixels: rgb.buffer, width: nw, height: nh };
}
