import * as THREE from 'three';
import { Sim, fmtTime } from '../sim/embers.js';
import { buildScene, addLights, SimView, configureRenderer } from '../render/build3d.js';
import { overviewCamera } from '../render/views.js';

// One reusable WebGL context serves all 24 thumbnails. They are actual
// deterministic replays of the verified scenario, not decorative placeholders.
export function createScenarioPreviewer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  configureRenderer(renderer);
  renderer.shadowMap.enabled = false;
  renderer.setSize(320, 180);
  return {
    render(spec, cell, options) {
      const scene = new THREE.Scene();
      addLights(scene);
      const built = buildScene(spec);
      scene.add(built.root);
      const sim = new Sim(spec, { ...options, windFrom: cell.wind, seed: cell.seed });
      const view = new SimView(scene, built, sim);
      const ignition = cell.worker?.result?.houseIgnitedAtSec;
      const timestamp = cell.houseIgnitedAt?.split(':').map(Number);
      const target = cell.houseIgnitedAt === null ? sim.opts.duration
        : Math.min(sim.opts.duration, (ignition ?? timestamp[0] * 60 + timestamp[1]) + 2);
      try {
        let step = 0;
        while (!sim.done && sim.t < target) {
          sim.step();
          if (++step % 5 === 0) view.update(sim.opts.dt * 5);
        }
        view.update(sim.opts.dt);
        const actual = sim.houseIgnitedAt === null ? null : fmtTime(sim.houseIgnitedAt);
        if (actual !== cell.houseIgnitedAt) throw new Error('Replay differs from the stored verification');
        renderer.render(scene, overviewCamera(spec, cell.wind, 16 / 9));
        return { src: renderer.domElement.toDataURL('image/jpeg', .78), time: fmtTime(sim.t) };
      } finally {
        view.dispose();
        const geometries = new Set(), materials = new Set();
        scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
          if (object.material) for (const material of [object.material].flat()) materials.add(material);
          object.shadow?.dispose();
        });
        geometries.forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
      }
    },
    dispose() { renderer.dispose(); },
  };
}
