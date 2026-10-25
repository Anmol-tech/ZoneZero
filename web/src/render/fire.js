// Particle fire + smoke + embers for a running Sim. Advances on *visual* time
// (dt passed to update), so it animates smoothly whatever the sim step rate is.
import * as THREE from "three";

function spriteTexture(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === "fire") { g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.85)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
  else { g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.6, "rgba(255,255,255,0.25)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const VERT = `
  attribute float size; attribute vec4 tint;
  varying vec4 vTint;
  void main() {
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (520.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D map; varying vec4 vTint;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vTint.rgb, vTint.a * t.a);
    if (gl_FragColor.a < 0.01) discard;
  }`;

class Pool {
  constructor(max, kind, blending) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max); this.s0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.size = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.tint = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
    geo.setAttribute("position", this.pos); geo.setAttribute("size", this.size); geo.setAttribute("tint", this.tint);
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { map: { value: spriteTexture(kind) } }, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending, fog: false,
    }));
    this.points.frustumCulled = false;
    this.kind = kind;
  }
  emit(x, y, z, vx, vy, vz, life, size) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.age[i] = 0; this.s0[i] = size;
  }
  step(dt, wind) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) continue;
      const k = a / this.life[i];
      // Buoyant rise, drift downwind, slight turbulence.
      this.v[i * 3] += (wind[0] * 0.6 + Math.sin(a * 7 + i) * 1.5) * dt;
      this.v[i * 3 + 2] += (wind[1] * 0.6 + Math.cos(a * 6 + i) * 1.5) * dt;
      for (let c = 0; c < 3; c++) this.p[i * 3 + c] += this.v[i * 3 + c] * dt;
      // compact into slot w
      this.pos.array.set([this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]], w * 3);
      let r, g, b, al, sz;
      if (this.kind === "fire") {
        // White-yellow core -> orange -> deep red as the tongue rises and dies.
        r = 1; g = Math.max(0.12, 0.95 - k * 1.1); b = Math.max(0, 0.55 - k * 2.2);
        al = (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9) * 0.75; sz = this.s0[i] * (1 - k * 0.7);
      } else {
        const gr = 0.18 + k * 0.25; r = g = b = gr;
        al = (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8) * 0.45; sz = this.s0[i] * (0.6 + k * 1.8);
      }
      this.tint.array.set([r, g, b, al], w * 4);
      this.size.array[w] = sz;
      // keep simulation arrays compact as well
      if (w !== i) {
        for (let c = 0; c < 3; c++) { this.p[w * 3 + c] = this.p[i * 3 + c]; this.v[w * 3 + c] = this.v[i * 3 + c]; }
        this.life[w] = this.life[i]; this.age[w] = this.age[i]; this.s0[w] = this.s0[i];
      }
      w++;
    }
    this.n = w;
    this.points.geometry.setDrawRange(0, w);
    this.pos.needsUpdate = this.size.needsUpdate = this.tint.needsUpdate = true;
  }
}

export class FireFX {
  constructor(scene, sim) {
    this.scene = scene; this.sim = sim;
    this.fire = new Pool(9000, "fire", THREE.AdditiveBlending);
    this.smoke = new Pool(5000, "smoke", THREE.NormalBlending);
    scene.add(this.smoke.points, this.fire.points);
    // Embers: small additive sparks that twinkle.
    this.maxEmbers = 4000;
    const eg = new THREE.BufferGeometry();
    this.ePos = new THREE.BufferAttribute(new Float32Array(this.maxEmbers * 3), 3);
    this.eSize = new THREE.BufferAttribute(new Float32Array(this.maxEmbers), 1);
    this.eTint = new THREE.BufferAttribute(new Float32Array(this.maxEmbers * 4), 4);
    eg.setAttribute("position", this.ePos); eg.setAttribute("size", this.eSize); eg.setAttribute("tint", this.eTint);
    this.embers = new THREE.Points(eg, new THREE.ShaderMaterial({ uniforms: { map: { value: spriteTexture("fire") } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.embers.frustumCulled = false;
    scene.add(this.embers);
    this.lights = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xff6a20, 0, 90, 1.6); scene.add(l); return l; });
    this.t = 0;
    this.carry = new Map();
  }
  update(dt) {
    this.t += dt;
    const wind = [this.sim.blow[0] * 4, this.sim.blow[1] * 4];
    const burning = this.sim.nodes.filter((n) => n.state === "burning" && n.intensity > 0.02);
    for (const n of burning) {
      // Emission scales with node size and intensity; carry fractional particles between frames.
      const rate = (8 + n.r * n.r * 3) * n.intensity;
      let c = (this.carry.get(n.idx) || 0) + rate * dt;
      while (c >= 1) {
        c -= 1;
        const a = Math.random() * Math.PI * 2, rr = Math.random() * n.r * 0.8;
        const x = n.p[0] + Math.cos(a) * rr, z = n.p[2] + Math.sin(a) * rr, y = n.p[1] - n.r * 0.4 + Math.random() * n.r * 0.5;
        this.fire.emit(x, y, z, (Math.random() - 0.5) * 1.5, 7 + Math.random() * 8 * n.intensity, (Math.random() - 0.5) * 1.5, 0.45 + Math.random() * 0.6, 1.6 + Math.min(n.r, 5) * (0.35 + Math.random() * 0.45));
        if (Math.random() < 0.35) this.smoke.emit(x, y + n.r * 0.6, z, (Math.random() - 0.5), 4 + Math.random() * 3, (Math.random() - 0.5), 3 + Math.random() * 3, 3 + n.r * 0.6);
      }
      this.carry.set(n.idx, c);
    }
    this.fire.step(dt, wind);
    this.smoke.step(dt, wind);

    // Embers from the sim (positions), twinkling.
    const n = Math.min(this.sim.embers.length, this.maxEmbers);
    for (let i = 0; i < n; i++) {
      const e = this.sim.embers[i];
      this.ePos.array.set([e.x, e.y, e.z], i * 3);
      const tw = 0.6 + 0.4 * Math.sin(this.t * 18 + i * 1.7);
      this.eTint.array.set([1, 0.55 + 0.3 * tw, 0.15, 0.9 * tw], i * 4);
      this.eSize.array[i] = 0.45 + 0.35 * tw;
    }
    this.embers.geometry.setDrawRange(0, n);
    this.ePos.needsUpdate = this.eSize.needsUpdate = this.eTint.needsUpdate = true;

    // Up to 4 flickering lights on the biggest fires.
    const big = burning.sort((a, b) => b.intensity * b.r - a.intensity * a.r).slice(0, 4);
    this.lights.forEach((l, i) => {
      const b = big[i];
      if (!b) { l.intensity = 0; return; }
      l.position.set(b.p[0], b.p[1] + b.r, b.p[2]);
      l.intensity = (500 + b.r * 160) * b.intensity * (0.8 + 0.25 * Math.sin(this.t * 23 + i * 3) + 0.1 * Math.sin(this.t * 41 + i));
    });
  }
  dispose() {
    this.scene.remove(this.fire.points, this.smoke.points, this.embers, ...this.lights);
  }
}
