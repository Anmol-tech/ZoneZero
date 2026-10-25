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

const PIN = { risk: "#d63a1c", fix: "#17855a" };

// Small numbered pins at hazard/fix locations. The highlighted group also gets
// its full label beside each of its pins.
export function drawPins(ctx, pins, { highlight = null, alpha = 1, labels = false } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  // Draw the highlighted group last so it sits on top.
  const ordered = [...pins].sort((a, b) => (a.key === highlight) - (b.key === highlight));
  for (const p of ordered) {
    const hot = p.key === highlight, r = hot ? 12 : p.behind ? 6 : 9;
    ctx.globalAlpha = (highlight && !hot ? 0.45 : 1) * (p.behind && !hot ? 0.35 : 1) * alpha;
    ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 4;
    ctx.fillStyle = PIN[p.type];
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${hot ? 12 : 10}px system-ui, sans-serif`;
    if (!p.behind || hot) ctx.fillText(p.type === "fix" ? "✓" : String(p.n), p.x, p.y + 0.5);
    if (hot || (labels && !p.behind)) {
      ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "left";
      const text = p.label, w = ctx.measureText(text).width + 14;
      const x = Math.min(p.x + 16, ctx.canvas.width / (window.devicePixelRatio || 1) - w - 4);
      ctx.fillStyle = "rgba(14,18,22,0.88)";
      ctx.beginPath(); ctx.roundRect(x, p.y - 11, w, 22, 6); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(text, x + 7, p.y + 0.5);
      ctx.textAlign = "center";
    }
  }
  ctx.restore();
}

// Minimized legend for recorded videos: just the hazard / fix counts.
export function drawLegendChip(ctx, groups, x, yBottom) {
  const risks = groups.filter((g) => g.type === "risk").length, fixes = groups.length - risks;
  const parts = [[risks, "risk", `hazard${risks === 1 ? "" : "s"}`], [fixes, "fix", `fix${fixes === 1 ? "" : "es"}`]].filter(([n]) => n);
  if (!parts.length) return;
  ctx.save();
  ctx.font = "600 12px system-ui, sans-serif"; ctx.textBaseline = "middle";
  const w = parts.reduce((sum, [n, , word]) => sum + 30 + ctx.measureText(`${n} ${word}`).width, 10);
  const h = 26, y = yBottom - h;
  ctx.fillStyle = "rgba(14,18,22,0.78)"; ctx.beginPath(); ctx.roundRect(x, y, w, h, 13); ctx.fill();
  let cx = x + 10;
  for (const [n, type, word] of parts) {
    ctx.fillStyle = PIN[type]; ctx.beginPath(); ctx.arc(cx + 7, y + h / 2, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "700 9px system-ui, sans-serif"; ctx.fillText(type === "fix" ? "✓" : "!", cx + 7, y + h / 2 + 0.5);
    ctx.textAlign = "left"; ctx.font = "600 12px system-ui, sans-serif"; ctx.fillText(`${n} ${word}`, cx + 18, y + h / 2 + 0.5);
    cx += 30 + ctx.measureText(`${n} ${word}`).width;
  }
  ctx.restore();
}

// Compact legend panel for recorded videos (the live viewer uses an HTML legend).
export function drawLegend(ctx, groups, x, yBottom, alpha = 1) {
  const rows = groups.slice(0, 9);
  const more = groups.length - rows.length;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "600 12px system-ui, sans-serif";
  const lineH = 19, pad = 8;
  const w = Math.max(...rows.map((g) => ctx.measureText(`${g.label}${g.positions.length > 1 ? `  ×${g.positions.length}` : ""}`).width), 80) + 40;
  const h = rows.length * lineH + pad * 2 + (more > 0 ? lineH : 0);
  const y0 = yBottom - h;
  ctx.fillStyle = "rgba(14,18,22,0.78)";
  ctx.beginPath(); ctx.roundRect(x, y0, w, h, 8); ctx.fill();
  rows.forEach((g, i) => {
    const cy = y0 + pad + i * lineH + lineH / 2;
    ctx.fillStyle = PIN[g.type];
    ctx.beginPath(); ctx.arc(x + 16, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "700 9px system-ui, sans-serif"; ctx.fillText(g.type === "fix" ? "✓" : String(g.n), x + 16, cy + 0.5);
    ctx.textAlign = "left"; ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText(g.label, x + 30, cy + 0.5);
    if (g.positions.length > 1) { ctx.fillStyle = "#9fb0ba"; ctx.fillText(`×${g.positions.length}`, x + 34 + ctx.measureText(g.label).width, cy + 0.5); }
  });
  if (more > 0) { ctx.fillStyle = "#9fb0ba"; ctx.fillText(`+${more} more`, x + 30, y0 + pad + rows.length * lineH + lineH / 2); }
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
