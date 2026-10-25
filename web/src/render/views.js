import * as THREE from "three";
import { windVectors } from "../sim/embers.js";

// Elevated three-quarter view from the side of the wind, so embers visibly
// stream across the frame toward the house.
export function overviewCamera(spec, windFrom, aspect) {
  const { from, side } = windVectors(windFrom);
  const r = Math.max(spec.house.w, spec.house.d) * 1.6 + 50;
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.5, 1000);
  cam.position.set(side[0] * r + from[0] * r * 0.45, r * 0.75, side[1] * r + from[1] * r * 0.45);
  cam.lookAt(0, 4, 0);
  return cam;
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
