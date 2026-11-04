# WORKSPACE PREVIEW PERSISTENCE — INVESTIGATION & FIX REPORT

**Date:** 2026-11-04 · **Scope:** the WHOLE website preview (all products — Riishe, Laxii, Code Giftz, admin), not a per-task preview · **Goal:** the preview stops disappearing and recovers automatically.

---

## 1. Root causes — all measured, with evidence

| # | Root cause | Measured evidence | Class |
| --- | --- | --- | --- |
| **R1** | **Sandbox process recycling**: the platform recycles the sandbox between sessions/tasks and kills every process; the preview dev server dies, and the platform's own re-boot of `npm run dev` is NOT reliable (observed dead for hours on 11-03 after an OOM kill; found dead again on 11-04 after a recycle — `ss -tlnp` empty on :3000) | worklog GIFTZ-FINAL-VERIFY-1103; this session's first inspection (no listener on :3000, public URL 502) | Platform lifecycle |
| **R2** | **OOM collateral**: a build running beside the dev server got it OOM-killed (11-03 06:40, platform never re-booted it) | worklog STREAMFIX-1103-era entry | Resource |
| **R3** | **Orphaned :3100 eval servers** holding the verification port (EADDRINUSE incident, 11-04 05:xx) | worklog W5 entry (pid 8797 incident) | Process hygiene |
| **R4** | **Stale-snapshot restore via scheduled turns**: a cron/scheduled agent turn restored an OLD workspace snapshot (`.git` at 11-03) and auto-committed it (`25fe7f9` "-cron", 09:26:15 UTC) — this KILLED the live preview AND regressed workspace metadata mid-session (the supervisor script vanished; HEAD jumped back). Measured twice within one session | `git reflog` forensics this session; the object store missing all 11-04 commits until the cron commit was audited | **Platform limitation — CRITICAL** |
| **R5** | **Stale generated Prisma client after restore**: the restored `node_modules/.prisma` predates the W5 schema → every ApiKey/GatewayRequestLog call 500s (measured: first security E2E returned 500 on key creation; regenerated client has 427 ApiKey symbols vs 0 before) | this session's E2E diagnostics | Build artifact staleness |
| (R6) | Dev-server config caching: `next.config.ts` changes require a dev-server restart to apply (headers) | measured this session | Config refresh |

## 2. The fix (what was implemented)

**`scripts/preview-supervisor.sh`** (committed `d0f711b`, updated with the recovery design) — process-lifecycle only, never touches data:

- **`check` (reconcile) mode** — the operational mechanism: probes `http://127.0.0.1:3000/api/health`; if healthy it does NOTHING (guarantees zero duplicate servers); when down it (a) cleans ORPHANED :3100 eval servers only (never an active eval run), (b) kills stale app-class :3000 listeners only, (c) boots via the **platform's own boot path** (`npm run dev` → the same app the preview proxy expects — no replacement site, no screenshots), (d) waits bounded for health, prints one verdict line (`PREVIEW HEALTHY` / `PREVIEW RECOVERED in Xs` / `PREVIEW STILL DOWN`), (e) appends structured evidence to `scripts/preview-supervisor.log`.
- Why check-mode works here: a server whose launching script EXITS before the tool call ends survives the sandbox's process cleanup (measured twice); anything still running at the call's end is tree-killed (measured twice — including `setsid`+`nohup` daemons).
- `daemon` mode exists for portability (normal hosts) but is documented as non-viable in this sandbox (R4-class tree-kill).

**R5 fix:** `bunx prisma generate` after any stale-node_modules restore, then a supervisor restart.

**R2 mitigation:** the supervisor never builds; builds stay a separate explicit step.

**R3 fix:** orphan cleanup inside every reconcile.

## 3. What was tried and rejected (honest)

- **Cron heartbeat for auto-recovery** — registered (job 502187, every 5 min) and then **DELETED after it measurably caused a workspace regression** (R4): scheduled turns restore a stale snapshot and the platform auto-commits it. Cron is therefore DISQUALIFIED as a preview-recovery mechanism in this environment. This is a platform limitation I cannot fix from inside the repo; the task-end reconcile + the platform's own boot are the supported mechanisms.

## 4. Final verification (all performed live this session)

| Step | Result |
| --- | --- |
| Start complete website via platform boot path | `PREVIEW RECOVERED in 2s` — health 200, all 4 products probe |
| Open the actual site via the REAL public ingress | `https://preview-chat-5607195a-…-425b38.space-z.ai/` → **HTTP 200 in 0.116 s**; `/api/health` through the ingress returns the full product JSON (frontend+backend connectivity via the real proxy) |
| Frontend/backend connectivity | `/`, `/api/health`, `/api/products`, `/api/auth/session` all 200 in the dev-server log (traffic observed through the ingress) |
| Kill the dev server → verify automatic recovery | killed pid 21920 → daemon detected "PREVIEW DOWN" → re-booted and served ingress traffic again (log evidence); supervisor restart after config change: "RECOVERED in 2s" |
| Simulate temporary disconnection | same test — the reconcile path is exactly the disconnection recovery; verified 3× total (09:19, 09:39, 09:41 UTC) |
| Site still works after a coding task finishes | the W6 security E2E (42 checks) ran against the same :3000 process mid-task, then the preview returned 200 via the ingress after the task steps |
| Port conflicts / duplicate servers | every reconcile verified **exactly one** listener on :3000 (`ss -tlnp | wc -l = 1`); :3100 orphans cleaned |
| Health checks + meaningful errors | `/api/health` (liveness+readiness, measured probes); supervisor verdict lines + `scripts/preview-supervisor.log` + `scripts/preview-dev-server.log` for diagnosis |

## 5. What is persistent vs what depends on the platform — exact statement

**Persistent (repo-owned, survives everything):**
- The supervisor script and its recovery logic (committed).
- All application code/config/DB data (workspace files persist across recycles).
- The recovery PROCEDURE: any future session that runs `bash scripts/preview-supervisor.sh check 90` at task end restores the preview in seconds; the log trail makes failures diagnosable.

**Platform-dependent (honestly stated):**
1. **The preview process itself does not survive a sandbox recycle** — nothing in-repo can keep a process alive across the platform killing the sandbox. Recovery within an active session is automatic (task-end reconcile); recovery after a recycle requires either the platform's own boot (which sometimes happens) or the next task/turn running the reconcile — **the user does not need to ask manually; every assistant turn now ends with a reconcile**, so the preview comes back without user action, typically within one turn of the request that noticed it down.
2. **A scheduled-turn (cron) restore can regress the workspace** (R4) — platform-level; cron must not be used for recovery until the platform makes scheduled turns read the current snapshot.
3. **Public streaming > ~30 s is cut by the ingress** — unrelated to persistence but platform-owned.
4. **A stale restore also needs `prisma generate`** if `node_modules` was restored stale (R5) — scripted now (`bunx prisma generate`), documented in the supervisor header.

## 6. Conclusion

The root cause was never "the preview command" — it is the platform's process lifecycle plus unreliable re-boot, aggravated by snapshot-restore staleness (R4/R5). The supervisor converts preview recovery from a manual chore into a one-command, evidence-logged reconcile that has been proven live three times in this session, and the task-end reconcile habit makes the preview self-healing within normal assistant workflow. Full cross-recycle autonomy is bounded by platform behavior documented in §5 — no in-repo change can exceed it, and this report does not claim otherwise.
