"""Thin wrapper over the Gemini Interactions API (google-genai >= 2.3).

Every model call in ZoneZero goes through `ask()`, and the Managed Agent
through `start_agent()` / `poll_agent()`, so SDK details live in one place.
"""
import base64
import json
import os
import re
import time
from pathlib import Path

from google import genai

ARGON = os.getenv("ZZ_MODEL", "gemini-4-argon")
FLASH = os.getenv("ZZ_FAST_MODEL", "gemini-3.8-flash")
AGENT = os.getenv("ZZ_AGENT", "antigravity-preview-09-2026")
INLINE_LIMIT = 18 * 1024 * 1024

_client = None


def client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client()
    return _client


def text(t: str) -> dict:
    return {"type": "text", "text": t}


def image(path: Path) -> dict:
    mime = "image/png" if str(path).endswith(".png") else "image/jpeg"
    return {"type": "image", "data": base64.b64encode(Path(path).read_bytes()).decode(), "mime_type": mime}


def video(path: Path, *, resolution: str | None = None, agentic: bool = False) -> dict:
    """agentic=True lets Argon scrub timestamps and zoom into high-res frames on its own."""
    path = Path(path)
    extra = {}
    if resolution:
        extra["resolution"] = resolution
    if agentic:
        extra["processing"] = "agentic"
    if path.stat().st_size <= INLINE_LIMIT:
        return {"type": "video", "data": base64.b64encode(path.read_bytes()).decode(), "mime_type": "video/mp4", **extra}
    f = client().files.upload(file=str(path))
    while getattr(f, "state", None) and str(f.state).upper().endswith("PROCESSING"):
        time.sleep(2)
        f = client().files.get(name=f.name)
    return {"type": "video", "uri": f.uri, "mime_type": "video/mp4", **extra}


def ask(parts: list, *, model: str = ARGON, thinking: str = "medium", system: str | None = None,
        previous: str | None = None) -> tuple[str, str]:
    """Returns (output_text, interaction_id)."""
    kwargs = dict(model=model, input=parts, generation_config={"thinking_level": thinking}, timeout=1200)
    if system:
        kwargs["system_instruction"] = system
    if previous:
        kwargs["previous_interaction_id"] = previous
    # Long calls occasionally drop the connection; retry those (not API errors like bad input).
    for attempt in range(3):
        try:
            it = client().interactions.create(**kwargs)
            return it.output_text or "", it.id
        except Exception as e:
            transient = type(e).__name__ in ("APIConnectionError", "APITimeoutError", "RemoteProtocolError", "ReadTimeout", "ConnectError") \
                or "disconnected" in str(e).lower() or "503" in str(e) or "UNAVAILABLE" in str(e)
            if not transient or attempt == 2:
                raise
            time.sleep(3 * (attempt + 1))


def parse_json(s: str):
    """Model JSON, tolerant of ```json fences and leading prose."""
    m = re.search(r"```json\s*(.*?)```", s, re.S) or re.search(r"```\s*\n([\[{].*?)```", s, re.S)
    if m:
        s = m.group(1)
    start = min([i for i in (s.find("{"), s.find("[")) if i >= 0], default=0)
    return json.JSONDecoder().raw_decode(s[start:])[0]


def extract_code(s: str) -> str:
    m = re.findall(r"```(?:js|javascript)[ \t]*\n(.*?)```", s, re.S)
    if not m:
        m = [b for b in re.findall(r"```[ \t]*\n(.*?)```", s, re.S) if "kit." in b]
    return max(m, key=len).strip() if m else s.strip()


def ask_json(parts: list, **kw):
    out, iid = ask(parts, **kw)
    try:
        return parse_json(out), iid
    except Exception:
        # One repair attempt with the fast model.
        fixed, _ = ask([text("Return ONLY the valid JSON contained in this text, no prose:\n\n" + out)], model=FLASH, thinking="low")
        return parse_json(fixed), iid


# ---------- Managed Agent (Antigravity) ----------

def start_agent(task: str, files: dict[str, str]) -> str:
    """Starts a background Managed Agent run with `files` mounted inline.
    files: {"/workspace/zz/path": "file text"}"""
    sources = [{"type": "inline", "content": body, "target": target} for target, body in files.items()]
    it = client().interactions.create(
        agent=AGENT,
        agent_config={"type": "antigravity", "model": ARGON},
        input=task,
        environment={"type": "remote", "sources": sources},
        background=True,
        timeout=120,
    )
    return it.id


def cancel_agent(interaction_id: str):
    return client().interactions.cancel(interaction_id, timeout=30)


def stream_agent_steps(interaction_id: str, on_step):
    """Blocking: replays then follows the agent's event stream, calling on_step(dict)
    for each completed step. Background `get()` does not return steps while running."""
    cur = {}
    for ev in client().interactions.get(interaction_id, stream=True, timeout=1800):
        d = ev.model_dump(exclude_none=True)
        et = d.get("event_type", "")
        if et == "step.start":
            cur = d.get("step", {})
            cur.setdefault("_text", "")
        elif et == "step.delta":
            c = (d.get("delta") or {}).get("content") or {}
            if isinstance(c, dict) and c.get("text"):
                cur["_text"] = cur.get("_text", "") + c["text"]
        elif et == "step.stop" and cur:
            kind = cur.get("type", "step")
            if kind == "code_execution_call":
                summary = "$ " + (cur.get("arguments") or {}).get("code", "")
            elif kind == "code_execution_result":
                summary = str(cur.get("result", ""))
            else:
                summary = cur.get("_text", "")
            on_step({"type": kind, "summary": summary.strip()[:400]})
            cur = {}
        elif et.startswith("interaction.") and d.get("status") not in (None, "in_progress", "queued"):
            return


def poll_agent(interaction_id: str):
    it = client().interactions.get(interaction_id, timeout=60)
    steps = []
    for s in getattr(it, "steps", None) or []:
        kind = getattr(s, "type", "step")
        summary = ""
        for attr in ("code", "text", "output", "result", "content", "arguments"):
            v = getattr(s, attr, None)
            if v:
                summary = v if isinstance(v, str) else json.dumps(v, default=str)
                break
        steps.append({"type": kind, "summary": summary[:400]})
    return {"status": str(it.status), "output_text": it.output_text or "", "steps": steps}
