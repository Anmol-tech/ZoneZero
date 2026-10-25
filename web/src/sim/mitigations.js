// The only fixes Argon (or the Managed Agent) may recommend. Each maps to
// published CAL FIRE / IBHS home-hardening guidance and is applied to the
// spec as a pure transform, so before/after runs differ only by the fix.

import { distToHouse } from "../kit/spec.js";

export const CATALOG = {
  clear_gutters: { title: "Clean gutters / add metal gutter guards", cost: "$", target: "gutter id or \"all\"", zone0: false },
  screen_vents: { title: "Cover vents with 1/8\" metal mesh (ember-resistant vents)", cost: "$", target: "vent id or \"all\"", zone0: false },
  metal_fence_section: { title: "Replace first 5 ft of fence at the house with a metal gate/section", cost: "$$", target: "fence id", zone0: true },
  metal_fence_full: { title: "Replace the whole wood fence with metal/masonry", cost: "$$$", target: "fence id", zone0: false },
  clear_zone0_plants: { title: "Remove plants within 5 ft of the house (Zone 0)", cost: "$", target: "\"all\"", zone0: true },
  gravel_zone0: { title: "Replace bark mulch with gravel within 5 ft of the house", cost: "$", target: "mulch id or \"all\"", zone0: true },
  move_firewood: { title: "Move firewood 30+ ft from the house", cost: "$", target: "firewood id or \"all\"", zone0: true },
  enclose_deck: { title: "Clear debris under the deck and enclose the underside", cost: "$$", target: "deck id", zone0: false },
  clear_deck_items: { title: "Move combustible furniture/items off the deck and away from walls", cost: "$", target: "\"all\"", zone0: true },
  class_a_roof: { title: "Replace roof with a Class A (metal/tile) roof", cost: "$$$", target: "\"house\"", zone0: false },
  trim_trees: { title: "Trim/remove tree crowns within 10 ft of the house", cost: "$$", target: "plant id or \"all\"", zone0: false },
  zone1_trees: { title: "Zone 1 (5-30 ft): limb up and thin trees, remove dead branches", cost: "$$", target: "plant id or \"all\"", zone0: false },
  zone1_mulch: { title: "Zone 1 (5-30 ft): replace bark mulch with gravel or irrigated ground cover", cost: "$", target: "mulch id or \"all\"", zone0: false },
};

const COST_RANK = { $: 1, $$: 2, $$$: 3 };
export const costRank = (fixId) => COST_RANK[CATALOG[fixId]?.cost] ?? 9;

const clone = (s) => JSON.parse(JSON.stringify(s));

// fixes: [{ fix: "screen_vents", target: "v3" | "all" }]
export function applyFixes(spec, fixes) {
  const out = clone(spec);
  const applied = [], rejected = [];
  const h = out.house;
  const near = (o, ft) => distToHouse(h, o.x, o.z) < ft;
  const pick = (kind, target) => out.objects.filter((o) => o.kind === kind && (target === "all" || o.id === target));

  for (const f of fixes) {
    const def = CATALOG[f.fix];
    if (!def) { rejected.push({ ...f, reason: `"${f.fix}" is not in the mitigation catalog` }); continue; }
    const target = f.target ?? "all";
    let changed = 0;
    switch (f.fix) {
      case "clear_gutters":
        for (const g of pick("gutter", target)) if (g.debris) { g.debris = false; changed++; }
        break;
      case "screen_vents":
        for (const v of pick("vent", target)) if (!v.screened) { v.screened = true; changed++; }
        break;
      case "metal_fence_section":
        for (const fe of pick("fence", target)) if (fe.material === "wood" && !fe.metalNearHouse) { fe.metalNearHouse = true; changed++; }
        break;
      case "metal_fence_full":
        for (const fe of pick("fence", target)) if (fe.material === "wood") { fe.material = "metal"; changed++; }
        break;
      case "clear_zone0_plants": {
        const before = out.objects.length;
        out.objects = out.objects.filter((o) => !(o.kind === "plant" && o.species !== "tree" && o.species !== "conifer" && near(o, 5)));
        changed = before - out.objects.length;
        break;
      }
      case "gravel_zone0":
        for (const m of pick("mulch", target)) if (m.material === "bark" && distToHouse(h, m.x, m.z) < 5 + Math.max(m.w, m.d) / 2) { m.material = "gravel"; changed++; }
        break;
      case "move_firewood":
        for (const fw of pick("firewood", target)) if (near(fw, 30)) {
          const len = Math.hypot(fw.x, fw.z) || 1;
          const need = 30 + Math.max(h.w, h.d) / 2 + 2;
          fw.x = +((fw.x / len) * need).toFixed(1); fw.z = +((fw.z / len) * need).toFixed(1);
          changed++;
        }
        break;
      case "enclose_deck":
        for (const d of pick("deck", target)) if (d.underside === "open" || d.debris) { d.underside = "enclosed"; d.debris = false; changed++; }
        break;
      case "clear_deck_items":
        for (const o of out.objects) if (o.kind === "object" && o.material !== "metal" && near(o, 6) && o.objKind !== "car") {
          const len = Math.hypot(o.x, o.z) || 1, need = Math.max(h.w, h.d) / 2 + 12;
          o.x = +((o.x / len) * need).toFixed(1); o.z = +((o.z / len) * need).toFixed(1);
          changed++;
        }
        break;
      case "class_a_roof":
        if (h.roof === "wood_shake" || h.roof === "asphalt") { h.roof = "metal"; changed++; }
        break;
      case "trim_trees": {
        const before = out.objects.length;
        out.objects = out.objects.filter((o) => !(o.kind === "plant" && (o.species === "tree" || o.species === "conifer") && (target === "all" || o.id === target) && near(o, 10)));
        changed = before - out.objects.length;
        break;
      }
      case "zone1_trees":
        for (const t of pick("plant", target)) if ((t.species === "tree" || t.species === "conifer") && !t.limbed && near(t, 30 + t.height / 3)) { t.limbed = true; changed++; }
        break;
      case "zone1_mulch":
        for (const m of pick("mulch", target)) if (m.material === "bark" && distToHouse(h, m.x, m.z) < 30 + Math.max(m.w, m.d) / 2) { m.material = "gravel"; changed++; }
        break;
    }
    if (changed) applied.push({ ...f, target, title: def.title, cost: def.cost, changed });
    else rejected.push({ ...f, reason: target !== "all" && !out.objects.some((o) => o.id === target)
      ? `no object with id "${target}"`
      : "already done, or the target is outside this fix's distance range (try the Zone 1 fixes for 5-30 ft)" });
  }
  return { spec: out, applied, rejected };
}

// Compact text summary of the spec for prompts.
export function describeSpec(spec) {
  const h = spec.house;
  const lines = [`house ${h.w}x${h.d} ft, wall height ${h.h} ft, roof=${h.roof}, siding=${h.siding}`];
  for (const o of spec.objects) {
    const d = o.x !== undefined ? ` @(${o.x},${o.z}) ${distToHouse(h, o.x, o.z).toFixed(1)} ft from house` : "";
    const { id, kind, ...rest } = o;
    delete rest.x; delete rest.z;
    lines.push(`${id}: ${kind} ${JSON.stringify(rest)}${d}`);
  }
  return lines.join("\n");
}
