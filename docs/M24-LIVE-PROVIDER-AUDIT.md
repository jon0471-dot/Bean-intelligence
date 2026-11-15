# M24 — Live-Provider End-to-End Validation: Architecture Audit

Milestone: CODE GIFTZ — M24 · Repository: `jon0471-dot/Bean-intelligence` · Branch: `main`
Baseline verified before any change: local HEAD **and** `origin/main` both at
`e6fe3a514cde4212a5ebe1b2c556657570785b6d` (`feat(code-giftz): add safe chat-based file operations`).
Audit date: 2026-11-15.

This audit was produced **before** the validation work, per milestone Section 0. It maps what
exists, what is reused, and the integration gaps found — three of which were subsequently
confirmed live and fixed (§6). No second gateway, queue, database, storage layer or sandbox was
created; every validation runs the existing architecture.

---

## 1. Model registry and provider configuration (reused as-is)

- Private source of truth: `src/lib/registry/backends.ts` — 10 backends; the CODE GIFTZ lane is
  `bean-code-llm-hosted-primary` (Z.ai hosted gateway, `managed-sdk`, enabled, retries
  `{maxAttempts: 1, backoffMs: 0}` — exactly one upstream attempt, no blind retry).
- Public projection: `src/lib/registry/models.ts` (`getGatewayModels`, `resolveGatewayModel`).
  Gateway model ids: `bean-chat-hosted`, `bean-code-hosted`, … Engine catalog:
  `src/lib/ai-engine/model-registry.ts`.
- Availability = registry flag + measured probe health + credential presence
  (`src/lib/registry/capabilities.ts`, `src/lib/adapters/health-cache.ts`).

## 2. Unified `/api/v1` gateway and routing (reused as-is)

- `src/lib/ai-gateway/gateway.ts`: `planGatewayChat` → `executeGatewayChat(Stream)` →
  `recordGatewayCall` (no prompts, no secrets in `GatewayRequestLog`). Sliding-window rate limit
  (30/min/principal) + daily quota (500) with truthful `Retry-After`/`X-RateLimit-*` headers.
- Routes under `src/app/api/v1/` (`chat/completions`, `models`, `providers`, `usage`, `health`,
  `keys`). Auth: `src/lib/security/gateway-auth.ts` (Bearer `bgk_…` or session cookie).
- Product lane: `src/lib/router/router.ts` `preflight()` — burst limit 15/min and daily quota
  150 for `code-giftz`, per-product provider budget, account budget, concurrency slot
  (2/user, 8 total), fallback chain (`bean-llm-openai-compatible` → `bean-chat-local-llamacpp`,
  both credential-gated).

## 3. API key and provider credential handling (reused as-is)

- Platform-managed gateway credential: `/etc/.z-ai-config` (fields `apiKey`, `baseUrl`), consumed
  by `z-ai-web-dev-sdk` (`ZAI.create()`) — presence check only, values never read/logged.
- External lane: AES-256-GCM admin vault (`src/lib/security/provider-credentials.ts`,
  master key `BEAN_CREDENTIALS_MASTER_KEY`) with SSRF re-validation at decrypt time
  (`src/lib/security/url-guard.ts`); env lane `BEAN_PROVIDER_OPENAI_API_KEY` (+ optional
  base-url/model), guarded by the same SSRF policy. Documented local-rig hatch:
  `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=true` admits loopback for test rigs only; the cloud
  metadata range is hard-blocked even under the hatch.
- Spend guards: `cost-guard.ts` (opt-in per-product daily request budgets), `account-quota.ts`.

## 4. Project generation and targeted editing (reused as-is)

- Chat turn: `POST /api/code-giftz/chat` → `runGiftzTurnCore` (`src/lib/giftz/turn.ts`) shared by
  the live SSE path and the background worker. Prompt assembly (`src/lib/giftz/prompts.ts`):
  SYSTEM_PROMPT + curated history (≤12) + `buildProjectContext` (24 000-char budget) +
  tech-docs block + frontend-intel brief + targeted-edit brief + user message.
- The single provider call: `hostedLlmAdapter.chatStream/codeTask` (`src/lib/adapters/hosted-llm.ts`)
  → `createWithGatewayGuard` → `zai.chat.completions.create` (streaming or buffered).
- Extraction: `parseFiles` (`path=`-tagged fences) → `applyFiles` (the single content-write path;
  per-file `assertSafeProjectPath` before every write; identical content = honest no-op).
- Targeted editing (M22): `buildTargetedEditBrief(fileCount)` injected when the project has files;
  unrelated files are structurally preserved (only emitted fences are ever written); every turn
  with accepted changes auto-snapshots `kind:'turn'`.

## 5. Persistent project lifecycle, versioning, file ops (M22/M23, reused as-is)

- Storage: Prisma + SQLite (`src/lib/db.ts`, `connection_limit=1`). `CodeProject` / `CodeFile`
  (`@@unique(projectId,path)`) / `CodeMessage` / `CodeBlob` (per-project dedup,
  `@@unique(projectId,hash)`) / `CodeVersion` (`@@unique(projectId,seq)`, kinds
  initial|turn|manual|rollback|file-save|file-delete|file-op|repair) / `CodeVersionFile`
  (path→blobHash) / `CodeFileOperation` (M23 ledger with `planHash`).
- `src/lib/code/versioning.ts`: `snapshotProjectVersion` (transactional, skips unchanged sets),
  `validateVersionIntegrity` (missing blobs + recomputed hash vs stored `contentHash`),
  `rollbackToVersion` (rollback-as-new-version; history append-only; 200-version cap).
- Routes under `src/app/api/code-giftz/projects/[id]/…`: files (editor save with optimistic
  concurrency `expectedUpdatedAt`), versions/[seq] (+`?file=`, compare, rollback), duplicate,
  export, preview, preview-check, dependencies, file-ops/execute|cancel.
- M23 file ops: `src/lib/code/file-ops/{detect,plan,execute,references,types}.ts` — deterministic
  intent detection (no model call), plan hash binding, transactional execution, idempotent replay,
  stale-plan refusal, separately-approved reference repairs.

## 6. Integration gaps found (and what M24 did about them)

| # | Gap found during audit / validation | Evidence | Action taken |
|---|---|---|---|
| G1 | **Preview inliner `$`-pattern corruption.** `preview/route.ts` inlined CSS/JS with `String.replace(re, "<script>" + content + "</script>")` — a STRING replacement. Minified vendor bundles contain `$&`, `$'` sequences (`ScrollTrigger.min.js` contains `$&&$(se)`), so the replacement spliced content and appended scripts into the wrong script block. Browser-only failure ("Unexpected token '<'", 1077px mobile overflow from stray text); static checks could not see it. | M24 live run 1, browser evidence | Extracted the inliner to `src/lib/code/preview-inline.ts` with function-form replacements (literal insertion) + regression test `tests/unit/code-preview-inline.test.ts` (5 tests). Verified live: all served scripts parse, mobile overflow gone. |
| G2 | **Frontend-intel AUTO path hijacked targeted edits.** `resolveFrontendPlan` ran its catalogue keyword matcher on EVERY turn. On existing projects, incidental words in edit messages ("ScrollTrigger" → scroll-stack, "text" → split-text) mandated the animation pattern library (measured: 4 931-char brief with `entrance-timeline` etc. on a one-line heading change). The provider followed the brief INSTEAD of the user's request — 5 consecutive failed targeted edits across live runs. | M24 live runs 1–4, recorded diffs | `engine.ts`: on existing projects (`existingFilePaths.length > 0`) the AUTO keyword path no longer engages; explicit kit selections and messages naming frontend work still do. Fresh generation unchanged. 4 new regression tests in `frontend-intel-engine.test.ts` (24 total, all green). Live re-run: targeted edit applies exactly the one-line change. |
| G3 | **File-context budget starved/derailed edits.** `buildProjectContext` served files in storage order with a 24 000-char linear budget: engine-injected vendor bundles (116 KB) truncated minified library code into "the code the user sees and will run", which the model tried to "fix". | M24 live runs 2–3 (model prose quoted in the report) | Smallest-first ordering (mirrors the pre-existing smallest-first budget in `src/lib/code/files.ts`); over-budget files omitted WHOLE with an honest "large asset/library file; do NOT modify, re-emit or delete it" note. Pinned tests preserved (`giftz-workspace.test.ts`, `code-workspace.test.ts` green). |
| G4 | Conversation-history contamination: a duplicate taken AFTER an unsatisfied edit request made the provider apply the stale request during a repair turn. | M24 live run 3 (repair diff shows the old heading change) | Harness-level: the isolated repair copy is taken BEFORE the edit request (clean history). Product behavior unchanged; documented in the report. |
| G5 | Known limitations left as-is (no code change, documented): mid-stream connection loss is indistinguishable from a clean end on Bun fetch and the hosted SDK discards `[DONE]`/`finish_reason` (measured live via `scripts/m24/probe-stream-shape.ts`: a successful hosted stream surfaces NO finish_reason) — partial provider text is delivered verbatim, nothing fabricated, idle/total timers guard hangs; provider-reported truncation IS surfaced as `UpstreamTruncatedError`. No tools surface on `/api/v1/chat/completions`; no fetch-level timeout on the external streaming lane; cost data never reported (`costMicros` null by design); self-verification off by default. | `scripts/m24/probe-stream-shape.ts`, failure-modes report | Recorded in this audit + the delivery report; harness check states the measured contract explicitly. |

## 7. Async jobs, workers, queue; build pipeline; preview; repair; export (reused as-is)

- Durable queue: `GenerationJob`/`JobEvent` with lease/heartbeat/dedupeKey/cancelRequested;
  workers `scripts/ai-workers/worker.ts`; `giftz-coding-handler.ts` registered as
  `'coding-task'`; failure classification `classifyJobFailure` (rate-limited jobs are never
  re-queued).
- Build/preview: `runInSandbox` (`prlimit --as=4GiB --cpu=10 --nproc=512 … unshare -Urn`, 15 s
  wall clock, no secrets in env, honest per-run isolation profile); preview serves the entry HTML
  standalone with CSP `default-src 'none'` + the M22 error bootstrap (`source:'giftz-preview'`
  postMessage capture); static `auditPreview` + `analyzeDependencies` gates.
- Repair flow: chat repair requests run through the same turn core (targeted-edit brief), show a
  reviewable per-file diff in the done frame; destructive/reference operations go through the M23
  confirmation-bound plans.
- Export: `src/lib/code/export.ts` — fail-closed name/content secret filters, README + manifest
  with per-file sha256, `verifyExportZip` reopens the archive; route refuses to ship on any issue.

## 8. Rate limits, retries, breakers, audit logs (reused as-is)

- Breaker: `src/lib/upstream/gateway.ts` per-class state machine (60 s base, 2^n escalation to
  600 s), `Retry-After` honored on direct-fetch lanes, no blind retries anywhere.
- Classification: `classifyUpstreamError` → rate_limited / auth / billing / timeout / truncated /
  network / no_results; JSON/SSE error codes are typed and truthful.
- Metering/audit: `recordUsage` (token estimates labeled, cost never invented) + `recordAudit`
  (`code-giftz.chat`, `code-giftz.chat_file_op`, `code-giftz.file_op_execute`, …).

## 9. Test architecture (reused + extended)

- Runner: `bun test --isolate tests/` — 133 files / 1 885 tests (all green after M24).
- M24 additions: `tests/unit/code-preview-inline.test.ts` (5), 4 new frontend-intel-engine
  regression tests; validation harnesses under `validation/m24/harness/` (live workflow,
  file-ops regression, failure modes, fixtures, security, report assembler); artifacts under
  `validation/m24/{reports,evidence,fixtures}/` — never inside production project storage.
- M21 fixtures (`validation/m21/projects/…`) are consumed **read-only** on isolated copies.

## 10. Security posture carried into validation

Owner-only project access (404, no existence leak) on every route; server-side path validation
(`assertSafeProjectPath` before every write; M23 plan validation against the real file set);
preview CSP + sandboxed iframe (no same-origin); export fail-closed secret/traversal filters;
sandbox without secrets/network; provider credentials platform-managed and never logged
(`redact()` on Bearer tokens; one-JSON-line logger with no prompt/credential content).
