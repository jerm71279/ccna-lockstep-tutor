# Multi-user auth — design doc

**Status:** Draft, awaiting sign-off before implementation
**Author:** Design captured during 2026-09-23 planning session
**Target audience:** Private study group, 2-20 people, invite-only
**Related:** Replaces the current single-shared-passcode model on `/api/sample`

---

## 1. Goal

Let each member of a small CCNA study group log in with their own account, get their own persistent progress (day checkboxes, quiz history, Boson attempts, tutor chat log, subnetting drill stats), and have a per-user daily cap on AI calls so one heavy user can't drain the shared Anthropic budget for everyone else.

## 2. Non-goals

- Public self-service signup — this is invite-only
- Billing / paid tiers / Stripe
- Team/cohort features (progress leaderboards, shared study rooms, admin dashboards for instructors) — future work if the group grows
- SSO / SAML / enterprise auth
- MFA on the tutor app itself (Supabase's default is fine; MFA lives at the auth-provider layer)
- Preserving the claude.ai artifact deployment path (see §8)

## 3. Stack

**Chosen:** Supabase (Auth + Postgres + Row-Level Security in one product)
**Ruled out:**
- Clerk (auth-only, still needs a separate DB — more moving parts for no UX gain at this scale)
- Firebase Auth (fine, but Firebase Firestore is a worse fit for the mostly-relational data we have)
- Roll your own (would need to hand-write password reset flows, session management, JWT lifecycle — 3-5x the code for no benefit)

**Cost:** $0/mo on Supabase free tier for expected usage. Free tier caps: 50k monthly active users, 500 MB Postgres, 2 GB egress. Study group is ~5 MB total data.

## 4. Data model

Supabase Auth manages `auth.users` (id, email, encrypted_password, etc). We add three app tables in the `public` schema.

```sql
-- Per-user progress state (the JSON currently in localStorage)
create table public.progress (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Tutor chat history (kept separate — grows independently, easier to purge)
create table public.tutor_chats (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  turns       jsonb not null default '[]'::jsonb,
  mode        text not null default 'teach',
  updated_at  timestamptz not null default now()
);

-- Per-user daily API usage counter (drives per-user cap enforcement)
create table public.api_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         date not null,
  count       integer not null default 0,
  primary key (user_id, day)
);
create index api_usage_day_idx on public.api_usage(day);
```

**Why JSONB for `state` and `turns`?** The current localStorage state is already a JSON blob, the schema evolves as we add features (new quiz stats, new subnet drill types), and Postgres JSONB is fast, indexable, and cheap. Splitting the state into columns is premature normalization at this scale.

## 5. Row-Level Security (RLS)

Every table enables RLS. Users can only touch their own rows. Enforced at the database layer — the backend can't accidentally leak someone else's data even with a buggy query.

```sql
alter table public.progress     enable row level security;
alter table public.tutor_chats  enable row level security;
alter table public.api_usage    enable row level security;

create policy "own_progress" on public.progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own_chats" on public.tutor_chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- api_usage: user can READ own row, but only backend (service role) can write
create policy "own_usage_read" on public.api_usage
  for select using (auth.uid() = user_id);
```

Backend uses the Supabase **service role key** for `api_usage` writes — bypasses RLS by design.

## 6. Auth flow

### Signup (admin-driven, invite-only)
1. Admin opens Supabase dashboard → Authentication → Users → **Invite user** → types email
2. Invitee receives email with a magic link
3. Clicks link → lands on our app's `/auth/callback` route → sets a password → logged in
4. First-login handler creates rows in `progress` and `tutor_chats` (empty defaults)

**Why invite-only from the dashboard?** For 2-20 users this is zero extra code, and the admin (you) reviews every addition. If the group grows past ~30, we build a proper admin UI on top.

### Login (returning user)
1. User visits app → sees login screen if no active session
2. Enters email + password → Supabase JS client returns a JWT
3. JWT stored in `localStorage` (Supabase SDK handles this)
4. All subsequent requests to our own `/api/sample` include `Authorization: Bearer <jwt>`
5. Frontend queries Supabase directly for `progress` + `tutor_chats` — no backend proxy needed for user data

### Session lifecycle
- Access token: 1 hour lifetime (Supabase default)
- Refresh token: 7 days, rotated on every use
- Supabase SDK auto-refreshes in the background

## 7. Backend integration (`main.py`)

**New env vars on Render:**
- `SUPABASE_URL` (public, e.g. `https://xxxxx.supabase.co`)
- `SUPABASE_JWT_SECRET` (secret, HS256 signing key for JWT verification)
- `SUPABASE_SERVICE_KEY` (secret, for `api_usage` writes bypassing RLS)
- `DAILY_CAP_PER_USER` (default `50`)

**Existing env vars that stay:**
- `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` — no change
- `RATE_LIMIT_PER_10MIN` — still per-IP, orthogonal to per-user cap, keeps abuse-bot protection
- `DAILY_REQUEST_CAP` — becomes global belt-and-suspenders ceiling above the per-user caps

**Deprecated (kept during migration as fallback, dropped in Phase E):**
- `APP_PASSCODE` — during transition, `/api/sample` accepts either a valid JWT OR a valid passcode header. Once all study-group members are logged in, we drop passcode support entirely.

**New guard logic (sketch):**
```python
async def _guard_v2(req: Request) -> str:  # returns user_id
    if not client:
        raise HTTPException(503, "ai_not_configured")

    ip = _client_ip(req)
    now = time.time()

    # Per-IP DoS guard (unchanged)
    _check_ip_rate_limit(ip, now)

    # Try JWT first, fall back to passcode during migration
    auth_header = req.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            claims = jwt.decode(
                auth_header[7:],
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
            user_id = claims["sub"]
        except jwt.PyJWTError:
            raise HTTPException(401, "invalid_token")

        _check_user_daily_cap(user_id)  # queries api_usage via service role
        _increment_user_usage(user_id)
        return user_id

    # Fallback: passcode (removed in Phase E)
    if PASSCODE and hmac.compare_digest(req.headers.get("x-app-passcode", ""), PASSCODE):
        _check_ip_daily_cap(ip)  # existing DAILY_REQUEST_CAP logic
        return "legacy_passcode"

    raise HTTPException(401, "unauthenticated")
```

**Library additions:** `pyjwt[crypto]`, `supabase` (Python client). Both are small and well-maintained.

## 8. Deprecation of claude.ai artifact mode

The current app checks `if (window.claude?.use)` at startup and uses Anthropic's built-in per-user database when running as a claude.ai artifact. This gave us free auth + sync on that deployment path.

**Recommendation:** deprecate. Reasons:
- We're moving to Render as the primary deployment
- Maintaining two parallel sync paths (Supabase for Render, claude.ai APIs for artifact mode) doubles the code we have to keep working forever
- The claude.ai artifact was a demo — never the plan of record

**What we remove from `index.html`:**
- `window.claude?.use("sample")` code path — replaced by `/api/sample` with JWT
- `window.claude?.use("db")` sync — replaced by direct Supabase queries
- `window.claude?.use("user")` — replaced by Supabase auth user object
- `window.claude?.use("downloads")` for export — replaced by browser `<a download>` (the code already has this as fallback)

**Fallback plan if we ever want to republish as an artifact:** git tag `pre-auth-v1` on the last commit that has both paths. Reverting is a `git checkout` away.

## 9. Migration: existing localStorage → Supabase

Existing users on the Render deployment have progress in localStorage under `ccna-lockstep-v1` and `ccna-lockstep-tutor-v1`. After auth is deployed, first-login handler:

1. On successful login, frontend checks: does `localStorage["ccna-lockstep-v1"]` exist AND is Supabase `progress.state` empty?
2. If yes → show one-time modal: *"You have existing progress on this device. Import it to your account?"* [Import] [Start fresh]
3. If Import → POST all localStorage state to Supabase, then clear localStorage keys
4. If Start fresh → mark localStorage as ignored, don't offer again on this device

No data loss risk — we don't touch localStorage until user picks.

## 10. Per-user daily cap policy

**Default:** `DAILY_CAP_PER_USER = 50` requests per user per UTC day.

**Rationale:** Active study session ≈ 15-25 tutor questions + 3-5 quiz generations = ~20 requests. 50 gives 2.5x headroom for heavy days without letting a single user monopolize the shared API budget.

**Belt-and-suspenders:** Global `DAILY_REQUEST_CAP = 500` remains as a ceiling. If 20 users × 50 = 1000 potential, but a global cap of 500 kicks in first for the group. Admin can raise if needed.

**Cost estimate at cap:** 500 requests/day × avg 1600 output tokens × Sonnet 4.6 pricing ≈ $12/day worst case, ≈ $360/month. Realistic average based on typical study patterns: $30-80/month. Set Anthropic monthly budget accordingly.

## 11. Implementation phases

Each phase ends in a deployable state. If we stop mid-plan, the last deployed phase still works.

### Phase A — Supabase project + schema
- Create Supabase project (US East region)
- Run schema + RLS migrations from §4-5
- No app code changes yet
- Deliverable: empty Supabase project with schema live

### Phase B — Backend JWT verification (dual-mode)
- Add `pyjwt`, `supabase` to `requirements.txt`
- Rewrite `_guard()` per §7 — accepts JWT OR passcode
- Add per-user cap enforcement using service role client
- Deploy to Render — **no user-facing change yet**, existing passcode still works
- Deliverable: backend ready to accept JWTs, no frontend changes

### Phase C — Frontend login modal
- Add Supabase JS SDK via CDN
- Login/signup UI (modal, styled to match existing dark theme)
- Session state management, auto-refresh on token expiry
- All `/api/sample` calls updated to send `Authorization: Bearer <jwt>` when logged in
- Deliverable: users CAN log in, but progress still local

### Phase D — Progress migration + Supabase state
- Replace `save()` / `load()` in `index.html` with Supabase queries
- One-time migration modal per §9
- Delete `ccna-lockstep-passcode` localStorage key (no longer needed)
- Deliverable: full end-to-end multi-user experience live

### Phase E — Deprecate `APP_PASSCODE`, remove claude.ai paths
- Send Supabase invite emails to all study group members
- Once everyone's logged in and confirmed working, remove passcode fallback from backend
- Remove `window.claude?.use()` code paths from frontend
- Update README to document invite process
- Deliverable: clean single-mode multi-user app

## 12. What could go wrong (risk register)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Supabase free tier limits hit | Low | 20 users × 5 MB = 100 MB, well under 500 MB. Alert if egress spikes. |
| One user's JWT leaks | Medium | Per-user cap limits blast radius; user can rotate password. Not a systemic failure. |
| Supabase outage | Low | Free tier has no SLA. Study group tolerance for a few hours of downtime is high. Not worth building multi-region for. |
| Migration modal confuses users | Medium | Clear copy, single decision, no data touched until user picks. |
| Anthropic key still leaked (deferred rotation) | Certain | Per-user JWT auth shrinks blast radius by making anonymous drain impossible, but doesn't eliminate. Rotate before Phase E. |
| claude.ai artifact users lose progress | Low | We haven't announced this as the deployment path; anyone who used it was on `data/users/{uid}/ccna` in claude.ai's DB, which we can't migrate anyway. Accept as user cost of switching to Render as canonical. |

## 13. Open questions (need user sign-off)

Answer each before Phase A starts:

1. **Login method for MVP:** Email + password only, or add "Sign in with Google" from the start?
   - Recommend: email + password only. Google OAuth needs a Google Cloud Console project, OAuth consent screen setup, unverified-app warning until domain verification. ~1-2 hours of setup for zero user benefit at this scale. Can add later.

2. **Per-user daily cap starting value:** 50 too high? Too low?
   - Recommend: 50. Easy to lower via env var change without code deploy.

3. **claude.ai artifact mode deprecation:** OK to remove those code paths in Phase E?
   - Recommend: yes. Git tag `pre-auth-v1` preserves the option to revert if needed.

4. **Data retention:** Do we ever purge `tutor_chats.turns` (chat history grows unboundedly)?
   - Recommend: keep last 24 turns per user (already the client-side behavior via `tutor.turns.slice(-24)` in `index.html:1612`). Enforce at Supabase level too via a trigger or scheduled cleanup.

5. **Admin identification:** How does the app know who's admin (if we ever add admin UI)?
   - Recommend: skip for now, Supabase dashboard IS the admin UI. Revisit if we add cohort features.

6. **Password reset:** Rely on Supabase's built-in email flow, or build custom?
   - Recommend: use built-in. Costs nothing, works out of the box, no reason to reinvent.

---

## Sign-off checklist

Before starting Phase A, user confirms:

- [ ] Stack choice (Supabase) is fine
- [ ] Data model in §4 is right (or note what to change)
- [ ] Deprecating claude.ai artifact mode is OK
- [ ] Per-user daily cap of 50 is reasonable
- [ ] Answers to the 6 open questions in §13
- [ ] Timing: build over the next 1-2 evenings, or spread out?
