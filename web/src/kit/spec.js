// Scene Kit: the only API Argon may use when it writes scene.js.
// Running scene.js against `createKit()` records a plain JSON spec; nothing
// downstream (renderer, simulator, mitigations) ever executes generated code.
//
// Units are feet. The house footprint is centered on the origin:
//   x runs West(-) -> East(+), z runs North(-) -> South(+), y is up.

export const MATERIALS = {
  roof: ["asphalt", "wood_shake", "tile", "metal"],
  siding: ["wood", "stucco", "fiber_cement"],
  deck: ["wood", "composite"],
  fence: ["wood", "metal", "masonry"],
  plant: ["juniper", "shrub", "tree", "conifer", "grass"],
  wainscot: ["none", "stone", "brick"],
  roofStyle: ["hip", "gable", "flat"],
  paving: ["driveway", "path", "patio", "street"],
  mulch: ["bark", "gravel"],
  objectKind: ["patio_furniture", "trash_bin", "propane_tank", "car", "doormat", "planter"],
  objectMaterial: ["wood", "plastic", "metal", "fabric", "wicker"],
};
export const WALLS = ["N", "E", "S", "W"];

export function createKit() {
  const spec = { house: null, objects: [], cameras: [], notes: [] };
  const errors = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const err = (call, msg) => errors.push(`${call}: ${msg}`);
  const num = (call, name, v, lo = -Infinity, hi = Infinity) => {
    if (typeof v !== "number" || !Number.isFinite(v)) { err(call, `${name} must be a number`); return false; }
    if (v < lo || v > hi) { err(call, `${name}=${v} out of range [${lo}, ${hi}]`); return false; }
    return true;
  };
  const oneOf = (call, name, v, list) => {
    if (!list.includes(v)) { err(call, `${name}="${v}" must be one of ${list.join("|")}`); return false; }
    return true;
  };
  const needHouse = (call) => {
    if (!spec.house) { err(call, "kit.house() must be called first"); return false; }
    return true;
  };
  const push = (kind, o) => { const obj = { id: o.id || id(kind[0]), kind, ...o }; spec.objects.push(obj); return obj.id; };

  const kit = {
    house({ w = 40, d = 30, h = 12, roof = "asphalt", siding = "wood", stories, roofStyle = "hip", ridge = "x",
            wainscot = "none", garage = null, porch = null, sidingColor = null, trimColor = null } = {}) {
      if (spec.house) return err("house", "only one house allowed");
      num("house", "w", w, 15, 120); num("house", "d", d, 15, 120); num("house", "h", h, 8, 30);
      oneOf("house", "roof", roof, MATERIALS.roof); oneOf("house", "siding", siding, MATERIALS.siding);
      oneOf("house", "roofStyle", roofStyle, MATERIALS.roofStyle); oneOf("house", "ridge", ridge, ["x", "z"]);
      oneOf("house", "wainscot", wainscot, MATERIALS.wainscot);
      const st = stories ?? (h >= 17 ? 2 : 1);
      num("house", "stories", st, 1, 3);
      if (garage) { oneOf("house", "garage.wall", garage.wall, WALLS); num("house", "garage.x", garage.x ?? 0, -60, 60); num("house", "garage.width", garage.width ?? 16, 8, 40); }
      if (porch) { oneOf("house", "porch.wall", porch.wall, WALLS); num("house", "porch.x", porch.x ?? 0, -60, 60); num("house", "porch.w", porch.w ?? 10, 4, 60); num("house", "porch.d", porch.d ?? 6, 3, 15); }
      const color = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
      spec.house = { w, d, h, roof, siding, stories: st, roofStyle, ridge, wainscot,
        garage: garage ? { wall: garage.wall, x: garage.x ?? 0, width: garage.width ?? 16 } : null,
        porch: porch ? { wall: porch.wall, x: porch.x ?? 0, w: porch.w ?? 10, d: porch.d ?? 6 } : null,
        sidingColor: color(sidingColor), trimColor: color(trimColor) };
    },
    vent({ wall, x = 0, h = 2, screened = false } = {}) {
      if (!needHouse("vent")) return;
      oneOf("vent", "wall", wall, WALLS); num("vent", "x", x, -60, 60); num("vent", "h", h, 0.5, 30);
      return push("vent", { wall, x, h, screened: !!screened });
    },
    gutter({ wall, debris = false } = {}) {
      if (!needHouse("gutter")) return;
      oneOf("gutter", "wall", wall, WALLS);
      return push("gutter", { wall, debris: !!debris });
    },
    deck({ wall, depth = 10, length, offset = 0, material = "wood", underside = "open", debris = false } = {}) {
      if (!needHouse("deck")) return;
      oneOf("deck", "wall", wall, WALLS); num("deck", "depth", depth, 3, 30);
      if (length !== undefined) num("deck", "length", length, 4, 120);
      num("deck", "offset", offset, -60, 60);
      oneOf("deck", "material", material, MATERIALS.deck); oneOf("deck", "underside", underside, ["open", "enclosed"]);
      return push("deck", { wall, depth, length: length ?? null, offset, material, underside, debris: !!debris });
    },
    fence({ from, to, material = "wood", attachedToHouse = false } = {}) {
      const pt = (p, name) => Array.isArray(p) && p.length === 2 && num("fence", `${name}[0]`, p[0], -150, 150) && num("fence", `${name}[1]`, p[1], -150, 150);
      if (!pt(from, "from") || !pt(to, "to")) return err("fence", "from/to must be [x, z]");
      oneOf("fence", "material", material, MATERIALS.fence);
      return push("fence", { from, to, material, attachedToHouse: !!attachedToHouse, metalNearHouse: false });
    },
    plant({ x, z, kind = "shrub", height = 4, color = null } = {}) {
      num("plant", "x", x, -150, 150); num("plant", "z", z, -150, 150); num("plant", "height", height, 0.5, 80);
      oneOf("plant", "kind", kind, MATERIALS.plant);
      const c = typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
      return push("plant", { x, z, species: kind, height, ...(c ? { color: c } : {}) });
    },
    mulch({ x, z, w = 4, d = 4, material = "bark" } = {}) {
      num("mulch", "x", x, -150, 150); num("mulch", "z", z, -150, 150); num("mulch", "w", w, 1, 60); num("mulch", "d", d, 1, 60);
      oneOf("mulch", "material", material, MATERIALS.mulch);
      return push("mulch", { x, z, w, d, material });
    },
    // A stand of conifers (e.g. the forest edge behind a lot). Expands into individual trees.
    forest({ x, z, w = 60, d = 30, density = 0.5, height = 60 } = {}) {
      // Forests can extend past the 150 ft modeling area; clamp instead of failing.
      if (typeof w === "number") w = Math.min(w, 300);
      if (typeof d === "number") d = Math.min(d, 300);
      if (!(num("forest", "x", x, -200, 200) & num("forest", "z", z, -200, 200) & num("forest", "w", w, 10, 300) & num("forest", "d", d, 10, 300)
        & num("forest", "density", density, 0.05, 1) & num("forest", "height", height, 15, 150))) return;
      let seed = Math.abs(Math.round(x * 31 + z * 17 + w * 7 + d)) + 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const count = Math.max(3, Math.min(30, Math.round((w * d * density) / 250)));
      for (let i = 0; i < count; i++) {
        push("plant", { x: +(x + (rnd() - 0.5) * w).toFixed(1), z: +(z + (rnd() - 0.5) * d).toFixed(1), species: "conifer", height: +(height * (0.7 + rnd() * 0.5)).toFixed(0), forest: true });
      }
    },
    // Neighboring structure: a fire source the homeowner can't change (house-to-house spread).
    neighbor({ x, z, w = 36, d = 30, h = 18, roof = "asphalt", siding = "wood", stories, sidingColor = null } = {}) {
      num("neighbor", "x", x, -150, 150); num("neighbor", "z", z, -150, 150); num("neighbor", "w", w, 10, 100); num("neighbor", "d", d, 10, 100); num("neighbor", "h", h, 8, 30);
      oneOf("neighbor", "roof", roof, MATERIALS.roof); oneOf("neighbor", "siding", siding, MATERIALS.siding);
      const sc = typeof sidingColor === "string" && /^#[0-9a-fA-F]{6}$/.test(sidingColor) ? sidingColor : null;
      return push("neighbor", { x, z, w, d, h, roof, siding, stories: stories ?? (h >= 17 ? 2 : 1), sidingColor: sc });
    },
    // Non-combustible ground surfaces (visual + they matter for spacing).
    paving({ x, z, w, d, kind = "driveway" } = {}) {
      num("paving", "x", x, -150, 150); num("paving", "z", z, -150, 150); num("paving", "w", w, 2, 200); num("paving", "d", d, 2, 200);
      oneOf("paving", "kind", kind, MATERIALS.paving);
      return push("paving", { x, z, w, d, surface: kind });
    },
    firewood({ x, z } = {}) {
      num("firewood", "x", x, -150, 150); num("firewood", "z", z, -150, 150);
      return push("firewood", { x, z });
    },
    object({ x, z, kind, material = "plastic" } = {}) {
      num("object", "x", x, -150, 150); num("object", "z", z, -150, 150);
      oneOf("object", "kind", kind, MATERIALS.objectKind); oneOf("object", "material", material, MATERIALS.objectMaterial);
      return push("object", { x, z, objKind: kind, material });
    },
    camera({ id: cid, pos, lookAt, videoTimestamp } = {}) {
      const v3 = (p) => Array.isArray(p) && p.length === 3 && p.every((q) => typeof q === "number" && Number.isFinite(q));
      if (!v3(pos) || !v3(lookAt)) return err("camera", "pos and lookAt must be [x, y, z]");
      if (typeof videoTimestamp !== "string" || !/^\d+:\d{2}(\.\d+)?$/.test(videoTimestamp)) return err("camera", `videoTimestamp "${videoTimestamp}" must look like "m:ss"`);
      spec.cameras.push({ id: cid || `cam${spec.cameras.length + 1}`, pos, lookAt, videoTimestamp });
    },
    note(text) { if (typeof text === "string") spec.notes.push(text.slice(0, 300)); },
  };
  return { kit, spec, errors };
}

// Distance (ft) from a point on the ground to the house footprint edge (0 if inside).
export function distToHouse(house, x, z) {
  const dx = Math.max(Math.abs(x) - house.w / 2, 0);
  const dz = Math.max(Math.abs(z) - house.d / 2, 0);
  return Math.hypot(dx, dz);
}

export function validateSpec(spec) {
  const errors = [];
  if (!spec.house) errors.push("no kit.house() call");
  if (spec.cameras.length < 4) errors.push(`need at least 4 kit.camera() calls matching video moments, got ${spec.cameras.length}`);
  if (spec.house) {
    for (const o of spec.objects) {
      if (["plant", "mulch", "firewood", "object"].includes(o.kind) && !o.forest && distToHouse(spec.house, o.x, o.z) > 150) errors.push(`${o.id} (${o.kind}) is >150 ft from the house`);
      if (["plant", "firewood", "object"].includes(o.kind) && Math.abs(o.x) < spec.house.w / 2 - 0.5 && Math.abs(o.z) < spec.house.d / 2 - 0.5) errors.push(`${o.id} (${o.kind}) is inside the house footprint`);
    }
    const vents = spec.objects.filter((o) => o.kind === "vent");
    for (const v of vents) {
      const half = (v.wall === "N" || v.wall === "S" ? spec.house.w : spec.house.d) / 2;
      if (Math.abs(v.x) > half) errors.push(`${v.id} vent x=${v.x} is off the ${v.wall} wall (half-length ${half})`);
      // Gable vents sit above the eaves, up to the roof peak (~12 ft above the wall top).
      if (v.h > spec.house.h + 12) errors.push(`${v.id} vent h=${v.h} is above the roof peak (wall height ${spec.house.h} + up to 12 ft of roof)`);
    }
  }
  for (const o of spec.objects) {
    if (o.kind === "neighbor" && spec.house) {
      const gx = Math.abs(o.x) - (spec.house.w + o.w) / 2, gz = Math.abs(o.z) - (spec.house.d + o.d) / 2;
      if (gx < 2 && gz < 2) errors.push(`${o.id} neighbor overlaps the main house; keep at least 2 ft between footprints`);
    }
  }
  if (spec.objects.length > 150) errors.push(`too many objects (${spec.objects.length} > 150)`);
  return errors;
}

// Runs generated scene code with only `kit` in scope. Used by Node scripts.
export function compileScene(code, runner) {
  const { kit, spec, errors } = createKit();
  try {
    runner(code, kit);
  } catch (e) {
    errors.push(`scene.js threw: ${e && e.message ? e.message : String(e)}`);
  }
  if (!errors.length) errors.push(...validateSpec(spec));
  return { spec, errors };
}
