# ZoneZero

**Film a walk around your house. ZoneZero builds a 3D model of it, simulates a wildfire ember storm, shows exactly how the home would catch fire, and tests fixes until it doesn't — then checks the result in every wind direction.**

Built at the **Gemini 4 Argon SF Hackathon** (October 25, 2026) for **Problem Statement Two: More Dimensions** and the **Best use of Managed Agents** prize.
Repository: [github.com/Anmol-tech/ZoneZero](https://github.com/Anmol-tech/ZoneZero) · Team: Anmol Sharma, thesid42.

> ZoneZero is a planning aid based on published IBHS and CAL FIRE ember guidance. It is not a certified assessment, and a simulation is not a guarantee of real-world safety.

---

## 1. The problem

- Fire-safety research (IBHS) finds that **most homes lost in wildfires are ignited by embers**, not the flame front — usually through small details close to the house: gutters full of needles, open vents, a wood fence touching a wall, bark mulch and shrubs against siding, firewood under a deck.
- California is rolling out **Zone 0** rules: the first 5 ft around a home must be ember-resistant.
- Insurers have been **dropping or non-renewing** homeowner policies in fire-prone areas. A professional assessment costs money and takes weeks, and homeowners don't know what to fix first.

**Who it's for:** a homeowner in a wildfire zone (e.g. Altadena, Paradise) with a weekend and a limited budget, who needs to know *which* changes actually stop their house from igniting.

## 2. What it does

1. **Watch** — Gemini 4 Argon watches the homeowner's video and lists every ember-relevant feature with the timestamp where it is visible (gutters, vents, fences, plants, mulch, decks, neighbors, forest edge).
2. **Model** — Argon writes a 3D model of the property in one pass, including the house's real shape (main block, garage wing, cross gables), materials and colors.
3. **Check the model** — the model is rendered from the same viewpoints as the video; Argon compares real frames with renders and corrects the model until it matches.
4. **Burn it** — a deterministic ember storm is simulated and recorded; the ignition chain (what caught first, what spread to the house) is logged.
5. **Fix and verify** — Argon watches the recording, picks fixes from a fixed catalog, applies them to the model, re-runs the *same* storm (same wind, same random seed) and verifies the chain is broken. The simulator is the ground truth.
6. **Check every wind** — 24 Managed Agents test the final property in parallel across 8 wind directions × 3 random trials; every result is re-checked locally.
7. **Plan** — a homeowner action plan with ranked fixes, cost bands and a Zone 0 checklist; every headline is built from recorded numbers.

## 3. Why it needs Gemini 4 Argon

| Capability | How ZoneZero uses it |
|---|---|
| Long, agentic video understanding | The survey runs Argon with `processing: "agentic"` and high-resolution video so it can scrub the clip and inspect frames itself, citing a timestamp per hazard. |
| Long output | The whole property model (often 40–75 Scene Kit calls) is written in one response. |
| Multimodal verification | Argon compares real video frames with its own renders and patches the model (render → watch → critique → fix). |
| Reasoning over fire spread | Argon watches the simulation recording, explains the ignition chain and chooses the smallest set of catalog fixes. |
| Managed Agents | 24 independent Antigravity sandboxes each run one wind/seed scenario and diagnose it, concurrently. |

## 4. How it works

```
phone / drone video
   │
   ▼
① SURVEY ............ gemini-4-argon · thinking high · agentic high-res video
   │                   → inventory with timestamps, house shape, surroundings, coverage gaps
② GENERATE .......... gemini-4-argon · thinking high · writes scene.js with the Scene Kit
   │                   → validator (Node vm, kit-only) rejects bad scenes; errors go back to Argon
③ FIDELITY LOOP ..... render model from video viewpoints (headless Chromium)
   │                   → Argon compares real frame vs render → patches → repeat (≤2 rounds, pass ≥ 8/10)
④ SIMULATE .......... deterministic ember storm (seeded), recorded to video with an ignition log
⑤ MITIGATION LOOP ... Argon watches the recording → picks catalog fixes (citing video evidence)
   │                   → apply → re-simulate same wind + seed → Argon verifies (simulator is ground truth)
⑥ ALL-WIND CHECK .... (opt-in) 24 Managed Agents, 8 directions × 3 trials, locally re-verified
⑦ ACTION PLAN ....... gemini-3.8-flash writes the narrative from fixed numeric facts
```

### Models

| Step | Model |
|---|---|
| Survey, generation, fidelity, mitigation, verification | `gemini-4-argon` (Interactions API) |
| JSON repair, action-plan narrative | `gemini-3.8-flash` |
| All-wind check, per-scenario diagnosis | Managed Agent `antigravity-preview-09-2026` (×24) |

### Guardrails

- **Generated code never runs directly.** `scene.js` runs in a Node `vm` with only `kit` in scope and produces a JSON spec. The validator rejects out-of-range values, objects inside buildings, **plants or mulch on driveways, streets, paths, patios or pools**, and objects inside neighbors' footprints — and sends the errors back to Argon to repair.
- **Fixes only come from a fixed catalog** (14 measures, below). Anything else is rejected with a reason shown in the log.
- **Numbers are never generated.** Result headlines, ignition times and coverage come from recorded simulation fields; the action plan receives them as fixed sentences with units.
- **Tested vs. untested is explicit.** Fixes applied together are labeled "In tested set" (combined effect, not isolated per fix); agent suggestions are "Suggested · not tested".
- **Swarm results are verified locally.** Each agent's claim is replayed by the server; only local results populate the grid.

### The Scene Kit (what Argon writes against)

`kit.house` (size, stories, roof style and ridge, siding, stone/brick base, garage, porch, colors) · `kit.wing` (forward garage, L/T legs, cross-gable bump-outs) · `kit.chimney` · `kit.vent` · `kit.gutter` · `kit.deck` · `kit.fence` · `kit.plant` (juniper, shrub, tree, conifer, grass, with color) · `kit.forest` · `kit.neighbor` · `kit.paving` (driveway, path, patio, street, pool; rect / circle / ring) · `kit.mulch` · `kit.firewood` · `kit.object` · `kit.camera`.

### The scene-modeling skill

`server/skills/zonezero-scene-modeling/` is an agent skill (SKILL.md format) loaded into every modeling call: a 7-step method (orient, measure from known sizes, model the massing, inventory hazards, place objects physically, set cameras, self-check), references on measurements, house-shape patterns, materials and past mistakes, and a validated worked example. With it, generation went from 2–4 validator repairs per run to a valid model on the first try in testing.

### The ember simulation

Pure JavaScript (`web/src/sim/`), so the same code runs in the browser, on the server and in the agent sandboxes. Objects become fuel nodes with ignitability, ember-trap and heat values shaped by IBHS / CAL FIRE guidance; embers drift with wind and lodge; burning nodes heat neighbors (wind-biased); any siding, roof or vent ignition = house ignition. Deterministic by seed, so before/after comparisons are fair. It is a heuristic model for explaining ignition chains, not a validated fire model.

### Mitigation catalog (14 measures)

| Fix | Cost |
|---|---|
| Clean gutters / add metal gutter guards | $ |
| Cover vents with 1/8″ metal mesh | $ |
| Remove plants within 5 ft of the house (Zone 0) | $ |
| Replace bark mulch with gravel within 5 ft | $ |
| Move firewood 30+ ft from the house | $ |
| Move combustible items off the deck / away from walls | $ |
| Zone 1 (5–30 ft): replace bark mulch | $ |
| Replace first 5 ft of fence at the house with metal | $$ |
| Clear debris under the deck and enclose the underside | $$ |
| Trim tree crowns within 10 ft | $$ |
| Zone 1 (5–30 ft): limb up and thin trees | $$ |
| Replace the whole wood fence with metal/masonry | $$$ |
| Re-side a wall with noncombustible siding | $$$ |
| Replace roof with a Class A roof | $$$ |

## 5. The app

A single result-first workspace (Three.js + vanilla JS, FastAPI backend):

- **Result band** — verdict headline colored by outcome (green no ignition · amber mixed · red ignites · gray incomplete), a scope line (scene, wind, speed, duration), three key numbers (tested wind, all winds, fixes tested) and **Do these first** with cost and tested/untested status. Flags when the action plan is older than the latest tests, with **Update action plan**.
- **3D model** — procedurally textured house with wings, gables, windows, garage and porch; conifers, broadleaf trees, shrubs; driveways, pools, neighbors, forest. Numbered hazard pins (red) and fix pins (green) with a collapsible legend; click to fly the camera there. **Before / after** toggle; **Play ember test** with particle fire, smoke and glowing embers.
- **Ember tests** — the tested-wind before/after recordings first, then the all-wind check: hold rate, weakest directions, earliest ignition, a heat-shaded 8×3 grid with per-direction totals, what the 24 agents recommend next (counted), and every scenario's 3D replay.
- **Action plan** — ranked fixes with cost bands and evidence status, a Zone 0 checklist, and "prepared from" provenance.
- **Model vs footage** — real frames beside model renders for every fidelity round.
- **Sidebar** — the original video with timestamped findings ("Seen in your footage"), coverage gaps, what the agent did, and further tests (new wind, all-wind check).

## 6. Measured on October 25, 2026

| Run | Total | Notes |
|---|---|---|
| Illustrative property, no video | ~40 s | baseline ignites at 0:32 → survives after one fix round |
| Same, with the 24-agent all-wind check | **2 min 5 s** | swarm 83 s; result: 7 of 24 scenarios without ignition |
| Forest-house drone clip (10 s), with all-wind check | **3 min 51 s** | survey 96 s, generation 43 s, swarm 35 s; 24 of 24 without ignition |
| Two assessments at once (48 agents) | ~2 min each | 0 rate-limit retries, 0 failed agents |
| 24-agent swarm alone (8 runs) | 35–83 s, median ~70 s | vs ~600–900 s of combined agent time |

Remote/local agreement across all swarm runs: 24/24. Longer footage takes longer to survey (a 34 s clip took ~8 min with high thinking).

## 7. Run it

Requires Node 22+, Python 3.11 with [uv](https://docs.astral.sh/uv/), and ffmpeg.

```bash
cd web && npm install && npm run dev                 # http://127.0.0.1:5173
cd server && uv sync && uv run playwright install chromium
cp .env.example .env                                  # set GEMINI_API_KEY
uv run uvicorn main:app --port 8000
```

Open http://127.0.0.1:5173 → **New assessment** → upload a walk-around video (or **Try sample footage**). Tick **All-wind check (24 agents)** to run the swarm before the action plan (or set `ZZ_SWARM_DEFAULT=1`). Open any saved run with `?run=<id>`. Tests: `cd web && npm test` (20 cases) and `cd server && uv run python -m unittest test_swarm`.

## 8. Repository layout

| Path | Purpose |
|---|---|
| `server/pipeline.py` | Survey → generate → fidelity → simulate → mitigate → (swarm) → report; result facts and provenance |
| `server/swarm.py` | 24 concurrent Managed Agents, local verification, cancellation |
| `server/gemini.py` | Interactions API wrapper (agentic video, retries, Managed Agents) |
| `server/prompts.py` | All Argon prompts + Scene Kit docs; loads the modeling skill |
| `server/skills/zonezero-scene-modeling/` | The scene-modeling skill and worked example |
| `server/tools.py` | Node CLI bridge, ffmpeg, headless Playwright renderer |
| `web/src/kit/spec.js` | Scene Kit + validator (placement checks, footprints) |
| `web/src/sim/` | Ember simulation, fuel nodes, mitigation catalog |
| `web/src/render/` | Three.js builder, textures, particle fire, pins, headless recorder |
| `web/src/ui/` | The app; `facts.js` is the single source of result wording |
| `docs/` | Swarm benchmark, UI/UX audit, this overview |

## 9. Limits and honesty

- The model is a simplified representation of what the camera can see; unseen sides, roofs and vents remain uncertain and are listed as coverage gaps.
- The simulation is a heuristic explanation tool shaped by IBHS / CAL FIRE guidance, not a validated fire-behavior model. Outcomes are for the tested conditions only (30 mph, 90 s), not real-world probabilities.
- Fixes "tested in the model" are digital changes; the homeowner still has to do the work. Combined effects are not attributed to individual fixes.
- Stock clips used for testing show partial exteriors; a full 1–2 minute walk-around gives far better results.
- Sample footage: Pexels clips by Mark Embry, Ahmet Kurt and Kindel Media (free Pexels license), stored locally and excluded from the repository. No third-party 3D assets are used; all geometry and textures are procedural.

## 10. What was built during the hackathon

Everything in the repository was written on October 25, 2026: the pipeline and prompts, Scene Kit and validator, ember simulation and mitigation catalog, Three.js renderer (textures, wings, trees, particle fire, pins), the 24-agent swarm, the scene-modeling skill, the result-first UI, and the UI/UX audit and its fixes.
