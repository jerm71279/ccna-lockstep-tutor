# CCNA Lockstep Tutor

Single-page CCNA 200-301 v1.1 study app (Jeremy's IT Lab 63-day plan + Boson + CLI lab) with an AI tutor, adaptive quizzes and subnetting drills. A small FastAPI server hosts the page and proxies Claude so the API key never reaches the browser.

© JIT Technologies LLC. All rights reserved. Proprietary — not licensed for redistribution.

## Layout
```
index.html          the whole app (HTML/CSS/JS, no build step)
main.py             FastAPI: serves index.html + /api/sample (Claude proxy) + /api/health
requirements.txt    Python dependencies
render.yaml         Render Blueprint (one free Python web service)
```

## How AI works
- On **claude.ai** (published artifact) the page uses claude.ai's built-in model access and cloud sync.
- Anywhere else (Render, local) the page calls `/api/sample` on its own server, which calls the Anthropic API with `ANTHROPIC_API_KEY`.
- `APP_PASSCODE` gates the AI endpoint; the page asks for it once per device (Tutor tab).
- Per-IP rate limit: `RATE_LIMIT_PER_10MIN` (default 40).
- Progress is stored in the browser (localStorage) when self-hosted. Use Backup → Export to move it between devices.

## Push to GitHub
```bash
git init -b main
git add .
git commit -m "Initial commit: CCNA Lockstep Tutor"
gh repo create jerm71279/ccna-lockstep-tutor --private --source=. --push
```

## Deploy on Render
1. Render Dashboard → **New** → **Blueprint** → pick `jerm71279/ccna-lockstep-tutor`.
2. When prompted, set `ANTHROPIC_API_KEY` and `APP_PASSCODE` (both are `sync: false`, so Render asks for them).
3. Apply. Health check: `GET /api/health` should return `"ai": true`.
4. Open the `.onrender.com` URL → Tutor tab → enter the passcode.

Free instances sleep when idle, so the first load after a break can take a while.

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=... APP_PASSCODE=...
uvicorn main:app --reload --port 8080
```

## Config
| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for AI features |
| `APP_PASSCODE` | — | **Required** — server refuses AI calls if unset. Use a long random value (20+ chars) |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Model for tutor + quiz generation |
| `RATE_LIMIT_PER_10MIN` | `40` | Per-IP successful-request cap |
| `DAILY_REQUEST_CAP` | `500` | Global daily request cap (spend guardrail) |

## Updating
Edit `index.html`, commit, push. `autoDeploy: true` redeploys on push to `main`.
