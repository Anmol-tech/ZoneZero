# Scenario swarm: implementation and measured timing

Measured on October 25, 2026, after merging upstream `6cc930f`.

## What runs

The extended test creates **24 distinct managed-agent interactions**, one for each combination of 8 wind directions and 3 seeds. `asyncio.gather` dispatches them concurrently; `ZZ_SWARM_CONCURRENCY` defaults to 24 and can limit in-flight jobs when necessary.

Every sandbox receives the same frozen **current property**, including mitigation changes from the original assessment. Each agent runs its one assigned simulation, diagnoses the ignition chain, and may recommend catalog fixes. Suggestions are checked for applicability but **are not applied to the shared property or re-tested as part of that scenario**. This keeps the 24 outcomes comparable.

Each completed agent's result is replayed locally using its assigned wind, seed, and speed. The locally computed outcome populates the matrix, even if the remote claim disagrees. Queued, active, failed, and unchecked cells never count as passes. Per-agent deadlines, cancellation, and duplicate-launch protection are included.

This replaces the former single agent that searched many fix combinations and subsequently checked a final plan over 24 cases. That optimizer was cancelled after about 10m 13s without completing. It is a different workload and is not a sequential timing baseline for the swarm.

## Full 24-agent run

Input: the existing Kindel Media / Pexels house-and-patio assessment (`120646-5154`), frozen current scene v3, wind speed 30 mph, 90-second simulated exposure.

| Measurement | Observed |
|---|---:|
| Distinct remote managed-agent jobs | 24 |
| Concurrency configured | 24 |
| First remote agent started | 10.13 s |
| First locally verified scenario | 24.85 s |
| All 24 scenarios locally verified | **52.54 s** |
| Sum of individual agent durations (overlapping work) | 924.27 s |
| Failed agents | 0 |
| Remote/local result disagreements | 0 |
| Scenarios with no house ignition | 3 / 24 |

Wall-clock timing includes sandbox creation, remote execution and interpretation, local replay, and catalog-suggestion validation. It excludes the earlier video-to-model pipeline. Preview thumbnails are generated asynchronously in the browser after verification and do not delay completion of the agent jobs. The sum of worker durations is not a measured sequential benchmark.

## Controlled concurrency comparison

One trial used the **same three scenarios and task prompts** on the same frozen property: N/seed 1, SE/seed 2, and SW/seed 3. Both batches launched actual managed agents and checked results locally.

| Mode | Wall time |
|---|---:|
| Sequential, concurrency 1 | 114.23 s |
| Concurrent, concurrency 3 | 84.91 s |

Concurrent execution reduced elapsed time by **25.7%**, or a **1.35x speedup**, in this trial. Individual remote-agent durations varied substantially; these measurements are not a latency guarantee or a statistically representative benchmark.

## Views and default behavior

The existing **Ember tests** view contains the 24-cell matrix, a preview card for every scenario, and per-agent diagnoses, suggestions, IDs, and timings. Selecting a cell or card offers a 3D replay using the same property, wind, and seed. Thumbnail generation verifies that the replay reproduces the saved local ignition result. The original assessment and its report remain separate from the scenario view.

The extended swarm remains **opt-in**. A suitable next product choice is to start it in the background after the first report, with progress visible, rather than blocking the first assessment result. The measured variability argues against presenting a fixed completion-time promise.

Local benchmark artifacts (not committed): `runs/swarm-benchmark.json`, `runs/concurrency-comparison.json`, and the saved assessment's per-agent worker records.
