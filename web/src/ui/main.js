import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildScene, addLights, SimView, configureRenderer } from '../render/build3d.js';
import { Sim, fmtTime } from '../sim/embers.js';
import { CATALOG, applyFixes } from '../sim/mitigations.js';
import { createKit } from '../kit/spec.js';
import { PHASES, assessmentSummary, phaseStates } from './assessment.js';
import { resultFacts, verdict, testedWindLine, scopeLine, reportFreshness, fixInTestedSet, PLANNED_SCENARIOS } from './facts.js';
import { computeMarkers, groupMarkers, projectPins } from '../render/markers.js';
import { drawPins, overviewCamera } from '../render/views.js';
import { WINDS, SEEDS, extendedSummary, durationLabel } from './extended.js';
import { createScenarioPreviewer } from './scenario-previews.js';
import demoScene from '../../../samples/demo_scene.js?raw';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const rendered = new Map();
function paint(id, html) {
  if (rendered.get(id) !== html) { $(id).innerHTML = html; rendered.set(id, html); }
}
const empty = (text) => `<p class="empty-state">${esc(text)}</p>`;
const plural = (n, word) => `${n} ${n === 1 ? word : word === 'fix' ? 'fixes' : word === 'priority' ? 'priorities' : word + 's'}`;
const direction = (degrees) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
const safeLink = (value) => { try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } };
const FIX_LABELS = {
  clear_gutters: 'Clear debris from gutters', screen_vents: 'Add ember-resistant vent screens',
  metal_fence_section: 'Break the fence-to-house fire path', metal_fence_full: 'Replace combustible fencing',
  clear_zone0_plants: 'Clear plants from the first 5 feet', gravel_zone0: 'Replace nearby bark mulch',
  move_firewood: 'Move firewood away from the house', enclose_deck: 'Clear and enclose the deck underside',
  clear_deck_items: 'Move combustible patio items', class_a_roof: 'Upgrade to a Class A roof',
  trim_trees: 'Trim trees close to the house', zone1_trees: 'Thin and limb up nearby trees',
  zone1_mulch: 'Replace bark mulch within 5–30 feet', noncombustible_siding: 'Re-side the exposed wall with fiber cement',
};
const fixLabel = (title, id) => FIX_LABELS[id || Object.keys(CATALOG).find((key) => CATALOG[key].title.toLowerCase().trim() === title?.toLowerCase().trim())] || title;
let runId = null, state = null, eventSource = null, epoch = 0, loading = false;
let events = new Map(), refreshTimer, refreshing = false, refreshAgain = false, currentTab = 'report';
let versionKey = '', sceneRequest = 0;
let extendedLaunching = 0, previousAgentId = null;
let scenarioAgentId = null, scenarioSpec = null, selectedScenario = null, scenarioResult = null, previewScenario = null, scenarioToken = 0;
let scenarioSpecPromise = null, previewer = null, previewBusy = false;
const thumbnails = new Map(), thumbnailErrors = new Map(), previewQueue = [], previewQueued = new Set();
const extendedState = () => extendedSummary(extendedLaunching && (!state?.agent || state.agent.id === previousAgentId) ? { launched: extendedLaunching, status: 'launching' } : state?.agent, [...events.values()]);

async function api(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { const body = await response.json(); if (typeof body.detail === 'string') message = body.detail; } catch { /* Keep the HTTP error. */ }
    throw new Error(message);
  }
  return response.json();
}
function notify(message = '') { $('notice').hidden = !message; $('notice').textContent = message; }

// Preserve the original central viewer and upstream renderer/camera improvements.
const vp = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
configureRenderer(renderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
vp.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
camera.position.set(90, 80, 110);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, 0);
controls.enableDamping = true;
let scene = new THREE.Scene(), built = null, spec = null, sim = null, simView = null, acc = 0, last = performance.now();
// Hazard (red) / fix (green) labels drawn on a 2D overlay above the 3D view.
let groups = [], pins = [], labelFilter = 'all', hoverKey = null, legendKey = null, flight = null;
// The legend starts minimized; the viewer's choice is remembered on this device.
let legendOpen = false;
try { legendOpen = localStorage.getItem('zz.legendOpen') === '1'; } catch { /* storage unavailable */ }
const overlay = document.createElement('canvas');
overlay.className = 'label-overlay';
vp.appendChild(overlay);
const legend = document.createElement('div');
legend.className = 'pin-legend';
vp.appendChild(legend);
function resize() {
  const rect = vp.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.setSize(rect.width, rect.height);
  overlay.width = rect.width * devicePixelRatio; overlay.height = rect.height * devicePixelRatio;
  overlay.style.width = `${rect.width}px`; overlay.style.height = `${rect.height}px`;
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(vp);
function showSpec(next, illustrative = false) {
  simView?.dispose(); sim = null; simView = null; acc = 0;
  const geometries = new Set(), materials = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) for (const material of [object.material].flat()) materials.add(material);
    object.shadow?.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  spec = next;
  scene = new THREE.Scene(); addLights(scene); built = buildScene(next); scene.add(built.root);
  groups = groupMarkers(computeMarkers(next)); renderLegend();
  const viewpoint = next.cameras?.[0];
  if (viewpoint) { camera.position.set(...viewpoint.pos); controls.target.set(...viewpoint.lookAt); }
  $('simStatus').textContent = illustrative ? 'Illustrative property · not generated from footage' : `${next.objects.length} scene objects · ${next.cameras.length} camera views`;
  vp.querySelector('.viewer-badge').textContent = illustrative ? 'ILLUSTRATIVE PREVIEW' : 'SIMPLIFIED PROPERTY MODEL';
  $('play').innerHTML = '<span aria-hidden="true">▷</span> Play ember test';
}
function animate(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!document.hidden) {
    if (sim && !sim.done && !paused) {
      acc += dt * (+$('simSpeed').value || 3);
      while (acc >= sim.opts.dt && !sim.done) { sim.step(); acc -= sim.opts.dt; }
      simView.update(dt);
      $('simTimeline').value = sim.t; $('simClock').textContent = `${fmtTime(sim.t)} / ${fmtTime(sim.opts.duration)}`;
      $('simStatus').textContent = `Preview ${fmtTime(sim.t)} · ` + (sim.houseIgnitedAt !== null ? `House ignited at ${fmtTime(sim.houseIgnitedAt)}` : sim.done ? 'No house ignition in this preview' : 'No house ignition yet');
      if (sim.done) $('play').innerHTML = previewScenario ? '<span aria-hidden="true">↻</span> Replay selected scenario' : '<span aria-hidden="true">↻</span> Replay ember test';
    }
    if (flight) stepFlight(dt);
    controls.update(); renderer.render(scene, camera);
    updateCompass();
    drawLabels();
  }
  requestAnimationFrame(animate);
}
function drawLabels() {
  const ctx = overlay.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  pins = [];
  if (labelFilter === 'off' || !groups.length) return;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = overlay.width / devicePixelRatio, h = overlay.height / devicePixelRatio;
  pins = projectPins(groups, camera, w, h, THREE, labelFilter, built?.byObj.get('house'));
  drawPins(ctx, pins, { highlight: hoverKey || legendKey || selectedKey, alpha: sim && sim.t > 6 && !sim.done ? 0.7 : 1, labels: $('layerLabels').checked });
}
// Legend: one row per hazard/fix type, numbered to match the pins in the view.
function renderLegend() {
  const shown = groups.filter((g) => labelFilter === 'all' || g.type === labelFilter);
  const risks = groups.filter((g) => g.type === 'risk').length, fixes = groups.length - risks;
  legend.hidden = !groups.length || labelFilter === 'off';
  legend.classList.toggle('open', legendOpen);
  legend.innerHTML = `<button class="pin-legend-head" aria-expanded="${legendOpen}" title="${legendOpen ? 'Minimize' : 'Show the list'}"><span class="pin-legend-summary">${risks ? `<b class="risk">${risks}</b> hazard${risks === 1 ? '' : 's'}` : 'No hazards'}${fixes ? ` · <b class="fix">${fixes}</b> fix${fixes === 1 ? '' : 'es'}` : ''}</span><span class="pin-legend-toggle" aria-hidden="true">${legendOpen ? '▴' : '▾'}</span></button>
    ${legendOpen ? '<p class="pin-legend-hint">Hover to find · click to zoom</p>' : ''}<ol ${legendOpen ? '' : 'hidden'}>${shown.map((g) => `<li data-key="${esc(g.key)}" class="${g.type}"><i>${g.type === 'fix' ? '✓' : g.n}</i><span>${esc(g.label)}</span>${g.positions.length > 1 ? `<small>×${g.positions.length}</small>` : ''}</li>`).join('')}</ol>`;
}
legend.addEventListener('pointerover', (event) => { const row = event.target.closest('li[data-key]'); legendKey = row?.dataset.key || null; });
legend.addEventListener('pointerleave', () => { legendKey = null; });
legend.addEventListener('click', (event) => {
  if (event.target.closest('.pin-legend-head')) {
    legendOpen = !legendOpen;
    try { localStorage.setItem('zz.legendOpen', legendOpen ? '1' : '0'); } catch { /* storage unavailable */ }
    renderLegend(); return;
  }
  const row = event.target.closest('li[data-key]'); if (!row) return;
  const g = groups.find((item) => item.key === row.dataset.key); if (!g) return;
  // Fly to the first location of this hazard/fix, keeping the current viewing direction.
  const target = new THREE.Vector3(...g.positions[0]);
  const offset = camera.position.clone().sub(controls.target).setLength(45);
  flight = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: target.clone().add(offset), toTarget: target };
});
function stepFlight(dt) {
  flight.t = Math.min(1, flight.t + dt / 0.7);
  const k = flight.t < 0.5 ? 2 * flight.t * flight.t : 1 - (-2 * flight.t + 2) ** 2 / 2;
  camera.position.lerpVectors(flight.fromPos, flight.toPos, k);
  controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
  if (flight.t >= 1) flight = null;
}
vp.addEventListener('pointermove', (event) => {
  const rect = vp.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  const hit = pins.find((p) => Math.hypot(p.x - x, p.y - y) < 12);
  hoverKey = hit?.key || null;
  legend.querySelectorAll('li').forEach((row) => row.classList.toggle('hot', row.dataset.key === hoverKey));
  vp.style.cursor = hit ? 'pointer' : '';
});
const FILTERS = [['all', 'All labels'], ['risk', 'Hazards only'], ['fix', 'Fixes only'], ['off', 'Labels off']];
$('labels').onclick = () => {
  labelFilter = FILTERS[(FILTERS.findIndex(([key]) => key === labelFilter) + 1) % FILTERS.length][0];
  $('labels').innerHTML = `<span aria-hidden="true">⚑</span> ${FILTERS.find(([key]) => key === labelFilter)[1]}`;
  $('labels').classList.toggle('on', labelFilter !== 'off');
  renderLegend();
};
// Flip between the original property and the latest hardened version, keeping the camera still.
let showingBase = false;
$('beforeAfter').onclick = async () => {
  if (!state || state.base_spec === undefined) return;
  previewScenario = null;
  showingBase = !showingBase;
  const n = showingBase ? state.base_spec : state.spec_versions.at(-1).n;
  const cam = camera.position.clone(), target = controls.target.clone();
  try {
    showSpec(await api(`/api/runs/${runId}/spec/${n}`));
    $('version').value = n;
    camera.position.copy(cam); controls.target.copy(target);
    renderTakeaway(assessmentSummary(state));
    $('beforeAfter').innerHTML = showingBase ? '<span aria-hidden="true">⇄</span> Showing before' : '<span aria-hidden="true">⇄</span> Showing after';
  } catch (error) { notify(error.message); }
};
$('play').onclick = () => {
  if (previewScenario) { replayScenario(); return; }
  if (!spec) return;
  const selectedSpec = spec; showSpec(selectedSpec, !runId);
  const latest = state?.sims?.at(-1);
  sim = new Sim(selectedSpec, { windFrom: latest?.wind ?? state?.conditions?.wind ?? +$('wind').value, mph: latest?.mph ?? state?.conditions?.mph ?? 30, seed: latest?.seed ?? state?.conditions?.seed ?? 7 });
  simView = new SimView(scene, built, sim);
  $('play').innerHTML = '<span aria-hidden="true">↻</span> Restart preview';
};
function openTab(name) {
  if (name === 'model') name = 'report';
  currentTab = name;
  document.querySelectorAll('[data-tab]').forEach((button) => { const active = button.dataset.tab === name; button.classList.toggle('on', active); button.setAttribute('aria-selected', String(active)); });
  document.querySelectorAll('.tab').forEach((panel) => { const active = panel.id === `tab-${name}`; panel.classList.toggle('on', active); panel.hidden = !active; });
  resize();
}
document.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => openTab(button.dataset.tab); });
$('version').onchange = async () => {
  if ($('version').value === 'extended') {
    const first = extendedState()?.cells.find((cell) => cell.verified);
    if (first) { if (!selectedScenario) await selectScenario(first.wind, first.seed); await replayScenario(); }
    return;
  }
  previewScenario = null;
  const id = runId, request = ++sceneRequest;
  try { const next = await api(`/api/runs/${id}/spec/${$('version').value}`); if (runId === id && request === sceneRequest) { showSpec(next); renderTakeaway(assessmentSummary(state)); } } catch (error) { notify(error.message); }
};
async function renderVersions() {
  const versions = state?.spec_versions || [];
  const hasExtendedPlan = Boolean(state?.agent?.local_check?.grid?.length);
  const key = `${runId}:${versions.length}:${hasExtendedPlan}`;
  if (!versions.length || key === versionKey) return;
  versionKey = key;
  paint('version', versions.map((v) => `<option value="${v.n}">v${v.n} · ${esc(v.label.split(':')[0].replace('fidelity fix', 'model correction').replace('fix round', 'mitigation pass'))}</option>`).join('') + (hasExtendedPlan ? '<option value="extended">Swarm property snapshot</option>' : ''));
  if (previewScenario && hasExtendedPlan) { $('version').value = 'extended'; return; }
  $('version').value = versions.at(-1).n;
  const id = runId, request = ++sceneRequest;
  try { const next = await api(`/api/runs/${id}/spec/${versions.at(-1).n}`); if (runId === id && request === sceneRequest) showSpec(next); } catch (error) { notify(error.message); }
}

// One event stream per run; deduplicate replayed events and coalesce state reads.
async function loadRun(id) {
  eventSource?.close(); clearTimeout(refreshTimer); epoch++; sceneRequest++;
  const activeEpoch = epoch;
  runId = id; state = null; events = new Map(); versionKey = ''; rendered.clear();
  scenarioAgentId = null; scenarioSpec = null; selectedScenario = null; scenarioResult = null; previewScenario = null; scenarioToken++; extendedLaunching = 0;
  document.querySelectorAll('.left, .right, .tab').forEach((panel) => { panel.scrollTop = 0; });
  $('runId').textContent = id; $('player').removeAttribute('src'); $('player').load();
  paint('version', '<option>Awaiting model</option>');
  $('modelWaiting').hidden = false; $('play').disabled = true;
  history.replaceState(null, '', `?run=${encodeURIComponent(id)}`);
  openTab('model');
  try {
    const next = await api(`/api/runs/${id}/state`);
    if (epoch !== activeEpoch) return;
    state = next; render(); await renderVersions(); listen(activeEpoch);
  } catch (error) { if (epoch === activeEpoch) notify(`Could not open this assessment. ${error.message}`); }
}
function listen(activeEpoch = epoch) {
  eventSource?.close();
  eventSource = new EventSource(`/api/runs/${runId}/events?since=${events.size}`);
  eventSource.onmessage = (message) => {
    if (activeEpoch !== epoch) return;
    const event = JSON.parse(message.data);
    if (events.has(event.i)) return;
    events.set(event.i, event); window.__zzEvents = events;
    if (event.inventory && state) state.inventory = event.inventory;
    renderActivity();
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh(activeEpoch), 120);
  };
  eventSource.onerror = () => { if (state?.status !== 'done') $('workspaceStatus').textContent = 'Reconnecting to assessment…'; };
}
async function refresh(activeEpoch = epoch) {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const next = await api(`/api/runs/${runId}/state`);
    if (activeEpoch !== epoch) return;
    state = next; render(); await renderVersions();
  } catch (error) { if (activeEpoch === epoch) notify(error.message); }
  finally { refreshing = false; if (refreshAgain) { refreshAgain = false; refresh(epoch); } }
}
function setBusy() {
  const extendedBusy = Boolean(extendedLaunching || extendedState()?.active);
  const busy = loading || extendedBusy || Boolean(state && ['created', 'running'].includes(state.status));
  for (const id of ['start', 'sample', 'illustrative']) $(id).disabled = busy;
  const ready = state?.status === 'done';
  $('windTest').disabled = !ready || extendedBusy; $('agent').disabled = !ready || extendedBusy;
  $('beforeAfter').disabled = !(state?.base_spec !== undefined && state.spec_versions.at(-1)?.n > state.base_spec);
}
async function start(mode) {
  const data = new FormData();
  if (mode === 'upload') {
    const file = $('video').files[0];
    if (!file) { notify('Choose a walk-around video first, or select “Try sample footage”.'); return; }
    data.append('video', file);
  } else if (mode === 'stock') data.append('sample', 'stock');
  data.append('wind', $('wind').value);
  data.append('swarm', $('swarmToggle').checked ? '1' : '0');
  loading = true; setBusy(); notify(); setSetup(false);
  try { const response = await api('/api/runs', { method: 'POST', body: data }); await loadRun(response.id); }
  catch (error) { notify(`Could not start the assessment. ${error.message}`); }
  finally { loading = false; setBusy(); }
}
// Remember the all-wind opt-in on this device (it stays opt-in by default).
// On by default; the viewer's own choice to turn it off is remembered on this device.
$('swarmToggle').checked = true;
try { if (localStorage.getItem('zz.swarm.v2') === '0') $('swarmToggle').checked = false; } catch { /* storage unavailable */ }
$('swarmToggle').onchange = () => { try { localStorage.setItem('zz.swarm.v2', $('swarmToggle').checked ? '1' : '0'); } catch { /* storage unavailable */ } };
$('video').onchange = () => { $('videoName').textContent = $('video').files[0]?.name || ''; notify(); };
$('start').onclick = () => start('upload');
$('sample').onclick = () => start('stock');
$('illustrative').onclick = () => start('illustrative');

function featureTitle(object) {
  const text = object.description?.toLowerCase() || '';
  if (object.kind === 'fence') return 'Fencing & gates';
  if (/ceiling|tongue.and.groove/.test(text)) return 'Patio ceiling';
  if (/dining/.test(text)) return 'Outdoor dining set';
  if (/lounge|sofa|cushion|furniture/.test(text)) return 'Patio furniture';
  if (/kitchen|bbq|barbecue/.test(text)) return 'Outdoor kitchen';
  return ({ fence: 'Fencing & gates', plant: 'Plants & shrubs', mulch: 'Ground cover & mulch', gutter: 'Gutters', vent: 'Vents', deck: 'Deck & underside', firewood: 'Firewood', object: 'Outdoor item' })[object.kind] || 'Property feature';
}
function renderObservations() {
  const inventory = state?.inventory;
  const objects = inventory?.objects || [];
  $('featureCount').textContent = objects.length;
  paint('chips', objects.length ? objects.map((object) => {
    const timestamp = object.seen_at?.[0];
    return `<details class="feature" data-kind="${esc(object.kind)}"><summary><span class="feature-name"><strong>${esc(featureTitle(object))}</strong><small>${timestamp ? `Seen at ${esc(timestamp)} · Added to model` : 'Added to model'}${object.material ? ` · ${esc(object.material)}` : ''}</small></span>${timestamp ? `<button class="seek" data-seek="${esc(timestamp)}" aria-label="Play footage at ${esc(timestamp)}">${esc(timestamp)} ↗</button>` : ''}</summary><p>${esc(object.description)}</p>${object.ember_risk ? `<p class="risk-note">${esc(object.ember_risk)}</p>` : ''}</details>`;
  }).join('') + (inventory?.uncertain || []).map((gap) => `<div class="feature gap"><span class="feature-name"><strong>${esc(gap)}</strong><small>Not visible · Coverage gap</small></span></div>`).join('') : empty(state && !state.video && state.spec_versions.length ? 'Illustrative property. No video survey was performed.' : 'Observations appear here as the footage is reviewed.'));
  const unknowns = inventory?.uncertain || [];
  $('uncertainCount').textContent = unknowns.length ? `${unknowns.length} notes` : '';
  paint('coverageContent', unknowns.length ? `<p>Only visible features can be assessed. Unseen areas remain uncertain.</p><ul>${unknowns.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : `<p>${state?.source?.coverage ? esc(state.source.coverage) + '. ' : ''}A complete walk-around gives the agent more evidence. Unseen materials and elevations cannot be verified.</p>`);
  if (state?.video && $('player').getAttribute('src') !== state.video) $('player').src = state.video;
  const source = state?.source;
  paint('sourceCaption', source?.credit ? `${esc(source.name)} · ${Math.round(state.video_duration || 20)}s<br><a href="${esc(safeLink(source.url))}" target="_blank" rel="noreferrer">${esc(source.credit)}</a> · ${esc(source.coverage)}` : state?.video ? 'Original input footage. The model is based on what the camera can see.' : 'Upload a walk-around video, or try the house-and-patio sample.');
}
$('chips').addEventListener('toggle', (event) => {
  const row = event.target.closest?.('details.feature'); if (!row || !row.open) return;
  const kind = row.dataset.kind, words = KIND_WORDS.filter(([, k]) => k === kind).map(([w]) => w);
  const group = groups.find((g) => words.some((w) => g.label.toLowerCase().includes(w)));
  if (group) openHazardCard(group);
}, true);
$('chips').addEventListener('click', (event) => {
  const button = event.target.closest('[data-seek]'); if (!button) return;
  event.preventDefault(); event.stopPropagation();
  const [minutes, seconds] = button.dataset.seek.split(':').map(Number);
  $('player').currentTime = minutes * 60 + seconds;
  $('player').play().catch(() => {});
});
function renderTakeaway(summary) {
  const { before, latest, applied, sceneEdits, suggestions, tone } = summary;
  let title = 'Ready to review a home', description = 'Start an assessment to see what was found, what was tested, and what to do next.', label = 'YOUR ASSESSMENT';
  if (state?.status === 'error') { title = 'Assessment interrupted'; description = 'The completed steps are saved below. Open the event details to see what stopped the run.'; label = 'RUN NEEDS ATTENTION'; }
  else if (state && state.status !== 'done') { title = 'Assessment in progress'; description = 'The agent is working through the footage, model, and ember test. Follow the steps below.'; label = 'AGENT IS WORKING'; }
  else if (latest) {
    title = latest.result.houseIgnited ? `House ignited at ${latest.result.houseIgnitedAt}` : before.result.houseIgnited && applied.length ? 'Tested fixes stopped house ignition' : 'House did not ignite';
    label = 'LATEST SIMULATION RESULT';
    description = latest.result.houseIgnited ? 'A path to the house remains in the latest test. Review the ignition chain and the action plan.' : applied.length ? 'The agent changed the model and re-ran the simulation. These are simulated improvements, not physical work.' : (latest.result.ignited || []).length ? 'Nearby fuels still caught fire. The agent suggested improvements, but did not apply or re-test them.' : 'No ignition was observed under these conditions. This does not establish safety under other conditions.';
  }
  // Result band: precise conclusion from recorded numbers, scope, three metrics, and "Do these first".
  const report = state?.report;
  const facts = resultFacts(state);
  const v = state?.status === 'done' ? verdict(facts) : null;
  const sw = facts?.swarm;
  const appliedIds = new Set(applied.map((item) => item.fix));
  const freshness = reportFreshness(state);
  const top = (report?.fixes_ranked || []).slice(0, 3);
  const fmtT = (sec) => (sec === null ? 'None observed' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  // Slim result banner: one headline and at most two key pills. Details live in the Action plan.
  if (!state) {
    paint('resultSummary', `<div class="band slim tone-neutral"><span class="band-dot"></span><div class="band-text"><h1>Illustrative property — sample results</h1></div><div class="band-pills"><button class="primary" data-open-setup>New assessment</button></div></div>`);
  } else if (!v) {
    const statuses = phaseStates(state, [...events.values()]);
    const at = Math.max(0, statuses.indexOf('active'));
    const swNow = state.agent?.type === 'swarm' && state.agent.status !== 'completed' ? (state.agent.local_check?.grid?.length || 0) : null;
    const failed = state.status === 'error';
    paint('resultSummary', `<div class="band slim tone-${failed ? 'danger' : 'neutral'}"><span class="band-dot ${failed ? '' : 'pulse'}"></span><div class="band-text"><h1>${esc(failed ? title : (PHASES[at]?.title || 'Starting') + '…')}</h1></div><div class="band-pills"><span class="pill-chip">Step ${at + 1} of ${PHASES.length}</span>${swNow !== null ? `<span class="pill-chip">${swNow}/24 scenarios verified</span>` : ''}</div><div class="band-progress" style="--p:${((at + (failed ? 0 : 0.5)) / PHASES.length).toFixed(2)}"></div></div>`);
  } else {
    const pill = (text, cls = '') => `<span class="pill-chip ${cls}">${text}</span>`;
    const tested = facts.tested ? pill(`Tested wind: ${facts.finalS === null ? 'no ignition after changes' : `ignites at ${fmtT(facts.finalS)}`}`, facts.finalS === null ? 'good' : 'bad') : '';
    const winds = sw ? pill(`${sw.noIgnition}/24 wind tests hold`, !sw.complete ? '' : sw.ignited === 0 ? 'good' : sw.noIgnition === 0 ? 'bad' : 'warn') : pill('Other winds not checked');
    paint('resultSummary', `<div class="band slim tone-${v.tone}"><span class="band-dot"></span><div class="band-text"><h1>${esc(v.title)}</h1></div><div class="band-pills">${tested}${winds}<button class="link" data-open-tab="report">Action plan →</button></div></div>`);
  }
  document.querySelector('.next-steps').hidden = Boolean(top.length);
  document.body.classList.toggle('has-run', Boolean(state));
  document.body.classList.toggle('no-video', !state?.video);
  $('suggestionCount').textContent = suggestions.length;
  $('recommendationNote').textContent = suggestions.length ? applied.length ? 'Agent recommendations. Tested changes are listed separately below.' : 'Suggested only · these changes have not been simulated.' : 'Recommendations will appear when the assessment finishes.';
  paint('recommendations', suggestions.length ? suggestions.map((fix, index) => {
    const tested = applied.some((item) => (item.title || CATALOG[item.fix]?.title || '').toLowerCase().trim() === fix.title.toLowerCase().trim());
    return `<details class="recommendation"><summary><span class="rec-number">${index + 1}</span><span class="rec-title">${esc(fixLabel(fix.title))}${tested ? '<small>Included in a tested fix set</small>' : ''}</span><span class="rec-cost" title="Rough relative cost">${esc(fix.cost)}</span><span class="rec-arrow" aria-hidden="true">›</span></summary><div class="rec-detail"><p><b>${esc(fix.title)}</b></p><p><b>Why it matters</b><br>${esc(fix.why)}</p><p><b>${applied.length ? 'Benefit described in the report' : 'Expected benefit — not re-tested'}</b><br>${esc(fix.effect)}</p><span class="rec-state">${tested ? latest.result.houseIgnited ? `Tested set: house still ignites at ${esc(latest.result.houseIgnitedAt)}` : 'Tested set: no house ignition' : applied.length ? 'Report recommendation' : 'Not applied or re-tested'}</span></div></details>`;
  }).join('') : empty('The agent’s priorities will be listed here, with a reason for each one.'));
  $('appliedSection').hidden = !applied.length;
  $('appliedCount').textContent = summary.fixGroups.length;
  paint('appliedFixes', summary.fixGroups.map((fix) => `<div class="applied-fix">${esc(fixLabel(fix.title, fix.fix))}<small>${fix.targets.length > 1 ? `${fix.targets.length} targets · ` : ''}Applied to the model and re-tested · ${esc(fix.cost)}</small></div>`).join(''));
}
function renderActivity() {
  const allEvents = [...events.values()].sort((a, b) => a.i - b.i);
  const statuses = phaseStates(state, allEvents);
  const summary = assessmentSummary(state);
  const inventory = state?.inventory;
  const corrections = (state?.fidelity || []).flatMap((round) => round.issues || []);
  const counts = state?.sims?.length || 0;
  const swarmNow = state?.agent?.type === 'swarm' ? state.agent : null;
  const stories = [
    inventory ? `${plural(inventory.objects?.length || 0, 'feature')} identified · ${(inventory.uncertain || []).length} coverage gaps.` : state?.spec_versions?.length && !state.video ? 'Illustrative property; no real video surveyed.' : 'Identify visible features and materials.',
    state?.spec_versions?.length ? `${state.spec_versions[0] ? 'Model generated' : ''}${summary.sceneEdits ? ` · ${plural(summary.sceneEdits, 'repair')}` : ''}.` : 'Write the 3D model from the survey.',
    state?.fidelity?.length ? `${plural(state.fidelity.length, 'comparison round')} · ${plural(summary.sceneEdits, 'model correction')}.` : 'Compare real frames with model renders.',
    state?.sims?.length ? `Original property: ${state.sims[0].result.houseIgnited ? `house ignited at ${state.sims[0].result.houseIgnitedAt}` : 'no house ignition'}.` : 'Run the baseline ember storm.',
    counts > 1 ? `${plural(summary.fixGroups.length, 'change type')} applied and re-tested.` : 'Apply catalog changes and re-test.',
    swarmNow ? `${swarmNow.local_check?.grid?.length || 0} of 24 scenarios verified.` : 'Optional: 24 scenario agents.',
    state?.report ? `${plural(summary.suggestions.length, 'priority')} with reasons and cost bands.` : 'Rank and explain the next steps.',
  ];
  let activity = PHASES.map((phase, index) => {
    const group = allEvents.filter((event) => phase.stages.includes(event.stage) || (index === statuses.findIndex((status) => status === 'error') && event.stage === 'error'));
    let extra = '';
    if (index === 1 && corrections.length) extra = `<div class="raw-event"><strong>What was corrected in the scene</strong><ul>${corrections.map((issue) => `<li>${esc(issue.fix || issue.problem)}</li>`).join('')}</ul></div>`;
    const raw = group.map((event) => `<div class="raw-event">${esc(event.msg)}${event.plan ? `<ul>${(event.plan.fixes || []).map((fix) => `<li>${esc(CATALOG[fix.fix]?.title || fix.fix)}: ${esc(fix.why)}${evidence(fix)}</li>`).join('')}</ul>` : ''}${event.errors ? `<pre>${esc(event.errors.join('\n'))}</pre>` : ''}${event.trace ? `<pre>${esc(event.trace)}</pre>` : ''}</div>`).join('');
    return `<li class="phase ${statuses[index]}"><span class="phase-dot">${statuses[index] === 'complete' ? '✓' : index + 1}</span><h4>${esc(phase.title)}</h4><p>${esc(stories[index])}</p>${group.length ? `<details><summary>${group.length} event${group.length === 1 ? '' : 's'} · view details</summary>${extra}${raw}</details>` : ''}</li>`;
  }).join('');
  const extended = extendedState();
  if (extended) {
    const group = allEvents.filter((event) => event.stage === 'agent' && event.t >= (extended.launched || 0));
    activity += `<li class="phase ${extended.active ? 'active' : extended.phase === 'complete' ? 'complete' : 'error'}"><span class="phase-dot">${extended.active ? '5' : extended.phase === 'complete' ? '✓' : '!'}</span><h4>24-agent scenario swarm</h4><p>${extended.phase === 'complete' ? `${extended.holds}/24 scenarios had no house ignition.` : extended.phase === 'failed' ? 'Extended test stopped; open its results for details.' : `${extended.running} agents active · ${extended.checked}/24 verified.`} <span data-extended-elapsed></span></p><button class="scenario-inline-link" data-open-tab="sims">View all scenarios ↗</button>${group.length ? `<details><summary>${group.length} events · view details</summary>${group.map((event) => `<div class="raw-event">${esc(event.msg)}</div>`).join('')}</details>` : ''}</li>`;
  }
  paint('log', activity);
}
// The real footage frame Argon cited as proof of a hazard; click it to seek the video.
function evidence(item) {
  if (!item.evidence_frame && !item.evidence) return '';
  return `<div class="evidence">${item.evidence_frame ? `<img src="${esc(item.evidence_frame)}" data-seek="${esc(item.seen_in_video_at || '')}" alt="Footage at ${esc(item.seen_in_video_at)}" loading="lazy">` : ''}<span>Seen in footage ${esc(item.seen_in_video_at || '')} · ${esc(item.evidence || '')}</span></div>`;
}
document.addEventListener('click', (event) => {
  const img = event.target.closest('.evidence img[data-seek], .evrow img[data-seek]');
  if (!img || !img.dataset.seek) return;
  const [minutes, seconds] = img.dataset.seek.split(':').map(Number);
  $('player').currentTime = minutes * 60 + seconds; $('player').play().catch(() => {});
});
const pill = (result) => result.houseIgnited ? `<span class="pill bad">House ignited ${esc(result.houseIgnitedAt)}</span>` : '<span class="pill good">No house ignition</span>';
const chain = (result) => result.chain?.length ? `<ol class="chain">${result.chain.map((item) => `<li><b>${esc(item.time)}</b> ${esc(item.label)}</li>`).join('')}</ol>` : '';
function renderEvidence(summary) {
  const { before, latest, applied } = summary;
  const rounds = state?.fix_rounds || [];
  const efacts = resultFacts(state);
  $('simulationNote').textContent = rounds.length ? 'Same wind and random seed before and after.' : before ? 'Original property only — no changes tested yet.' : 'Recorded tests appear here.';
  let simulations = before ? rounds.length ? rounds.map((round) => `<h3>${round.tag === 'wind' ? 'New wind' : 'Mitigation'} · round ${round.round} · wind from ${direction(round.wind)}</h3>${(round.plan?.fixes || []).some((fix) => fix.evidence_frame) ? `<div class="evrow">${round.plan.fixes.filter((fix) => fix.evidence_frame).map((fix) => `<figure><img src="${esc(fix.evidence_frame)}" data-seek="${esc(fix.seen_in_video_at)}" alt="Footage at ${esc(fix.seen_in_video_at)}" loading="lazy"><figcaption>Footage ${esc(fix.seen_in_video_at)} · ${esc(fixLabel(null, fix.fix))}<br><span>${esc(fix.evidence || '')}</span></figcaption></figure>`).join('')}</div>` : ''}<div class="ba"><div><h4>Original for this round ${pill(round.before)}</h4><video src="${esc(round.before_video)}" controls muted preload="metadata"></video>${chain(round.before)}</div><div><h4>After tested fixes ${pill(round.after)}</h4><video src="${esc(round.after_video)}" controls muted preload="metadata"></video>${chain(round.after)}<p>${round.verdict.sim_agrees ? 'The agent’s verification agrees with the simulator.' : 'The agent disagreed. This result uses the simulator’s recorded outcome.'}</p></div></div>`).join('') : `<div class="ba"><div><h4>Baseline simulation ${pill(before.result)}</h4><video src="${esc(before.video)}" controls muted preload="metadata"></video>${chain(before.result)}<p>${before.result.ignited.length} modeled objects ignited. ${before.result.houseIgnited ? 'The house also ignited.' : 'The house did not ignite.'}</p></div><div class="no-after"><strong>${state?.status === 'running' ? 'Assessment still in progress' : 'No “after” test was run'}</strong><p>${state?.status === 'running' ? 'The agent is evaluating the baseline and testing changes where needed. Follow its progress on the right.' : 'The agent did not apply mitigation fixes. Its report lists suggestions for you to consider; their effects have not been verified by a second simulation.'}</p></div></div>` : empty('The first recorded ember test will appear here.');
  if (summary.pendingTests) simulations += `<h3>Latest re-test · agent verification in progress</h3><div class="ba"><div><h4>Recorded result ${pill(latest.result)}</h4><video src="${esc(latest.video)}" controls muted preload="metadata"></video>${chain(latest.result)}</div><div class="no-after"><strong>The agent is checking this re-test</strong><p>Changes were applied to the model before this recording. The confirmed fix list and explanation will appear after verification.</p></div></div>`;
  paint('sims', simulations);
  paint('fidelity', state?.fidelity?.length ? state.fidelity.map((round, index) => `<details class="round" ${index === state.fidelity.length - 1 ? 'open' : ''}><summary><span>Comparison round ${round.round}</span><span class="pill ${round.pass ? 'good' : 'neutral'}">${round.pass ? 'Agent accepted the match' : `${round.issues?.length || 0} corrections requested`}</span></summary>${round.issues?.length ? `<ul class="issues">${round.issues.map((issue) => `<li><b>Issue:</b> ${esc(issue.problem)}<br><b>Correction:</b> ${esc(issue.fix)}</li>`).join('')}</ul>` : ''}<div class="pairs">${round.pairs.map((pair) => `<figure><img src="${esc(pair.real)}" loading="lazy" alt="Original footage at ${esc(pair.ts)}"><figcaption>Original footage · ${esc(pair.ts)}</figcaption></figure><figure><img src="${esc(pair.render)}" loading="lazy" alt="Model render for camera ${esc(pair.id)}"><figcaption>Model render · ${esc(pair.ts)}</figcaption></figure>`).join('')}</div><p>AI comparison score: ${esc(round.score)}/10. Not a calibrated measure of real-world accuracy.</p></details>`).join('') : empty(state?.spec_versions?.length && !state.video ? 'The illustrative property skips video matching.' : 'Video-to-model comparisons will appear after scene generation.'));
  $('fidelityCount').textContent = state?.fidelity?.length || 0;
  paint('testStrip', latest ? `<p><strong>${state.sims.length} recorded test${state.sims.length === 1 ? '' : 's'}</strong> · Wind ${direction(latest.wind)}${latest.mph ? ` at ${latest.mph} mph` : ''}${latest.duration ? ` · ${latest.duration}s exposure` : ''}<br>${summary.pendingTests ? 'Changes were re-tested; verification is in progress.' : applied.length ? 'Model changes were applied and re-tested.' : state?.status === 'running' ? 'The agent is evaluating this result and any required changes.' : 'Suggestions have not been applied or re-tested.'}</p><button data-open-tab="sims">Watch evidence ↗</button>` : `<p>${state ? 'Preparing this property’s first recorded ember test.' : 'Start an assessment to generate a model from footage and record an ember test.'}</p>`);
  const report = state?.report;
  // Action plan: the three numbers that matter, then ranked actions. Everything else is one tap away.
  const rfacts = resultFacts(state), fresh = reportFreshness(state);
  const appliedIdsR = new Set(applied.map((item) => item.fix));
  const mm = (sec) => (sec === null ? 'none' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
  const stat = (label, value, sub, cls = '') => `<div class="plan-stat ${cls}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;
  const rsw = rfacts?.swarm;
  const stats = rfacts?.hasBaseline ? `<div class="plan-stats">${
    stat('Tested wind', rfacts.tested ? `${mm(rfacts.baselineS)} → ${mm(rfacts.finalS)}` : mm(rfacts.baselineS), rfacts.tested ? 'house ignition, before → after' : 'house ignition', rfacts.finalS === null ? 'good' : 'bad')}${
    rsw ? stat('All winds', `${rsw.noIgnition}/24`, rsw.complete ? 'scenarios hold' : `${rsw.checked}/24 checked`, !rsw.complete ? '' : rsw.ignited === 0 ? 'good' : rsw.noIgnition === 0 ? 'bad' : 'warn') : stat('All winds', '—', 'not checked')}${
    stat('Changes tested', `${new Set(applied.map((a) => a.fix)).size}`, 'applied together')}</div>` : '';
  const stale = fresh === 'stale' || fresh === 'legacy' ? `<div class="plan-stale"><span>${fresh === 'stale' ? 'Newer tests ran after this plan.' : 'This plan predates the latest checks.'}</span><button data-update-report>Update plan</button></div>` : '';
  const fixes = report?.fixes_ranked || [];
  const row = (fix, i) => {
    const t = fixInTestedSet(fix, appliedIdsR, CATALOG);
    return `<li class="plan-item"><div class="plan-row"><b class="plan-rank">${i + 1}</b><div class="plan-what"><strong>${esc(fixLabel(fix.title, fix.fix_id))}</strong><span class="plan-tags"><em class="cost" title="Relative cost">${esc(fix.cost)}</em><em class="${t ? 'tested' : 'untested'}">${t ? 'Tested in model' : 'Not tested'}</em></span></div><button class="plan-show" data-show-fix="${esc(fix.fix_id || '')}" data-title="${esc(fix.title)}">Show</button></div>${fix.why ? `<details class="plan-why"><summary>Why</summary><p>${esc(fix.why)}</p></details>` : ''}</li>`;
  };
  const list = fixes.length ? `<h3 class="plan-h">Do these first</h3><ol class="plan-list">${fixes.slice(0, 5).map(row).join('')}</ol>${fixes.length > 5 ? `<details class="plan-more"><summary>${fixes.length - 5} more actions</summary><ol class="plan-list" start="6">${fixes.slice(5).map((f, i) => row(f, i + 5)).join('')}</ol></details>` : ''}` : '';
  const checklist = (report?.zone0_checklist || []).length ? `<details class="plan-more"><summary>First 5 feet checklist · ${report.zone0_checklist.length}</summary><ul class="plan-check">${report.zone0_checklist.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></details>` : '';
  const prepared = state?.report_scope ? `<details class="plan-more"><summary>Prepared from</summary><p>Scene v${esc(state.report_scope.spec_n)} · ${state.report_scope.sims} recorded tests · ${state.report_scope.swarm_checked ? `all-wind check ${state.report_scope.swarm_checked}/24` : 'single wind only'}. Changes marked “tested in model” were applied together; individual effects were not isolated.</p></details>` : '';
  paint('report', report ? `<div class="plan">${stats}${stale}${list}${checklist}${prepared}<p class="plan-foot">$ low · $$ medium · $$$ high relative cost · Planning aid, not a certified assessment.</p></div>` : empty('Your action plan appears when the assessment finishes.'));
}
function renderAgent() {
  const agent = state?.agent;
  if (extendedLaunching && (agent?.id !== previousAgentId && agent?.id || extendedState()?.phase === 'failed')) extendedLaunching = 0;
  const extended = extendedState();
  $('extendedPanel').hidden = !extended;
  if (!extended) { paint('agentGrid', ''); return; }
  if (agent?.id !== scenarioAgentId) {
    scenarioAgentId = agent?.id; scenarioSpec = null; scenarioSpecPromise = null; selectedScenario = null; scenarioResult = null; scenarioToken++; thumbnails.clear(); thumbnailErrors.clear(); previewQueue.length = 0; previewQueued.clear();
  }
  const labels = { launching: 'Launching scenario agents', searching: extended.isSwarm ? 'Scenario agents running' : 'Legacy optimizer running', verifying: 'Verifying locally', complete: '24 agents verified', partial: 'Some agents failed', failed: 'Test interrupted', cancelled: 'Test cancelled' };
  $('extendedStatus').textContent = labels[extended.phase];
  $('extendedStatus').className = `pill ${extended.phase === 'complete' ? 'good' : extended.phase === 'failed' ? 'bad' : 'neutral'}`;
  paint('agentGrid', `<p>${esc(labels[extended.phase])} · <span data-extended-elapsed></span></p><button class="scenario-inline-link" data-open-tab="sims">Open 24-scenario view ↗</button>`);
  // Results first: how many hold, which directions are weakest, the worst case, and wall time.
  const verified = extended.cells.filter((cell) => cell.verified);
  const byDir = WINDS.map((wind) => { const cells = verified.filter((cell) => cell.wind === wind); return { wind, n: cells.length, holds: cells.filter((cell) => cell.outcome === 'no_ignition').length }; });
  const minHolds = Math.min(...byDir.filter((d) => d.n).map((d) => d.holds));
  const weakest = byDir.filter((d) => d.n && d.holds === minHolds && d.holds < d.n);
  const toSec = (t) => { const [m, sec] = t.split(':').map(Number); return m * 60 + sec; };
  const ignitions = verified.filter((cell) => cell.houseIgnitedAt).sort((a, b) => toSec(a.houseIgnitedAt) - toSec(b.houseIgnitedAt));
  const worst = ignitions[0];
  const holdTone = !extended.checked ? '' : extended.holds === extended.checked ? 'good' : extended.holds === 0 ? 'bad' : 'warn';
  paint('extendedMetrics', `<div class="${holdTone}"><strong>${extended.checked ? `${extended.holds}/${extended.checked}` : '—'}</strong><span>Wind tests hold</span></div><div><strong>${weakest.length ? weakest.map((d) => direction(d.wind)).join(', ') : extended.checked ? 'None' : '—'}</strong><span>${weakest.length ? `Weakest direction${weakest.length > 1 ? 's' : ''} (${minHolds}/3 hold)` : 'Weak directions'}</span></div><div><strong>${worst ? esc(worst.houseIgnitedAt) : extended.checked ? 'Never' : '—'}</strong><span>${worst ? `Earliest ignition · ${direction(worst.wind)} seed ${worst.seed}` : 'House ignition'}</span></div><div><strong data-extended-elapsed></strong><span>${extended.active ? 'Elapsed · 24 agents' : 'Wall time · 24 agents'}</span></div>`);
  const messages = {
    launching: 'Launching separate remote sandboxes for the 24 assigned scenarios.',
    searching: `${extended.running} agents active · ${extended.checked} locally checked · ${extended.failed} failed. Each agent tests one wind/seed against the same property.`,
    verifying: `Checking scenario results locally: ${extended.checked} of 24 recorded. Remote claims are not shown as verified results.`,
    complete: `Each cell is one agent's scenario at ${agent?.mph ?? state?.conditions?.mph ?? 30} mph for ${extended.duration}s; times show when the house ignited. Select a cell to inspect or replay it.`,
    partial: `${extended.checked}/24 scenarios verified; ${extended.failed} agents failed. Failed cells are not passes.`,
    cancelled: 'The swarm was cancelled. Completed scenario results are preserved.',
    failed: extended.error || 'The extended test could not finish. Completed assessment results are still available below.',
  };
  $('extendedProgress').textContent = messages[extended.phase];
  const DIR_NAMES = { 0: 'North', 45: 'Northeast', 90: 'East', 135: 'Southeast', 180: 'South', 225: 'Southwest', 270: 'West', 315: 'Northwest' };
  const cellLabel = (cell) => cell.verified ? (cell.outcome === 'no_ignition' ? ['✓', 'No ignition'] : ['🔥', `Ignition · ${cell.houseIgnitedAt}`])
    : cell.outcome === 'failed' ? ['✕', 'Failed to complete'] : cell.worker?.status === 'verifying' ? ['…', 'Awaiting verification'] : ['running', 'launching'].includes(cell.worker?.status) ? ['⟳', 'Running'] : ['–', 'Not run'];
  paint('scenarioGrid', `<p class="matrix-summary"><strong>${extended.checked} / ${PLANNED_SCENARIOS} verified</strong> · <strong>${extended.holds} / ${PLANNED_SCENARIOS} without house ignition</strong></p><p class="matrix-note">Tested scenarios only — not a real-world survival probability. Click a cell to replay it on the model.</p><div class="matrix-scroll"><table class="scenario-matrix rows"><thead><tr><th scope="col">Wind from</th>${SEEDS.map((seed) => `<th scope="col">Trial ${seed}</th>`).join('')}<th scope="col">No ignition</th></tr></thead><tbody>${WINDS.map((wind) => {
    const cells = SEEDS.map((seed) => extended.cells.find((item) => item.seed === seed && item.wind === wind));
    const d = byDir.find((x) => x.wind === wind);
    return `<tr><th scope="row" title="Wind from ${DIR_NAMES[wind]}"><abbr title="${DIR_NAMES[wind]}">${direction(wind)}</abbr></th>${cells.map((cell) => {
      const selected = selectedScenario?.wind === wind && selectedScenario?.seed === cell.seed;
      const [icon, text] = cellLabel(cell);
      const heat = cell.houseIgnitedAt ? Math.max(0.15, 1 - toSec(cell.houseIgnitedAt) / 90).toFixed(2) : 0;
      return `<td><button class="scenario-cell ${cell.outcome} ${selected ? 'selected' : ''}" style="--heat:${heat}" data-scenario="${wind}:${cell.seed}" ${cell.verified ? '' : 'disabled'} aria-pressed="${selected}" aria-label="Wind from ${DIR_NAMES[wind]}, trial ${cell.seed}: ${esc(text)}"><span class="cell-icon" aria-hidden="true">${icon}</span>${esc(text)}</button></td>`;
    }).join('')}<td class="dir-total ${!d.n ? '' : d.holds === d.n ? 'good' : d.holds === 0 ? 'bad' : 'warn'}">${d.n ? `${d.holds} / ${d.n}` : '—'}</td></tr>`;
  }).join('')}</tbody></table></div>`);
  renderConsensus(extended);
  const timings = [
    ['First remote agent started', extended.timings.first_agent_started_seconds],
    ['First locally verified result', extended.timings.first_result_seconds],
    ['Wall-clock completion', extended.timings.total_seconds],
    ['Sum of individual agent times', extended.timings.sum_worker_seconds],
    ['Sum of local verification times', extended.timings.local_seconds_sum],
  ];
  paint('extendedPlan', `<p>24 independent managed jobs; concurrency ${agent?.concurrency || 24}. All jobs test scene version ${agent?.spec_n ?? '—'} at ${agent?.mph ?? 30} mph for 90 seconds. Suggested fixes remain recommendations and do not change these results.</p><dl class="extended-timings">${timings.map(([label, seconds]) => `<div><dt>${label}</dt><dd>${durationLabel(seconds)}</dd></div>`).join('')}</dl><p>The sum of worker times describes overlapping work, not a measured sequential benchmark. Thumbnails and 3D replays are deterministic recalculations, not video recordings.</p>`);
  if (extended.checked && !selectedScenario) {
    const first = extended.cells.find((cell) => cell.verified);
    selectScenario(first.wind, first.seed);
  } else renderScenarioDetail();
  renderScenarioPreviews(); updateExtendedClock();
}

async function getScenarioSpec() {
  if (scenarioSpec) return scenarioSpec;
  if (!scenarioSpecPromise) {
    const id = runId, agentId = state.agent.id;
    scenarioSpecPromise = api(`/api/runs/${id}/files/${encodeURIComponent(state.agent.spec || 'agent_spec.json')}`).then((value) => {
      if (runId === id && state?.agent?.id === agentId) scenarioSpec = value;
      return value;
    }).catch((error) => { scenarioSpecPromise = null; throw error; });
  }
  return scenarioSpecPromise;
}

// What the 24 agents converge on: their (validated, not applied) suggestions, counted across scenarios.
function renderConsensus(extended) {
  const votes = new Map();
  for (const cell of extended.cells) for (const fix of cell.worker?.suggested_fixes || []) {
    const key = `${fix.fix}:${fix.target}`;
    const entry = votes.get(key) || { fix, count: 0, winds: new Set() };
    entry.count += 1; entry.winds.add(direction(cell.wind)); votes.set(key, entry);
  }
  const ranked = [...votes.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  const failing = extended.cells.filter((cell) => cell.verified && cell.outcome === 'ignited').length;
  paint('agentConsensus', !extended.checked ? '' : !ranked.length
    ? `<h3>What the agents recommend next</h3><p class="section-help">${failing ? 'No new catalog fixes were suggested.' : 'Nothing: the house held in every checked scenario.'}</p>`
    : `<h3>Agents also suggest</h3><p class="section-help">Not tested · how often a change is suggested is not proof it works.</p><ol class="consensus-list">${ranked.map((item) => `<li><span class="consensus-bar" style="--share:${(item.count / Math.max(1, failing)).toFixed(2)}"></span><strong>${esc(fixLabel(null, item.fix.fix))}</strong><small>${esc(String(item.fix.target))} · ${esc(CATALOG[item.fix.fix]?.cost || '')}</small><em>Suggested by ${item.count} agent${item.count === 1 ? '' : 's'} · ${[...item.winds].join(', ')} · Not tested</em></li>`).join('')}</ol>`);
}

function renderScenarioPreviews() {
  const extended = extendedState();
  $('swarmPreviews').hidden = !extended?.isSwarm;
  if (!extended?.isSwarm) return;
  const order = { ignited: 0, no_ignition: 2 };
  const sorted = [...extended.cells].sort((a, b) => (order[a.outcome] ?? 1) - (order[b.outcome] ?? 1) || a.wind - b.wind || a.seed - b.seed);
  paint('scenarioPreviews', sorted.map((cell) => {
    const key = `${cell.wind}-${cell.seed}`, image = thumbnails.get(key);
    const status = cell.verified ? cell.houseIgnitedAt === null ? 'No house ignition' : `Ignition ${cell.houseIgnitedAt}` : cell.worker?.status || 'queued';
    return `<button class="scenario-preview-card ${cell.outcome}" data-scenario="${cell.wind}:${cell.seed}" ${cell.verified ? '' : 'disabled'}><div class="scenario-preview-image"><img data-preview-image="${key}" ${image ? `src="${image.src}"` : 'hidden'} alt="Simulated scenario preview: wind ${direction(cell.wind)}, seed ${cell.seed}"><span data-preview-placeholder="${key}" ${image ? 'hidden' : ''}>${cell.verified ? thumbnailErrors.get(key) ? 'Replay unavailable' : 'Preparing replay…' : esc(status)}</span><small data-preview-time="${key}">${image ? `Preview at ${image.time}` : ''}</small></div><div class="scenario-preview-label"><strong>Agent ${direction(cell.wind)} · seed ${cell.seed}</strong><span>${esc(status)}</span><small>${cell.worker?.elapsed_seconds ? durationLabel(cell.worker.elapsed_seconds) + ' · locally checked' : cell.worker?.id ? 'Independent remote agent started' : 'Awaiting remote sandbox'}</small></div></button>`;
  }).join(''));
  for (const cell of extended.cells) {
    const key = `${cell.wind}-${cell.seed}`;
    if (cell.verified && !thumbnails.has(key) && !thumbnailErrors.has(key) && !previewQueued.has(key)) {
      previewQueued.add(key); previewQueue.push({ cell, key, agentId: scenarioAgentId });
    }
  }
  pumpPreviews();
}

async function pumpPreviews() {
  if (previewBusy || !previewQueue.length) return;
  previewBusy = true;
  const job = previewQueue.shift();
  try {
    const plan = await getScenarioSpec();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (job.agentId !== scenarioAgentId) return;
    previewer ||= createScenarioPreviewer();
    const image = previewer.render(plan, job.cell, { mph: state.agent.mph ?? 30, duration: 90 });
    thumbnails.set(job.key, image);
    const element = document.querySelector(`[data-preview-image="${job.key}"]`);
    if (element) {
      element.src = image.src; element.hidden = false;
      document.querySelector(`[data-preview-placeholder="${job.key}"]`).hidden = true;
      document.querySelector(`[data-preview-time="${job.key}"]`).textContent = `Preview at ${image.time}`;
    }
  } catch (error) {
    thumbnailErrors.set(job.key, error.message);
    const element = document.querySelector(`[data-preview-placeholder="${job.key}"]`);
    if (element) element.textContent = 'Replay unavailable';
  } finally {
    previewQueued.delete(job.key); previewBusy = false;
    if (previewQueue.length) requestAnimationFrame(pumpPreviews);
  }
}

function updateExtendedClock() {
  const extended = extendedState();
  if (extended) document.querySelectorAll('[data-extended-elapsed]').forEach((element) => { element.textContent = durationLabel(extended.elapsed); });
}

function renderScenarioDetail() {
  const extended = extendedState();
  if (!extended || !selectedScenario) { paint('scenarioDetail', '<p class="empty-state">Scenario inspection becomes available as local results arrive.</p>'); return; }
  const cell = extended.cells.find((item) => item.wind === selectedScenario.wind && item.seed === selectedScenario.seed);
  if (!cell?.verified) return;
  const matches = scenarioResult && scenarioResult.houseIgnitedAt === cell.houseIgnitedAt;
  const worker = cell.worker;
  const workerDetails = worker ? `<div class="worker-diagnosis"><p><b>Agent ${direction(cell.wind)} / seed ${cell.seed}</b> · ${durationLabel(worker.elapsed_seconds)}${worker.agent_agrees === false ? ' · agent claim disagreed; using local simulation' : ' · locally verified'}</p><p>${esc(worker.diagnosis || '')}</p>${worker.suggested_fixes?.length ? `<h4>Agent suggestions · not applied or re-tested</h4><ul>${worker.suggested_fixes.map((fix) => `<li>${esc(fixLabel(fix.title, fix.fix))}${fix.why ? ': ' + esc(fix.why) : ''}</li>`).join('')}</ul>` : ''}<details><summary>Independent managed-agent ID & timing</summary><code>${esc(worker.id)}</code><p>Startup ${durationLabel(worker.timings?.startup_seconds)} · remote execution ${durationLabel(worker.timings?.agent_seconds)} · local check ${durationLabel(worker.timings?.local_seconds)}</p></details></div>` : '';
  paint('scenarioDetail', `<div class="scenario-detail-heading"><h3>Wind ${direction(cell.wind)} · seed ${cell.seed}</h3>${pill({ houseIgnited: cell.houseIgnitedAt !== null, houseIgnitedAt: cell.houseIgnitedAt })}</div><p>${scenarioResult ? matches ? 'Interactive replay reproduces the stored local result with the same wind, speed, and seed.' : 'The recalculated preview differs from the stored result. The matrix shows the original local verification.' : 'Loading the property snapshot for replay…'}</p>${scenarioResult ? chain(scenarioResult) || `<p>${scenarioResult.ignitedObjects.length} modeled objects ignited; the house did not.</p>` : ''}${workerDetails}<button id="replayScenario" ${matches ? '' : 'disabled'}>Replay this scenario in 3D ↗</button>`);
}

async function selectScenario(wind, seed) {
  const cell = extendedState()?.cells.find((item) => item.wind === wind && item.seed === seed && item.verified);
  if (!cell) return;
  const token = ++scenarioToken, id = runId;
  selectedScenario = { wind, seed }; scenarioResult = null; renderScenarioDetail();
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    const selected = button.dataset.scenario === `${wind}:${seed}`;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
  try {
    const plan = await getScenarioSpec();
    if (token !== scenarioToken || id !== runId) return;
    scenarioSpec = plan;
    const mph = state.agent.mph ?? state.conditions?.mph ?? 30;
    scenarioResult = new Sim(plan, { windFrom: wind, seed, mph, duration: state.agent.duration || 90 }).run();
    renderScenarioDetail();
  } catch (error) { if (token === scenarioToken) paint('scenarioDetail', `<p class="empty-state">Could not prepare this replay: ${esc(error.message)}</p>`); }
}

async function replayScenario() {
  if (!selectedScenario || !scenarioSpec || !scenarioResult) return;
  const cell = extendedState()?.cells.find((item) => item.wind === selectedScenario.wind && item.seed === selectedScenario.seed);
  if (!cell?.verified || scenarioResult.houseIgnitedAt !== cell.houseIgnitedAt) return;
  previewScenario = { ...cell };
  sceneRequest++;
  keepCamera(() => showSpec(scenarioSpec));
  $('version').value = 'extended';
  sim = new Sim(scenarioSpec, { windFrom: cell.wind, seed: cell.seed, mph: state.agent.mph ?? state.conditions?.mph ?? 30, duration: state.agent.duration || 90 });
  simView = new SimView(scene, built, sim);
  $('play').innerHTML = '<span aria-hidden="true">↻</span> Replay selected scenario';
  vp.querySelector('.viewer-badge').textContent = `SWARM SCENARIO · ${direction(cell.wind)} · SEED ${cell.seed}`;
  $('segOriginal').classList.remove('on'); $('segChanges').classList.remove('on');
  $('scenarioChip').hidden = false;
  $('scenarioChip').innerHTML = `Scenario: wind from <b>${direction(cell.wind)}</b> · trial ${cell.seed} · ${cell.houseIgnitedAt ? `house ignites at ${esc(cell.houseIgnitedAt)}` : 'no house ignition'} <button data-back-assessment>Back to assessment</button>`;
  applyLayers();
}

function render() {
  const summary = assessmentSummary(state);
  renderObservations(); renderTakeaway(summary); renderActivity(); renderEvidence(summary); renderAgent(); setBusy();
  $('runStatus').textContent = state?.status === 'done' ? 'Complete' : state?.status === 'error' ? 'Interrupted' : state ? 'Working' : 'Ready';
  $('runStatus').className = `status-label ${state?.status || ''}`;
  $('workspaceStatus').textContent = state?.status === 'done' ? 'Assessment complete' : state?.status === 'error' ? 'Run interrupted' : state ? 'Agent working…' : 'Illustrative preview';
  const waiting = Boolean(state && !state.spec_versions.length);
  $('modelWaiting').hidden = !waiting;
  $('play').disabled = waiting;
  if (waiting) $('simStatus').textContent = state.status === 'error' ? 'No model was completed · see agent activity' : 'Waiting for the model generated from this footage';
  if (extendedState()?.active) $('workspaceStatus').textContent = 'Extended all-winds test running';
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-tab]'); if (button) openTab(button.dataset.openTab);
  const cell = event.target.closest('[data-scenario]');
  if (cell) {
    const chosenRun = runId;
    selectScenario(...cell.dataset.scenario.split(':').map(Number)).then(() => {
      if (runId === chosenRun) replayScenario();
    });
  }
  if (event.target.closest('#replayScenario')) replayScenario();
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-update-report]'); if (!button || !runId) return;
  button.disabled = true; button.textContent = 'Updating…';
  try { await api(`/api/runs/${runId}/report`, { method: 'POST' }); } catch (error) { notify(error.message); button.disabled = false; button.textContent = 'Update action plan'; }
});
// "Do these first" → show where the change applies on the model.
document.addEventListener('click', async (event) => {
  const item = event.target.closest('[data-show-fix]'); if (!item) return;
  const fixId = item.dataset.showFix || Object.keys(CATALOG).find((k) => CATALOG[k].title.toLowerCase().trim() === String(item.dataset.title || '').toLowerCase().trim());
  if (versionKind !== 'changes') await setVersion('changes');
  const ids = (spec?.fixed || []).filter((f) => f.fix === fixId).map((f) => f.id);
  const group = groups.find((g) => g.ids?.some((id) => ids.includes(id)));
  if (group) { openHazardCard(group); $('viewerShell').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  else { item.textContent = 'Removed in model'; item.disabled = true; }
});
// Setup lives in a panel under the header: open by default when nothing is loaded.
// Entry mode: intro + upload on the left, the shared 3D viewer as an illustrative preview on the right.
function setSetup(open) {
  document.body.classList.toggle('entry-mode', open);
  $('entry').hidden = !open;
  (open ? $('entryViewerSlot') : $('workspaceViewerSlot')).appendChild($('viewerShell'));
  $('newAssessment').textContent = open && runId ? 'Back to assessment' : 'New assessment';
  requestAnimationFrame(resize);
}
$('newAssessment').onclick = () => setSetup(!document.body.classList.contains('entry-mode'));
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-open-setup]')) setSetup(true);
  if (event.target.closest('[data-load-illustrative]')) $('illustrative').click();
  if (event.target.closest('#heroSample')) $('sample').click();
  if (event.target.closest('[data-run-swarm]')) { if (!$('agent').disabled) $('agent').click(); openTab('sims'); }
});
$('windTest').onclick = async () => {
  $('windTest').disabled = true; notify();
  try { const data = new FormData(); data.append('wind', $('judgeWind').value); await api(`/api/runs/${runId}/wind`, { method: 'POST', body: data }); openTab('sims'); }
  catch (error) { notify(error.message); $('windTest').disabled = false; }
};
$('agent').onclick = async () => {
  extendedLaunching = Date.now() / 1000; previousAgentId = state?.agent?.id || null; notify(); renderAgent(); setBusy(); openTab('sims');
  try { await api(`/api/runs/${runId}/agent`, { method: 'POST' }); await refresh(); }
  catch (error) { extendedLaunching = 0; notify(error.message); renderAgent(); setBusy(); }
};
let extendedPollAt = 0;
setInterval(() => {
  updateExtendedClock();
  if (runId && (extendedLaunching || extendedState()?.active) && Date.now() - extendedPollAt >= 4000) {
    extendedPollAt = Date.now(); refresh();
  }
}, 1000);
api('/api/health').then((health) => { $('health').textContent = health.gemini_key ? 'Gemini connected' : 'API key missing'; $('health').style.color = health.gemini_key ? '' : 'var(--fire)'; }).catch(() => { $('health').textContent = 'API offline'; $('health').style.color = 'var(--fire)'; });
const { kit, spec: illustrativeSpec } = createKit(); new Function('kit', demoScene)(kit); showSpec(illustrativeSpec, true);
render(); requestAnimationFrame(animate);
const linked = new URLSearchParams(location.search).get('run');
if (linked && /^[a-zA-Z0-9-]+$/.test(linked)) loadRun(linked);
else { setSetup(true); }
window.addEventListener('beforeunload', () => eventSource?.close());

// ===================== Inspection-tool interactions =====================
let paused = false, selectedKey = null, versionKind = 'changes';
const DEMO_FIXES = [{ fix: 'clear_gutters', target: 'all' }, { fix: 'screen_vents', target: 'all' }, { fix: 'clear_zone0_plants' }, { fix: 'gravel_zone0', target: 'all' }, { fix: 'enclose_deck', target: 'all' }];
const illustrativeFixed = applyFixes(illustrativeSpec, DEMO_FIXES).spec;

function keepCamera(fn) {
  const cam = camera.position.clone(), target = controls.target.clone();
  fn(); camera.position.copy(cam); controls.target.copy(target);
}
// Original property | With changes — same camera, same layers.
async function setVersion(kind) {
  versionKind = kind; previewScenario = null; $('scenarioChip').hidden = true;
  $('segOriginal').classList.toggle('on', kind === 'original'); $('segChanges').classList.toggle('on', kind === 'changes');
  closeHazardCard();
  if (!runId) { keepCamera(() => showSpec(kind === 'original' ? illustrativeSpec : illustrativeFixed, true)); applyLayers(); return; }
  const n = kind === 'original' ? state?.base_spec : state?.spec_versions?.at(-1)?.n;
  if (n === undefined) return;
  try { const next = await api(`/api/runs/${runId}/spec/${n}`); keepCamera(() => showSpec(next)); $('version').value = n; applyLayers(); } catch (error) { notify(error.message); }
}
$('segOriginal').onclick = () => setVersion('original');
document.addEventListener('click', (e) => { if (e.target.closest('[data-back-assessment]')) setVersion('changes'); });
$('segChanges').onclick = () => setVersion('changes');

// Camera tools
$('resetCam').onclick = () => { const c = spec?.cameras?.[0]; if (c) { camera.position.set(...c.pos); controls.target.set(...c.lookAt); } else { camera.position.set(90, 80, 110); controls.target.set(0, 5, 0); } };
$('topView').onclick = () => { controls.target.set(0, 0, 0); camera.position.set(0.01, 190, 0.01); };
$('fullscreen').onclick = () => { const shell = $('viewerShell'); if (document.fullscreenElement) document.exitFullscreen(); else shell.requestFullscreen?.(); };
document.addEventListener('fullscreenchange', () => requestAnimationFrame(resize));

// Layers
function applyLayers() {
  const hz = $('layerHazards').checked, fx = $('layerFixes').checked;
  labelFilter = hz && fx ? 'all' : hz ? 'risk' : fx ? 'fix' : 'off';
  renderLegend();
  const zone = scene.getObjectByName('zone0'); if (zone) zone.visible = $('layerZone').checked;
  $('compass').hidden = !$('layerWind').checked;
}
['layerHazards', 'layerFixes', 'layerZone', 'layerWind', 'layerLabels'].forEach((id) => { $(id).onchange = applyLayers; });

// Compass + wind arrow (the arrow points where the wind blows to)
function currentWind() { return sim?.opts.windFrom ?? state?.sims?.at(-1)?.wind ?? state?.conditions?.wind ?? +$('wind').value; }
function updateCompass() {
  $('compass').style.transform = `rotate(${controls.getAzimuthalAngle()}rad)`;
  $('windArrow').style.transform = `translate(-50%, -50%) rotate(${currentWind() + 180}deg)`;
  $('playWind').textContent = `Wind from ${direction(currentWind())} · ${state?.conditions?.mph ?? 30} mph`;
}

// Playback: play/pause, timeline seek, speed
const startPreview = $('play').onclick;
$('play').onclick = () => {
  if (sim && !sim.done) { paused = !paused; $('play').innerHTML = paused ? '<span aria-hidden="true">▷</span> Resume' : '<span aria-hidden="true">❚❚</span> Pause'; return; }
  paused = false; keepCamera(() => startPreview()); $('play').innerHTML = '<span aria-hidden="true">❚❚</span> Pause';
};
$('simTimeline').oninput = () => {
  if (!spec) return;
  const t = +$('simTimeline').value, opts = sim ? { ...sim.opts } : { windFrom: currentWind(), mph: state?.conditions?.mph ?? 30, seed: state?.conditions?.seed ?? 7 };
  keepCamera(() => showSpec(spec, !runId));
  sim = new Sim(spec, opts); simView = new SimView(scene, built, sim);
  while (sim.t < t && !sim.done) sim.step();
  simView.update(0.05); paused = true; applyLayers();
  $('simClock').textContent = `${fmtTime(sim.t)} / ${fmtTime(sim.opts.duration)}`;
  $('play').innerHTML = '<span aria-hidden="true">▷</span> Resume';
};

// Hazard / change detail card: click a marker → fly there and explain it.
function flyToPos(pos) {
  const target = new THREE.Vector3(...pos);
  const offset = camera.position.clone().sub(controls.target).setLength(48);
  flight = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: target.clone().add(offset), toTarget: target };
}
controls.addEventListener('start', () => { flight = null; });
const KIND_WORDS = [['gutter', 'gutter'], ['vent', 'vent'], ['fence', 'fence'], ['mulch', 'mulch'], ['deck', 'deck'], ['firewood', 'firewood'], ['juniper', 'plant'], ['plant', 'plant'], ['tree', 'plant'], ['shrub', 'plant']];
function footageFor(label) {
  const kind = KIND_WORDS.find(([w]) => label.toLowerCase().includes(w))?.[1];
  const obj = kind && (state?.inventory?.objects || []).find((o) => o.kind === kind && o.seen_at?.length);
  return obj ? obj.seen_at[0] : null;
}
function closeHazardCard() { $('hazardCard').hidden = true; selectedKey = null; }
function openHazardCard(group) {
  selectedKey = group.key; flyToPos(group.positions[0]);
  const chain = state?.sims?.[0]?.result?.chain || [];
  const step = chain.find((c) => group.ids.includes(c.obj));
  const ts = footageFor(group.label);
  const num = group.type === 'fix' ? '✓' : String(group.n).padStart(2, '0');
  const fact = group.type === 'fix' ? 'Applied in the 3D model (a digital change). The work still needs to be done at the property.'
    : step ? `In the original test this ignited at ${step.time}, on the path to the house.` : state ? 'Not on the house-ignition path in the original test.' : 'Illustrative hazard on a sample property.';
  $('hazardCard').innerHTML = `<button class="card-close" aria-label="Close">×</button><h4><span class="num ${group.type}">${num}</span>${esc(group.label)}</h4>
    <p>${ts ? `Similar feature seen in your footage at ${esc(ts)}.` : runId ? 'Not matched to a footage timestamp.' : 'Sample property · no footage.'}</p><p>${esc(fact)}</p>
    <div class="card-actions">${ts ? `<button data-card="footage" data-ts="${esc(ts)}">View footage</button>` : ''}<button data-card="replay">Replay ignition</button>${group.type === 'risk' ? '<button data-card="change" class="primary">View proposed change</button>' : '<button data-card="original">View original</button>'}</div>`;
  $('hazardCard').hidden = false;
}
let downAt = null;
vp.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
vp.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || e.target.closest('#hazardCard, .pin-legend')) return;
  const rect = vp.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
  const hit = pins.find((p) => Math.hypot(p.x - x, p.y - y) < 14);
  if (hit) openHazardCard(groups.find((g) => g.key === hit.key)); else closeHazardCard();
});
$('hazardCard').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.classList.contains('card-close')) { closeHazardCard(); return; }
  const act = b.dataset.card;
  if (act === 'footage') { const [m, sec] = b.dataset.ts.split(':').map(Number); $('player').currentTime = m * 60 + sec; $('player').play().catch(() => {}); $('player').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  if (act === 'replay') setVersion('original').then(() => { sim = null; paused = false; $('play').click(); });
  if (act === 'change') setVersion('changes');
  if (act === 'original') setVersion('original');
});

// Upload: drag-and-drop or picker; the main button starts once a file is chosen.
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('drag')));
dz.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { $('video').files = e.dataTransfer.files; $('video').onchange(); } });
$('start').onclick = () => { if (!$('video').files[0]) $('video').click(); else start('upload'); };
const prevVideoChange = $('video').onchange;
$('video').onchange = () => { prevVideoChange(); $('start').textContent = $('video').files[0] ? 'Analyze walkthrough' : 'Upload walkthrough'; };

// Editable assessment name, remembered per run on this device.
function nameKey() { return `zz.name.${runId || 'illustrative'}`; }
function syncName() {
  if (document.activeElement === $('assessmentName')) return;
  let saved = null; try { saved = localStorage.getItem(nameKey()); } catch { /* storage unavailable */ }
  const pretty = (n) => { const t = n.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s\d{5,}$/, '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : 'Home'; };
  $('assessmentName').textContent = saved || (runId ? `${state?.source?.name ? pretty(state.source.name) : 'Home'} · Assessment ${runId.slice(-4)}` : 'Illustrative property');
}
$('assessmentName').addEventListener('blur', () => { try { localStorage.setItem(nameKey(), $('assessmentName').textContent.trim().slice(0, 60)); } catch { /* storage unavailable */ } });
$('assessmentName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
setInterval(syncName, 1000); syncName();

// The illustrative preview starts on the original property (hazards visible).
if (!runId) { versionKind = 'original'; $('segOriginal').classList.add('on'); $('segChanges').classList.remove('on'); }
