// Turns a scene spec into "fuel nodes": spheres the ember simulation works on.
// Numbers are heuristics shaped by IBHS / CAL FIRE ember guidance (what catches
// embers, what burns easily, what carries fire to the house). Not a validated
// fire model; it exists to show *ignition chains* to a homeowner.

import { distToHouse } from "../kit/spec.js";

export const ROOF_RISE = 6;

// f = ignitability (0..1), trap = chance a landing ember lodges (0..1),
// heat = how strongly it heats neighbors once burning, fuel = burn seconds.
const SIDING = { wood: 0.55, stucco: 0.03, fiber_cement: 0.05 };
const ROOF = {
  wood_shake: { f: 0.85, trap: 0.5 },
  asphalt: { f: 0.04, trap: 0.2 },
  tile: { f: 0.03, trap: 0.25 },
  metal: { f: 0.01, trap: 0.05 },
};
const PLANT = {
  juniper: { f: 0.95, trap: 0.55, heat: 1.0, fuel: 35 },
  shrub: { f: 0.5, trap: 0.35, heat: 0.6, fuel: 25 },
  tree: { f: 0.35, trap: 0.25, heat: 0.8, fuel: 90 },
  conifer: { f: 0.8, trap: 0.45, heat: 1.1, fuel: 70 },
  grass: { f: 0.85, trap: 0.35, heat: 0.35, fuel: 8 },
};
const OBJ = {
  patio_furniture: { r: 2, y: 1.5, heat: 0.55, fuel: 40, trap: 0.4 },
  trash_bin: { r: 1.5, y: 1.5, heat: 0.45, fuel: 30, trap: 0.3 },
  propane_tank: { r: 1.2, y: 1.2, heat: 1.4, fuel: 20, trap: 0.05 },
  car: { r: 6, y: 2.5, heat: 1.1, fuel: 240, trap: 0.1 },
  doormat: { r: 1.5, y: 0.1, heat: 0.25, fuel: 15, trap: 0.7 },
  planter: { r: 1.2, y: 1, heat: 0.2, fuel: 20, trap: 0.3 },
};
const OBJ_F = { wood: 0.6, wicker: 0.75, fabric: 0.7, plastic: 0.45, metal: 0 };

// Point on a wall at along-offset `a` (feet from wall center), pushed `out` feet outward.
export function wallPoint(house, wall, a, out = 0) {
  const hw = house.w / 2, hd = house.d / 2;
  switch (wall) {
    case "N": return [a, -hd - out];
    case "S": return [a, hd + out];
    case "E": return [hw + out, a];
    case "W": return [-hw - out, a];
  }
}
export function wallLength(house, wall) {
  return wall === "N" || wall === "S" ? house.w : house.d;
}
const steps = (len, every) => {
  const n = Math.max(1, Math.round(len / every));
  return Array.from({ length: n }, (_, i) => -len / 2 + (len * (i + 0.5)) / n);
};

export function buildNodes(spec) {
  const h = spec.house;
  const nodes = [];
  const add = (n) => nodes.push({ critical: false, heat: 0.5, fuel: 30, ...n, idx: nodes.length });

  // House shell: siding per wall + roof grid. Igniting any of them = house ignites.
  for (const wall of ["N", "E", "S", "W"]) {
    for (const a of steps(wallLength(h, wall), 8)) {
      const [x, z] = wallPoint(h, wall, a, 0.5);
      add({ obj: "house", label: `${wall} wall siding`, part: "siding", p: [x, h.h / 2, z], r: 3,
        f: SIDING[h.sidingOverride?.[wall] || h.siding], trap: 0.004, heat: 1.2, fuel: 600, critical: true });
    }
  }
  const roof = ROOF[h.roof];
  for (const x of steps(h.w, 12)) for (const z of steps(h.d, 12)) {
    add({ obj: "house", label: `${h.roof.replace("_", " ")} roof`, part: "roof", p: [x, h.h + ROOF_RISE * 0.6, z], r: 6,
      f: roof.f, trap: roof.trap, heat: 1.2, fuel: 600, critical: true });
  }

  for (const o of spec.objects) {
    switch (o.kind) {
      case "vent": {
        // An unscreened vent lets embers into the attic or crawlspace: direct house ignition.
        const [x, z] = wallPoint(h, o.wall, o.x, 0.3);
        add({ obj: o.id, label: `${o.wall} wall vent${o.screened ? " (screened)" : ""}`, part: "vent", p: [x, o.h, z], r: 1.4,
          f: o.screened ? 0.02 : 1, trap: o.screened ? 0.02 : 0.9, heat: 0, fuel: 600, critical: true });
        break;
      }
      case "gutter": {
        for (const a of steps(wallLength(h, o.wall), 8)) {
          const [x, z] = wallPoint(h, o.wall, a, 0.8);
          add({ obj: o.id, label: `${o.wall} gutter${o.debris ? " (debris)" : ""}`, part: "gutter", p: [x, h.h, z], r: 1.8,
            f: o.debris ? 0.95 : 0.02, trap: o.debris ? 0.85 : 0.1, heat: 0.9, fuel: 25 });
        }
        break;
      }
      case "deck": {
        const len = o.length ?? wallLength(h, o.wall);
        let f = o.material === "wood" ? 0.4 : 0.25;
        let trap = o.underside === "open" ? 0.45 : 0.04;
        if (o.debris) { f = Math.min(1, f + 0.45); trap = Math.min(1, trap + 0.35); }
        for (const a of steps(len, 6)) for (let out = 3; out < o.depth; out += 6) {
          const [x, z] = wallPoint(h, o.wall, o.offset + a, out);
          add({ obj: o.id, label: `${o.wall} ${o.material} deck`, part: "deck", p: [x, 1.5, z], r: 3.2, f, trap, heat: 0.9, fuel: 90 });
        }
        break;
      }
      case "fence": {
        if (o.material !== "wood") break;
        const [x0, z0] = o.from, [x1, z1] = o.to;
        const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 4));
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
          if (o.metalNearHouse && distToHouse(h, x, z) < 5 + 2.4) continue; // 5 ft clear of the wall, edge to edge
          add({ obj: o.id, label: "wood fence", part: "fence", p: [x, 3, z], r: 2.4, f: 0.7, trap: 0.35, heat: 0.5, fuel: 45 });
        }
        break;
      }
      case "plant": {
        const d = PLANT[o.species];
        const tree = o.species === "tree" || o.species === "conifer";
        const r = o.species === "conifer" ? Math.max(3, o.height / 5) : tree ? Math.max(3, o.height / 3) : Math.max(1.5, o.height / 2);
        // Limbed-up, thinned trees (Zone 1 work) hold far fewer embers and burn less intensely.
        const fuel = o.limbed ? { ...d, f: o.species === "conifer" ? 0.25 : 0.12, trap: 0.1, heat: 0.45 } : d;
        add({ obj: o.id, label: o.limbed ? "tree (limbed up)" : o.species, part: "plant", p: [o.x, tree ? o.height * 0.65 : Math.max(0.5, o.height / 2), o.z], r, ...fuel });
        break;
      }
      case "mulch": {
        if (o.material !== "bark") break;
        for (const a of steps(o.w, 4)) for (const b of steps(o.d, 4)) {
          add({ obj: o.id, label: "bark mulch", part: "mulch", p: [o.x + a, 0.3, o.z + b], r: 2.2, f: 0.75, trap: 0.8, heat: 0.4, fuel: 50 });
        }
        break;
      }
      case "neighbor": {
        // Neighbor walls burn like ours but are not "our house"; they radiate onto our siding.
        const nh = { w: o.w, d: o.d, h: o.h };
        for (const wall of ["N", "E", "S", "W"]) for (const a of steps(wallLength(nh, wall), 8)) {
          const [x, z] = wallPoint(nh, wall, a, 0.5);
          add({ obj: o.id, label: "neighbor's siding", part: "neighbor", p: [o.x + x, o.h / 2, o.z + z], r: 3, f: SIDING[o.siding], trap: 0.004, heat: 1.2, fuel: 600 });
        }
        add({ obj: o.id, label: "neighbor's roof", part: "neighbor", p: [o.x, o.h + ROOF_RISE * 0.6, o.z], r: Math.max(6, Math.min(o.w, o.d) / 3), f: ROOF[o.roof].f, trap: ROOF[o.roof].trap, heat: 1.2, fuel: 600 });
        break;
      }
      case "firewood":
        add({ obj: o.id, label: "firewood pile", part: "firewood", p: [o.x, 1.5, o.z], r: 2.2, f: 0.8, trap: 0.6, heat: 1.0, fuel: 150 });
        break;
      case "object": {
        const d = OBJ[o.objKind];
        const f = o.objKind === "car" ? 0.15 : o.objKind === "propane_tank" ? 0.2 : OBJ_F[o.material];
        if (f > 0) add({ obj: o.id, label: o.objKind.replace("_", " "), part: "object", p: [o.x, d.y, o.z], r: d.r, f, trap: d.trap, heat: d.heat, fuel: d.fuel });
        break;
      }
    }
  }
  return nodes;
}
