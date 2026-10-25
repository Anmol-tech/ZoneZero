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
  paving: ["driveway", "path", "patio", "street", "pool"],
  pavingShape: ["rect", "circle", "ring"],
  mulch: ["bark", "gravel"],
  objectKind: ["patio_furniture", "trash_bin", "propane_tank", "car", "doormat", "planter"],
  objectMaterial: ["wood", "plastic", "metal", "fabric", "wicker"],
  furnitureItem: ["chair", "lounge_chair", "sofa", "table", "coffee_table", "dining_set", "bench", "grill", "umbrella"],
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
  const color = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null);
  // Walls that are mostly floor-to-ceiling glass on the ground floor (sliding doors, window walls).
  const walls = (call, v) => {
    const list = typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
    return list.filter((w) => oneOf(call, "glass", w, WALLS));
  };
  const needHouse = (call) => {
    if (!spec.house) { err(call, "kit.house() must be called first"); return false; }
    return true;
  };
  const push = (kind, o) => { const obj = { id: o.id || id(kind[0]), kind, ...o }; spec.objects.push(obj); return obj.id; };

  const kit = {
    house({ w = 40, d = 30, h = 12, roof = "asphalt", siding = "wood", stories, roofStyle = "hip", ridge = "x",
            wainscot = "none", garage = null, porch = null, sidingColor = null, trimColor = null, glass = [] } = {}) {
      if (spec.house) return err("house", "only one house allowed");
      num("house", "w", w, 15, 120); num("house", "d", d, 15, 120); num("house", "h", h, 8, 30);
      oneOf("house", "roof", roof, MATERIALS.roof); oneOf("house", "siding", siding, MATERIALS.siding);
      oneOf("house", "roofStyle", roofStyle, MATERIALS.roofStyle); oneOf("house", "ridge", ridge, ["x", "z"]);
      oneOf("house", "wainscot", wainscot, MATERIALS.wainscot);
      const st = stories ?? (h >= 17 ? 2 : 1);
      num("house", "stories", st, 1, 3);
      if (garage) { oneOf("house", "garage.wall", garage.wall, WALLS); num("house", "garage.x", garage.x ?? 0, -60, 60); num("house", "garage.width", garage.width ?? 16, 8, 40); }
      if (porch) { oneOf("house", "porch.wall", porch.wall, WALLS); num("house", "porch.x", porch.x ?? 0, -60, 60); num("house", "porch.w", porch.w ?? 10, 4, 60); num("house", "porch.d", porch.d ?? 6, 3, 15); }
      spec.house = { w, d, h, roof, siding, stories: st, roofStyle, ridge, wainscot, wings: [], chimneys: [],
        garage: garage ? { wall: garage.wall, x: garage.x ?? 0, width: garage.width ?? 16 } : null,
        porch: porch ? { wall: porch.wall, x: porch.x ?? 0, w: porch.w ?? 10, d: porch.d ?? 6 } : null,
        sidingColor: color(sidingColor), trimColor: color(trimColor), glass: walls("house", glass) };
    },
    // An attached section that changes the footprint: L/T shapes, a forward garage, a bump-out.
    // It sticks out from `wall` of the main block, centered `offset` ft along that wall,
    // `w` ft wide along the wall and `d` ft deep away from it, with its own roof.
    wing({ wall, offset = 0, w = 20, d = 20, h, roof, roofStyle = "gable", ridge, siding, stories, garage = null, sidingColor = null, glass = [] } = {}) {
      if (!needHouse("wing")) return;
      const H = spec.house;
      if (H.wings.length >= 4) return err("wing", "at most 4 wings");
      oneOf("wing", "wall", wall, WALLS); num("wing", "offset", offset, -60, 60); num("wing", "w", w, 4, 80); num("wing", "d", d, 1.5, 60);
      const wh = h ?? Math.min(H.h, 10);
      // A wing may be taller than the block passed to kit.house (e.g. a two-story section on a one-story base).
      num("wing", "h", wh, 7, 40);
      // Masonry-faced sections are modeled as the house siding over a masonry base.
      const wr = roof ?? H.roof, ws = ["stone", "brick", "masonry"].includes(siding) ? H.siding : (siding ?? H.siding);
      oneOf("wing", "roof", wr, MATERIALS.roof); oneOf("wing", "siding", ws, MATERIALS.siding); oneOf("wing", "roofStyle", roofStyle, MATERIALS.roofStyle);
      const along = wall === "N" || wall === "S";
      // Absolute footprint rectangle (x/z sizes) centered at cx, cz.
      const sx = along ? w : d, sz = along ? d : w;
      const cx = along ? offset : (wall === "E" ? H.w / 2 + d / 2 : -H.w / 2 - d / 2);
      const cz = along ? (wall === "S" ? H.d / 2 + d / 2 : -H.d / 2 - d / 2) : offset;
      if (garage) { oneOf("wing", "garage.wall", garage.wall, WALLS); num("wing", "garage.width", garage.width ?? 16, 8, 40); }
      const r = ridge ?? (along ? "z" : "x"); // default: a cross gable perpendicular to the main roof
      oneOf("wing", "ridge", r, ["x", "z"]);
      H.wings.push({ id: `w${H.wings.length + 1}`, wall, x: cx, z: cz, w: sx, d: sz, h: wh, roof: wr, siding: ws, roofStyle, ridge: r,
        stories: stories ?? (wh >= 17 ? 2 : 1), garage: garage ? { wall: garage.wall, x: garage.x ?? 0, width: garage.width ?? 16 } : null,
        sidingColor: color(sidingColor), glass: walls("wing", glass) });
    },
    // A masonry or metal chimney (visual; spark arrestors are outside this model).
    chimney({ x = 0, z = 0, h } = {}) {
      if (!needHouse("chimney")) return;
      num("chimney", "x", x, -80, 80); num("chimney", "z", z, -80, 80);
      spec.house.chimneys.push({ x, z, h: h ?? spec.house.h + 10 });
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
    // shape "circle" = ellipse filling w×d; "ring" = circular drive around an unpaved island (inner = island size 0.1–0.9 of w/d).
    paving({ x, z, w, d, kind = "driveway", shape = "rect", inner = 0.45 } = {}) {
      num("paving", "x", x, -150, 150); num("paving", "z", z, -150, 150); num("paving", "w", w, 2, 200); num("paving", "d", d, 2, 200);
      oneOf("paving", "kind", kind, MATERIALS.paving); oneOf("paving", "shape", shape, MATERIALS.pavingShape);
      if (shape === "ring") num("paving", "inner", inner, 0.1, 0.9);
      return push("paving", { x, z, w, d, surface: kind, shape, ...(shape === "ring" ? { inner } : {}) });
    },
    firewood({ x, z } = {}) {
      num("firewood", "x", x, -150, 150); num("firewood", "z", z, -150, 150);
      return push("firewood", { x, z });
    },
    // item picks the 3D model for patio_furniture; rot turns it (degrees, 0 = front faces +z / South).
    object({ x, z, kind, material = "plastic", item, rot = 0, color } = {}) {
      num("object", "x", x, -150, 150); num("object", "z", z, -150, 150); num("object", "rot", rot, -360, 360);
      oneOf("object", "kind", kind, MATERIALS.objectKind); oneOf("object", "material", material, MATERIALS.objectMaterial);
      if (item !== undefined) oneOf("object", "item", item, MATERIALS.furnitureItem);
      return push("object", { x, z, objKind: kind, material, rot, ...(item ? { item } : {}), ...(color && /^#[0-9a-fA-F]{6}$/.test(color) ? { color } : {}) });
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

// Is ground point (x, z) covered by this paving (respecting circle/ring shapes)?
export function onPaving(p, x, z) {
  const dx = (x - p.x) / (p.w / 2), dz = (z - p.z) / (p.d / 2);
  if (p.shape === "circle" || p.shape === "ring") {
    const r = Math.hypot(dx, dz);
    return r < 1 && !(p.shape === "ring" && r < p.inner);
  }
  return Math.abs(dx) < 1 && Math.abs(dz) < 1;
}

// What may sit on each paved surface. Plants, mulch and firewood never go on paving.
const ALLOWED_ON = {
  driveway: ["car", "trash_bin", "planter"], street: ["car"], path: ["doormat", "planter", "trash_bin"],
  patio: ["patio_furniture", "planter", "doormat", "propane_tank", "trash_bin"], pool: [],
};
const label = (o) => o.species || o.objKind || o.kind;

// Footprint rectangles: the main block plus any wings, as {x, z, w, d} centered boxes.
export function houseRects(house) {
  return [{ x: 0, z: 0, w: house.w, d: house.d }, ...(house.wings || [])];
}

// Distance (ft) from a point on the ground to the nearest house footprint edge (0 if inside).
export function distToHouse(house, x, z) {
  let best = Infinity;
  for (const r of houseRects(house)) {
    const dx = Math.max(Math.abs(x - r.x) - r.w / 2, 0);
    const dz = Math.max(Math.abs(z - r.z) - r.d / 2, 0);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

export function validateSpec(spec) {
  const errors = [];
  if (!spec.house) errors.push("no kit.house() call");
  if (spec.cameras.length < 4) errors.push(`need at least 4 kit.camera() calls matching video moments, got ${spec.cameras.length}`);
  if (spec.house) {
    // A plant or object a little inside the walls is a placement slip, not a modeling error: move it just outside
    // the nearest wall here instead of spending an Argon repair round on it.
    for (const o of spec.objects) {
      if (!["plant", "firewood", "object"].includes(o.kind)) continue;
      for (let pass = 0; pass < 4; pass++) {
        const r = houseRects(spec.house).find((q) => Math.abs(o.x - q.x) < q.w / 2 - 0.5 && Math.abs(o.z - q.z) < q.d / 2 - 0.5);
        if (!r) break;
        const exits = [[r.x - r.w / 2 - 1.5, o.z], [r.x + r.w / 2 + 1.5, o.z], [o.x, r.z - r.d / 2 - 1.5], [o.x, r.z + r.d / 2 + 1.5]];
        const [nx, nz] = exits.sort((a, b) => Math.hypot(a[0] - o.x, a[1] - o.z) - Math.hypot(b[0] - o.x, b[1] - o.z))[0];
        spec.notes.push(`Moved ${o.id} (${o.item || o.objKind || o.species || o.kind}) ${Math.hypot(nx - o.x, nz - o.z).toFixed(1)} ft out of the house footprint`);
        o.x = Math.round(nx * 10) / 10; o.z = Math.round(nz * 10) / 10;
      }
    }
    for (const o of spec.objects) {
      if (["plant", "mulch", "firewood", "object"].includes(o.kind) && !o.forest && distToHouse(spec.house, o.x, o.z) > 150) errors.push(`${o.id} (${o.kind}) is >150 ft from the house`);
      if (["plant", "firewood", "object"].includes(o.kind) && houseRects(spec.house).some((r) => Math.abs(o.x - r.x) < r.w / 2 - 0.5 && Math.abs(o.z - r.z) < r.d / 2 - 0.5)) errors.push(`${o.id} (${o.kind}) is inside the house footprint (main block or a wing)`);
    }
    const vents = spec.objects.filter((o) => o.kind === "vent");
    for (const v of vents) {
      const half = (v.wall === "N" || v.wall === "S" ? spec.house.w : spec.house.d) / 2;
      if (Math.abs(v.x) > half) errors.push(`${v.id} vent x=${v.x} is off the ${v.wall} wall (half-length ${half})`);
      // Gable vents sit above the eaves, up to the roof peak (~12 ft above the wall top).
      if (v.h > spec.house.h + 12) errors.push(`${v.id} vent h=${v.h} is above the roof peak (wall height ${spec.house.h} + up to 12 ft of roof)`);
    }
  }
  // Placement sanity: nothing growing on pavement or inside a neighbor's house; vehicles only on drives/streets.
  const pavings = spec.objects.filter((o) => o.kind === "paving");
  const neighbors = spec.objects.filter((o) => o.kind === "neighbor");
  const inNeighbor = (o) => neighbors.find((n) => Math.abs(o.x - n.x) < n.w / 2 - 0.5 && Math.abs(o.z - n.z) < n.d / 2 - 0.5);
  // Generated forest trees that land on pavement or buildings are simply dropped.
  spec.objects = spec.objects.filter((o) => !(o.forest && (pavings.some((p) => onPaving(p, o.x, o.z)) || inNeighbor(o)
    || (spec.house && houseRects(spec.house).some((r) => Math.abs(o.x - r.x) < r.w / 2 + 3 && Math.abs(o.z - r.z) < r.d / 2 + 3)))));
  for (const o of spec.objects) {
    if (!["plant", "mulch", "firewood", "object"].includes(o.kind)) continue;
    const n = inNeighbor(o);
    if (n) errors.push(`${o.id} (${label(o)}) at (${o.x}, ${o.z}) is inside neighbor ${n.id}'s footprint; move it outside that building`);
    for (const p of pavings) {
      if (!onPaving(p, o.x, o.z)) continue;
      if (o.kind === "object" && ALLOWED_ON[p.surface].includes(o.objKind)) continue;
      const hint = p.surface === "driveway" && (o.kind === "plant" || o.kind === "mulch")
        ? " If it grows in an island inside a circular drive, use paving shape \"ring\" (the island stays unpaved); otherwise move it beside the paving."
        : " Move it beside the paving, or shrink/split the paving to match the footage.";
      errors.push(`${o.id} (${label(o)}) at (${o.x}, ${o.z}) sits on the ${p.surface} ${p.id}.${hint}`);
    }
    if (o.kind === "object" && o.objKind === "car" && !pavings.some((p) => (p.surface === "driveway" || p.surface === "street") && onPaving(p, o.x, o.z)))
      spec.notes.push(`check: ${o.id} (car) is not on a driveway or street`);
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
