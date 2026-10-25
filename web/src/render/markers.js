// Labels pinned in 3D: red "⚠" for ember hazards still present, green "✓" for
// fixes applied (from spec.fixed / spec.removed written by applyFixes).
import { distToHouse } from "../kit/spec.js";
import { wallPoint, wallLength } from "../sim/nodes.js";

export function computeMarkers(spec) {
  const h = spec.house;
  const out = [];
  const fixedTitle = new Map((spec.fixed || []).map((f) => [f.id, f.title]));
  const add = (id, pos, text, type) => out.push({ id, pos, text, type });
  const at = (o, y) => [o.x, y, o.z];
  const near = (o, ft) => distToHouse(h, o.x, o.z) < ft;

  for (const o of spec.objects) {
    if (fixedTitle.has(o.id)) {
      const y = o.kind === "gutter" ? h.h + 1.5 : o.kind === "vent" ? o.h + 1.5 : 4;
      const pos = o.kind === "gutter" || o.kind === "vent" ? [...(([x, z]) => [x, y, z])(wallPoint(h, o.wall, o.kind === "vent" ? o.x : 0, 2))]
        : o.kind === "fence" ? [o.from[0], 7, o.from[1]] : o.kind === "deck" ? (([x, z]) => [x, 4, z])(wallPoint(h, o.wall, o.offset, o.depth / 2)) : at(o, y);
      add(o.id, pos, "✓ " + fixedTitle.get(o.id), "fix");
      continue;
    }
    switch (o.kind) {
      case "gutter":
        if (o.debris) { const [x, z] = wallPoint(h, o.wall, 0, 2); add(o.id, [x, h.h + 1.5, z], "⚠ Clogged gutter", "risk"); }
        break;
      case "vent":
        if (!o.screened) { const [x, z] = wallPoint(h, o.wall, o.x, 1); add(o.id, [x, o.h + 1.2, z], "⚠ Open vent", "risk"); }
        break;
      case "deck":
        if (o.underside === "open") { const [x, z] = wallPoint(h, o.wall, o.offset, o.depth / 2); add(o.id, [x, 4, z], o.debris ? "⚠ Debris under deck" : "⚠ Open deck underside", "risk"); }
        break;
      case "fence":
        if (o.material === "wood" && o.attachedToHouse && !o.metalNearHouse) add(o.id, [o.from[0], 7, o.from[1]], "⚠ Wood fence touches house", "risk");
        break;
      case "plant":
        if ((o.species === "tree" || o.species === "conifer") && !o.limbed && near(o, 10)) add(o.id, at(o, o.height * 0.8), "⚠ Tree over roof", "risk");
        else if (o.species !== "tree" && o.species !== "conifer" && near(o, 5)) add(o.id, at(o, o.height + 1.5), o.species === "juniper" ? "⚠ Juniper on wall" : "⚠ Plant in Zone 0", "risk");
        break;
      case "mulch":
        if (o.material === "bark" && distToHouse(h, o.x, o.z) < 5 + Math.max(o.w, o.d) / 2) add(o.id, at(o, 1.5), "⚠ Bark mulch in Zone 0", "risk");
        break;
      case "firewood":
        if (near(o, 30)) add(o.id, at(o, 4), "⚠ Firewood near house", "risk");
        break;
      case "object":
        if (o.material !== "metal" && o.objKind !== "car" && o.objKind !== "planter" && near(o, 5)) add(o.id, at(o, 4), "⚠ Combustible by wall", "risk");
        break;
      case "neighbor": {
        const gap = Math.max(Math.abs(o.x) - (h.w + o.w) / 2, Math.abs(o.z) - (h.d + o.d) / 2);
        if (gap < 20) add(o.id, [o.x, o.h + 4, o.z], `⚠ Neighbor ${Math.round(gap)} ft away`, "risk");
        break;
      }
    }
  }
  if (h.roof === "wood_shake") add("house", [0, h.h + 9, 0], "⚠ Wood shake roof", "risk");
  for (const [wall] of Object.entries(h.sidingOverride || {})) { const [x, z] = wallPoint(h, wall, 0, 1); add("house", [x, h.h * 0.6, z], "✓ Fiber-cement siding", "fix"); }
  if ((spec.fixed || []).some((f) => f.fix === "class_a_roof")) add("house", [0, h.h + 9, 0], "✓ Class A roof", "fix");
  for (const r of spec.removed || []) add("removed", [r.x, 2, r.z], `✓ Removed ${r.label}`, "fix");
  return out;
}

// Groups markers that say the same thing into numbered legend entries:
// hazards first (1, 2, …), then fixes. Each group keeps all its 3D positions.
export function groupMarkers(markers) {
  const groups = new Map();
  for (const m of markers) {
    const label = m.text.replace(/^[⚠✓]\s*/, "");
    const key = `${m.type}:${label}`;
    if (!groups.has(key)) groups.set(key, { key, label, type: m.type, positions: [] });
    groups.get(key).positions.push(m.pos);
  }
  const list = [...groups.values()].sort((a, b) => (a.type === b.type ? 0 : a.type === "risk" ? -1 : 1));
  list.forEach((g, i) => { g.n = i + 1; });
  return list;
}

// Projects every pin of every group to screen pixels; pins of one group that land
// within a few pixels of each other are merged. Returns [{x, y, n, type, key}].
// `occluders` (e.g. the house meshes) mark pins behind them as `behind`, drawn faint.
export function projectPins(groups, camera, width, height, THREE, filter = "all", occluders = null) {
  const v = new THREE.Vector3();
  const pins = [];
  const ray = occluders ? new THREE.Raycaster() : null;
  const dir = new THREE.Vector3();
  for (const g of groups) {
    if (filter !== "all" && g.type !== filter) continue;
    for (const pos of g.positions) {
      v.set(...pos).project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02) continue;
      const x = (v.x * 0.5 + 0.5) * width, y = (-v.y * 0.5 + 0.5) * height;
      if (pins.some((p) => p.key === g.key && Math.hypot(p.x - x, p.y - y) < 14)) continue;
      let behind = false;
      if (ray) {
        const p = new THREE.Vector3(...pos);
        const dist = dir.copy(p).sub(camera.position).length();
        ray.set(camera.position, dir.normalize());
        ray.far = dist - 1.5;
        behind = ray.intersectObjects(occluders, true).length > 0;
      }
      pins.push({ x, y, n: g.n, type: g.type, key: g.key, label: g.label, behind });
    }
  }
  return pins;
}

export { wallLength };
