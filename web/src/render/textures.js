// Procedural canvas textures (no image assets), so renders look like a house
// rather than gray boxes. Cached by key; works in the headless renderer too.
import * as THREE from "three";

const cache = new Map();
const PX = 12; // pixels per foot on wall textures

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
function hashStr(str) {
  let h = 7;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(4, Math.round(w)); c.height = Math.max(4, Math.round(h));
  return [c, c.getContext("2d")];
}
function tex(key, make, repeat) {
  if (cache.has(key)) return cache.get(key);
  const c = make();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  cache.set(key, t);
  return t;
}
function noise(ctx, w, h, amount, seed, alpha = 0.08) {
  const r = rng(seed);
  for (let i = 0; i < amount; i++) {
    ctx.fillStyle = r() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}
const shade = (hex, k) => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
};

export const SIDING_COLORS = { wood: "#a47e57", stucco: "#e6dccb", fiber_cement: "#8d8f86" };
export const ROOF_COLORS = { asphalt: "#5b5e64", wood_shake: "#7d5a3c", tile: "#a8553b", metal: "#7f8a92" };

// One wall face: lap siding or stucco, stone/brick base, windows per story, garage door, front door.
export function wallTexture({ len, h, material, color, trim = "#f2f0ea", stories = 1, wainscot = "none", garage = null, door = null, seed = 1 }) {
  const key = JSON.stringify(arguments[0]);
  return tex(key, () => {
    const [c, ctx] = canvas(len * PX, h * PX);
    const W = c.width, H = c.height;
    ctx.fillStyle = color; ctx.fillRect(0, 0, W, H);
    if (material === "stucco") noise(ctx, W, H, W * H / 6, seed, 0.05);
    else {
      // Lap siding courses with a shadow line every ~7 in.
      for (let y = 0; y < H; y += PX * 0.6) { ctx.fillStyle = "rgba(0,0,0,0.16)"; ctx.fillRect(0, y, W, 2); ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(0, y + 2, W, 2); }
      if (material === "wood") noise(ctx, W, H, W * H / 10, seed, 0.06);
    }
    if (wainscot !== "none") {
      const bh = 3.5 * PX, r = rng(seed + 3);
      for (let y = H - bh; y < H; y += 10) for (let x = -(r() * 20); x < W; x += 14 + r() * 18) {
        const base = wainscot === "brick" ? "#8e4b3a" : "#8c8579";
        ctx.fillStyle = shade(base, 0.8 + r() * 0.4); ctx.fillRect(x, y, wainscot === "brick" ? 20 : 12 + r() * 14, 9);
      }
      ctx.fillStyle = trim; ctx.fillRect(0, H - bh - 3, W, 3);
    }
    // Belt trim between stories.
    const sh = H / stories;
    for (let s = 1; s < stories; s++) { ctx.fillStyle = trim; ctx.fillRect(0, H - s * sh - 2, W, 4); }
    const blocked = (x0, x1) => (garage && x1 > garage.x0 && x0 < garage.x1) || (door && x1 > door.x0 - 6 && x0 < door.x1 + 6);
    for (let s = 0; s < stories; s++) {
      const n = Math.max(1, Math.floor(len / 11));
      for (let i = 0; i < n; i++) {
        const cx = ((i + 0.5) / n) * W, ww = 3.2 * PX, wh = 4.2 * PX;
        if (s === 0 && blocked(cx - ww / 2, cx + ww / 2)) continue;
        const top = H - s * sh - sh * 0.72;
        ctx.fillStyle = trim; ctx.fillRect(cx - ww / 2 - 4, top - 4, ww + 8, wh + 8);
        const g = ctx.createLinearGradient(0, top, 0, top + wh);
        g.addColorStop(0, "#5d7186"); g.addColorStop(1, "#22303d");
        ctx.fillStyle = g; ctx.fillRect(cx - ww / 2, top, ww, wh);
        ctx.fillStyle = trim; ctx.fillRect(cx - 1.5, top, 3, wh); ctx.fillRect(cx - ww / 2, top + wh / 2 - 1.5, ww, 3);
        ctx.fillStyle = trim; ctx.fillRect(cx - ww / 2 - 8, top + wh + 4, ww + 16, 5);   // sill
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(cx - ww / 2 - 8, top + wh + 9, ww + 16, 2);
      }
    }
    if (garage) {
      const gh = 8 * PX, top = H - gh;
      ctx.fillStyle = trim; ctx.fillRect(garage.x0 - 5, top - 5, garage.x1 - garage.x0 + 10, gh + 5);
      ctx.fillStyle = "#d9d6cf"; ctx.fillRect(garage.x0, top, garage.x1 - garage.x0, gh);
      for (let y = top; y < H; y += gh / 4) { ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(garage.x0, y, garage.x1 - garage.x0, 2); }
      ctx.fillStyle = "rgba(40,55,70,0.75)"; ctx.fillRect(garage.x0 + 6, top + 8, garage.x1 - garage.x0 - 12, gh / 4 - 12);
    }
    if (door) {
      const dh = 7 * PX, top = H - dh;
      ctx.fillStyle = trim; ctx.fillRect(door.x0 - 5, top - 5, door.x1 - door.x0 + 10, dh + 5);
      ctx.fillStyle = "#3b2a20"; ctx.fillRect(door.x0, top, door.x1 - door.x0, dh);
      ctx.fillStyle = "#c9a54a"; ctx.fillRect(door.x1 - 8, top + dh / 2, 4, 4);
    }
    return c;
  });
}

export function roofTexture(material) {
  return tex(`roof:${material}`, () => {
    const [c, ctx] = canvas(256, 256);
    const base = ROOF_COLORS[material];
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    const r = rng(hashStr(material));
    if (material === "metal") {
      for (let x = 0; x < 256; x += 16) { ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(x, 0, 2, 256); }
    } else {
      const rowH = material === "tile" ? 18 : 12;
      for (let y = 0; y < 256; y += rowH) {
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0, y, 256, 2);
        for (let x = (y / rowH) % 2 ? 0 : 10; x < 256; x += 20) {
          ctx.fillStyle = shade(base, 0.85 + r() * 0.3); ctx.fillRect(x, y + 2, 18, rowH - 2);
        }
      }
      noise(ctx, 256, 256, 3000, 11, 0.07);
    }
    return c;
  }, true);
}

export function groundTexture(kind) {
  return tex(`ground:${kind}`, () => {
    const [c, ctx] = canvas(256, 256);
    const r = rng(hashStr(kind));
    const base = { grass: "#7a8763", driveway: "#b9b4ab", path: "#c2bbb0", patio: "#a59c90", street: "#3d3f42", bark: "#5a3a24", gravel: "#9a968e", dirt: "#7a6448" }[kind];
    ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256);
    const n = kind === "grass" ? 9000 : 5000;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = shade(base, 0.75 + r() * 0.5);
      const s = kind === "gravel" || kind === "bark" ? 2 + r() * 3 : 1 + r() * 2;
      ctx.fillRect(r() * 256, r() * 256, s, kind === "grass" ? s * 2 : s);
    }
    if (kind === "driveway" || kind === "path") { ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(0, 127, 256, 2); ctx.fillRect(127, 0, 2, 256); }
    return c;
  }, true);
}

export function boardsTexture(color, vertical = true) {
  return tex(`boards:${color}:${vertical}`, () => {
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128);
    const r = rng(hashStr(color));
    for (let i = 0; i < 128; i += 11) {
      ctx.fillStyle = shade(color, 0.85 + r() * 0.3);
      if (vertical) ctx.fillRect(i, 0, 10, 128); else ctx.fillRect(0, i, 128, 10);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      if (vertical) ctx.fillRect(i + 10, 0, 1, 128); else ctx.fillRect(0, i + 10, 128, 1);
    }
    return c;
  }, true);
}

// Gable end: board-and-batten siding with a small attic window near the middle.
export function gableTexture(color, trim = "#f1efe8") {
  return tex(`gable:${color}`, () => {
    const [c, ctx] = canvas(256, 128);
    ctx.fillStyle = shade(color, 0.92); ctx.fillRect(0, 0, 256, 128);
    for (let x = 0; x < 256; x += 10) { ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(x, 0, 2, 128); ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(x + 2, 0, 2, 128); }
    ctx.fillStyle = trim; ctx.fillRect(110, 50, 36, 34);
    const g = ctx.createLinearGradient(0, 54, 0, 80); g.addColorStop(0, "#5d7186"); g.addColorStop(1, "#22303d");
    ctx.fillStyle = g; ctx.fillRect(114, 54, 28, 26);
    ctx.fillStyle = trim; ctx.fillRect(127, 54, 2, 26);
    ctx.fillStyle = trim; ctx.fillRect(0, 122, 256, 6);
    return c;
  });
}

// Fine metal mesh (vent screens, gutter guards).
export function meshTexture() {
  return tex("mesh", () => {
    const [c, ctx] = canvas(64, 64);
    ctx.fillStyle = "#c9d0d4"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#4b5459";
    for (let y = 2; y < 64; y += 6) for (let x = (y / 6) % 2 ? 2 : 5; x < 64; x += 6) ctx.fillRect(x, y, 2.5, 2.5);
    return c;
  }, true);
}

export function latticeTexture() {
  return tex("lattice", () => {
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = "#3a3632"; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#d8d2c4"; ctx.lineWidth = 5;
    for (let i = -128; i < 256; i += 22) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + 128, 0); ctx.lineTo(i, 128); ctx.stroke(); }
    return c;
  }, true);
}

export function skyTexture() {
  return tex("sky", () => {
    const [c, ctx] = canvas(4, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#c4d6e3"); g.addColorStop(0.55, "#e6edf0"); g.addColorStop(1, "#f5f4ef");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    return c;
  });
}

export { hashStr, rng, shade };
