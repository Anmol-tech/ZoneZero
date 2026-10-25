"""Independent managed agents, one sandbox and interaction per wind/seed case."""
import asyncio
import json
import os
import time
import uuid

import gemini as g
import tools

WINDS = tuple(range(0, 360, 45))
SEEDS = (1, 2, 3)
ACTIVE = {"queued", "launching", "running", "verifying", "in_progress", "cancelling"}

TASK = """You are scenario agent {key}, one member of a 24-agent swarm.
Your ONLY assigned scenario: wind FROM {wind} degrees, seed {seed}, at {mph} mph, 90 seconds exposure.
All agents receive an IDENTICAL snapshot of the current property, including previously tested fixes.
Run this exact command in your sandbox:
node /workspace/zz/scripts/zz.mjs sim /workspace/zz/property.json {wind} {seed} {mph}

Read the JSON output. Explain the observed ignition chain for YOUR case. If the house ignites,
recommend up to three NEW catalog fixes, with targets and reasons. The catalog is below.
Already applied to this property (do NOT recommend these again; build on them): {already}
Do NOT change the property, search combinations, test other winds/seeds, or inspect unrelated files.
This is an independent assessment of one fixed property, not a global optimization job.
Finish promptly with ONE JSON block:
{{"wind": {wind}, "seed": {seed}, "houseIgnited": true|false,
 "houseIgnitedAt": null|"m:ss", "diagnosis": "short explanation of the simulator output",
 "fixes": [{{"fix": "catalog id", "target": "object id or all", "why": "..."}}]}}
Catalog: {catalog}
"""


def sandbox_files(spec):
    files = {"/workspace/zz/package.json": '{"type":"module"}'}
    for relative in ("scripts/zz.mjs", "src/kit/spec.js", "src/sim/nodes.js", "src/sim/embers.js", "src/sim/mitigations.js"):
        files[f"/workspace/zz/{relative}"] = (tools.WEB / relative).read_text(encoding="utf-8")
    files["/workspace/zz/property.json"] = json.dumps(spec)
    return files


async def baseline_grid(run, mph=None):
    """The same 24 scenarios on the original house (before any change), simulated locally, so the
    all-wind result can be read as before -> after. Deterministic; takes seconds, no agents involved."""
    base = run.state.get("base_spec")
    if base is None:
        return None
    path = run.spec_path(base)
    sem = asyncio.Semaphore(8)

    async def one(wind, seed):
        async with sem:
            result = await asyncio.to_thread(tools.simulate, path, wind, seed, mph or run.mph)
        return {"wind": wind, "seed": seed, "houseIgnitedAt": result.get("houseIgnitedAt") if result.get("houseIgnited") else None}

    grid = await asyncio.gather(*(one(wind, seed) for seed in SEEDS for wind in WINDS))
    return {"spec_n": base, "grid": list(grid), "ignited": sum(1 for c in grid if c["houseIgnitedAt"])}


def new_state(run, concurrency=None):
    cap = concurrency if concurrency is not None else int(os.getenv("ZZ_SWARM_CONCURRENCY", "24"))
    return {"id": f"swarm-{uuid.uuid4().hex[:10]}", "type": "swarm", "status": "queued",
            "launched": time.time(), "concurrency": max(1, min(24, cap)), "total": 24,
            "mph": run.mph, "duration": 90, "spec_n": run.state.get("final_spec", len(run.state["spec_versions"]) - 1),
            "workers": [{"key": f"{wind}-{seed}", "wind": wind, "seed": seed, "status": "queued"}
                        for seed in SEEDS for wind in WINDS],
            "local_check": {"grid": [], "survives": 0}, "timings": {}}


async def run_swarm(run, *, concurrency=None, poll_interval=3, timeout=None):
    swarm = run.state.get("agent")
    if not swarm or swarm.get("type") != "swarm" or swarm.get("status") != "queued":
        swarm = run.state["agent"] = new_state(run, concurrency)
    launched = swarm["launched"]
    timeout = timeout or int(os.getenv("ZZ_SWARM_TIMEOUT", "180"))
    semaphore = asyncio.Semaphore(swarm["concurrency"])
    workers = []
    try:
        # Initialize lazy SDK clients once, before starting concurrent threads.
        g.client().interactions
        snapshot = run.spec(swarm["spec_n"])
        run.path("swarm_property.json").write_text(json.dumps(snapshot), encoding="utf-8")
        swarm["spec"] = "swarm_property.json"
        files = sandbox_files(snapshot)
        catalog = tools._node("catalog")
        # Fixes the frozen property already has, so agents suggest only what is still missing.
        applied = [f"{a['fix']} → {a['target']}" for r in run.state.get("fix_rounds", []) for a in r.get("applied", [])]
        already = "; ".join(dict.fromkeys(applied)) or "none"
        swarm["status"] = "running"
        await run.emit("agent", f"Launching 24 independent managed agents ({swarm['concurrency']} concurrent), one per wind/seed scenario", "running")

        async def worker(case):
            remote_id = None
            began = None
            try:
                async with semaphore:
                    began = time.time()
                    case.update(status="launching", started=began)
                    await run.emit("agent", f"Agent {case['key']}: starting its independent sandbox", "info", scenario=case["key"])
                    prompt = TASK.format(**case, mph=run.mph, catalog=catalog, already=already)
                    for attempt in range(4):
                        # Shield creation so cancellation can still obtain and cancel the remote ID.
                        creation = asyncio.create_task(asyncio.to_thread(g.start_agent, prompt, files))
                        try:
                            remote_id = await asyncio.shield(creation)
                            break
                        except asyncio.CancelledError:
                            remote_id = await creation
                            raise
                        except Exception as error:
                            if "429" not in str(error) or attempt == 3:
                                raise
                            case.update(status="queued", retries=attempt + 1)
                            await run.emit("agent", f"Agent {case['key']}: provider rate limit; retrying", "warn", scenario=case["key"])
                            await asyncio.sleep(2 ** (attempt + 1))
                    case.update(id=remote_id, status="running", remote_started=time.time())
                    swarm["timings"].setdefault("first_agent_started_seconds", round(time.time() - launched, 2))
                    await run.emit("agent", f"Agent {case['key']}: running wind {case['wind']}°, seed {case['seed']}", "info", scenario=case["key"])
                    deadline = time.monotonic() + timeout
                    while True:
                        if time.monotonic() > deadline:
                            raise TimeoutError(f"Scenario exceeded {timeout}s after sandbox startup")
                        await asyncio.sleep(poll_interval)
                        try:
                            response = await asyncio.to_thread(g.poll_agent, remote_id)
                            case.pop("poll_error", None)
                        except Exception as error:
                            case["poll_error"] = str(error)[:300]
                            await asyncio.sleep(poll_interval)
                            continue
                        remote_status = str(response["status"]).lower()
                        if "in_progress" in remote_status or "queued" in remote_status:
                            continue
                        if "completed" not in remote_status:
                            raise RuntimeError(f"Remote agent ended with {remote_status}")
                        break
                    case.update(status="verifying", remote_finished=time.time())
                    await run.emit("agent", f"Agent {case['key']}: checking its result locally", "info", scenario=case["key"])
                    reported = g.parse_json(response["output_text"])
                    if reported.get("wind") != case["wind"] or reported.get("seed") != case["seed"]:
                        raise ValueError("Agent returned a result for the wrong scenario")
                    result = await asyncio.to_thread(tools.simulate, run.path("swarm_property.json"), case["wind"], case["seed"], run.mph)
                    # Validate suggestions without applying them to the shared property.
                    fixes = reported.get("fixes") or []
                    fixes = [fix for fix in fixes if isinstance(fix, dict) and isinstance(fix.get("fix"), str)] if isinstance(fixes, list) else []
                    proposals = run.path(f"swarm_fixes_{case['key']}.json")
                    proposals.write_text(json.dumps(fixes), encoding="utf-8")
                    checked_fixes = await asyncio.to_thread(tools.apply_fixes, run.path("swarm_property.json"), proposals)
                    agrees = reported.get("houseIgnited") == result["houseIgnited"] and reported.get("houseIgnitedAt") == result["houseIgnitedAt"]
                    case.update(status="complete", finished=time.time(), result=result,
                                diagnosis=str(reported.get("diagnosis", "")), suggested_fixes=checked_fixes["applied"],
                                rejected_fixes=checked_fixes["rejected"], agent_agrees=agrees)
                    case["elapsed_seconds"] = round(case["finished"] - began, 2)
                    case["timings"] = {"startup_seconds": round(case["remote_started"] - began, 2),
                                       "agent_seconds": round(case["remote_finished"] - case["remote_started"], 2),
                                       "local_seconds": round(case["finished"] - case["remote_finished"], 2)}
                    row = {"wind": case["wind"], "seed": case["seed"], "houseIgnitedAt": result["houseIgnitedAt"], "worker": case["key"], "agent_agrees": agrees}
                    swarm["local_check"]["grid"].append(row)
                    swarm["local_check"]["survives"] += not result["houseIgnited"]
                    swarm["timings"].setdefault("first_result_seconds", round(time.time() - launched, 2))
                    outcome = f"house ignited at {result['houseIgnitedAt']}" if result["houseIgnited"] else "no house ignition"
                    await run.emit("agent", f"Agent {case['key']}: {outcome} · verified in {case['elapsed_seconds']}s", "info", scenario=case["key"])
            except asyncio.CancelledError:
                case.update(status="cancelled", finished=time.time())
                if remote_id:
                    try:
                        await asyncio.to_thread(g.cancel_agent, remote_id)
                    except Exception as error:
                        case["cancel_error"] = str(error)[:300]
                raise
            except Exception as error:
                case.update(status="failed", error=str(error)[:1200], finished=time.time())
                if began:
                    case["elapsed_seconds"] = round(time.time() - began, 2)
                if remote_id and isinstance(error, TimeoutError):
                    try:
                        await asyncio.to_thread(g.cancel_agent, remote_id)
                    except Exception as cancel_error:
                        case["cancel_error"] = str(cancel_error)[:300]
                await run.emit("agent", f"Agent {case['key']}: {type(error).__name__}: {error}", "warn", scenario=case["key"])

        baseline = asyncio.create_task(baseline_grid(run, swarm["mph"]))
        workers = [asyncio.create_task(worker(case)) for case in swarm["workers"]]
        await asyncio.gather(*workers)
        try:
            swarm["baseline"] = await baseline
        except Exception as error:  # the before-grid is context; never fail the swarm over it
            swarm["baseline_error"] = str(error)[:300]
        count = len(swarm["local_check"]["grid"])
        swarm.update(status="completed" if count == 24 else "partial" if count else "failed", finished=time.time())
        swarm["timings"]["total_seconds"] = round(swarm["finished"] - launched, 2)
        swarm["timings"]["sum_worker_seconds"] = round(sum(case.get("elapsed_seconds", 0) for case in swarm["workers"]), 2)
        swarm["timings"]["local_seconds_sum"] = round(sum(case.get("timings", {}).get("local_seconds", 0) for case in swarm["workers"]), 2)
        await run.emit("agent", f"Swarm finished: {count}/24 independently verified; {swarm['local_check']['survives']} had no house ignition; {swarm['timings']['total_seconds']}s wall time", "done" if count == 24 else "warn")
    except asyncio.CancelledError:
        for task in workers:
            task.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        swarm.update(status="cancelled", finished=time.time())
        await run.emit("agent", "Scenario swarm cancelled", "warn")
        raise
    except Exception as error:
        swarm.update(status="failed", error=str(error)[:1200], finished=time.time())
        await run.emit("agent", f"Scenario swarm failed: {error}", "fail")
