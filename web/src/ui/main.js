import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildScene, addLights, SimView } from "../render/build3d.js";
import { Sim } from "../sim/embers.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let runId = null, es = null, state = null;

// ---------- 3D viewer ----------
const vp = $("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
vp.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
camera.position.set(90, 80, 110);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, 0);
let scene = new THREE.Scene(), built = null, spec = null, sim = null, simView = null, acc = 0, last = performance.now();

function resize() {
  const r = vp.getBoundingClientRect();
  renderer.setSize(r.width, r.height);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(vp);

function showSpec(s) {
  spec = s; sim = null; simView = null;
  scene = new THREE.Scene();
  addLights(scene);
  built = buildScene(s);
  scene.add(built.root);
  $("simStatus").textContent = `${s.objects.length} objects`;
}

function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (sim && !sim.done) {
    acc += dt * 3; // 3x real time
    while (acc >= sim.opts.dt && !sim.done) { sim.step(); acc -= sim.opts.dt; }
    simView.update();
    const t = Math.floor(sim.t);
    $("simStatus").innerHTML = `t=${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")} · ` +
      (sim.houseIgnitedAt !== null ? `<span class="pill bad">house ignited ${fmt(sim.houseIgnitedAt)}</span>` : `<span class="pill good">house OK</span>`);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

$("play").onclick = () => {
  if (!spec) return;
  showSpec(spec);
  sim = new Sim(spec, { windFrom: +$("wind").value, seed: 7 });
  simView = new SimView(scene, built, sim);
};

// ---------- tabs ----------
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
function tab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.id === `tab-${name}`));
  if (name === "model") resize();
}

// ---------- start a run ----------
$("video").onchange = () => ($("videoName").textContent = $("video").files[0]?.name || "");
$("start").onclick = () => start(false);
$("sample").onclick = () => start(true);

async function start(sample) {
  const fd = new FormData();
  if (!sample) {
    const f = $("video").files[0];
    if (!f) return alert("Choose a walk-around video first (or use the demo property).");
    fd.append("video", f);
    $("player").src = URL.createObjectURL(f);
  }
  fd.append("wind", $("wind").value);
  $("log").innerHTML = ""; $("chips").innerHTML = "";
  ["fidelity", "sims", "report"].forEach((k) => ($(k).innerHTML = ""));
  const r = await fetch("/api/runs", { method: "POST", body: fd }).then((r) => r.json());
  runId = r.id;
  $("runId").textContent = `· ${runId}`;
  listen();
}

function listen() {
  es?.close();
  es = new EventSource(`/api/runs/${runId}/events`);
  es.onmessage = async (m) => {
    const ev = JSON.parse(m.data);
    logEvent(ev);
    await refresh(ev);
  };
}

// ---------- log ----------
function logEvent(ev) {
  const li = document.createElement("li");
  li.className = ev.status;
  let extra = "";
  if (ev.plan) extra = `<details open><summary>Ignition chain → fixes</summary><ol>${(ev.plan.failure_chain || []).map((c) => `<li><b>${esc(c.time)}</b> ${esc(c.what)} — ${esc(c.why)}</li>`).join("")}</ol>
    <ul>${(ev.plan.fixes || []).map((f) => `<li>🛠 <b>${esc(f.fix)}</b> → ${esc(f.target)}: ${esc(f.why)}</li>`).join("")}</ul></details>`;
  else if (ev.step?.verdict) extra = `<details><summary>Argon's verification</summary><ul>${(ev.step.verdict.observations || []).map((o) => `<li>${esc(o)}</li>`).join("")}</ul>${esc(ev.step.verdict.remaining_risk || "")}</details>`;
  else if (ev.fidelity?.issues?.length) extra = `<details><summary>Mismatches</summary><ul>${ev.fidelity.issues.map((i) => `<li><b>${esc(i.camera)}</b>: ${esc(i.problem)}</li>`).join("")}</ul></details>`;
  else if (ev.errors) extra = `<details><summary>Validator errors</summary><pre>${esc(ev.errors.join("\n"))}</pre></details>`;
  else if (ev.trace) extra = `<details><summary>trace</summary><pre>${esc(ev.trace)}</pre></details>`;
  li.innerHTML = `<div class="st">${esc(ev.stage)}</div>${esc(ev.msg)}${extra}`;
  $("log").appendChild(li);
  li.scrollIntoView({ block: "end" });
}

// ---------- panels ----------
async function refresh(ev) {
  state = await fetch(`/api/runs/${runId}/state`).then((r) => r.json());
  if (ev.video) $("player").src = ev.video;
  if (ev.inventory) renderChips(ev.inventory);
  if (ev.version || ev.step || ev.stage === "done" || ev.stage === "fidelity") await renderVersions();
  if (state.fidelity.length) renderFidelity();
  if (state.sims.length) renderSims();
  if (state.report) renderReport();
  const ready = state.status === "done";
  $("windTest").disabled = !ready;
  $("agent").disabled = !ready;
  if (state.agent) renderAgent();
}

function renderChips(inv) {
  $("chips").innerHTML = (inv.objects || []).map((o) =>
    `<span class="chip ${o.ember_risk && !/^low/i.test(o.ember_risk) ? "risk" : ""}" data-ts="${esc((o.seen_at || [])[0] || "")}" title="${esc(o.ember_risk)}">${esc(o.description)} · ${esc((o.seen_at || [])[0] || "")}</span>`).join("");
  $("chips").querySelectorAll(".chip").forEach((c) => (c.onclick = () => {
    const [m, s] = (c.dataset.ts || "0:0").split(":"); $("player").currentTime = +m * 60 + +s; $("player").play();
  }));
}

let shownVersions = -1;
async function renderVersions() {
  const vs = state.spec_versions;
  if (!vs.length || vs.length === shownVersions) return;
  shownVersions = vs.length;
  $("version").innerHTML = vs.map((v) => `<option value="${v.n}">v${v.n} · ${esc(v.label)}</option>`).join("");
  $("version").value = vs.length - 1;
  showSpec(await fetch(`/api/runs/${runId}/spec/${vs.length - 1}`).then((r) => r.json()));
}
$("version").onchange = async () => showSpec(await fetch(`/api/runs/${runId}/spec/${$("version").value}`).then((r) => r.json()));

function renderFidelity() {
  $("fidelity").className = "pad";
  $("fidelity").innerHTML = state.fidelity.map((f) => `<div class="round"><h3>Round ${f.round}: ${f.pass ? '<span class="pill good">match</span>' : '<span class="pill bad">mismatch</span>'} score ${esc(f.score)}/10</h3>
    <ul class="issues">${(f.issues || []).map((i) => `<li><b>${esc(i.camera)}</b>: ${esc(i.problem)} → <i>${esc(i.fix)}</i></li>`).join("")}</ul>
    <div class="pairs">${f.pairs.map((p) => `<figure><img src="${p.real}"><figcaption>real · ${esc(p.id)} @ ${esc(p.ts)}</figcaption></figure><figure><img src="${p.render}"><figcaption>model render · ${esc(p.id)}</figcaption></figure>`).join("")}</div></div>`).join("");
}

const verdictPill = (r) => r.houseIgnited ? `<span class="pill bad">house ignites ${esc(r.houseIgnitedAt)}</span>` : `<span class="pill good">house survives</span>`;
const chainList = (r) => r.chain?.length ? `<ol class="chain">${r.chain.map((c) => `<li>${esc(c.time)} ${esc(c.label)} (${esc(c.cause)})</li>`).join("")}</ol>` : "";

function renderSims() {
  $("sims").className = "pad";
  const rounds = state.fix_rounds;
  const first = state.sims[0];
  let html = rounds.length ? "" : `<div class="ba"><div><h4>${esc(first.label)} · wind ${first.wind}° ${verdictPill(first.result)}</h4><video src="${first.video}" controls autoplay muted loop></video>${chainList(first.result)}</div></div>`;
  html += rounds.map((s) => `<h3>${s.tag === "wind" ? "Wind test" : "Fix round"} ${s.round} · wind ${s.wind}° — ${s.applied.map((a) => `${esc(a.title)} <span class="muted">${esc(a.cost)}</span>`).join(", ")}</h3>
    <div class="ba"><div><h4>Before ${verdictPill(s.before)}</h4><video src="${s.before_video}" controls muted loop></video>${chainList(s.before)}</div>
    <div><h4>After ${verdictPill(s.after)} ${s.verdict.sim_agrees ? "· Argon agrees ✅" : "· Argon disagreed ⚠️"}</h4><video src="${s.after_video}" controls muted loop></video>${chainList(s.after)}</div></div>`).join("");
  $("sims").innerHTML = html;
}

function renderReport() {
  const r = state.report;
  $("report").className = "pad report";
  $("report").innerHTML = `<h2>${esc(r.headline)}</h2><h3>Fixes, in priority order</h3>
    <ol>${(r.fixes_ranked || []).map((f) => `<li><b>${esc(f.title)}</b> <span class="pill good">${esc(f.cost)}</span><br>${esc(f.why)}<br><span class="muted">${esc(f.effect)}</span></li>`).join("")}</ol>
    <h3>Zone 0 checklist</h3><ul>${(r.zone0_checklist || []).map((x) => `<li>☐ ${esc(x)}</li>`).join("")}</ul>
    <p class="muted">${esc(r.caveats)}</p>`;
}

function renderAgent() {
  const a = state.agent;
  const chk = a.local_check;
  let html = `<p class="muted">status: ${esc(a.status)} · ${a.steps?.length || 0} steps</p>`;
  if (a.result) html += `<p>Agent plan: ${(a.result.fixes || []).map((f) => `<b>${esc(f.fix)}</b>→${esc(f.target)}`).join(", ")}<br>claims ${esc(a.result.survives)}/24 · tried ${esc(a.result.combinations_tried)}</p>`;
  if (chk) {
    const winds = [0, 45, 90, 135, 180, 225, 270, 315];
    html += `<p>Local re-check: <b>${chk.survives}/24</b> survive</p><table class="grid"><tr><th>seed</th>${winds.map((w) => `<th>${w}°</th>`).join("")}</tr>` +
      [1, 2, 3].map((s) => `<tr><td>${s}</td>${winds.map((w) => { const g = chk.grid.find((x) => x.wind === w && x.seed === s); return `<td class="${g.houseIgnitedAt ? "bad" : "ok"}">${g.houseIgnitedAt || "✓"}</td>`; }).join("")}</tr>`).join("") + "</table>";
  }
  $("agentGrid").innerHTML = html;
}

$("windTest").onclick = async () => {
  const fd = new FormData(); fd.append("wind", $("judgeWind").value);
  await fetch(`/api/runs/${runId}/wind`, { method: "POST", body: fd });
  tab("sims");
};
$("agent").onclick = async () => { await fetch(`/api/runs/${runId}/agent`, { method: "POST" }); };

// Open an existing run (e.g. one started from the API) with ?run=<id>.
const linked = new URLSearchParams(location.search).get("run");
if (linked) {
  runId = linked;
  $("runId").textContent = `· ${runId}`;
  fetch(`/api/runs/${runId}/state`).then((r) => r.json()).then((s) => {
    if (s.video) $("player").src = s.video;
    listen();
  });
}

fetch("/api/health").then((r) => r.json()).then((h) => {
  $("health").textContent = h.gemini_key ? "Gemini key ✓" : "No Gemini key (server/.env)";
  $("health").style.color = h.gemini_key ? "var(--ok)" : "var(--fire)";
}).catch(() => { $("health").textContent = "API offline"; $("health").style.color = "var(--fire)"; });

// Show the demo property immediately so the viewer is never empty.
import("../kit/spec.js").then(async ({ createKit }) => {
  const code = await fetch("/samples/demo_scene.js").then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (!code || spec) return;
  const { kit, spec: s } = createKit();
  // The bundled demo scene is our own file, not model output, so running it here is safe.
  new Function("kit", code)(kit);
  showSpec(s);
});
