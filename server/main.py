"""ZoneZero API. Run: uv run uvicorn main:app --port 8000 (from server/)."""
import asyncio
import json
import shutil
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
async def create_run(video: UploadFile | None = File(None), sample: str = Form(""), wind: int = Form(45), mph: int = Form(30)):
    run = Run()
    run.wind, run.mph = wind % 360, mph
    RUN_REGISTRY[run.id] = run
    src = None
    if video is not None and video.filename:
        src = run.path("input" + Path(video.filename).suffix.lower())
        with src.open("wb") as f:
            shutil.copyfileobj(video.file, f)
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
    return get_run(rid).state


@app.post("/api/runs/{rid}/wind")
async def wind(rid: str, wind: int = Form(...)):
    run = get_run(rid)
    asyncio.create_task(pipeline.wind_test(run, wind % 360))
    return {"ok": True}


@app.post("/api/runs/{rid}/agent")
async def agent(rid: str, attach: str = Form("")):
    """Starts the stress test, or with `attach` re-follows an agent run already in progress."""
    run = get_run(rid)
    if not run.state["fix_rounds"] and run.state["status"] != "done":
        raise HTTPException(409, "run the pipeline first")
    asyncio.create_task(pipeline.agent_stress_test(run, attach or None))
    return {"ok": True}


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
