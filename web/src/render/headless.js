// Page driven by Playwright (server/render.py): renders a spec from the
// video-matched cameras, or records an ember-storm run as JPEG frames.
import * as THREE from "three";
import { buildScene, addLights, SimView, configureRenderer } from "./build3d.js";
import { Sim } from "../sim/embers.js";
import { overviewCamera, drawHud, drawPins, drawLegend, drawLegendChip } from "./views.js";
import { computeMarkers, groupMarkers, projectPins } from "./markers.js";

const W = 960, H = 540;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
configureRenderer(renderer);
document.body.appendChild(renderer.domElement);
const hud = document.createElement("canvas");
hud.width = W; hud.height = H;
const out = document.createElement("canvas");
out.width = W; out.height = H;

function fresh(spec) {
  const scene = new THREE.Scene();
  addLights(scene);
  const built = buildScene(spec);
  scene.add(built.root);
  return { scene, built };
}

// The full legend shows while the scene is introduced, then minimizes to a count chip.
function snapshot(text, pins, groups, labelAlpha = 1, fullLegend = true) {
  const ctx = out.getContext("2d");
  ctx.drawImage(renderer.domElement, 0, 0);
  if (pins?.length) drawPins(ctx, pins, { alpha: labelAlpha });
  if (groups?.length) fullLegend ? drawLegend(ctx, groups, 12, H - 12, 0.95) : drawLegendChip(ctx, groups, 12, H - 12);
  if (text) { drawHud(hud, text); ctx.drawImage(hud, 0, 0); }
  return out.toDataURL("image/jpeg", 0.72);
}

window.ZZ = {
  renderCameras(spec) {
    const { scene } = fresh(spec);
    const cam = new THREE.PerspectiveCamera(60, W / H, 0.5, 1000);
    return spec.cameras.map((c) => {
      cam.position.set(...c.pos); cam.lookAt(...c.lookAt);
      renderer.render(scene, cam);
      return { id: c.id, videoTimestamp: c.videoTimestamp, dataUrl: snapshot(`model view "${c.id}" (video ${c.videoTimestamp})`) };
    });
  },
  // One frame every `every` sim steps (0.3 s of sim time), played back at 15 fps.
  recordSim(spec, opts, every = 3, fps = 15) {
    const { scene, built } = fresh(spec);
    const sim = new Sim(spec, opts);
    const view = new SimView(scene, built, sim);
    const groups = groupMarkers(computeMarkers(spec));
    const frames = [];
    const total = Math.ceil(sim.opts.duration / (sim.opts.dt * every));
    let i = 0, f = 0;
    while (!sim.done) {
      sim.step();
      if (i++ % every === 0) {
        // Slow 20° orbit over the clip keeps the motion smooth and shows depth.
        const cam = overviewCamera(spec, sim.opts.windFrom, W / H, -10 + (20 * f) / total);
        view.update(1 / fps);
        renderer.render(scene, cam);
        const labelAlpha = sim.t < 6 ? 1 : 0.55;
        frames.push(snapshot(hudLines(sim, opts.label), projectPins(groups, cam, W, H, THREE, "all", built.byObj.get("house")), groups, labelAlpha, sim.t < 5));
        f++;
      }
    }
    return { frames, fps, result: sim.result() };
  },
};

function hudLines(sim, label) {
  const t = Math.floor(sim.t);
  const lines = [`${label || "simulation"}  ·  t=${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}  ·  wind from ${sim.opts.windFrom}° @ ${sim.opts.mph} mph`];
  const ign = sim.events.filter((e) => !e.type).slice(-3).map((e) => `${e.time} ${e.label} ignites (${e.cause}${e.fromLabel ? " from " + e.fromLabel : ""})`);
  lines.push(...ign);
  if (sim.houseIgnitedAt !== null) lines.push(`HOUSE IGNITED at ${Math.floor(sim.houseIgnitedAt / 60)}:${String(Math.floor(sim.houseIgnitedAt % 60)).padStart(2, "0")}`);
  return lines;
}
window.ZZ_READY = true;
