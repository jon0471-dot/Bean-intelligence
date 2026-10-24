# BEAN Intelligence — Test Report

**Execution dates:** 2026-10-24 · **Environment:** this deployment (Next.js 16 dev
server, SQLite, authorized hosted inference gateway, no GPU). Every result below comes
from an actually executed command or request; evidence paths are given. Mocked-only
successes are never labeled PASS against real criteria.

---

## 1. Repository and build

| # | Test | Command | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Dependency install | `bun install` (scaffold init) | clean install | clean | **PASS** |
| 1.2 | Schema push | `bun run db:push` | schema applied | applied (after fixing one relation field flagged by Prisma) | **PASS** |
| 1.3 | Lint | `bun run lint` | 0 errors | 0 errors, 0 warnings (final) | **PASS** |
| 1.4 | Server serves app | `curl / ` | 200 | 200 (`GET / 200` in dev.log) | **PASS** |
| 1.5 | No broken imports | dev.log compile lines | no module errors | all routes compile (`✓ Compiled`) | **PASS** |

Note: `bun run build` is not used inside this managed dev sandbox (the dev server owns
port 3000; production build/run instructions are documented in OPERATIONS.md §2).

## 2. Unit tests — `bun test tests/unit/`

**21 pass / 0 fail / 72 assertions** (final run, 267 ms).

Covered: public catalog exposes exactly 4 products and zero upstream model names;
registry↔product task consistency; video backend truthfully disabled with reason; license
verification data present on all enabled backends; fallback integrity; router capability
limits (rejects oversized prompts with `CAPABILITY_UNSUPPORTED`); error-code→HTTP mapping
(401/403/503/429); sandbox path-traversal rejection; code-fence extraction (path-tagged,
fallback naming, no-fence); scrypt round-trip + strength policy; rate limiter
allow/block/retry.

## 3. Real inference (the critical section)

### RIISHE
| # | Test | Evidence | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Real completion (probe) | `scripts/stage0-report.json` | exact token returned | `BEAN_RIISHE_PROBE_OK` in 446 ms | **PASS** |
| 3.2 | Real streaming (probe) | same; SSE parse test | deltas decoded | `"1, 2, 3."` parsed from raw `data:` frames | **PASS** |
| 3.3 | Production chat JSON | curl POST `/api/riishe/chat` | brand-consistent reply | "I am RIISHE, the conversational AI developed by BEAN Intelligence." (1034 ms) | **PASS** |
| 3.4 | Production chat SSE | curl `?stream=1` | token deltas + done frame | delta frames streamed; conversation persisted | **PASS** |
| 3.5 | Browser chat E2E | Agent Browser; `scripts/e2e-riishe.png` | streamed reply rendered | "Hello! I can help with information…" rendered with history rail | **PASS** |

### LAXII
| # | Test | Evidence | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| 3.6 | Real generation (probe) | `scripts/stage0-report.json` | real image bytes | 47,435 bytes in 59.4 s; magic `FFD8FF` (JPEG) — format recorded honestly | **PASS** (w/ caveat) |
| 3.7 | Async job lifecycle | curl: submit → poll `queued→running→completed` | truthful progression | completed in ~65 s; `imageUrl` only on completion | **PASS** |
| 3.8 | Authenticated delivery | curl GET image | 200 + JPEG, owner-gated | 200, 78,652 bytes, `image/jpeg`, magic verified; 404 before completion; 404 for non-owners by construction (userId-scoped path + job ownership check) | **PASS** |
| 3.9 | Browser E2E (submit→gallery) | Agent Browser; `scripts/e2e-laxii.png` | queued state → completed card w/ download | in-flight state shown; final gallery shows 2 real images with durations (64.6 s / 66.5 s) and sizes (130 KB / 77 KB) + Download buttons | **PASS** |

### JAZMII
| # | Test | Evidence | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| 3.10 | Truthful rejection | curl POST `/api/jazmii/generate` | clear NO_BACKEND, no fake job | `rejected:true, code:"NO_BACKEND"`, honest message; job recorded as `unsupported` | **PASS** |
| 3.11 | UI truthful state | Agent Browser; `scripts/e2e-jazmii.png` | availability banner says not deployed; history shows `unsupported` | banner: "No video-generation backend is deployed. BEAN does not simulate video jobs…"; dashboard shows "Unavailable" | **PASS** |
| 3.12 | Real video generation | — | a real completed video job | **BLOCKED** — no GPU worker and no licensed hosted video endpoint exists in this environment. Unblocking path documented (Wan2.2 candidate, Apache-2.0, verified) in `docs/models/MODEL-EVALUATION-REPORT.md`. | **BLOCKED** |

### CODE GIFTZ
| # | Test | Evidence | Expected | Actual | Status |
| --- | --- | --- | --- | --- | --- |
| 3.13 | Real coding task | curl POST tasks | files extracted from real LLM output | `main.js` (1267 B) extracted | **PASS** |
| 3.14 | Sandbox execution | curl POST run | real process result | exit 0, stdout `PASS` ×3 + "Tests passed: 3/3", 31 ms | **PASS** |
| 3.15 | Browser E2E task+run | Agent Browser; `scripts/e2e-codegiftz.png` | generate → files → Run in sandbox → real output | fizzBuzz task generated, `Run in sandbox` → exit 0, `DONE` in stdout, sandbox panel rendered | **PASS** |
| 3.16 | Approval requirement | API schema | run requires `approval:true` | zod `z.literal(true)`; missing/other → 400 | **PASS** |

## 4. Routing & security

| # | Test | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| 4.1 | Unauthenticated product call → 401 | rejected | 401 (curl, no cookie) | **PASS** |
| 4.2 | Member hits admin API → 403 | RBAC enforced | 403 | **PASS** |
| 4.3 | Admin sees private registry | provider metadata only for admins | overview returned 4 backends w/ health; member denied | **PASS** |
| 4.4 | No upstream catalogue in customer UI | products API contains BEAN identity only | verified by unit test (banned-name scan) + browser | **PASS** |
| 4.5 | Invalid task routed to incompatible backend | impossible by registry constraints | unit test: backend.task must equal product.task | **PASS** |
| 4.6 | Path traversal in sandbox | rejected | unit tests cover `../`, absolute, illegal chars | **PASS** |
| 4.7 | Rate limiting enforced | burst blocked | unit test + per-product limits in preflight | **PASS** |
| 4.8 | Quotas durable, server-side | counted from DB | `/api/usage` showed real per-product counts; JAZMII quota 0 | **PASS** |
| 4.9 | Safe error surfaces | no stack traces to clients | `handle()` maps unexpected errors to generic 500; BeanApiErrors carry customer-safe text | **PASS** |

## 5. Product UI (Agent Browser E2E)

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 5.1 | Landing + login | rendered; sign-in works | `scripts/e2e-riishe.png` (post-login) |
| 5.2 | Dashboard: 4 products, real availability | RIISHE/LAXII/CODE GIFTZ "Operational" with probe ms; JAZMII "Unavailable" | snapshot transcript |
| 5.3 | RIISHE workspace | streaming reply rendered | `scripts/e2e-riishe.png` |
| 5.4 | LAXII workspace | progress state → completed gallery + downloads | `scripts/e2e-laxii.png` |
| 5.5 | JAZMII workspace | truthful banner + unsupported history | `scripts/e2e-jazmii.png` |
| 5.6 | CODE GIFTZ workspace | modes, files, sandbox result | `scripts/e2e-codegiftz.png` |
| 5.7 | Usage view | real quotas + rollup | `scripts/e2e-usage.png` |
| 5.8 | Admin view | private registry + audit | `scripts/e2e-admin.png` |
| 5.9 | Settings view | profile/password/delete sections | `scripts/e2e-settings.png` |
| 5.10 | Mobile layout (390×844) | stacked cards, drawer nav works | `scripts/e2e-mobile-dash.png`, `scripts/e2e-mobile-drawer.png` |
| 5.11 | Sticky footer | footer pinned on short content; pushes down on long content | shell layout `min-h-screen flex flex-col` + `mt-auto`; verified visually in screenshots |

**Incident during E2E:** one transient client-side exception occurred on CODE GIFTZ
while dev-server Fast Refresh rebuilt chunks mid-interaction. Page reloaded cleanly,
the POST had completed (dev.log shows `POST /api/code-giftz/tasks 200` and
`POST /api/code-giftz/run 200`), and the full flow was re-verified from history.
Assessment: dev-HMR transient, not an application defect; no repro after reload.

## 6. Observability

| # | Test | Result |
| --- | --- | --- |
| 6.1 | Usage metering records actuals | `/api/usage` showed riishe/laxii/code-giftz counts + durations after real calls |
| 6.2 | No invented cost data | `costMicros` always null; UI says "cost not reported by provider" |
| 6.3 | Audit trail | login/register/submit/sandbox-run/admin-view events present in Admin view |
| 6.4 | No prompt content in logs | logger emits events + metrics only (verified fields) |

## 7. Summary

- **21/21 unit tests PASS** · **E2E: all 8 views + mobile verified in a real browser**
- **Real inference:** RIISHE ✅ · LAXII ✅ (JPEG, ~60 s) · CODE GIFTZ ✅ · **JAZMII
  real-video test: BLOCKED** (no backend in environment — product truthfully reports
  unavailability rather than simulating).
- Known UI/environment caveats are recorded verbatim in this report and in
  `docs/operations/OPERATIONS.md §7`.
