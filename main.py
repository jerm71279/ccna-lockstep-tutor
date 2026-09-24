"""CCNA Lockstep Tutor — static app + Claude proxy for Render.

Serves index.html and exposes /api/sample for AI tutor + quiz generation.
The Anthropic API key never reaches the browser.

Auth (Phase B, dual-mode):
  1. Supabase JWT via `Authorization: Bearer <jwt>` — per-user daily cap
  2. Legacy shared passcode via `X-App-Passcode` header — fallback during migration
"""
import hmac
import json
import os
import sys
import time
from datetime import date
from pathlib import Path
from collections import defaultdict, deque

import httpx
import jwt
from anthropic import AsyncAnthropic, APIError
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

# Anthropic
API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

# Legacy passcode (kept as fallback during migration — removed in Phase E)
PASSCODE = os.getenv("APP_PASSCODE", "")

# Rate + spend guards
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_10MIN", "40"))
DAILY_CAP = int(os.getenv("DAILY_REQUEST_CAP", "500"))
DAILY_CAP_PER_USER = int(os.getenv("DAILY_CAP_PER_USER", "50"))
MAX_INPUT_CHARS = 150_000

# Supabase (Phase B: JWT auth + per-user cap tracking)
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_READY = bool(SUPABASE_URL and SUPABASE_JWT_SECRET and SUPABASE_SERVICE_KEY)

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


def _verify_supabase_jwt(token: str) -> str | None:
    """Return user_id (uuid) if the JWT is a valid Supabase auth token, else None."""
    if not SUPABASE_JWT_SECRET:
        return None
    try:
        claims = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError:
        return None
    return claims.get("sub")


async def _increment_user_cap(user_id: str) -> None:
    """Atomic per-user daily cap check + increment via Supabase RPC.
    Raises 429 if over cap. Fails open on Supabase errors (logged)."""
    if not SUPABASE_READY:
        return
    url = f"{SUPABASE_URL}/rest/v1/rpc/increment_api_usage"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"uid": user_id, "today": date.today().isoformat(), "cap": DAILY_CAP_PER_USER}
    try:
        async with httpx.AsyncClient(timeout=5.0) as h:
            r = await h.post(url, json=payload, headers=headers)
    except httpx.HTTPError as e:
        print(f"[cap] supabase RPC error, failing open: {e}", file=sys.stderr)
        return
    if r.status_code != 200:
        print(f"[cap] supabase RPC {r.status_code}, failing open: {r.text[:200]}", file=sys.stderr)
        return
    result = r.json()
    if isinstance(result, int) and result < 0:
        raise HTTPException(429, "user_daily_cap")


async def _guard(req: Request) -> str:
    """Auth + rate limit + cap. Returns caller identifier."""
    if not client:
        raise HTTPException(503, "ai_not_configured")

    ip = _client_ip(req)
    now = time.time()

    # Per-IP DoS guard on total successful requests (unchanged)
    q = _hits[ip]
    while q and now - q[0] > 600:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, "rate_limited")

    # Global daily cap (belt-and-suspenders above per-user caps)
    today_key = time.strftime("%Y-%m-%d", time.gmtime(now))
    if _daily["day"] != today_key:
        _daily["day"] = today_key
        _daily["count"] = 0
    if _daily["count"] >= DAILY_CAP:
        raise HTTPException(429, "daily_cap")

    # Try Supabase JWT first
    auth_header = req.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        user_id = _verify_supabase_jwt(auth_header[7:])
        if not user_id:
            raise HTTPException(401, "invalid_token")
        await _increment_user_cap(user_id)
        q.append(now)
        _daily["count"] += 1
        return f"user:{user_id}"

    # Legacy passcode fallback (removed in Phase E)
    if not PASSCODE:
        raise HTTPException(401, "unauthenticated")

    fq = _auth_fails[ip]
    while fq and now - fq[0] > 600:
        fq.popleft()
    if len(fq) >= 5:
        raise HTTPException(429, "rate_limited")

    if not hmac.compare_digest(req.headers.get("x-app-passcode", ""), PASSCODE):
        fq.append(now)
        raise HTTPException(401, "passcode")

    q.append(now)
    _daily["count"] += 1
    return f"legacy:{ip}"


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "ai": client is not None,
        "passcode": bool(PASSCODE),
        "supabase": SUPABASE_READY,
        "model": MODEL,
    }


@app.get("/api/config")
async def config():
    # Public config the frontend needs at boot. Nothing secret — anon key
    # is safe to expose (RLS protects everything user-scoped). Only exposed
    # once Supabase is FULLY configured on backend (JWT secret + service key
    # present) so the frontend never enables login when backend can't verify.
    if not SUPABASE_READY:
        return {"supabase_url": None, "supabase_anon_key": None}
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", "") or None,
    }


@app.post("/api/sample")
async def sample(body: SampleReq, request: Request):
    await _guard(request)
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
                yield "\x00" + json.dumps({"truncated": final.stop_reason == "max_tokens"})
        except APIError as e:
            yield "\x00" + json.dumps({"error": "upstream", "detail": getattr(e, "message", str(e))[:200]})

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
