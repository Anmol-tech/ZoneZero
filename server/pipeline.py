"""The ZoneZero pipeline: survey -> generate -> fidelity loop -> simulate ->
mitigation loop (fix + verify) -> report, plus the judge's wind test and the
Managed Agent stress test. Every step emits events the UI streams over SSE."""
import asyncio
import json
import time
import traceback
import uuid
from pathlib import Path

import gemini as g
import prompts as P
import tools

RUNS = tools.ROOT / "runs"
SAMPLES = tools.ROOT / "samples"
MAX_FIDELITY_ROUNDS = 3
MAX_FIX_ROUNDS = 4
CATALOG = json.loads(tools._node("catalog"))

renderer = tools.Renderer()


class Run:
    def __init__(self, rid: str | None = None):
        self.id = rid or time.strftime("%H%M%S-") + uuid.uuid4().hex[:4]
        self.dir = RUNS / self.id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.events: list[dict] = []
        self.cond = asyncio.Condition()
        self.state = {"id": self.id, "status": "created", "spec_versions": [], "sims": [], "fix_rounds": [],
                      "fidelity": [], "report": None, "agent": None, "wind_tests": []}
        self.wind, self.mph, self.seed = 45, 30, 7
        self.inventory = None
        self.task: asyncio.Task | None = None
        self.agent_task: asyncio.Task | None = None

    @classmethod
    def load(cls, rid: str) -> "Run":
        """Reopens a run saved on disk (e.g. after a server restart)."""
        run = cls(rid)
        run.state = json.loads(run.path("state.json").read_text())
        run.events = [json.loads(line) for line in run.path("events.jsonl").read_text().splitlines()]
        if run.path("inventory.json").exists():
            run.inventory = json.loads(run.path("inventory.json").read_text())
        conditions = run.state.get("conditions", {})
        run.wind = conditions.get("wind", run.state["sims"][0]["wind"] if run.state.get("sims") else 45)
        run.mph = conditions.get("mph", 30)
        run.seed = conditions.get("seed", 7)
        return run

    def path(self, name: str) -> Path:
        return self.dir / name

    def url(self, name: str) -> str:
        return f"/api/runs/{self.id}/files/{name}"

    async def emit(self, stage: str, msg: str, status: str = "info", **data):
        ev = {"i": len(self.events), "t": round(time.time(), 2), "stage": stage, "status": status, "msg": msg, **data}
        self.events.append(ev)
        with self.path("events.jsonl").open("a") as f:
            f.write(json.dumps(ev) + "\n")
        self.path("state.json").write_text(json.dumps(self.state, indent=1))
        async with self.cond:
            self.cond.notify_all()

    # ---------- spec versions ----------
    def add_spec(self, spec: dict, label: str, code: str | None = None) -> dict:
        n = len(self.state["spec_versions"])
        sp = self.path(f"spec_v{n}.json")
        sp.write_text(json.dumps(spec))
        v = {"n": n, "label": label, "spec": sp.name}
        if code is not None:
            self.path(f"scene_v{n}.js").write_text(code)
            v["scene"] = f"scene_v{n}.js"
        self.state["spec_versions"].append(v)
        return v

    def spec_path(self, n: int = -1) -> Path:
        return self.path(self.state["spec_versions"][n]["spec"])

    def spec(self, n: int = -1) -> dict:
        return json.loads(self.spec_path(n).read_text())


RUN_REGISTRY: dict[str, Run] = {}


def short_result(r: dict) -> dict:
    return {"houseIgnited": r["houseIgnited"], "houseIgnitedAt": r["houseIgnitedAt"],
            "chain": r["chain"], "ignited": [f"{o['first']} {o['label']} ({o['cause']}{' from ' + o['fromLabel'] if o['fromLabel'] else ''})" for o in r["ignitedObjects"][:25]]}


async def sim_record(run: Run, spec_n: int, label: str, wind: int | None = None) -> dict:
    wind = run.wind if wind is None else wind
    name = f"sim_{len(run.state['sims'])}_{label.lower().replace(' ', '_')}.mp4"
    res = await renderer.record_sim(run.spec(spec_n), {"windFrom": wind, "mph": run.mph, "seed": run.seed, "label": label}, run.path(name))
    sim = {"label": label, "spec_n": spec_n, "wind": wind, "mph": run.mph, "seed": run.seed,
           "duration": res.get("opts", {}).get("duration", 90),
           "video": run.url(name), "file": name, "result": short_result(res)}
    run.state["sims"].append(sim)
    return sim


# ---------- stages ----------

async def stage_survey(run: Run, video: Path):
    await run.emit("survey", "Argon is watching the full walk-around video…", "running")
    inv, _ = await asyncio.to_thread(g.ask_json, [g.text(P.SURVEY.format(conventions=P.CONVENTIONS)), g.video(video, resolution="high", agentic=True)], system=P.SYSTEM_MODELING, thinking="high")
    run.inventory = inv
    run.path("inventory.json").write_text(json.dumps(inv, indent=1))
    await run.emit("survey", inv.get("summary", "Inventory ready"), "done", inventory=inv)


async def compile_with_repair(run: Run, code: str, stage: str, attempts: int = 2) -> tuple[dict, str]:
    for i in range(attempts + 1):
        tmp = run.path("_candidate.js")
        tmp.write_text(code)
        out = await asyncio.to_thread(tools.compile_scene, tmp)
        if not out["errors"]:
            return out["spec"], code
        await run.emit(stage, f"Validator rejected scene.js ({len(out['errors'])} errors); sending errors back to Argon", "warn", errors=out["errors"][:8])
        if i == attempts:
            break
        reply, _ = await asyncio.to_thread(g.ask, [g.text(P.FIX_SCENE.format(errors="\n".join(out["errors"]), code=code))], system=P.SYSTEM_MODELING, thinking="low")
        code = g.extract_code(reply)
    raise RuntimeError("scene.js still invalid after repairs")


async def stage_generate(run: Run):
    await run.emit("generate", "Argon is writing the 3D model (scene.js) in one pass…", "running")
    reply, _ = await asyncio.to_thread(
        g.ask, [g.text(P.GENERATE.format(kit=P.KIT_DOC, conventions=P.CONVENTIONS, inventory=json.dumps(run.inventory, indent=1))),
                g.video(run.path("video.mp4"), resolution="medium")],
        system=P.SYSTEM_MODELING, thinking="high")
    spec, code = await compile_with_repair(run, g.extract_code(reply), "generate")
    v = run.add_spec(spec, "generated", code)
    await run.emit("generate", f"Model built: {len(spec['objects'])} objects, {len(spec['cameras'])} matched cameras", "done", version=v, lines=code.count("\n") + 1)


async def stage_fidelity(run: Run, video: Path):
    for rnd in range(1, MAX_FIDELITY_ROUNDS + 1):
        await run.emit("fidelity", f"Round {rnd}: rendering the model from the video's viewpoints…", "running")
        spec = run.spec()
        renders = await renderer.render_cameras(spec, run.dir / f"fid{rnd}")
        parts, pairs = [], []
        for r in renders:
            real = run.dir / f"fid{rnd}" / f"real_{r['id']}.jpg"
            await asyncio.to_thread(tools.keyframe, video, r["videoTimestamp"], real)
            parts += [g.text(f"Camera {r['id']} — REAL frame at {r['videoTimestamp']}:"), g.image(real),
                      g.text(f"Camera {r['id']} — RENDER of the model:"), g.image(r["path"])]
            pairs.append({"id": r["id"], "ts": r["videoTimestamp"], "real": run.url(f"fid{rnd}/real_{r['id']}.jpg"), "render": run.url(f"fid{rnd}/render_{r['id']}.jpg")})
        code = run.path(run.state["spec_versions"][-1].get("scene", "")).read_text() if run.state["spec_versions"][-1].get("scene") else ""
        reply, _ = await asyncio.to_thread(g.ask, [g.text(P.FIDELITY.format(code=code))] + parts, system=P.SYSTEM_MODELING, thinking="medium")
        verdict = g.parse_json(reply)
        entry = {"round": rnd, "pairs": pairs, **verdict}
        run.state["fidelity"].append(entry)
        if verdict.get("pass"):
            await run.emit("fidelity", f"Round {rnd}: model matches the video (score {verdict.get('score')}/10) ✅", "done", fidelity=entry)
            return
        await run.emit("fidelity", f"Round {rnd}: {len(verdict.get('issues', []))} mismatches found ❌ — patching the model", "warn", fidelity=entry)
        if "```js" not in reply and "```javascript" not in reply:
            break
        spec, code = await compile_with_repair(run, g.extract_code(reply), "fidelity")
        run.add_spec(spec, f"fidelity fix {rnd}", code)
    await run.emit("fidelity", "Fidelity loop finished (best effort)", "done")


async def stage_mitigate(run: Run, wind: int | None = None, start_spec: int | None = None, tag: str = "fix"):
    """Simulate -> Argon watches -> picks catalog fixes -> apply -> re-simulate -> Argon verifies. Repeat."""
    wind = run.wind if wind is None else wind
    spec_n = len(run.state["spec_versions"]) - 1 if start_spec is None else start_spec
    before = await sim_record(run, spec_n, "BEFORE" if tag == "fix" else f"WIND {wind}", wind)
    await run.emit("simulate", f"Ember storm (wind from {wind}°): " + (f"house ignites at {before['result']['houseIgnitedAt']}" if before["result"]["houseIgnited"] else "house survives"),
                   "fail" if before["result"]["houseIgnited"] else "done", sim=before)
    current = before
    history = []
    for rnd in range(1, MAX_FIX_ROUNDS + 1):
        if not current["result"]["houseIgnited"]:
            break
        await run.emit(tag, f"Round {rnd}: Argon is watching the simulation to find the ignition chain…", "running")
        prompt = P.MITIGATE.format(wind=wind, mph=run.mph, describe=tools.describe(run.spec_path(spec_n)),
                                   result=json.dumps(current["result"], indent=1), catalog=json.dumps(CATALOG, indent=1),
                                   inventory=json.dumps((run.inventory or {}).get("objects", []), indent=0)[:12000] or "(no video: sample property)",
                                   history=("Fixes already applied in earlier rounds:\n" + json.dumps(history, indent=1)) if history else "")
        plan, _ = await asyncio.to_thread(g.ask_json, [g.text(prompt), g.video(run.path(current["file"]))], system=P.SYSTEM, thinking="medium")
        await attach_evidence(run, plan)
        await run.emit(tag, plan.get("diagnosis", "Chain identified"), "info", plan=plan)

        fixes_path = run.path(f"fixes_{tag}_{rnd}.json")
        fixes_path.write_text(json.dumps(plan.get("fixes", [])))
        applied = await asyncio.to_thread(tools.apply_fixes, run.spec_path(spec_n), fixes_path)
        for rj in applied["rejected"]:
            await run.emit("guardrail", f"Rejected {rj.get('fix')} → {rj.get('target')}: {rj['reason']}", "warn")
        if not applied["applied"]:
            await run.emit(tag, "No applicable fixes left in the catalog", "fail")
            break
        v = run.add_spec(applied["spec"], f"{tag} round {rnd}: " + ", ".join(a["fix"] for a in applied["applied"]))
        spec_n = v["n"]
        after = await sim_record(run, spec_n, f"AFTER {tag.upper()} {rnd}", wind)

        await run.emit("verify", f"Round {rnd}: re-simulating with the same seed; Argon compares before/after…", "running")
        verdict, _ = await asyncio.to_thread(g.ask_json, [
            g.text(P.VERIFY.format(applied=json.dumps(applied["applied"]), before=json.dumps(current["result"]), after=json.dumps(after["result"]))),
            g.video(run.path(current["file"])), g.video(run.path(after["file"]))], system=P.SYSTEM, thinking="low")
        # Ground truth comes from the simulator; Argon's verdict must agree with it.
        survives = not after["result"]["houseIgnited"]
        verdict["sim_agrees"] = bool(verdict.get("house_survives")) == survives
        step = {"round": rnd, "tag": tag, "wind": wind, "plan": plan, "applied": applied["applied"], "rejected": applied["rejected"],
                "before": current["result"], "after": after["result"], "before_video": current["video"], "after_video": after["video"], "verdict": verdict}
        run.state["fix_rounds"].append(step)
        history.append({"round": rnd, "applied": [a["fix"] + "→" + a["target"] for a in applied["applied"]], "result": after["result"]["houseIgnitedAt"] or "survived"})
        msg = ("house SURVIVES ✅" if survives else f"house still ignites at {after['result']['houseIgnitedAt']} ❌") + (" (Argon agrees)" if verdict["sim_agrees"] else " (Argon disagreed with the simulator — trusting the simulator)")
        await run.emit("verify", f"Round {rnd}: " + msg, "done" if survives else "fail", step=step)
        current = after
    return spec_n, before, current


async def attach_evidence(run: Run, plan: dict):
    """Pulls the real video frame Argon cites for each hazard, so problems are visible, not just described."""
    video = run.path("video.mp4")
    if not video.exists():
        return
    for item in plan.get("fixes", []) + plan.get("failure_chain", []):
        ts = item.get("seen_in_video_at")
        if not ts or not isinstance(ts, str) or ":" not in ts:
            continue
        name = f"evidence_{ts.replace(':', '_').replace('.', '_')}.jpg"
        try:
            if not run.path(name).exists():
                await asyncio.to_thread(tools.keyframe, video, ts, run.path(name))
            item["evidence_frame"] = run.url(name)
        except Exception:
            pass


def swarm_summary(run: Run):
    """Compact all-winds result for the report: pass rate, failing cases, and the fixes agents converge on."""
    sw = run.state.get("agent")
    if not sw or sw.get("type") != "swarm" or not sw["local_check"]["grid"]:
        return "not run"
    fails = [c for c in sw["local_check"]["grid"] if c["houseIgnitedAt"]]
    votes = {}
    for w in sw["workers"]:
        for f in w.get("suggested_fixes", []):
            k = f"{f['fix']} -> {f['target']}"
            votes[k] = votes.get(k, 0) + 1
    return {"scenarios_checked": len(sw["local_check"]["grid"]), "no_house_ignition": sw["local_check"]["survives"],
            "ignites_in": [f"wind {c['wind']} seed {c['seed']} at {c['houseIgnitedAt']}" for c in fails][:24],
            "fixes_suggested_by_agents": sorted(votes.items(), key=lambda kv: -kv[1])[:6]}


def _secs(t):
    if not t:
        return None
    m, s = t.split(":")
    return int(m) * 60 + int(s)


def _fmt(sec):
    return "no house ignition" if sec is None else f"{sec} s"


def result_facts(run: Run) -> dict:
    """Numeric facts every summary must agree on. Computed here, never by the language model."""
    # Every round at the originally tested wind counts (fix rounds and same-wind tests); other directions don't.
    rounds = run.state.get("fix_rounds", [])
    tested_wind = rounds[0]["wind"] if rounds else run.wind
    fix_rounds = [r for r in rounds if r.get("wind", tested_wind) == tested_wind]
    sims = run.state.get("sims", [])
    base = fix_rounds[0]["before"] if fix_rounds else (sims[0]["result"] if sims else None)
    final = fix_rounds[-1]["after"] if fix_rounds else base
    b, f = (_secs(base["houseIgnitedAt"]) if base else None), (_secs(final["houseIgnitedAt"]) if final else None)
    facts = {"wind": run.wind, "mph": run.mph, "duration_s": 90, "baseline_ignition_s": b, "final_ignition_s": f,
             "fix_rounds": len(fix_rounds), "final_spec": run.state.get("final_spec")}
    if b is not None and f is not None:
        facts["delay_s"] = f - b
    sw = run.state.get("agent")
    if sw and sw.get("type") == "swarm" and sw["local_check"]["grid"]:
        checked = len(sw["local_check"]["grid"])
        facts["swarm"] = {"id": sw["id"], "checked": checked, "planned": 24, "no_ignition": sw["local_check"]["survives"],
                          "ignited": checked - sw["local_check"]["survives"], "complete": checked == 24}
    return facts


def facts_text(f: dict) -> str:
    lines = [f"Tested wind: from {f['wind']} degrees at {f['mph']} mph for {f['duration_s']} s of simulated exposure.",
             f"Before fixes: {_fmt(f['baseline_ignition_s'])}{' (house ignition time)' if f['baseline_ignition_s'] is not None else ''}.",
             f"After the tested set of fixes: {_fmt(f['final_ignition_s'])}{' (house ignition time)' if f['final_ignition_s'] is not None else ''}."]
    if f.get("delay_s") is not None:
        lines.append(f"Ignition happened {f['delay_s']} s later after the fixes; the house still ignited.")
    sw = f.get("swarm")
    if sw:
        lines.append(f"All-wind check: {sw['checked']} of {sw['planned']} scenarios checked; house ignited in {sw['ignited']}, "
                     f"no house ignition in {sw['no_ignition']}" + ("" if sw["complete"] else " (INCOMPLETE)") + ".")
    else:
        lines.append("Other wind directions were not checked.")
    return "\n".join(lines)


async def stage_report(run: Run, before: dict | None = None, after: dict | None = None):
    await run.emit("report", "Writing the homeowner report…", "running")
    facts = result_facts(run)
    applied = sorted({a["fix"] for r in run.state.get("fix_rounds", []) for a in r.get("applied", [])})
    rep, _ = await asyncio.to_thread(g.ask_json, [g.text(P.REPORT.format(
        summary=(run.inventory or {}).get("summary", "demo property"), facts=facts_text(facts),
        tested=json.dumps(applied), catalog=json.dumps(CATALOG), swarm=json.dumps(swarm_summary(run))))],
        model=g.FLASH, thinking="low")
    run.state["report"] = rep
    # Provenance: which evidence this plan was written from, so the UI can flag it once newer tests exist.
    run.state["report_scope"] = {"created": round(time.time()), "spec_n": run.state.get("final_spec"),
                                 "sims": len(run.state.get("sims", [])), "swarm_id": (facts.get("swarm") or {}).get("id"),
                                 "swarm_checked": (facts.get("swarm") or {}).get("checked", 0), "facts": facts}
    await run.emit("report", rep.get("headline", "Report ready"), "done", report=rep)


async def run_pipeline(run: Run, video_src: Path | None):
    try:
        run.state["status"] = "running"
        if video_src:
            video = run.path("video.mp4")
            await run.emit("prepare", "Preparing video (480p)…", "running")
            await asyncio.to_thread(tools.prepare_video, video_src, video)
            run.state["video"] = run.url("video.mp4")
            run.state["video_duration"] = tools.video_duration(video)
            await run.emit("prepare", f"Video ready ({tools.video_duration(video):.0f}s)", "done", video=run.state["video"])
            await stage_survey(run, video)
            await stage_generate(run)
            await stage_fidelity(run, video)
        else:
            code = (SAMPLES / "demo_scene.js").read_text()
            spec, code = await compile_with_repair(run, code, "generate", attempts=0)
            v = run.add_spec(spec, "sample scene", code)
            await run.emit("generate", "Loaded the sample property (no video)", "done", version=v)
        base_n = len(run.state["spec_versions"]) - 1
        run.state["base_spec"] = base_n
        _, before, after = await stage_mitigate(run)
        run.state["final_spec"] = len(run.state["spec_versions"]) - 1
        if run.state.get("swarm_default"):
            # All-winds check before the report, so the report speaks to every direction, not just one.
            from swarm import run_swarm
            t = time.time()
            await run_swarm(run)
            run.state.setdefault("timings", {})["swarm_seconds"] = round(time.time() - t, 1)
        await stage_report(run, before, after)
        run.state["status"] = "done"
        await run.emit("done", "Pipeline complete", "done")
    except Exception as e:
        run.state["status"] = "error"
        await run.emit("error", f"{type(e).__name__}: {e}", "fail", trace=traceback.format_exc()[-1500:])


async def wind_test(run: Run, wind: int):
    """Live judge moment: does the hardened home hold under a new wind? If not, Argon keeps fixing."""
    try:
        final = run.state.get("final_spec", len(run.state["spec_versions"]) - 1)
        await run.emit("wind", f"Judge's wind test: wind from {wind}° on the hardened home", "running")
        _, before, after = await stage_mitigate(run, wind=wind, start_spec=final, tag="wind")
        run.state["final_spec"] = len(run.state["spec_versions"]) - 1
        run.state["wind_tests"].append({"wind": wind, "before": before["result"], "after": after["result"]})
        await run.emit("wind", f"Wind {wind}°: " + ("hardened home holds ✅" if not after["result"]["houseIgnited"] else f"house still ignites at {after['result']['houseIgnitedAt']}"),
                       "done" if not after["result"]["houseIgnited"] else "fail")
    except Exception as e:
        await run.emit("error", f"{type(e).__name__}: {e}", "fail", trace=traceback.format_exc()[-1500:])


# ---------- Independent per-scenario managed-agent swarm ----------

async def agent_stress_test(run: Run):
    from swarm import run_swarm
    await run_swarm(run)
