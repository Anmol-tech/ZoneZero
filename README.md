# ZoneZero 🔥

**Film a 2-minute walk around your house. ZoneZero builds a 3D model of it, simulates a wildfire ember storm, shows exactly how your home would catch fire, and tests fixes until it doesn't.**

Built at the Gemini 4 Argon SF Hackathon (Oct 25, 2026). Track 2: More Dimensions, plus the Managed Agents side prize.

## Who it's for
A homeowner in a California fire zone who just got an insurance non-renewal letter. IBHS research finds most homes lost in wildfires are ignited by **embers**, through small details near the house: gutters, vents, fences, mulch, firewood. California's **Zone 0** rules target the first 5 ft around the home. ZoneZero shows *this* home's ignition chain and the cheapest fixes that break it.

> ZoneZero is a planning aid based on published IBHS and CAL FIRE ember guidance. It is not a certified assessment.

## How it works (render → watch → critique → fix)

```
phone video ─▶ ① SURVEY (Argon watches the full video → inventory with timestamps)
            ─▶ ② GENERATE (Argon writes scene.js in one pass, using only the Scene Kit API)
            ─▶ ③ FIDELITY LOOP (render the model from the video's viewpoints → Argon compares
                 real frame vs render → patches scene.js → repeat)
            ─▶ ④ SIMULATE (deterministic ember storm, recorded to video with an ignition log)
            ─▶ ⑤ MITIGATION LOOP (Argon watches the sim → picks catalog fixes → apply →
                 re-simulate, same seed → Argon verifies before/after; the simulator is ground truth)
            ─▶ ⑥ REPORT (ranked fixes with cost bands, Zone 0 checklist)
   + JUDGE WIND TEST: re-test the hardened home under any wind; Argon keeps fixing if it fails
   + MANAGED AGENT: an Antigravity sandbox agent searches for the cheapest fix set that survives
     8 wind directions × 3 seeds, then the server re-checks its answer locally
```

**Guardrails**
- Generated code never runs directly: `scene.js` executes in a Node `vm` with only `kit` in scope, which records a JSON spec. A validator rejects bad scenes and sends the errors back to Argon.
- Fixes come only from a fixed catalog (`web/src/sim/mitigations.js`). Anything else is rejected and shown in the log.

## Models
| Step | Model |
|---|---|
| Survey, generate, fidelity critique, mitigation, verification | `gemini-4-argon` (Interactions API) |
| JSON repair, report | `gemini-3.8-flash` |
| All-winds stress test | Managed Agent `antigravity-preview-09-2026` |

## Run it
Requires Node 22+, Python 3.11 with [uv](https://docs.astral.sh/uv/), and ffmpeg.

```bash
cd web && npm install && npm run dev            # http://127.0.0.1:5173
cd server && uv sync && uv run playwright install chromium
cp .env.example .env                              # then set GEMINI_API_KEY
uv run uvicorn main:app --port 8000
uv run python smoke.py                            # optional: time each Gemini call
```

Open http://127.0.0.1:5173. Upload a walk-around video, or click **Demo property**.

## Layout
- `web/src/kit/spec.js`: Scene Kit (the API Argon writes against) plus the validator
- `web/src/sim/`: ember simulation (`embers.js`), fuel nodes (`nodes.js`), mitigation catalog (`mitigations.js`). Pure JS; runs in the browser, Node and the agent sandbox.
- `web/src/render/`: Three.js scene builder and the headless recording page (`render.html`)
- `web/src/ui/`: the app
- `web/scripts/zz.mjs`: command-line interface (`compile` / `sim` / `apply` / `describe` / `catalog`)
- `server/`: FastAPI pipeline (`pipeline.py`), prompts, Gemini wrapper, Playwright renderer
- `samples/demo_scene.js`: a hand-written demo property

## What was built during the hackathon
Everything in this repository was written on Oct 25, 2026 during the event.
