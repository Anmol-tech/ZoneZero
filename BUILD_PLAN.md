# ZoneZero: build plan

**Hackathon:** Gemini 4 Argon SF. Track 2 ("More Dimensions") plus the side prize for best use of Managed Agents.
**Hacking window:** 10:30 to 5:00. Submit by **4:45**.

---

## 1. Pitch
> "Film a 2-minute walk around your house. ZoneZero builds a 3D model of it, simulates a wildfire ember storm, shows you exactly how your home catches fire, and tests fixes until it doesn't."

**User:** a homeowner in a California fire zone (Altadena, Paradise) who just got an insurance non-renewal letter. They have a weekend and a limited budget, and no idea what to fix first.

**Problem:**
- Fire-safety research from IBHS finds that most homes lost in wildfires are ignited by **embers**, through small details near the house: fences, gutters, vents, mulch, firewood.
- California's **Zone 0** rules (keep the first 5 ft around a home ember-resistant) are being rolled out.
- Professional assessments cost money and take weeks.

**What we never claim:** ZoneZero is not a certified assessment. It explains ember risk using published CAL FIRE and IBHS guidance, and the homeowner decides what to do.

---

## 2. How it maps to what judges score

| Criterion | How we hit it |
|---|---|
| Live demo plus verification loop (50%) | Two visible loops. **Fidelity:** render the model, compare with the real video, fix. **Mitigation:** simulate, watch, fix, simulate again, verify the house survives. |
| Problem and usefulness (25%) | A real person, a real deadline (insurance letter), real rules (Zone 0). The output is a prioritized checklist. |
| Originality (15%) | Needs long video, plus generating the whole model in one pass, plus checking its renders against reality, plus reasoning about fire spread. |
| Pitch (10%) | Phone video in, burning-house simulation, fixes, house survives. |
| **Managed Agents ($5,000)** | The generate → render → compare → fix loop runs in the Antigravity sandbox with headless Chromium. |

---

## 3. Pipeline

```
 phone walk-around video (.mp4, 1–2 min)
        │
 ① SURVEY      gemini-4-argon (thinking: medium) — watches full video
        │      → inventory.json: objects, materials, positions relative to house,
        │        distances, timestamps where each is seen
        ▼
 ② GENERATE    gemini-4-argon — writes scene.js in ONE pass using our Scene Kit API
        │      (every object registered with material + flammability + tags)
        ▼
 ③ FIDELITY LOOP  (max 3 iterations)
        │  render scene.js headless from cameras matching video keyframes
        │  Argon gets [real frame | render] pairs → critique JSON
        │  → patch scene.js → re-render … until "pass" or 3 iterations
        ▼
 ④ SIMULATE    ember storm (seeded, wind dir/speed) in Three.js → record .webm
        │      + ignition log (what ignited, when, what it spread to)
        ▼
 ⑤ MITIGATION LOOP  (max 4 iterations)
        │  Argon watches sim video + log → failure chain ("0:14 embers in gutter
        │  → 0:31 fence → east wall → house ignites 0:48")
        │  → picks fixes from Mitigation Catalog → applies to scene
        │  → re-simulate SAME seed → Argon verifies: did the chain break?
        │  → repeat until house survives or the catalog runs out
        ▼
 ⑥ REPORT      ranked fixes (effect × cost band), before/after clips, Zone 0 checklist
```

### Where each model is used
| Step | Model | Why |
|---|---|---|
| ① Survey | `gemini-4-argon`, thinking medium | Long video understanding |
| ② Generate | `gemini-4-argon` | Long output: the whole model in one pass |
| ③ Fidelity critique | `gemini-4-argon`, thinking low | Comparing renders with real frames |
| ⑤ Watch the simulation and plan fixes | `gemini-4-argon`, thinking medium | Reasoning about how fire spreads |
| Quick checks (does the JSON parse, labeling keyframes) | `gemini-3.8-flash` / `gemini-3.5-flash-lite` | Speed |
| Steps ②–⑤ as a single sandbox job | **Managed Agent** `antigravity-preview-09-2026` | The side prize: a long-running, multi-step job with renders |

**Plan for the Managed Agent:** first build the pipeline as a local Python orchestrator so it definitely works. Then send the same kit, scripts and inputs to the Managed Agent and let it run steps ②–⑤ in its sandbox. The 10:30 tests decide which one runs live:
- If the agent is fast enough, it runs everything.
- If not, it runs only the mitigation loop (⑤) in the background, and the local pipeline handles the rest.

---

## 4. Scene Kit (what Argon writes code against)
Argon generates `scene.js` using **only** these functions. That keeps the generated code valid, lets the simulation read every material, and acts as the guardrail.

```js
// all units in feet, house footprint origin at (0,0)
kit.house({ w, d, h, roof: "asphalt"|"wood_shake"|"tile"|"metal", siding: "wood"|"stucco"|"fiber_cement" })
kit.vent({ wall: "N"|"E"|"S"|"W", x, h, screened: false })
kit.gutter({ wall, debris: true|false })
kit.deck({ wall, depth, material: "wood"|"composite", underside: "open"|"enclosed", debris: true|false })
kit.fence({ from:[x,z], to:[x,z], material: "wood"|"metal"|"masonry", attachedToHouse: true|false })
kit.plant({ x, z, kind: "juniper"|"shrub"|"tree"|"grass", height })
kit.mulch({ x, z, w, d, material: "bark"|"gravel" })
kit.firewood({ x, z })
kit.object({ x, z, kind: "patio_furniture"|"trash_bin"|"propane_tank"|"car", material })
kit.camera({ id, pos:[x,y,z], lookAt:[x,y,z], videoTimestamp: "0:42" })  // for fidelity renders
```

**Validator** (`kit/validate.mjs`) checks:
- only kit calls are used,
- everything is within 150 ft of the house,
- no overlapping objects,
- every material is from the allowed list,
- at least 4 cameras.

Failures go back to Argon as feedback.

---

## 5. Ember simulation (`sim/embers.js`)
- **Seeded and deterministic**, so before and after runs are a fair comparison.
- Embers spawn upwind and drift with wind plus noise, then land.
- **Ember build-up:** objects tagged as ember traps (gutters with debris, inside corners, the gap under an open deck, bark mulch, unscreened vents) gather embers faster.
- **Ignition:** an object ignites when its build-up × its flammability crosses a threshold.
- **Spread:** a burning object can ignite neighbors within range. The range grows with how much fuel the object has and how easily the neighbor ignites.
- The **house ignites** if its siding, a vent, its roof or its gutter ignites.
- **Output:** a recorded .webm plus `ignitions.json` (object, time, source).
- **Visuals:** orange ember particles, glowing build-up spots, and a charred material once something burns.

## 6. Mitigation catalog (Argon picks only from this list)

| Fix | Effect in sim | Cost band |
|---|---|---|
| Clear gutters / add gutter guards | Gutter debris removed | $ |
| 1/8" metal mesh on vents | Vent no longer collects embers | $ |
| Metal gate or section where the fence meets the house (first 5 ft) | Breaks fence → house spread | $$ |
| Clear Zone 0 plants (0–5 ft) | Removes those plants | $ |
| Swap bark mulch for gravel in 0–5 ft | Mulch material → gravel | $ |
| Move firewood 30+ ft away | Moves the object | $ |
| Enclose under the deck / clear debris under it | Deck underside enclosed or cleared | $$ |
| Move items off the deck (furniture, propane) | Moves objects | $ |
| Class A roof replacement | Roof material → tile/metal | $$$ |

Cost bands are deliberately vague. Don't invent dollar figures; label them "rough."

---

## 7. App UI (single page)
- **Left:** the phone video with a scrubber. The detected objects show up as chips with timestamps.
- **Center:** the 3D model. Toggle between the model, a side-by-side fidelity view, and the simulation. You can walk around as an inspector and click an object to see its risk.
- **Right:** the **Argon log**, streaming each stage: survey → generate → fidelity critique (pass ✅/fail ❌ per round) → failure chain → fix applied → verification ✅/❌.
- **Bottom:** before/after simulation clips side by side, plus "house ignites at 0:48" → "house survives."
- **Report tab:** the ranked checklist.

## 8. Repo layout
```
zonezero/
├── README.md               # built-today section, architecture diagram, run steps
├── AGENTS.md               # API quirks we hit
├── web/                    # Vite + Three.js
│   └── src/ main.js, kit/ (scene kit + validate), sim/embers.js,
│            ui/ (log, fidelity view, report), inspector.js
├── server/                 # Python FastAPI
│   ├── main.py             # /run (upload video) → streams stage events (SSE)
│   ├── survey.py  generate.py  fidelity.py  mitigate.py  report.py
│   ├── render.py           # Playwright headless: scene.js → PNGs / sim .webm
│   ├── frames.py           # ffmpeg keyframes at camera timestamps
│   └── agent_job.py        # Managed Agent: create, poll, stream logs
└── samples/house1.mp4      # your own walk-around video
```

---

## 9. Timeline

| Time | Work | Done when |
|---|---|---|
| **10:30–11:15** | **Reduce the API risk first.** Install the gemini-api-dev skill. Test (a) Argon on a 1-minute video → JSON, (b) Argon returning 300+ lines of code, (c) a Managed Agent running a trivial headless-Chromium task. Time each one. | All 3 work; durations noted in AGENTS.md |
| 11:15–12:00 | Scene kit, validator, and a scene you write by hand that renders | A hand-written house renders |
| 12:00–12:45 | ① Survey and ② Generate on your real video | Argon's scene.js renders your house |
| 12:45–1:30 | Ember simulation and recording | The hand-written scene ignites believably |
| 1:30–2:15 | ⑤ Mitigation loop (the money shot) | House ignites → fixes → house survives, verified |
| 2:15–2:45 | ③ Fidelity loop (keyframes, side-by-side, patching) | At least 1 visible fix round |
| 2:45–3:30 | UI: streaming log, before/after, report. Managed Agent wiring. | Full run viewable in the browser |
| 3:30–4:00 | Full rehearsal twice; save a finished run as backup | Two clean runs |
| 4:00–4:45 | 1-minute video, README, make the repo public, **submit** | Submitted |

**Why the mitigation loop comes before the fidelity loop:** "house survives" is the demo's payoff, so it's built first.

**If you have teammates, split the work this way:**
- **A:** scene kit and ember simulation
- **B:** server pipeline and prompts
- **C:** Managed Agent and rendering
- **D:** UI and report

**Cut order if behind:**
1. inspector walk mode
2. Report tab (fold it into the log)
3. fidelity loop down to 1 round

Never cut the mitigation verification.

---

## 10. Three-minute demo
1. **0:00–0:25 Hook:** "Most homes lost in wildfires are lit by embers, not the fire front. This homeowner's insurer just dropped them. What should they fix first?" Play 5 s of the walk-around video.
2. **0:25–1:00 Build:** start the run. Survey chips appear. The model renders. Fidelity view: "the fence touches the house in the video, but not in the model" → patched ✅.
3. **1:00–1:45 Burn:** the ember storm. "Embers in gutter → fence → east wall. House ignites at 0:48."
4. **1:45–2:30 Fix and verify:** Argon applies gutter guards and a metal fence section, and re-runs with the same seed: "House survives ✅." **A judge picks a new wind direction live**, and the system checks whether the fixes still hold. This is the real-input moment.
5. **2:30–3:00 Report:** the ranked checklist, Zone 0 items, before/after clip. "A $300 weekend instead of a $3,000 assessment wait. And the Managed Agent ran this whole loop in its own sandbox."

Since a full run may take longer than 3 minutes, start it when you walk up. If it isn't done in time, switch to the finished run saved from rehearsal and say so on screen.

## 11. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Video input is slow or too big | Downscale to 480p, or send 1-fps keyframes plus the audio narration |
| Argon writes a broken scene.js | The validator's errors go back for up to 2 retries. Otherwise use the last valid scene. |
| The model looks rough | That's expected. Pitch it as "what's next to what, and what it's made of," not a photoreal copy. |
| The Managed Agent is slow | It runs only the mitigation loop in the background; the local pipeline runs the rest |
| Wi-Fi or the API fails during judging | Replay a saved run with a clear "recorded" label |
| A judge asks "is the sim accurate?" | "It's a guidance tool based on IBHS and CAL FIRE ember research, not a certified assessment. It shows the *chain* so the homeowner understands why." |

## 12. Get first
- [ ] **Your walk-around video:** 1–2 minutes around a real house you have permission to film. Go slowly, show the fence and the house, gutters, vents, plants close to the walls and under the deck. Optionally narrate ("this is the east side, wood fence"). Shoot a second, shorter one as backup.
- [ ] Gemini credits from the kickoff
- [ ] Ask the mentors: how to send video in the Interactions API (inline or upload), size limits, how long Managed Agent runs take, and whether the sandbox can install Playwright or Chromium.
