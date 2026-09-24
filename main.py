"""CCNA Lockstep Tutor — static app + Claude proxy for Render.

Serves index.html and exposes /api/sample, which the page uses
for the AI tutor and quiz generation when it is not running on claude.ai.
The Anthropic API key never reaches the browser.
"""
import hmac
import json
import os
import time
from pathlib import Path
from collections import defaultdict, deque

from anthropic import AsyncAnthropic, APIError
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
PASSCODE = os.getenv("APP_PASSCODE", "")
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_10MIN", "40"))
DAILY_CAP = int(os.getenv("DAILY_REQUEST_CAP", "500"))
MAX_INPUT_CHARS = 150_000

client = AsyncAnthropic(api_key=API_KEY) if API_KEY else None
app = FastAPI(title="CCNA Lockstep Tutor", docs_url=None, redoc_url=None)
_hits: dict[str, deque] = defaultdict(deque)
_auth_fails: dict[str, deque] = defaultdict(deque)
_daily = {"count": 0, "day": ""}


class Msg(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class SampleReq(BaseModel):
    messages: list[Msg] = Field(min_length=1, max_length=40)
    json_mode: bool = False
    stream: bool = True


def _client_ip(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for", "")
    parts = [p.strip() for p in fwd.split(",") if p.strip()]
    return parts[-1] if parts else (req.client.host if req.client else "?")


def _guard(req: Request) -> None:
    if not client or not PASSCODE:
        raise HTTPException(503, "ai_not_configured")

    ip = _client_ip(req)
    now = time.time()

    today = time.strftime("%Y-%m-%d", time.gmtime(now))
    if _daily["day"] != today:
        _daily["day"] = today
        _daily["count"] = 0
    if _daily["count"] >= DAILY_CAP:
        raise HTTPException(429, "daily_cap")

    fq = _auth_fails[ip]
    while fq and now - fq[0] > 600:
        fq.popleft()
    if len(fq) >= 5:
        raise HTTPException(429, "rate_limited")

    if not hmac.compare_digest(req.headers.get("x-app-passcode", ""), PASSCODE):
        fq.append(now)
        raise HTTPException(401, "passcode")

    q = _hits[ip]
    while q and now - q[0] > 600:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, "rate_limited")
    q.append(now)
    _daily["count"] += 1


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp


@app.get("/api/health")
async def health():
    return {"ok": True, "ai": client is not None, "passcode": bool(PASSCODE), "model": MODEL}


@app.post("/api/sample")
async def sample(body: SampleReq, request: Request):
    _guard(request)
    msgs = [m.model_dump() for m in body.messages]
    if msgs[0]["role"] != "user":
        raise HTTPException(400, "first message must be from the user")
    if sum(len(m["content"]) for m in msgs) > MAX_INPUT_CHARS:
        raise HTTPException(413, "prompt_too_large")
    max_tokens = 3000 if body.json_mode else 1600

    if body.json_mode or not body.stream:
        try:
            r = await client.messages.create(model=MODEL, max_tokens=max_tokens, messages=msgs)
        except APIError as e:
            raise HTTPException(502, f"upstream: {getattr(e, 'message', str(e))[:200]}")
        text = "".join(b.text for b in r.content if b.type == "text")
        return {"text": text, "truncated": r.stop_reason == "max_tokens"}

    async def gen():
        # Plain-text stream; a trailing NUL + JSON line carries the stop reason.
        try:
            async with client.messages.stream(model=MODEL, max_tokens=max_tokens, messages=msgs) as s:
                async for chunk in s.text_stream:
                    yield chunk
                final = await s.get_final_message()
                yield "\u0000" + json.dumps({"truncated": final.stop_reason == "max_tokens"})
        except APIError as e:
            yield "\u0000" + json.dumps({"error": "upstream", "detail": getattr(e, "message", str(e))[:200]})

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.exception_handler(HTTPException)
async def http_err(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


INDEX = Path(__file__).with_name("index.html")


@app.get("/", include_in_schema=False)
async def index():
    # Serve only the app page; nothing else in the repo is exposed.
    return FileResponse(INDEX, media_type="text/html", headers={"Cache-Control": "no-cache"})
