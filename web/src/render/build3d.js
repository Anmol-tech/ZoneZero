// Builds a Three.js scene from a spec and animates a running Sim on top of it.
import * as THREE from "three";
import { wallPoint, wallLength } from "../sim/nodes.js";
import { wallTexture, roofTexture, groundTexture, boardsTexture, skyTexture, SIDING_COLORS, hashStr, rng, shade } from "./textures.js";

const COLORS = {
  deck: { wood: "#8a5d36", composite: "#6f665c" }, fence: { wood: "#9b7048", metal: 0x3a3f44, masonry: 0xb0a594 },
  trunk: 0x4a3524, firewood: 0x7a5230,
  obj: { wood: 0x8a5d36, wicker: 0xc8a165, fabric: 0x5b7fa3, plastic: 0x3d6e9e, metal: 0x8a9399 },
  vent: 0x2b2b2b, ventScreened: 0x9aa4ad, gutter: 0xe8e6e0, debris: 0x6b5a2e,
};
const GREENS = ["#3f6b2e", "#4d7a35", "#2f5a2a", "#5b8a3c", "#46703a"];
const CONIFER = ["#1f3d26", "#24472b", "#2b5131", "#1b3622"];

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
const texMat = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, ...extra });
const wallRot = { N: Math.PI, S: 0, E: Math.PI / 2, W: -Math.PI / 2 };

export function configureRenderer(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

// Hip / gable / flat roof as one textured mesh (+ gable-end walls).
function roofMeshes(w, d, style, ridge, material, sidingMat, overhang = 1.5) {
  if (ridge === "z") {
    const ms = roofMeshes(d, w, style, "x", material, sidingMat, overhang);
    ms.forEach((m) => m.geometry.rotateY(Math.PI / 2));
    return ms;
  }
  const W = w + overhang * 2, D = d + overhang * 2;
  const rise = Math.min(12, Math.min(w, d) * 0.28);
  const roofMat = texMat(roofTexture(material), { side: THREE.DoubleSide, flatShading: true });
  if (style === "flat") {
    const g = new THREE.BoxGeometry(W, 1, D);
    g.translate(0, 0.5, 0);
    return [new THREE.Mesh(g, roofMat)];
  }
  const rl = style === "gable" ? W / 2 : Math.max(0, (W - D) / 2);
  const A = [-W / 2, 0, -D / 2], B = [W / 2, 0, -D / 2], C = [W / 2, 0, D / 2], E = [-W / 2, 0, D / 2];
  const R1 = [-rl, rise, 0], R2 = [rl, rise, 0];
  const pos = [], uv = [];
  const slope = Math.hypot(D / 2, rise);
  const tri = (p, q, r, axis) => {
    for (const v of [p, q, r]) {
      pos.push(...v);
      const along = axis === "x" ? v[0] : v[2];
      uv.push(along / 6, (v[1] / rise) * (slope / 6));
    }
  };
  // Long slopes (north and south), then hip ends.
  tri(A, R2, B, "x"); tri(A, R1, R2, "x");
  tri(C, R2, R1, "x"); tri(C, R1, E, "x");
  if (style === "hip") { tri(B, R2, C, "z"); tri(E, R1, A, "z"); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const out = [new THREE.Mesh(g, roofMat)];
  if (style === "gable") {
    // Triangular gable walls at each end, flush with the house walls.
    const gp = [];
    for (const sx of [-1, 1]) gp.push(sx * w / 2, 0, -d / 2, sx * w / 2, 0, d / 2, sx * w / 2, rise * (d / D), 0);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3));
    gg.computeVertexNormals();
    const gm = sidingMat.clone(); gm.side = THREE.DoubleSide;
    out.push(new THREE.Mesh(gg, gm));
  }
  return out;
}

// A house body (ours or a neighbor's). Returns meshes positioned around (0,0).
function houseMeshes(h, seed) {
  const sidingColor = h.sidingColor || SIDING_COLORS[h.siding];
  const trim = h.trimColor || "#f1efe8";
  const meshes = [];
  const faces = { E: null, W: null, S: null, N: null };
  const toTex = (wall, a) => (wall === "E" || wall === "N" ? wallLength(h, wall) / 2 - a : wallLength(h, wall) / 2 + a) * 12;
  for (const wall of ["E", "W", "S", "N"]) {
    const len = wallLength(h, wall);
    let garage = null, door = null;
    if (h.garage && h.garage.wall === wall) {
      const x0 = toTex(wall, h.garage.x - h.garage.width / 2), x1 = toTex(wall, h.garage.x + h.garage.width / 2);
      garage = { x0: Math.min(x0, x1), x1: Math.max(x0, x1) };
    }
    const doorWall = h.porch ? h.porch.wall : "N";
    if (wall === doorWall && h.door !== false) {
      let dx = h.porch ? h.porch.x : 0;
      if (h.garage && h.garage.wall === wall && Math.abs(dx - h.garage.x) < h.garage.width / 2 + 3) dx = h.garage.x + (h.garage.x > 0 ? -1 : 1) * (h.garage.width / 2 + 5);
      const x0 = toTex(wall, dx - 1.75), x1 = toTex(wall, dx + 1.75);
      door = { x0: Math.min(x0, x1), x1: Math.max(x0, x1) };
    }
    faces[wall] = texMat(wallTexture({ len, h: h.h, material: h.siding, color: sidingColor, trim, stories: h.stories || 1, wainscot: h.wainscot || "none", garage, door, seed: seed + wall.charCodeAt(0) }));
  }
  const plain = mat(sidingColor);
  const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), [faces.E, faces.W, plain, plain, faces.S, faces.N]);
  body.position.y = h.h / 2; body.castShadow = body.receiveShadow = true;
  meshes.push(body);
  for (const r of roofMeshes(h.w, h.d, h.roofStyle || "hip", h.ridge || (h.w >= h.d ? "x" : "z"), h.roof, plain)) {
    r.position.y = h.h; r.castShadow = true; r.receiveShadow = true; meshes.push(r);
  }
  // Fascia band under the eaves.
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(h.w + 3, 0.7, h.d + 3), mat(trim));
  fascia.position.y = h.h - 0.1; meshes.push(fascia);
  if (h.porch) {
    const p = h.porch;
    const [x, z] = wallPoint(h, p.wall, p.x, p.d / 2);
    const g = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.6, p.d), mat(0xb5aea3)); slab.position.y = 0.3; g.add(slab);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(p.w + 1, 0.6, p.d + 1), texMat(roofTexture(h.roof))); roof.position.y = 9.2; roof.castShadow = true; g.add(roof);
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), mat(trim)); post.position.set(sx * (p.w / 2 - 0.5), 4.5, p.d / 2 - 0.5); g.add(post); }
    g.position.set(x, 0, z); g.rotation.y = wallRot[p.wall];
    meshes.push(g);
  }
  return meshes;
}

function conifer(o, color) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, o.height * 0.35, 6), mat(COLORS.trunk));
  trunk.position.y = o.height * 0.175; g.add(trunk);
  const r = Math.max(2.5, o.height / (o.limbed ? 7.5 : 5.5));
  const start = o.limbed ? 0.4 : 0.15;
  for (let i = 0; i < 4; i++) {
    const t = i / 4, ch = (o.height * (1 - start)) / 2.2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r * (1 - t * 0.55), ch, 8), mat(color, { flatShading: true }));
    cone.position.y = o.height * start + (o.height * (1 - start) - ch) * t + ch / 2;
    cone.castShadow = true; g.add(cone);
  }
  return g;
}

function broadleaf(o, color, r) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, o.height * (o.limbed ? 0.6 : 0.45), 6), mat(COLORS.trunk));
  trunk.position.y = o.height * (o.limbed ? 0.3 : 0.225); g.add(trunk);
  const cr = Math.max(2.5, o.height / 3.2) * (o.limbed ? 0.7 : 1);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(cr * (0.55 + r() * 0.3), 1), mat(shade(color, 0.85 + r() * 0.3), { flatShading: true }));
    s.position.set((r() - 0.5) * cr, o.height * 0.62 + (r() - 0.3) * cr * 0.6, (r() - 0.5) * cr);
    s.castShadow = true; g.add(s);
  }
  return g;
}

function bush(o, color, r, cone = false) {
  const g = new THREE.Group();
  const n = cone ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const rad = Math.max(0.8, o.height / 2) * (0.7 + r() * 0.4);
    const m = cone ? new THREE.Mesh(new THREE.ConeGeometry(rad, o.height * (0.8 + r() * 0.3), 7), mat(color, { flatShading: true }))
      : new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), mat(shade(color, 0.85 + r() * 0.3), { flatShading: true }));
    m.position.set((r() - 0.5) * rad, cone ? o.height / 2 : rad * 0.8, (r() - 0.5) * rad);
    m.castShadow = true; g.add(m);
  }
  return g;
}

function flatPatch(w, d, map, y, repeatFt = 12) {
  const t = map.clone(); t.needsUpdate = true;
  t.repeat.set(w / repeatFt, d / repeatFt);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), texMat(t));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true;
  return m;
}

export function buildScene(spec) {
  const root = new THREE.Group();
  const byObj = new Map();
  const reg = (id, m) => {
    m.traverse((c) => { c.userData.obj = id; });
    (byObj.get(id) || byObj.set(id, []).get(id)).push(m);
    root.add(m);
    return m;
  };
  const h = spec.house;

  root.add(flatPatch(800, 800, groundTexture("grass"), 0, 10));
  const z0 = new THREE.Mesh(new THREE.PlaneGeometry(h.w + 10, h.d + 10), new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.12, depthWrite: false }));
  z0.rotation.x = -Math.PI / 2; z0.position.y = 0.08; root.add(z0);

  for (const m of houseMeshes(h, 3)) reg("house", m);

  for (const o of spec.objects) {
    const r = rng(hashStr(o.id) + 1);
    switch (o.kind) {
      case "vent": {
        const [x, z] = wallPoint(h, o.wall, o.x, 0.12);
        const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 0.2), mat(o.screened ? COLORS.ventScreened : COLORS.vent, o.screened ? { metalness: 0.6, roughness: 0.4 } : {}));
        m.position.set(x, o.h, z); m.rotation.y = wallRot[o.wall]; reg(o.id, m);
        break;
      }
      case "gutter": {
        const len = wallLength(h, o.wall) + 3;
        const [x, z] = wallPoint(h, o.wall, 0, 1.6);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.55, 0.55), mat(COLORS.gutter)));
        if (o.debris) { const db = new THREE.Mesh(new THREE.BoxGeometry(len * 0.95, 0.25, 0.45), mat(COLORS.debris)); db.position.y = 0.3; g.add(db); }
        g.position.set(x, h.h - 0.4, z); g.rotation.y = wallRot[o.wall]; reg(o.id, g);
        break;
      }
      case "deck": {
        const len = o.length ?? wallLength(h, o.wall);
        const [x, z] = wallPoint(h, o.wall, o.offset, o.depth / 2);
        const g = new THREE.Group();
        const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, o.depth), texMat(boardsTexture(COLORS.deck[o.material], false)));
        top.position.y = 2.4; top.castShadow = top.receiveShadow = true; g.add(top);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), mat(COLORS.deck[o.material])); p.position.set(sx * (len / 2 - 0.5), 1.2, sz * (o.depth / 2 - 0.5)); g.add(p);
        }
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 0.25), mat(COLORS.deck[o.material])); rail.position.set(0, 5.4, o.depth / 2 - 0.2); g.add(rail);
        if (o.underside === "enclosed") { const sk = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, o.depth), texMat(boardsTexture("#6e6a64", true))); sk.position.y = 1.1; g.add(sk); }
        else if (o.debris) { const db = new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.4, o.depth * 0.8), mat(COLORS.debris)); db.position.y = 0.2; g.add(db); }
        // Deck is built along +z of its local frame; rotate the local +z to face outward from the wall.
        g.position.set(x, 0, z); g.rotation.y = wallRot[o.wall]; reg(o.id, g);
        break;
      }
      case "fence": {
        const [x0, z0] = o.from, [x1, z1] = o.to;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const ang = Math.atan2(z1 - z0, x1 - x0);
        const seg = (a, b, material) => {
          if (b - a <= 0.01) return;
          const t0 = a / len, t1 = b / len;
          const g = new THREE.Group();
          const panel = material === "wood"
            ? new THREE.Mesh(new THREE.BoxGeometry(b - a, 6, 0.3), texMat(boardsTexture(COLORS.fence.wood, true)))
            : material === "metal" ? new THREE.Mesh(new THREE.BoxGeometry(b - a, 5, 0.15), mat(COLORS.fence.metal, { metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.85 }))
            : new THREE.Mesh(new THREE.BoxGeometry(b - a, 6, 0.8), mat(COLORS.fence.masonry));
          panel.position.y = 3; panel.castShadow = true; g.add(panel);
          for (let s = 0; s <= b - a; s += 8) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.5, 0.5), mat(material === "wood" ? 0x6b4c30 : COLORS.fence.metal)); p.position.set(-(b - a) / 2 + s, 3.25, 0); g.add(p); }
          g.position.set(x0 + (x1 - x0) * (t0 + t1) / 2, 0, z0 + (z1 - z0) * (t0 + t1) / 2);
          g.rotation.y = -ang; reg(o.id, g);
        };
        if (o.metalNearHouse) {
          let cut = 0;
          for (let s = 0; s <= len; s += 0.5) {
            const x = x0 + ((x1 - x0) * s) / len, z = z0 + ((z1 - z0) * s) / len;
            if (Math.hypot(Math.max(Math.abs(x) - h.w / 2, 0), Math.max(Math.abs(z) - h.d / 2, 0)) < 7.4) cut = s;
          }
          seg(0, cut, "metal"); seg(cut, len, o.material);
        } else seg(0, len, o.material);
        break;
      }
      case "plant": {
        const color = o.color || (o.species === "conifer" ? CONIFER[hashStr(o.id) % CONIFER.length] : o.species === "juniper" ? "#2c4f3b" : o.species === "grass" ? "#9d9a5a" : GREENS[hashStr(o.id) % GREENS.length]);
        const m = o.species === "conifer" ? conifer(o, color) : o.species === "tree" ? broadleaf(o, color, r) : bush(o, color, r, o.species === "juniper" || o.species === "grass");
        m.position.set(o.x, 0, o.z); reg(o.id, m);
        break;
      }
      case "mulch": {
        const m = flatPatch(o.w, o.d, groundTexture(o.material), 0.12, 6);
        m.position.x = o.x; m.position.z = o.z; reg(o.id, m);
        break;
      }
      case "paving": {
        const m = flatPatch(o.w, o.d, groundTexture(o.surface), o.surface === "street" ? 0.04 : 0.06, o.surface === "street" ? 24 : 10);
        m.position.x = o.x; m.position.z = o.z; reg(o.id, m);
        break;
      }
      case "neighbor": {
        const g = new THREE.Group();
        for (const m of houseMeshes({ ...o, wainscot: "none", roofStyle: "hip", porch: null, garage: null }, hashStr(o.id))) g.add(m);
        g.position.set(o.x, 0, o.z); reg(o.id, g);
        break;
      }
      case "firewood": {
        const g = new THREE.Group();
        for (let i = 0; i < 12; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2, 6), mat(shade("#7a5230", 0.8 + r() * 0.4)));
          log.rotation.x = Math.PI / 2; log.position.set(-1.5 + (i % 4), 0.4 + Math.floor(i / 4) * 0.7, 0); g.add(log);
        }
        g.position.set(o.x, 0, o.z); reg(o.id, g);
        break;
      }
      case "object": {
        const g = new THREE.Group();
        if (o.objKind === "car") {
          const color = [0x3a4a5c, 0x8f9499, 0x6b1f1f, 0xdedede][hashStr(o.id) % 4];
          const body = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 14), mat(color, { metalness: 0.5, roughness: 0.4 })); body.position.y = 2; g.add(body);
          const cab = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.8, 7), mat(0x2a3440, { metalness: 0.3, roughness: 0.2 })); cab.position.set(0, 4, -0.5); g.add(cab);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.8, 12), mat(0x111111)); wh.rotation.z = Math.PI / 2; wh.position.set(sx * 2.9, 1.2, sz * 4.5); g.add(wh); }
          g.traverse((c) => (c.castShadow = true));
        } else {
          const size = { patio_furniture: [3, 2.5, 3], trash_bin: [2, 3.2, 2], propane_tank: [1.4, 3, 1.4], doormat: [3, 0.1, 2], planter: [2, 2, 2] }[o.objKind];
          const m = new THREE.Mesh(o.objKind === "propane_tank" ? new THREE.CylinderGeometry(0.7, 0.7, 3, 12) : new THREE.BoxGeometry(...size), mat(COLORS.obj[o.material]));
          m.position.y = size[1] / 2; m.castShadow = true; g.add(m);
        }
        g.position.set(o.x, 0, o.z); reg(o.id, g);
        break;
      }
    }
  }
  return { root, byObj };
}

export function addLights(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 12), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
  scene.add(sky);
  scene.background = new THREE.Color(0xc9dbe9);
  scene.fog = new THREE.Fog(0xdfe8ee, 220, 650);
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5a30, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
  sun.position.set(-90, 140, -60); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.4;
  Object.assign(sun.shadow.camera, { left: -150, right: 150, top: 150, bottom: -150, near: 10, far: 500 });
  scene.add(sun);
}

const eachMat = (m, fn) => m.traverse((c) => {
  if (!c.isMesh) return;
  c.material = Array.isArray(c.material) ? c.material.map((x) => fn(x.clone())) : fn(c.material.clone());
});

// Visual layer for a running Sim: ember particles, flames, charring.
export class SimView {
  constructor(scene, built, sim) {
    this.scene = scene; this.built = built; this.sim = sim;
    this.maxEmbers = 4000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.maxEmbers * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffa020, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.95 }));
    scene.add(this.points);
    this.flames = new Map();
    this.flameGeo = new THREE.ConeGeometry(1, 2.5, 7);
    this.charred = new Set();
    this.houseGlow = null;
  }
  update() {
    const pos = this.points.geometry.attributes.position.array;
    const n = Math.min(this.sim.embers.length, this.maxEmbers);
    for (let i = 0; i < n; i++) { const e = this.sim.embers[i]; pos[i * 3] = e.x; pos[i * 3 + 1] = e.y; pos[i * 3 + 2] = e.z; }
    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;

    for (const node of this.sim.nodes) {
      let fl = this.flames.get(node.idx);
      if (node.state === "burning") {
        if (!fl) {
          fl = new THREE.Mesh(this.flameGeo, new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.85, fog: false }));
          fl.position.set(node.p[0], node.p[1] + node.r * 0.3, node.p[2]);
          this.scene.add(fl); this.flames.set(node.idx, fl);
        }
        const s = Math.max(0.3, node.intensity) * Math.min(node.r, 6) * 0.9 * (0.85 + 0.3 * Math.random());
        fl.scale.set(s, s * 1.4, s);
        if (!this.charred.has(node.obj) && node.obj !== "house") {
          this.charred.add(node.obj);
          for (const m of this.built.byObj.get(node.obj) || []) eachMat(m, (x) => { x.color.lerp(new THREE.Color(0x1a1410), 0.75); return x; });
        }
      } else if (fl && node.state === "burnt") {
        this.scene.remove(fl); this.flames.delete(node.idx);
      }
    }
    if (this.sim.houseIgnitedAt !== null && !this.houseGlow) {
      this.houseGlow = new THREE.PointLight(0xff4400, 8000, 120);
      this.houseGlow.position.set(0, this.sim.spec.house.h + 4, 0); this.scene.add(this.houseGlow);
      for (const m of this.built.byObj.get("house") || []) eachMat(m, (x) => { x.emissive = new THREE.Color(0x802000); return x; });
    }
  }
  dispose() {
    this.scene.remove(this.points);
    for (const fl of this.flames.values()) this.scene.remove(fl);
    if (this.houseGlow) this.scene.remove(this.houseGlow);
  }
}
