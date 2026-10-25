// Procedural props for kit.object: furniture, grills, bins, tanks, planters. Units are feet,
// each prop sits on y = 0 centered at the origin with its front facing +z (rot turns it).
import * as THREE from "three";
import { shade } from "./textures.js";

const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
const hex = (c) => (typeof c === "number" ? `#${c.toString(16).padStart(6, "0")}` : c);

function box(g, m, w, h, d, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y + h / 2, z); g.add(b); return b;
}
function cyl(g, m, r1, r2, h, x = 0, y = 0, z = 0, seg = 12) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); c.position.set(x, y + h / 2, z); g.add(c); return c;
}
const legs = (g, m, w, d, h, r = 0.08, inset = 0.15) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, m, r, r, h, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), 6);
};

// Frame material plus a softer cushion tone, from the object's material or an explicit color.
function palette(material, color, base) {
  const frame = color ? hex(color) : hex(base[material]);
  const soft = material === "fabric" || material === "wicker" ? shade(frame, 1.25) : "#e9e4d8";
  const opts = material === "metal" ? { metalness: 0.6, roughness: 0.4 } : {};
  return { frame: M(frame, opts), cushion: M(soft, { roughness: 0.95 }), dark: M("#2b2d2f", { metalness: 0.5, roughness: 0.45 }) };
}

const BUILD = {
  chair(g, p) {
    legs(g, p.frame, 1.7, 1.7, 1.4, 0.06);
    box(g, p.frame, 1.8, 0.12, 1.8, 0, 1.4);
    box(g, p.cushion, 1.6, 0.2, 1.6, 0, 1.52);
    const back = box(g, p.frame, 1.8, 1.7, 0.12, 0, 1.5, -0.85); back.rotation.x = -0.12;
  },
  lounge_chair(g, p) {
    box(g, p.frame, 2.7, 1.1, 2.7, 0, 0.15);
    legs(g, p.dark, 2.6, 2.6, 0.15, 0.07);
    box(g, p.cushion, 2.1, 0.4, 2.1, 0, 1.25, 0.15);
    box(g, p.frame, 2.7, 1.3, 0.45, 0, 1.25, -1.12);
    box(g, p.cushion, 2.1, 1.0, 0.35, 0, 1.6, -0.75);
    for (const sx of [-1, 1]) box(g, p.frame, 0.35, 0.65, 2.7, sx * 1.17, 1.25);
  },
  sofa(g, p) {
    box(g, p.frame, 6.6, 1.1, 2.9, 0, 0.15);
    legs(g, p.dark, 6.5, 2.8, 0.15, 0.07);
    for (const i of [-1, 0, 1]) box(g, p.cushion, 1.85, 0.4, 2.1, i * 1.9, 1.25, 0.2);
    box(g, p.frame, 6.6, 1.4, 0.5, 0, 1.25, -1.2);
    for (const i of [-1, 0, 1]) { const c = box(g, p.cushion, 1.85, 1.1, 0.35, i * 1.9, 1.6, -0.8); c.rotation.x = -0.1; }
    for (const sx of [-1, 1]) box(g, p.frame, 0.4, 0.7, 2.9, sx * 3.1, 1.25);
  },
  table(g, p) {
    box(g, p.frame, 6, 0.15, 3.2, 0, 2.35);
    legs(g, p.frame, 5.6, 2.8, 2.35, 0.09, 0.2);
  },
  coffee_table(g, p) {
    box(g, p.frame, 3.6, 0.15, 2, 0, 1.2);
    box(g, p.frame, 3.2, 0.1, 1.6, 0, 0.35);
    legs(g, p.frame, 3.4, 1.8, 1.2, 0.07);
  },
  dining_set(g, p) {
    BUILD.table(g, p);
    const seats = [[-1.8, 2.3, 0], [0, 2.3, 0], [1.8, 2.3, 0], [-1.8, -2.3, Math.PI], [0, -2.3, Math.PI], [1.8, -2.3, Math.PI]];
    for (const [x, z, a] of seats) {
      const c = new THREE.Group(); BUILD.chair(c, p);
      c.position.set(x, 0, z); c.rotation.y = a + Math.PI; c.scale.setScalar(0.9); g.add(c);
    }
  },
  bench(g, p) {
    for (let i = 0; i < 3; i++) box(g, p.frame, 5, 0.12, 0.42, 0, 1.45, -0.5 + i * 0.5);
    legs(g, p.frame, 4.6, 1.3, 1.45, 0.1, 0.1);
  },
  grill(g, p) {
    const steel = M("#9aa1a6", { metalness: 0.75, roughness: 0.3 });
    box(g, p.dark, 2.8, 2.3, 1.9, 0, 0.25);
    for (const sx of [-1, 1]) cyl(g, p.dark, 0.25, 0.25, 0.12, sx * 1.1, 0, 0.7, 10);
    box(g, steel, 3, 0.25, 2, 0, 2.55);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 16, 1, false, 0, Math.PI), steel);
    lid.rotation.z = Math.PI / 2; lid.position.set(0, 2.8, 0); lid.scale.set(1, 1, 0.95); g.add(lid);
    box(g, steel, 1.2, 0.08, 1.8, 2.1, 2.5);
    box(g, p.dark, 1.6, 0.12, 0.12, 0, 3.4, 1);
  },
  umbrella(g, p) {
    cyl(g, p.dark, 0.9, 1, 0.3);
    cyl(g, p.dark, 0.06, 0.06, 7.2, 0, 0.3, 0, 8);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(4.5, 1.4, 8, 1, true), M(shade(hex(p.frame.color.getHex()), 1.15), { side: THREE.DoubleSide, roughness: 0.95 }));
    canopy.position.y = 7.1; g.add(canopy);
  },
};

const ITEMS = Object.keys(BUILD);
export const FURNITURE_ITEMS = ITEMS;

// Returns a THREE.Group for one kit.object.
export function propMesh(o, base, seed = 0) {
  const g = new THREE.Group();
  const p = palette(o.material, o.color, base);
  switch (o.objKind) {
    case "patio_furniture": {
      const item = ITEMS.includes(o.item) ? o.item : "lounge_chair";
      BUILD[item](g, item === "grill" ? { ...p, dark: M("#26282a", { metalness: 0.5, roughness: 0.45 }) } : p);
      break;
    }
    case "trash_bin": {
      const c = o.color ? hex(o.color) : ["#2f5d3a", "#2d3b4f", "#4a4d50"][seed % 3];
      const body = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.9, 3.1, 4), M(c)); body.rotation.y = Math.PI / 4; body.position.y = 1.6; g.add(body);
      const lid = box(g, M(shade(c, 0.85)), 2.2, 0.2, 2.2, 0, 3.15); lid.rotation.y = 0;
      for (const sx of [-1, 1]) { const w = cyl(g, p.dark, 0.3, 0.3, 0.2, sx * 0.8, 0.1, -0.9, 10); w.rotation.z = Math.PI / 2; }
      break;
    }
    case "propane_tank": {
      const white = M("#eceae4", { metalness: 0.3, roughness: 0.5 });
      cyl(g, white, 0.65, 0.65, 1.9, 0, 0.35, 0, 16);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.65, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), white); top.position.y = 2.25; g.add(top);
      const bot = new THREE.Mesh(new THREE.SphereGeometry(0.65, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white); bot.position.y = 0.35; g.add(bot);
      cyl(g, white, 0.45, 0.45, 0.35, 0, 0, 0, 16);
      cyl(g, white, 0.4, 0.4, 0.45, 0, 2.6, 0, 12);
      cyl(g, M("#7d8a91", { metalness: 0.7 }), 0.1, 0.1, 0.3, 0, 2.75, 0, 8);
      break;
    }
    case "planter": {
      const pot = o.color ? hex(o.color) : o.material === "wood" ? "#8a5d36" : "#b8653f";
      cyl(g, M(pot), 1.1, 0.8, 1.8, 0, 0, 0, 14);
      cyl(g, M("#4a3526"), 1.0, 1.0, 0.1, 0, 1.7, 0, 14);
      const leaf = M("#4f7a3a", { roughness: 1 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2, s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), leaf);
        s.position.set(Math.cos(a) * 0.45, 2.2 + (i % 2) * 0.25, Math.sin(a) * 0.45); g.add(s);
      }
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), leaf); c.position.y = 2.6; g.add(c);
      break;
    }
    case "doormat":
      box(g, M(o.color ? hex(o.color) : "#6b5a44", { roughness: 1 }), 3, 0.06, 2);
      break;
    default:
      box(g, p.frame, 2, 2, 2);
  }
  g.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  if (typeof o.rot === "number") g.rotation.y = (o.rot * Math.PI) / 180;
  return g;
}
