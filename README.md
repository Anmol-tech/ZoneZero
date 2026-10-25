# ZoneZero 🔥

**Film a 2-minute walk around your house. ZoneZero builds a 3D model of it, simulates a wildfire ember storm, shows exactly how your home would catch fire, and tests fixes until it doesn't.**

Built at the Gemini 4 Argon SF Hackathon (Oct 25, 2026). Track 2: More Dimensions, plus the Managed Agents side prize.

## Demo video
**[▶ Watch the 60-second demo](docs/zonezero-demo.mp4)**: why embers matter, what ZoneZero does, and how it works, shown on a real run (house ignites at 60 s, then no ignition after fixes, and 0 of 24 wind scenarios ignite).

The video is a [Remotion](https://www.remotion.dev) project in [`demo-video/`](demo-video/). Scenes are in `src/scenes.tsx`, timing is in `src/Composition.tsx`, and the Gemini TTS voiceover clips are in `public/vo/`.

```bash
cd demo-video && npm install
npx remotion studio                                  # preview and edit
npx remotion render ZoneZeroDemo out/zonezero-demo.mp4
```

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
   + SCENARIO SWARM: 24 separate Antigravity agents concurrently test the same current home
     (8 wind directions × 3 seeds); each diagnoses its own case and is checked locally
```

**Guardrails**
- Generated code never runs directly: `scene.js` executes in a Node `vm` with only `kit` in scope, which records a JSON spec. A validator rejects bad scenes and sends the errors back to Argon.
- Fixes come only from a fixed catalog (`web/src/sim/mitigations.js`). Anything else is rejected and shown in the log.

## Models
| Step | Model |
|---|---|
| Survey, generate, fidelity critique, mitigation, verification | `gemini-4-argon` (Interactions API) |
| JSON repair, report | `gemini-3.8-flash` |
| All-winds stress test | 24 independent managed agents, `antigravity-preview-09-2026` |

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

After an assessment, **Additional tests → Run 24-agent swarm** starts the optional extended test.
The **Ember tests** view shows all 24 agent states, a wind/seed result matrix, per-agent diagnoses,
and deterministic preview cards with selectable 3D replays. Agent suggestions are not applied to
the shared test property. `ZZ_SWARM_CONCURRENCY` defaults to 24; `ZZ_SWARM_TIMEOUT` defaults to
180 seconds per agent after sandbox creation. See [measured timing and comparison](docs/SWARM_BENCHMARK.md).

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
