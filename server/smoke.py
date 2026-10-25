"""API smoke tests (run first): uv run python smoke.py [path/to/video.mp4]
Times one call each to Argon (video in -> JSON), Flash, and the Managed Agent."""
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))
import gemini as g  # noqa: E402


def timed(name, fn):
    t = time.time()
    try:
        out = fn()
        print(f"✅ {name} ({time.time() - t:.1f}s): {str(out)[:300]}")
    except Exception as e:
        print(f"❌ {name} ({time.time() - t:.1f}s): {type(e).__name__}: {e}")


video = Path(sys.argv[1]) if len(sys.argv) > 1 else next(Path(__file__).resolve().parent.parent.glob("runs/*/sim_0_*.mp4"), None)

timed("flash json", lambda: g.ask_json([g.text('Return {"ok": true} as JSON.')], model=g.FLASH, thinking="low")[0])
timed("argon text", lambda: g.ask([g.text("In one sentence: why do embers ignite homes?")], thinking="low")[0])
if video:
    timed(f"argon video ({video.name})", lambda: g.ask_json([g.text('Describe this video. Return JSON {"summary": "...", "duration_guess_s": n}.'), g.video(video)], thinking="low")[0])
else:
    print("⚠️  no video given and no runs/*/sim_0_*.mp4 yet; skipping the video test")


def agent():
    iid = g.start_agent("Run `node -e \"console.log(6*7)\"` and `cat /workspace/zz/hello.txt`, then reply with both outputs.",
                        {"/workspace/zz/hello.txt": "hello from ZoneZero"})
    while True:
        st = g.poll_agent(iid)
        if not any(k in st["status"] for k in ("in_progress", "queued")):
            return st["status"], st["output_text"][:200], len(st["steps"])
        time.sleep(5)


timed("managed agent", agent)
