import * as THREE from "three";
import { windVectors } from "../sim/embers.js";

// Elevated three-quarter view from the side of the wind, so embers visibly
// stream across the frame toward the house.
export function overviewCamera(spec, windFrom, aspect, orbitDeg = 0) {
  const { from, side } = windVectors(windFrom);
  const r = Math.max(spec.house.w, spec.house.d) * 0.95 + 32;
  const cam = new THREE.PerspectiveCamera(48, aspect, 0.5, 1500);
  const bx = side[0] + from[0] * 0.45, bz = side[1] + from[1] * 0.45;
  const a = (orbitDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  cam.position.set((bx * ca - bz * sa) * r, r * 0.5, (bx * sa + bz * ca) * r);
  cam.lookAt(0, 5, 0);
  return cam;
}

// Pill labels for hazards (red) and fixes (green), drawn onto a 2D canvas.
export function drawMarkers(ctx, labels, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "600 15px system-ui, sans-serif";
  for (const l of labels) {
    const w = ctx.measureText(l.text).width + 16, h = 24;
    const x = Math.min(Math.max(4, l.x - w / 2), ctx.canvas.width - w - 4), y = l.y - h / 2;
    const col = l.type === "fix" ? "rgba(22,120,70,0.92)" : "rgba(190,40,20,0.92)";
    // Leader line from the label to the object it points at.
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(l.x, y + h); ctx.lineTo(l.ax, l.ay); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(l.ax, l.ay, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(l.text, x + 8, y + 17);
  }
  ctx.restore();
}

export function drawHud(canvas, lines) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (typeof lines === "string") lines = [lines];
  ctx.font = "600 18px system-ui, sans-serif";
  const hgt = 26 * lines.length + 14;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, canvas.width, hgt);
  lines.forEach((l, i) => {
    ctx.fillStyle = l.startsWith("HOUSE") ? "#ff6a3d" : "#fff";
    ctx.fillText(l, 14, 30 + i * 26);
  });
}
