# BEAN Intelligence — Operations Guide

**Date:** 2026-10-24

## 1. Environment requirements

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | SQLite file path (e.g. `file:/app/db/custom.db`) |
| `BEAN_LOG_LEVEL` | No | `debug`/`info`/`warn`/`error` (default `info`) |
| `BEAN_SANDBOX_RUNTIME` | No | Sandbox runtime binary (default `bun`) |
| `BEAN_SANDBOX_RETENTION_HOURS` | No | Sandbox workspace retention (default 24) |

No third-party API keys are required in this environment: the inference gateway is
authorized by the platform runtime. If you port BEAN to external providers, add their
credentials as server-only env vars and reference them by NAME in
`src/lib/registry/backends.ts` (`secrets` field) — never values.

## 2. Setup

```bash
bun install            # deps
bun run db:push        # create/patch schema
bun run dev            # development server (port 3000)
bun run lint           # eslint
```

Production build (outside the managed dev sandbox): `bun run build && bun run start`.

## 3. Health & readiness

- `GET /api/health` performs **live probes**: chat gateway (real completion), image
  gateway (client init + deploy-time generation evidence). Treat `products.riishe.available=false`
  as a page-on-call event.
- First-run bootstrap: the first registered account becomes the platform administrator.
  Register immediately after a fresh deployment and restrict further registrations at
  your ingress if desired.

## 4. Storage layout

- `db/custom.db` — SQLite database (users, sessions, conversations, jobs, usage, audit).
- `storage/laxii/<userId>/<jobId>.jpg` — generated images (owner-gated delivery).
- `sandbox-runs/<uuid>/` — ephemeral code workspaces (24 h retention sweep on each run).

Backups: copy the DB file and `storage/` tree; both are plain files. Stop writes (or use
SQLite's backup API) for a consistent snapshot.

## 5. Day-2 operations

**Image jobs stuck `running` > 3 min:** the 180 s request timeout will mark them `failed`
with `BACKEND_TIMEOUT`. If they persist, restart the app process (in-process worker) and
check the gateway's status.

**Resetting quotas:** quotas are computed from `UsageRecord` per calendar day; delete
rows for the target user/day or wait for midnight rollover.

**Auditing admin actions:** `AuditLog` (also rendered in Admin → Audit trail). Login,
logout, registration, task submission, sandbox runs and admin views are recorded.

**Adding a backend (e.g. enabling JAZMII with Wan2.2):**
1. Deploy the GPU worker (see `docs/models/MODEL-EVALUATION-REPORT.md` for the verified
   candidate and real constraints).
2. Implement `TaskAdapter` in `src/lib/adapters/` (video worker client + health).
3. Add the backend descriptor to the private registry with real limits + license data.
4. Flip `enabled: true`, update `models/manifests/`, re-run the test report additions.
5. The UI picks up availability automatically from `/api/products` + `/api/health`.

## 6. Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `503 NO_BACKEND` on a product | Registry entry disabled or adapter missing | Check `src/lib/registry/backends.ts` and adapter map in `src/lib/router/router.ts` |
| `429 QUOTA_EXCEEDED` | Daily quota used up | Verify `/api/usage`; adjust `PRODUCT_DAILY_QUOTAS` if policy changes |
| LAXII jobs all fail `BACKEND_FAILURE` | Gateway outage or size mismatch | Check `dev.log` (structured `laxii.job_failed`), confirm sizes against registry limits |
| RIISHE stream ends early | Upstream hiccup | UI labels partial output "Incomplete"; user can resend. Watch `riishe.stream_failed` logs |
| Sandbox `timeout (SIGKILL)` | Generated code loops / heavy compute | Expected protective behavior; increase `BEAN_SANDBOX` timeout only with capacity review |
| `401` loops in browser | Expired/invalid session cookie | Sign in again; sessions auto-clean on expiry detection |

## 7. Known limitations (truthful register)

1. **JAZMII is not operational** — no GPU worker or licensed hosted video endpoint here.
   The product truthfully reports this instead of simulating jobs.
2. **Sandbox isolation is process-level** — container hardening required for untrusted
   multi-tenant scale (SECURITY.md §6).
3. **Single-node job queue** — in-process worker; swap for a durable queue before
   horizontal scaling.
4. **Token/cost figures** — token counts are estimates; the gateway reports no cost data
   (fields stay null rather than fabricated).
5. **Image latency ~60 s per job** — measured gateway behavior; surfaced in the UI.
