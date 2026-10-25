import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildScene, addLights, SimView, configureRenderer } from '../render/build3d.js';
import { Sim, fmtTime } from '../sim/embers.js';
import { CATALOG } from '../sim/mitigations.js';
import { createKit } from '../kit/spec.js';
import { PHASES, assessmentSummary, phaseStates } from './assessment.js';
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
let events = new Map(), refreshTimer, refreshing = false, refreshAgain = false, currentTab = 'model';
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
  if (currentTab === 'model' && !document.hidden) {
    if (sim && !sim.done) {
      acc += dt * 3;
      while (acc >= sim.opts.dt && !sim.done) { sim.step(); acc -= sim.opts.dt; }
      simView.update(dt);
      $('simStatus').textContent = `Preview ${fmtTime(sim.t)} · ` + (sim.houseIgnitedAt !== null ? `House ignited at ${fmtTime(sim.houseIgnitedAt)}` : sim.done ? 'No house ignition in this preview' : 'No house ignition yet');
      if (sim.done) $('play').innerHTML = previewScenario ? '<span aria-hidden="true">↻</span> Replay selected scenario' : '<span aria-hidden="true">↻</span> Replay ember test';
    }
    if (flight) stepFlight(dt);
    controls.update(); renderer.render(scene, camera);
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
  drawPins(ctx, pins, { highlight: hoverKey || legendKey, alpha: sim && sim.t > 6 && !sim.done ? 0.7 : 1 });
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
  currentTab = name;
  document.querySelectorAll('[data-tab]').forEach((button) => { const active = button.dataset.tab === name; button.classList.toggle('on', active); button.setAttribute('aria-selected', String(active)); });
  document.querySelectorAll('.tab').forEach((panel) => { const active = panel.id === `tab-${name}`; panel.classList.toggle('on', active); panel.hidden = !active; });
  if (name === 'model') resize();
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
    events.set(event.i, event);
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
  loading = true; setBusy(); notify();
  try { const response = await api('/api/runs', { method: 'POST', body: data }); await loadRun(response.id); }
  catch (error) { notify(`Could not start the assessment. ${error.message}`); }
  finally { loading = false; setBusy(); }
}
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
    return `<details class="feature"><summary><span class="feature-name"><strong>${esc(featureTitle(object))}</strong><small>${esc(object.material || object.kind)}</small></span>${timestamp ? `<button class="seek" data-seek="${esc(timestamp)}" aria-label="Play footage at ${esc(timestamp)}">${esc(timestamp)} ↗</button>` : ''}</summary><p>${esc(object.description)}</p>${object.ember_risk ? `<p class="risk-note">${esc(object.ember_risk)}</p>` : ''}</details>`;
  }).join('') : empty(state && !state.video && state.spec_versions.length ? 'Illustrative property. No video survey was performed.' : 'Features appear here after the agent reviews the footage.'));
  const unknowns = inventory?.uncertain || [];
  $('uncertainCount').textContent = unknowns.length ? `${unknowns.length} notes` : '';
  paint('coverageContent', unknowns.length ? `<p>Only visible features can be assessed. Unseen areas remain uncertain.</p><ul>${unknowns.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : `<p>${state?.source?.coverage ? esc(state.source.coverage) + '. ' : ''}A complete walk-around gives the agent more evidence. Unseen materials and elevations cannot be verified.</p>`);
  if (state?.video && $('player').getAttribute('src') !== state.video) $('player').src = state.video;
  const source = state?.source;
  paint('sourceCaption', source?.credit ? `${esc(source.name)} · ${Math.round(state.video_duration || 20)}s<br><a href="${esc(safeLink(source.url))}" target="_blank" rel="noreferrer">${esc(source.credit)}</a> · ${esc(source.coverage)}` : state?.video ? 'Original input footage. The model is based on what the camera can see.' : 'Upload a walk-around video, or try the house-and-patio sample.');
}
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
  paint('resultSummary', `<section class="result-card ${tone}"><span class="result-label">${label}</span><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="result-metrics"><div><strong>${sceneEdits}</strong><span>Model corrections</span></div><div><strong>${summary.pendingTests ? '…' : summary.fixGroups.length}</strong><span>${summary.pendingTests ? 'Verifying fixes' : 'Fix types tested'}</span></div><div><strong>${suggestions.length}</strong><span>Report priorities</span></div></div></section>`);
  if (previewScenario) {
    const cell = previewScenario;
    paint('resultSummary', `<section class="result-card ${cell.houseIgnitedAt === null ? 'success' : 'danger'}"><span class="result-label">SWARM SCENARIO · ${direction(cell.wind)} · SEED ${cell.seed}</span><h3>${cell.houseIgnitedAt === null ? 'No house ignition in this scenario' : `House ignited at ${esc(cell.houseIgnitedAt)}`}</h3><p>Viewing one independent swarm agent’s scenario on the current property. The action plan below belongs to the original single-wind assessment.</p></section>`);
  }
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
  const stories = [
    inventory ? `${plural(inventory.objects?.length || 0, 'feature')} identified from the video.` : state?.spec_versions?.length && !state.video ? 'Illustrative property; no real video surveyed.' : 'Identify visible features and materials.',
    state?.spec_versions?.length ? `${plural(summary.sceneEdits, 'model edit')} · ${plural(state.fidelity?.length || 0, 'comparison')}.` : 'Generate and compare the scene.',
    counts ? `${plural(counts, 'recorded test')} · ${summary.pendingTests ? 'verifying the latest changes.' : summary.applied.length ? `${plural(summary.fixGroups.length, 'fix type')} re-tested.` : state?.status === 'running' ? 'evaluating changes.' : 'no fixes applied.'}` : 'Simulate ember exposure and test any required fixes.',
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
  $('simulationNote').textContent = rounds.length || summary.pendingTests ? 'Recorded before/after comparisons use the same wind and random seed within each round.' : before ? state?.status === 'running' ? 'The baseline is recorded. The agent is evaluating the result and testing any required changes.' : 'Only the baseline model was tested. The suggestions in the report were not applied or re-tested.' : 'Recorded tests will appear here. Any before/after comparison uses the same wind and random seed.';
  let simulations = before ? rounds.length ? rounds.map((round) => `<h3>${round.tag === 'wind' ? 'New wind' : 'Mitigation'} · round ${round.round} · wind from ${direction(round.wind)}</h3>${(round.plan?.fixes || []).some((fix) => fix.evidence_frame) ? `<div class="evrow">${round.plan.fixes.filter((fix) => fix.evidence_frame).map((fix) => `<figure><img src="${esc(fix.evidence_frame)}" data-seek="${esc(fix.seen_in_video_at)}" alt="Footage at ${esc(fix.seen_in_video_at)}" loading="lazy"><figcaption>Footage ${esc(fix.seen_in_video_at)} · ${esc(fixLabel(null, fix.fix))}<br><span>${esc(fix.evidence || '')}</span></figcaption></figure>`).join('')}</div>` : ''}<div class="ba"><div><h4>Original for this round ${pill(round.before)}</h4><video src="${esc(round.before_video)}" controls muted preload="metadata"></video>${chain(round.before)}</div><div><h4>After tested fixes ${pill(round.after)}</h4><video src="${esc(round.after_video)}" controls muted preload="metadata"></video>${chain(round.after)}<p>${round.verdict.sim_agrees ? 'The agent’s verification agrees with the simulator.' : 'The agent disagreed. This result uses the simulator’s recorded outcome.'}</p></div></div>`).join('') : `<div class="ba"><div><h4>Baseline simulation ${pill(before.result)}</h4><video src="${esc(before.video)}" controls muted preload="metadata"></video>${chain(before.result)}<p>${before.result.ignited.length} modeled objects ignited. ${before.result.houseIgnited ? 'The house also ignited.' : 'The house did not ignite.'}</p></div><div class="no-after"><strong>${state?.status === 'running' ? 'Assessment still in progress' : 'No “after” test was run'}</strong><p>${state?.status === 'running' ? 'The agent is evaluating the baseline and testing changes where needed. Follow its progress on the right.' : 'The agent did not apply mitigation fixes. Its report lists suggestions for you to consider; their effects have not been verified by a second simulation.'}</p></div></div>` : empty('The first recorded ember test will appear here.');
  if (summary.pendingTests) simulations += `<h3>Latest re-test · agent verification in progress</h3><div class="ba"><div><h4>Recorded result ${pill(latest.result)}</h4><video src="${esc(latest.video)}" controls muted preload="metadata"></video>${chain(latest.result)}</div><div class="no-after"><strong>The agent is checking this re-test</strong><p>Changes were applied to the model before this recording. The confirmed fix list and explanation will appear after verification.</p></div></div>`;
  paint('sims', simulations);
  paint('fidelity', state?.fidelity?.length ? state.fidelity.map((round, index) => `<details class="round" ${index === state.fidelity.length - 1 ? 'open' : ''}><summary><span>Comparison round ${round.round}</span><span class="pill ${round.pass ? 'good' : 'neutral'}">${round.pass ? 'Agent accepted the match' : `${round.issues?.length || 0} corrections requested`}</span></summary>${round.issues?.length ? `<ul class="issues">${round.issues.map((issue) => `<li><b>Issue:</b> ${esc(issue.problem)}<br><b>Correction:</b> ${esc(issue.fix)}</li>`).join('')}</ul>` : ''}<div class="pairs">${round.pairs.map((pair) => `<figure><img src="${esc(pair.real)}" loading="lazy" alt="Original footage at ${esc(pair.ts)}"><figcaption>Original footage · ${esc(pair.ts)}</figcaption></figure><figure><img src="${esc(pair.render)}" loading="lazy" alt="Model render for camera ${esc(pair.id)}"><figcaption>Model render · ${esc(pair.ts)}</figcaption></figure>`).join('')}</div><p>Agent-assigned match score: ${esc(round.score)}/10. This is a visual comparison, not an independent accuracy certification.</p></details>`).join('') : empty(state?.spec_versions?.length && !state.video ? 'The illustrative property skips video matching.' : 'Video-to-model comparisons will appear after scene generation.'));
  $('fidelityCount').textContent = state?.fidelity?.length || 0;
  paint('testStrip', latest ? `<p><strong>${state.sims.length} recorded test${state.sims.length === 1 ? '' : 's'}</strong> · Wind ${direction(latest.wind)}${latest.mph ? ` at ${latest.mph} mph` : ''}${latest.duration ? ` · ${latest.duration}s exposure` : ''}<br>${summary.pendingTests ? 'Changes were re-tested; verification is in progress.' : applied.length ? 'Model changes were applied and re-tested.' : state?.status === 'running' ? 'The agent is evaluating this result and any required changes.' : 'Suggestions have not been applied or re-tested.'}</p><button data-open-tab="sims">Watch evidence ↗</button>` : `<p>${state ? 'Preparing this property’s first recorded ember test.' : 'Start an assessment to generate a model from footage and record an ember test.'}</p>`);
  const report = state?.report;
  paint('report', report ? `<span class="eyebrow">HOMEOWNER ACTION PLAN</span><h2>${esc(report.headline)}</h2><p class="report-note">${applied.length ? `${plural(applied.length, 'fix')} were tested in the model. This report also describes recommendations and remaining risks.` : 'These are recommendations. No mitigation fixes were applied or re-tested during this assessment.'} Cost bands are rough and relative; they are not quotes.</p><h3>Recommendations, in priority order</h3><ol>${(report.fixes_ranked || []).map((fix) => `<li><b>${esc(fix.title)}</b> <span class="pill neutral">${esc(fix.cost)}</span><br>${esc(fix.why)}<br>Expected benefit: ${esc(fix.effect)}</li>`).join('')}</ol><h3>First 5 feet: checklist</h3><ul>${(report.zone0_checklist || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul><p>${esc(report.caveats)}</p>` : empty('The report appears here when the assessment is complete.'));
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
  paint('extendedMetrics', `<div><strong data-extended-elapsed></strong><span>${extended.active ? 'Elapsed time' : 'Total time'}</span></div><div><strong>${extended.checked}/24</strong><span>Locally checked</span></div><div><strong>${extended.checked ? extended.holds : '—'}</strong><span>No house ignition</span></div><div><strong>${extended.startedCount}/24</strong><span>Remote agents started</span></div>`);
  const messages = {
    launching: 'Launching separate remote sandboxes for the 24 assigned scenarios.',
    searching: `${extended.running} agents active · ${extended.checked} locally checked · ${extended.failed} failed. Each agent tests one wind/seed against the same property.`,
    verifying: `Checking scenario results locally: ${extended.checked} of 24 recorded. Remote claims are not shown as verified results.`,
    complete: `${extended.holds} of 24 scenarios had no house ignition at ${agent?.mph ?? state?.conditions?.mph ?? 30} mph over ${extended.duration}s. Select a cell to inspect or replay that scenario.`,
    partial: `${extended.checked}/24 scenarios verified; ${extended.failed} agents failed. Failed cells are not passes.`,
    cancelled: 'The swarm was cancelled. Completed scenario results are preserved.',
    failed: extended.error || 'The extended test could not finish. Completed assessment results are still available below.',
  };
  $('extendedProgress').textContent = messages[extended.phase];
  paint('scenarioGrid', `<table class="scenario-matrix"><caption>Locally verified scenarios · wind from each compass direction</caption><thead><tr><th scope="col">Seed</th>${WINDS.map((wind) => `<th scope="col">${direction(wind)}<small>${wind}°</small></th>`).join('')}</tr></thead><tbody>${SEEDS.map((seed) => `<tr><th scope="row">${seed}</th>${WINDS.map((wind) => {
    const cell = extended.cells.find((item) => item.seed === seed && item.wind === wind);
    const selected = selectedScenario?.wind === wind && selectedScenario?.seed === seed;
    const label = cell.verified ? cell.outcome === 'no_ignition' ? 'Holds' : cell.houseIgnitedAt : cell.worker?.status || 'queued';
    return `<td><button class="scenario-cell ${cell.outcome} ${selected ? 'selected' : ''}" data-scenario="${wind}:${seed}" ${cell.verified ? '' : 'disabled'} aria-pressed="${selected}" aria-label="Agent wind ${direction(wind)}, seed ${seed}: ${esc(label)}">${esc(label)}</button></td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`);
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

function renderScenarioPreviews() {
  const extended = extendedState();
  $('swarmPreviews').hidden = !extended?.isSwarm;
  if (!extended?.isSwarm) return;
  paint('scenarioPreviews', extended.cells.map((cell) => {
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
  showSpec(scenarioSpec);
  $('version').value = 'extended';
  sim = new Sim(scenarioSpec, { windFrom: cell.wind, seed: cell.seed, mph: state.agent.mph ?? state.conditions?.mph ?? 30, duration: state.agent.duration || 90 });
  simView = new SimView(scene, built, sim);
  $('play').innerHTML = '<span aria-hidden="true">↻</span> Replay selected scenario';
  vp.querySelector('.viewer-badge').textContent = `SWARM SCENARIO · ${direction(cell.wind)} · SEED ${cell.seed}`;
  const viewCamera = overviewCamera(scenarioSpec, cell.wind, camera.aspect); camera.position.copy(viewCamera.position); controls.target.set(0, 5, 0);
  openTab('model'); renderTakeaway(assessmentSummary(state));
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
      if (runId === chosenRun && cell.classList.contains('scenario-preview-card')) $('scenarioDetail').scrollIntoView({ block: 'start' });
    });
  }
  if (event.target.closest('#replayScenario')) replayScenario();
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
window.addEventListener('beforeunload', () => eventSource?.close());
