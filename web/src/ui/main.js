import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildScene, addLights, SimView, configureRenderer } from '../render/build3d.js';
import { Sim, fmtTime } from '../sim/embers.js';
import { CATALOG } from '../sim/mitigations.js';
import { createKit } from '../kit/spec.js';
import { PHASES, assessmentSummary, phaseStates } from './assessment.js';
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
  zone1_mulch: 'Replace bark mulch within 5–30 feet',
};
const fixLabel = (title, id) => FIX_LABELS[id || Object.keys(CATALOG).find((key) => CATALOG[key].title.toLowerCase().trim() === title?.toLowerCase().trim())] || title;
let runId = null, state = null, eventSource = null, epoch = 0, loading = false;
let events = new Map(), refreshTimer, refreshing = false, refreshAgain = false, currentTab = 'model';
let versionKey = '', sceneRequest = 0;

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
function resize() {
  const rect = vp.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.setSize(rect.width, rect.height);
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
      simView.update();
      $('simStatus').textContent = `Preview ${fmtTime(sim.t)} · ` + (sim.houseIgnitedAt !== null ? `House ignited at ${fmtTime(sim.houseIgnitedAt)}` : sim.done ? 'No house ignition in this preview' : 'No house ignition yet');
      if (sim.done) $('play').innerHTML = '<span aria-hidden="true">↻</span> Replay ember test';
    }
    controls.update(); renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);
}
$('play').onclick = () => {
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
  const id = runId, request = ++sceneRequest;
  try { const next = await api(`/api/runs/${id}/spec/${$('version').value}`); if (runId === id && request === sceneRequest) showSpec(next); } catch (error) { notify(error.message); }
};
async function renderVersions() {
  const versions = state?.spec_versions || [];
  const key = `${runId}:${versions.length}`;
  if (!versions.length || key === versionKey) return;
  versionKey = key;
  paint('version', versions.map((v) => `<option value="${v.n}">v${v.n} · ${esc(v.label.split(':')[0].replace('fidelity fix', 'model correction').replace('fix round', 'mitigation pass'))}</option>`).join(''));
  $('version').value = versions.at(-1).n;
  const id = runId, request = ++sceneRequest;
  try { const next = await api(`/api/runs/${id}/spec/${versions.at(-1).n}`); if (runId === id && request === sceneRequest) showSpec(next); } catch (error) { notify(error.message); }
}

// One event stream per run; deduplicate replayed events and coalesce state reads.
async function loadRun(id) {
  eventSource?.close(); clearTimeout(refreshTimer); epoch++; sceneRequest++;
  const activeEpoch = epoch;
  runId = id; state = null; events = new Map(); versionKey = ''; rendered.clear();
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
  const busy = loading || Boolean(state && ['created', 'running'].includes(state.status));
  for (const id of ['start', 'sample', 'illustrative']) $(id).disabled = busy;
  const ready = state?.status === 'done';
  $('windTest').disabled = !ready; $('agent').disabled = !ready;
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
  paint('log', PHASES.map((phase, index) => {
    const group = allEvents.filter((event) => phase.stages.includes(event.stage) || (index === statuses.findIndex((status) => status === 'error') && event.stage === 'error'));
    let extra = '';
    if (index === 1 && corrections.length) extra = `<div class="raw-event"><strong>What was corrected in the scene</strong><ul>${corrections.map((issue) => `<li>${esc(issue.fix || issue.problem)}</li>`).join('')}</ul></div>`;
    const raw = group.map((event) => `<div class="raw-event">${esc(event.msg)}${event.plan ? `<ul>${(event.plan.fixes || []).map((fix) => `<li>${esc(CATALOG[fix.fix]?.title || fix.fix)}: ${esc(fix.why)}</li>`).join('')}</ul>` : ''}${event.errors ? `<pre>${esc(event.errors.join('\n'))}</pre>` : ''}${event.trace ? `<pre>${esc(event.trace)}</pre>` : ''}</div>`).join('');
    return `<li class="phase ${statuses[index]}"><span class="phase-dot">${statuses[index] === 'complete' ? '✓' : index + 1}</span><h4>${esc(phase.title)}</h4><p>${esc(stories[index])}</p>${group.length ? `<details><summary>${group.length} event${group.length === 1 ? '' : 's'} · view details</summary>${extra}${raw}</details>` : ''}</li>`;
  }).join(''));
}
const pill = (result) => result.houseIgnited ? `<span class="pill bad">House ignited ${esc(result.houseIgnitedAt)}</span>` : '<span class="pill good">No house ignition</span>';
const chain = (result) => result.chain?.length ? `<ol class="chain">${result.chain.map((item) => `<li><b>${esc(item.time)}</b> ${esc(item.label)}</li>`).join('')}</ol>` : '';
function renderEvidence(summary) {
  const { before, latest, applied } = summary;
  const rounds = state?.fix_rounds || [];
  $('simulationNote').textContent = rounds.length || summary.pendingTests ? 'Recorded before/after comparisons use the same wind and random seed within each round.' : before ? state?.status === 'running' ? 'The baseline is recorded. The agent is evaluating the result and testing any required changes.' : 'Only the baseline model was tested. The suggestions in the report were not applied or re-tested.' : 'Recorded tests will appear here. Any before/after comparison uses the same wind and random seed.';
  let simulations = before ? rounds.length ? rounds.map((round) => `<h3>${round.tag === 'wind' ? 'New wind' : 'Mitigation'} · round ${round.round} · wind from ${direction(round.wind)}</h3><div class="ba"><div><h4>Original for this round ${pill(round.before)}</h4><video src="${esc(round.before_video)}" controls muted preload="metadata"></video>${chain(round.before)}</div><div><h4>After tested fixes ${pill(round.after)}</h4><video src="${esc(round.after_video)}" controls muted preload="metadata"></video>${chain(round.after)}<p>${round.verdict.sim_agrees ? 'The agent’s verification agrees with the simulator.' : 'The agent disagreed. This result uses the simulator’s recorded outcome.'}</p></div></div>`).join('') : `<div class="ba"><div><h4>Baseline simulation ${pill(before.result)}</h4><video src="${esc(before.video)}" controls muted preload="metadata"></video>${chain(before.result)}<p>${before.result.ignited.length} modeled objects ignited. ${before.result.houseIgnited ? 'The house also ignited.' : 'The house did not ignite.'}</p></div><div class="no-after"><strong>${state?.status === 'running' ? 'Assessment still in progress' : 'No “after” test was run'}</strong><p>${state?.status === 'running' ? 'The agent is evaluating the baseline and testing changes where needed. Follow its progress on the right.' : 'The agent did not apply mitigation fixes. Its report lists suggestions for you to consider; their effects have not been verified by a second simulation.'}</p></div></div>` : empty('The first recorded ember test will appear here.');
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
  if (!agent) { paint('agentGrid', ''); return; }
  const check = agent.local_check;
  let html = `<p>Extended test: ${esc(agent.status)} · ${agent.step_count || agent.steps?.length || 0} steps</p>`;
  if (agent.result) html += `<p>Agent plan: ${(agent.result.fixes || []).map((fix) => esc(CATALOG[fix.fix]?.title || fix.fix)).join('; ')}.</p>`;
  if (check) html += `<p>Local check: <b>${check.survives}/24</b> runs had no house ignition.</p><table class="grid"><caption>Recorded house ignition time by wind and seed</caption><tr><th>Seed</th>${[0,45,90,135,180,225,270,315].map((wind) => `<th>${direction(wind)}</th>`).join('')}</tr>${[1,2,3].map((seed) => `<tr><th>${seed}</th>${[0,45,90,135,180,225,270,315].map((wind) => { const item = check.grid.find((row) => row.wind === wind && row.seed === seed); return `<td class="${item && !item.houseIgnitedAt ? 'ok' : 'bad'}">${item ? item.houseIgnitedAt || '✓' : '—'}</td>`; }).join('')}</tr>`).join('')}</table>`;
  paint('agentGrid', html);
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
}
document.addEventListener('click', (event) => { const button = event.target.closest('[data-open-tab]'); if (button) openTab(button.dataset.openTab); });
$('windTest').onclick = async () => {
  $('windTest').disabled = true; notify();
  try { const data = new FormData(); data.append('wind', $('judgeWind').value); await api(`/api/runs/${runId}/wind`, { method: 'POST', body: data }); openTab('sims'); }
  catch (error) { notify(error.message); $('windTest').disabled = false; }
};
$('agent').onclick = async () => {
  $('agent').disabled = true; notify();
  try { await api(`/api/runs/${runId}/agent`, { method: 'POST' }); }
  catch (error) { notify(error.message); $('agent').disabled = false; }
};
api('/api/health').then((health) => { $('health').textContent = health.gemini_key ? 'Gemini connected' : 'API key missing'; $('health').style.color = health.gemini_key ? '' : 'var(--fire)'; }).catch(() => { $('health').textContent = 'API offline'; $('health').style.color = 'var(--fire)'; });
const { kit, spec: illustrativeSpec } = createKit(); new Function('kit', demoScene)(kit); showSpec(illustrativeSpec, true);
render(); requestAnimationFrame(animate);
const linked = new URLSearchParams(location.search).get('run');
if (linked && /^[a-zA-Z0-9-]+$/.test(linked)) loadRun(linked);
window.addEventListener('beforeunload', () => eventSource?.close());
