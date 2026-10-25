// Builds a Three.js scene from a spec and animates a running Sim on top of it.
import * as THREE from "three";
import { wallPoint, wallLength, ROOF_RISE } from "../sim/nodes.js";

const COLORS = {
  ground: 0x8a9a5b, siding: { wood: 0xb08a5a, stucco: 0xe8dcc4, fiber_cement: 0xc9c4b8 },
  roof: { asphalt: 0x4a4a4f, wood_shake: 0x8b5a2b, tile: 0xb5543a, metal: 0x9aa4ad },
  deck: { wood: 0x9c6b3e, composite: 0x7d7468 }, fence: { wood: 0xa5784a, metal: 0x707a80, masonry: 0xb0a090 },
  plant: { juniper: 0x2f5d3a, shrub: 0x4f7d3a, tree: 0x3b6b2f, grass: 0xb9b36a },
  mulch: { bark: 0x6b4226, gravel: 0xa9a9a9 }, firewood: 0x7a5230, trunk: 0x5a3d22,
  obj: { wood: 0x9c6b3e, wicker: 0xc8a165, fabric: 0x5b7fa3, plastic: 0x3d6e9e, metal: 0x8a9399 },
  vent: 0x222222, ventScreened: 0x9aa4ad, gutterDebris: 0x6b5a2e, gutter: 0xdddddd,
};

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

export function buildScene(spec) {
  const root = new THREE.Group();
  const byObj = new Map(); // obj id -> meshes (for charring/highlight)
  const reg = (id, m) => { m.userData.obj = id; (byObj.get(id) || byObj.set(id, []).get(id)).push(m); root.add(m); return m; };
  const h = spec.house;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(COLORS.ground));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; root.add(ground);

  // Zone 0 ring (5 ft) drawn on the ground.
  const z0 = new THREE.Mesh(new THREE.PlaneGeometry(h.w + 10, h.d + 10), new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.18 }));
  z0.rotation.x = -Math.PI / 2; z0.position.y = 0.05; root.add(z0);

  const body = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), mat(COLORS.siding[h.siding]));
  body.position.y = h.h / 2; body.castShadow = body.receiveShadow = true; reg("house", body);
  // Hip-ish roof: a 4-sided pyramid stretched over the footprint.
  const roofGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  const roof = new THREE.Mesh(roofGeo, mat(COLORS.roof[h.roof], { flatShading: true }));
  roof.scale.set(h.w * 1.1, ROOF_RISE, h.d * 1.1);
  roof.position.y = h.h + ROOF_RISE / 2; roof.castShadow = true; reg("house", roof);

  const wallRot = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };
  for (const o of spec.objects) {
    switch (o.kind) {
      case "vent": {
        const [x, z] = wallPoint(h, o.wall, o.x, 0.15);
        const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.3), mat(o.screened ? COLORS.ventScreened : COLORS.vent));
        m.position.set(x, o.h, z); m.rotation.y = wallRot[o.wall]; reg(o.id, m);
        break;
      }
      case "gutter": {
        const len = wallLength(h, o.wall);
        const [x, z] = wallPoint(h, o.wall, 0, 0.6);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 0.8), mat(o.debris ? COLORS.gutterDebris : COLORS.gutter));
        m.position.set(x, h.h, z); m.rotation.y = wallRot[o.wall]; reg(o.id, m);
        break;
      }
      case "deck": {
        const len = o.length ?? wallLength(h, o.wall);
        const [x, z] = wallPoint(h, o.wall, o.offset, o.depth / 2);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, o.depth), mat(COLORS.deck[o.material]));
        m.position.set(x, 2.2, z); m.rotation.y = wallRot[o.wall]; m.castShadow = true; reg(o.id, m);
        if (o.underside === "enclosed") {
          const skirt = new THREE.Mesh(new THREE.BoxGeometry(len, 2, o.depth), mat(0x777777));
          skirt.position.set(x, 1, z); skirt.rotation.y = wallRot[o.wall]; reg(o.id, skirt);
        } else if (o.debris) {
          const dbr = new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.4, o.depth * 0.8), mat(COLORS.gutterDebris));
          dbr.position.set(x, 0.2, z); dbr.rotation.y = wallRot[o.wall]; reg(o.id, dbr);
        }
        break;
      }
      case "fence": {
        const [x0, z0] = o.from, [x1, z1] = o.to;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const ang = Math.atan2(z1 - z0, x1 - x0);
        const addSeg = (a, b, material) => {
          if (b - a <= 0.01) return;
          const t0 = a / len, t1 = b / len;
          const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, 6, 0.4), mat(COLORS.fence[material]));
          m.position.set(x0 + (x1 - x0) * (t0 + t1) / 2, 3, z0 + (z1 - z0) * (t0 + t1) / 2);
          m.rotation.y = -ang; m.castShadow = true; reg(o.id, m);
        };
        if (o.metalNearHouse) {
          // Metal section covers the part of the fence within 5 ft of the house.
          let cut = 0;
          for (let s = 0; s <= len; s += 0.5) {
            const x = x0 + ((x1 - x0) * s) / len, z = z0 + ((z1 - z0) * s) / len;
            const d = Math.hypot(Math.max(Math.abs(x) - h.w / 2, 0), Math.max(Math.abs(z) - h.d / 2, 0));
            if (d < 7.4) cut = s;
          }
          addSeg(0, cut, "metal"); addSeg(cut, len, o.material);
        } else addSeg(0, len, o.material);
        break;
      }
      case "plant": {
        if (o.species === "tree") {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, o.height * 0.5, 8), mat(COLORS.trunk));
          trunk.position.set(o.x, o.height * 0.25, o.z); reg(o.id, trunk);
          // Limbed-up trees (Zone 1 fix) get a smaller, higher crown.
          const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(3, o.height / 3) * (o.limbed ? 0.65 : 1), 1), mat(COLORS.plant.tree, { flatShading: true }));
          if (o.limbed) trunk.scale.y = 1.4;
          crown.position.set(o.x, o.height * 0.65, o.z); crown.castShadow = true; reg(o.id, crown);
        } else {
          const geo = o.species === "juniper" ? new THREE.ConeGeometry(Math.max(1.2, o.height / 2.5), o.height, 7) : new THREE.IcosahedronGeometry(Math.max(1, o.height / 2), 0);
          const m = new THREE.Mesh(geo, mat(COLORS.plant[o.species], { flatShading: true }));
          m.position.set(o.x, o.species === "juniper" ? o.height / 2 : Math.max(0.5, o.height / 2), o.z); m.castShadow = true; reg(o.id, m);
        }
        break;
      }
      case "mulch": {
        const m = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.3, o.d), mat(COLORS.mulch[o.material]));
        m.position.set(o.x, 0.15, o.z); reg(o.id, m);
        break;
      }
      case "firewood": {
        const m = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 2), mat(COLORS.firewood));
        m.position.set(o.x, 1.5, o.z); m.castShadow = true; reg(o.id, m);
        break;
      }
      case "object": {
        const size = { patio_furniture: [3, 2.5, 3], trash_bin: [2, 3, 2], propane_tank: [1.5, 3, 1.5], car: [6, 5, 14], doormat: [3, 0.15, 2], planter: [2, 2, 2] }[o.objKind];
        const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat(COLORS.obj[o.material]));
        m.position.set(o.x, size[1] / 2, o.z); m.castShadow = true; reg(o.id, m);
        break;
      }
    }
  }
  return { root, byObj };
}

export function addLights(scene) {
  scene.background = new THREE.Color(0xc9d6e3);
  scene.fog = new THREE.Fog(0xc9d6e3, 180, 420);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-60, 120, -40); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120 });
  scene.add(sun);
}

// Visual layer for a running Sim: ember particles, glowing/burning nodes, charring.
export class SimView {
  constructor(scene, built, sim) {
    this.scene = scene; this.built = built; this.sim = sim;
    this.maxEmbers = 4000;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.maxEmbers * 3), 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffa020, size: 0.9, sizeAttenuation: true }));
    scene.add(this.points);
    this.flames = new Map();
    this.flameGeo = new THREE.ConeGeometry(1, 2.5, 6);
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
          fl = new THREE.Mesh(this.flameGeo, new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.85 }));
          fl.position.set(node.p[0], node.p[1] + node.r * 0.4, node.p[2]);
          this.scene.add(fl); this.flames.set(node.idx, fl);
        }
        const s = Math.max(0.3, node.intensity) * node.r * 0.9 * (0.85 + 0.3 * Math.random());
        fl.scale.set(s, s * 1.3, s);
        if (!this.charred.has(node.obj)) {
          this.charred.add(node.obj);
          for (const m of this.built.byObj.get(node.obj) || []) if (node.obj !== "house") m.material = m.material.clone(), m.material.color.lerp(new THREE.Color(0x1a1410), 0.75);
        }
      } else if (fl && node.state === "burnt") {
        this.scene.remove(fl); this.flames.delete(node.idx);
      }
    }
    if (this.sim.houseIgnitedAt !== null && !this.houseGlow) {
      this.houseGlow = new THREE.PointLight(0xff4400, 8000, 120);
      const h = this.sim.spec.house;
      this.houseGlow.position.set(0, h.h + 4, 0); this.scene.add(this.houseGlow);
      for (const m of this.built.byObj.get("house") || []) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(0x802000); }
    }
  }
  dispose() {
    this.scene.remove(this.points);
    for (const fl of this.flames.values()) this.scene.remove(fl);
    if (this.houseGlow) this.scene.remove(this.houseGlow);
  }
}
