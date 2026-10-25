"""Local tooling: the Node scene/sim CLI, ffmpeg, and headless rendering."""
import asyncio
import base64
import json
import os
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
ZZ = WEB / "scripts" / "zz.mjs"
WEB_URL = os.getenv("ZZ_WEB_URL", "http://127.0.0.1:5173")


# ---------- Node CLI (web/scripts/zz.mjs) ----------

def _node(*args) -> str:
    r = subprocess.run(["node", str(ZZ), *map(str, args)], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "zz.mjs failed")
    return r.stdout


def compile_scene(scene_path: Path) -> dict:
    return json.loads(_node("compile", scene_path))


def simulate(spec_path: Path, wind: int, seed: int = 7, mph: int = 30) -> dict:
    return json.loads(_node("sim", spec_path, wind, seed, mph))


def apply_fixes(spec_path: Path, fixes_path: Path) -> dict:
    return json.loads(_node("apply", spec_path, fixes_path))


def describe(spec_path: Path) -> str:
    return _node("describe", spec_path)


# ---------- ffmpeg ----------

def _ff(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *map(str, args)], check=True, timeout=600)


def prepare_video(src: Path, dst: Path):
    """480p / 15 fps keeps a 2-minute walk-around small enough to send inline."""
    _ff("-i", src, "-vf", "scale=-2:480,fps=15", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", dst)


def video_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def ts_seconds(ts: str) -> float:
    m, s = ts.split(":")
    return int(m) * 60 + float(s)


def keyframe(video: Path, ts: str, dst: Path):
    t = min(ts_seconds(ts), max(0.0, video_duration(video) - 0.2))
    _ff("-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", "-vf", "scale=960:-2", dst)


def frames_to_mp4(frame_dir: Path, dst: Path, fps: int = 12):
    _ff("-framerate", fps, "-i", frame_dir / "f%04d.jpg", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-crf", "26", "-movflags", "+faststart", dst)


# ---------- Headless rendering (web/render.html via Playwright) ----------

class Renderer:
    def __init__(self):
        self._pw = None
        self._browser = None
        self._lock = asyncio.Lock()

    async def _page(self):
        if self._browser is None:
            self._pw = await async_playwright().start()
            self._browser = await self._pw.chromium.launch(args=["--use-gl=angle", "--enable-unsafe-swiftshader"])
        page = await self._browser.new_page(viewport={"width": 960, "height": 540})
        await page.goto(f"{WEB_URL}/render.html")
        await page.wait_for_function("window.ZZ_READY === true", timeout=30000)
        return page

    async def render_cameras(self, spec: dict, out_dir: Path) -> list[dict]:
        async with self._lock:
            page = await self._page()
            try:
                shots = await page.evaluate("(spec) => window.ZZ.renderCameras(spec)", spec)
            finally:
                await page.close()
        out_dir.mkdir(parents=True, exist_ok=True)
        res = []
        for s in shots:
            p = out_dir / f"render_{s['id']}.jpg"
            p.write_bytes(base64.b64decode(s["dataUrl"].split(",", 1)[1]))
            res.append({"id": s["id"], "videoTimestamp": s["videoTimestamp"], "path": p})
        return res

    async def record_sim(self, spec: dict, opts: dict, out_mp4: Path) -> dict:
        async with self._lock:
            page = await self._page()
            try:
                rec = await page.evaluate("([spec, opts]) => window.ZZ.recordSim(spec, opts)", [spec, opts])
            finally:
                await page.close()
        frame_dir = out_mp4.with_suffix("")
        frame_dir.mkdir(parents=True, exist_ok=True)
        for i, d in enumerate(rec["frames"]):
            (frame_dir / f"f{i:04d}.jpg").write_bytes(base64.b64decode(d.split(",", 1)[1]))
        await asyncio.to_thread(frames_to_mp4, frame_dir, out_mp4)
        return rec["result"]

    async def close(self):
        if self._browser:
            await self._browser.close()
            await self._pw.stop()
