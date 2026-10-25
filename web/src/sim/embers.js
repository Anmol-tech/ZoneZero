// Deterministic ember-storm simulation. Pure JS: runs in the browser (for the
// live view and headless recording) and in Node (for the Managed Agent's
// sandbox search). Same spec + same options => same result.

import { buildNodes } from "./nodes.js";

export const DEFAULTS = { windFrom: 270, mph: 30, seed: 7, duration: 90, dt: 0.1, emberRate: 70 };

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// windFrom is the compass direction the wind blows FROM (0 = N, 90 = E).
// World axes: +x = East, -z = North.
export function windVectors(windFrom) {
  const t = (windFrom * Math.PI) / 180;
  const from = [Math.sin(t), -Math.cos(t)];
  return { from, blow: [-from[0], -from[1]], side: [-from[1], from[0]] };
}

export function fmtTime(t) {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export class Sim {
  constructor(spec, opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.spec = spec;
    this.rand = mulberry32(this.opts.seed);
    this.nodes = buildNodes(spec).map((n) => ({ ...n, ember: 0, dose: 0, state: "idle", burnT: 0, intensity: 0 }));
    this.fuelNodes = this.nodes.filter((n) => n.f > 0.001);
    this.embers = [];
    this.t = 0;
    this.events = [];
    this.houseIgnitedAt = null;
    this.emberCarry = 0;
    const w = windVectors(this.opts.windFrom);
    this.blow = w.blow; this.from = w.from; this.side = w.side;
    this.speed = this.opts.mph * 1.467; // ft/s
    const h = spec.house;
    this.reach = Math.max(h.w, h.d) / 2 + 60;
  }

  get done() { return this.t >= this.opts.duration - 1e-9; }

  ignite(n, cause, from) {
    if (n.state !== "idle") return;
    n.state = "burning"; n.burnT = 0;
    const ev = { t: +this.t.toFixed(1), time: fmtTime(this.t), node: n.idx, obj: n.obj, label: n.label, part: n.part, cause };
    if (from) { ev.from = from.idx; ev.fromObj = from.obj; ev.fromLabel = from.label; }
    this.events.push(ev);
    if (n.critical && this.houseIgnitedAt === null) {
      this.houseIgnitedAt = this.t;
      this.events.push({ t: ev.t, time: ev.time, type: "house_ignites", via: n.label, cause });
    }
  }

  spawnEmbers(dt) {
    // Storm builds over the first 15 s, then holds.
    const ramp = Math.min(1, this.t / 15);
    this.emberCarry += this.opts.emberRate * ramp * dt;
    while (this.emberCarry >= 1) {
      this.emberCarry -= 1;
      const lat = (this.rand() * 2 - 1) * this.reach;
      const back = this.reach + this.rand() * 20;
      this.embers.push({
        x: this.from[0] * back + this.side[0] * lat,
        z: this.from[1] * back + this.side[1] * lat,
        y: 8 + this.rand() * 35,
        vs: 0.75 + this.rand() * 0.5,
        fall: 4 + this.rand() * 4,
        life: 0,
      });
    }
  }

  step() {
    const dt = this.opts.dt;
    const h = this.spec.house;
    this.spawnEmbers(dt);

    // Embers drift, fall, and lodge in whatever they hit.
    const keep = [];
    for (const e of this.embers) {
      const gust = 0.85 + 0.3 * Math.sin(e.life * 3 + e.vs * 10);
      e.x += this.blow[0] * this.speed * e.vs * gust * dt;
      e.z += this.blow[1] * this.speed * e.vs * gust * dt;
      e.y -= e.fall * dt;
      e.life += dt;
      let alive = e.y > 0 && e.life < 12;
      if (alive) {
        for (const n of this.fuelNodes) {
          if (n.state !== "idle") continue;
          const dx = e.x - n.p[0], dy = e.y - n.p[1], dz = e.z - n.p[2];
          if (dx * dx + dy * dy + dz * dz < n.r * n.r) {
            if (this.rand() < n.trap) {
              n.ember += 1;
              n.dose += n.f * 0.34;
              if (n.dose >= 1) this.ignite(n, "ember");
              alive = false;
            }
            break;
          }
        }
      }
      // The house body stops embers that did not lodge in a house node.
      if (alive && Math.abs(e.x) < h.w / 2 && Math.abs(e.z) < h.d / 2 && e.y < h.h + 6) alive = false;
      if (alive) keep.push(e);
    }
    this.embers = keep;

    // Burning nodes heat their neighbors (radiant/contact spread, wind-biased).
    for (const b of this.nodes) {
      if (b.state !== "burning") continue;
      b.burnT += dt;
      const up = Math.min(1, b.burnT / 4);
      const down = Math.min(1, Math.max(0, (b.fuel - b.burnT) / (b.fuel * 0.3)));
      b.intensity = up * down;
      if (b.burnT >= b.fuel) { b.state = "burnt"; b.intensity = 0; continue; }
      if (b.heat <= 0) continue;
      const reach = 1.5 + 5 * b.heat;
      for (const n of this.fuelNodes) {
        if (n.state !== "idle" || n === b) continue;
        const dx = n.p[0] - b.p[0], dy = n.p[1] - b.p[1], dz = n.p[2] - b.p[2];
        const dist = Math.hypot(dx, dy, dz);
        const gap = Math.max(0, dist - b.r - n.r);
        if (gap > reach * 2.5) continue;
        const dir = dist > 0 ? (dx * this.blow[0] + dz * this.blow[1]) / dist : 0;
        const windBoost = 1 + 0.7 * Math.max(0, dir) + (dy > 0 ? 0.4 : 0);
        n.dose += b.heat * b.intensity * n.f * Math.exp(-gap / reach) * 0.14 * windBoost * dt;
        if (n.dose >= 1) this.ignite(n, "spread", b);
      }
    }
    this.t += dt;
  }

  run() {
    while (!this.done) this.step();
    return this.result();
  }

  result() {
    const ign = this.events.filter((e) => !e.type);
    const byObj = {};
    for (const e of ign) if (!byObj[e.obj]) byObj[e.obj] = { obj: e.obj, label: e.label, first: e.time, cause: e.cause, fromLabel: e.fromLabel || null };
    return {
      opts: this.opts,
      houseIgnited: this.houseIgnitedAt !== null,
      houseIgnitedAt: this.houseIgnitedAt === null ? null : fmtTime(this.houseIgnitedAt),
      houseIgnitedAtSec: this.houseIgnitedAt,
      ignitedObjects: Object.values(byObj),
      events: ign.slice(0, 120).concat(this.events.filter((e) => e.type)),
      chain: this.chain(),
    };
  }

  // Walks back from the first house ignition to the ember that started it.
  chain() {
    const first = this.events.find((e) => e.type === "house_ignites");
    if (!first) return [];
    const byNode = new Map(this.events.filter((e) => !e.type).map((e) => [e.node, e]));
    const houseEv = this.events.find((e) => !e.type && this.nodes[e.node].critical);
    const out = [];
    let cur = houseEv;
    while (cur && out.length < 12) {
      out.unshift({ time: cur.time, label: cur.label, obj: cur.obj, cause: cur.cause });
      cur = cur.from !== undefined ? byNode.get(cur.from) : null;
    }
    return out;
  }
}

export function simulate(spec, opts) {
  return new Sim(spec, opts).run();
}
