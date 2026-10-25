"""ZoneZero API. Run: uv run uvicorn main:app --port 8000 (from server/)."""
import asyncio
import json
import os
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from sse_starlette.sse import EventSourceResponse  # noqa: E402

import pipeline  # noqa: E402
from pipeline import RUN_REGISTRY, Run  # noqa: E402


@asynccontextmanager
async def lifespan(app):
    yield
    active_agents = [run.agent_task for run in RUN_REGISTRY.values() if run.agent_task and not run.agent_task.done()]
    for task in active_agents:
        task.cancel()
    await asyncio.gather(*active_agents, return_exceptions=True)
    await pipeline.renderer.close()


app = FastAPI(title="ZoneZero", lifespan=lifespan)


def get_run(rid: str) -> Run:
    run = RUN_REGISTRY.get(rid)
    if not run:
        if "/" in rid or not (pipeline.RUNS / rid / "state.json").exists():
            raise HTTPException(404, "unknown run")
        run = RUN_REGISTRY[rid] = Run.load(rid)
    return run


@app.post("/api/runs")
async def create_run(video: UploadFile | None = File(None), sample: str = Form(""), wind: int = Form(45), mph: int = Form(30),
                     swarm: str = Form("")):
    run = Run()
    run.wind, run.mph = wind % 360, mph
    # Opt-in (per run, or ZZ_SWARM_DEFAULT=1): run the 24-agent all-winds check before the final report.
    run.state["swarm_default"] = swarm == "1" or os.getenv("ZZ_SWARM_DEFAULT") == "1"
    run.state["conditions"] = {"wind": run.wind, "mph": run.mph, "seed": run.seed}
    RUN_REGISTRY[run.id] = run
    src = None
    if video is not None and video.filename:
        run.state["source"] = {"name": Path(video.filename).name, "kind": "upload"}
        src = run.path("input" + Path(video.filename).suffix.lower())
        with src.open("wb") as f:
            shutil.copyfileobj(video.file, f)
    elif sample == "stock":
        src = pipeline.SAMPLES / "stock" / "pexels-kindel-media-7578541.mp4"
        if not src.is_file():
            raise HTTPException(404, "The sample footage is not available on this machine. Upload a video instead.")
        run.state["source"] = {"name": "Modern home & patio", "kind": "stock", "credit": "Kindel Media / Pexels",
                               "url": "https://www.pexels.com/video/an-exterior-design-of-a-modern-house-7578541/",
                               "coverage": "Partial exterior"}
    elif sample == "video":
        vids = sorted(pipeline.SAMPLES.glob("*.mp4")) + sorted(pipeline.SAMPLES.glob("*.mov"))
        if not vids:
            raise HTTPException(400, "no sample video in samples/")
        src = vids[0]
    run.task = asyncio.create_task(pipeline.run_pipeline(run, src))
    return {"id": run.id}


@app.get("/api/runs/{rid}/events")
async def events(rid: str, since: int = 0):
    run = get_run(rid)

    async def gen():
        i = since
        while True:
            while i < len(run.events):
                yield {"data": json.dumps(run.events[i])}
                i += 1
            async with run.cond:
                try:
                    await asyncio.wait_for(run.cond.wait(), timeout=15)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}

    return EventSourceResponse(gen())


@app.get("/api/runs/{rid}/state")
async def state(rid: str):
    run = get_run(rid)
    return {**run.state, "inventory": run.inventory}


@app.post("/api/runs/{rid}/wind")
async def wind(rid: str, wind: int = Form(...)):
    run = get_run(rid)
    asyncio.create_task(pipeline.wind_test(run, wind % 360))
    return {"ok": True}


@app.post("/api/runs/{rid}/agent")
async def agent(rid: str, attach: str = Form("")):
    """Starts 24 separate scenario agents, with bounded concurrent execution."""
    run = get_run(rid)
    if run.state["status"] != "done":
        raise HTTPException(409, "run the pipeline first")
    if run.agent_task and not run.agent_task.done():
        raise HTTPException(409, "A scenario swarm is already running for this assessment")
    from swarm import ACTIVE, new_state
    if (run.state.get("agent") or {}).get("status") in ACTIVE:
        raise HTTPException(409, "An extended job is already active; cancel it before starting another")
    if attach:
        raise HTTPException(400, "A single optimizer cannot be attached as a scenario swarm")
    if run.state.get("agent"):
        run.path(f"extended_history_{int(time.time())}.json").write_text(json.dumps(run.state["agent"]), encoding="utf-8")
    run.state["agent"] = new_state(run)
    await run.emit("agent", "Queued 24 independent managed scenario agents", "running")
    run.agent_task = asyncio.create_task(pipeline.agent_stress_test(run))
    return {"ok": True, "id": run.state["agent"]["id"], "agents": 24, "concurrency": run.state["agent"]["concurrency"]}


@app.post("/api/runs/{rid}/agent/cancel")
async def cancel_swarm(rid: str):
    run = get_run(rid)
    if run.agent_task and not run.agent_task.done():
        run.state["agent"]["status"] = "cancelling"
        run.agent_task.cancel()
        return {"ok": True, "status": "cancelling"}
    raise HTTPException(409, "No local scenario swarm is running")


@app.get("/api/runs/{rid}/files/{name:path}")
async def files(rid: str, name: str):
    run = get_run(rid)
    p = (run.dir / name).resolve()
    if run.dir.resolve() not in p.parents or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/runs/{rid}/spec/{n}")
async def spec(rid: str, n: int):
    return get_run(rid).spec(n)


@app.get("/api/health")
async def health():
    import os
    return {"ok": True, "gemini_key": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))}
