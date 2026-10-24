# BEAN Intelligence — Multi-Agent Worklog

---
Task ID: 0-3
Agent: main (Z.ai)
Task: Stage 0 feasibility probe + data layer + core backend + API layer for BEAN Intelligence

Work Log:
- Initialized fullstack environment (Next.js 16, Prisma/SQLite, shadcn/ui, z-ai-web-dev-sdk).
- Stage 0 probe (scripts/stage0-probe.ts, results in scripts/stage0-report.json):
  chat PASS (446ms), SSE streaming PASS (raw data: lines, parsed to deltas),
  image PASS-with-caveat (gateway returns JPEG not PNG, ~60s latency).
  JAZMII: no video backend exists in this environment — will be reported BLOCKED.
- Prisma schema: User, Session, Conversation, Message, GenerationJob, UsageRecord, AuditLog. Pushed to db/custom.db.
- Built src/lib: registry (public products + PRIVATE backends), router (10 routing rules),
  adapters (hosted LLM w/ SSE, hosted image, truthful video stub), auth (scrypt, sessions, rate limits, quotas),
  observability (structured logger, metering, audit), jobs queue (async image worker), sandbox runner
  (child-process isolation, 15s SIGKILL, minimal env, output caps), api contracts (error codes, zod validation).
- API routes: auth (register/login/logout/session), products, health (real probes), riishe chat (JSON + SSE),
  riishe conversations, laxii generate/jobs/images (owner-checked), jazmii generate (truthful NO_BACKEND),
  code-giftz tasks + sandbox run (explicit approval), usage, account settings, admin overview (RBAC).

Stage Summary:
- Verified REAL inference: RIISHE chat JSON + SSE streaming; LAXII queued→running→completed with a real
  78,652-byte JPEG (magic bytes verified) delivered owner-authorized; CODE GIFTZ real LLM codegen +
  sandbox run exit 0 with 3/3 self-tests PASS (31ms); JAZMII truthfully rejects with NO_BACKEND (recorded as
  `unsupported` job); unauthenticated → 401; member → 403 admin; usage metering recording actuals.
- Fix applied during testing: withTimeout import moved to hosted-llm adapter source; adapter map gained
  bean-code-llm-hosted-primary entry.

---
Task ID: 4-8
Agent: main (Z.ai)
Task: Frontend SPA, QA/E2E, docs, tests, final report for BEAN Intelligence

Work Log:
- Built black & gold design system (globals.css: near-black surfaces, gold tokens, grid texture, glass cards).
- Built full SPA in src/app/page.tsx + src/components/bean/*: landing/auth, shell (sidebar+mobile drawer),
  dashboard (real availability), RIISHE (SSE streaming chat + conversations), LAXII (sizes, live job
  progress, gallery, downloads), JAZMII (truthful availability + unsupported history), CODE GIFTZ
  (4 modes, file tabs, explicit-approval sandbox runs), Usage, Settings (incl. GDPR-style delete), Admin
  (private registry + audit; role-gated).
- Agent Browser E2E: verified all 8 views, real RIISHE streamed reply rendered, real LAXII generation
  completed in-browser (64.6s, 130KB, download), CODE GIFTZ generate+sandbox exit 0 with DONE output,
  JAZMII truthful banner, mobile 390x844 layout + drawer, sticky footer. Screenshots in scripts/e2e-*.png.
- One transient dev-HMR client exception on CODE GIFTZ investigated: POSTs had completed (dev.log 200s),
  clean after reload, re-verified — recorded honestly in TEST-REPORT §5.
- Docs written: README, docs/architecture/ARCHITECTURE.md, docs/security/SECURITY.md (incl. sandbox
  process-isolation limitation + container hardening requirement), docs/operations/OPERATIONS.md,
  docs/api/API.md (implemented vs planned split), docs/models/MODEL-EVALUATION-REPORT.md + LICENSING-REPORT.md
  (license facts verified via web sources with URLs + dates), .env.example, models/manifests/*.json.
- Unit tests (bun test tests/unit/core.test.ts): 21 pass / 0 fail — registry integrity (no upstream names
  in public catalog), routing validation, error mapping, sandbox path guards, fence extraction, scrypt,
  rate limiter.
- Final state: lint 0 errors; /api/health live probes riishe/laxii/code-giftz available, jazmii truthful false.

Stage Summary:
- BEAN Intelligence complete and browser-verified: 3 of 4 flagship products fully operational on real
  inference; JAZMII truthfully BLOCKED with documented unblocking path (Wan2.2, Apache-2.0, verified).
- Final test report: docs/TEST-REPORT.md (PASS/BLOCKED with evidence paths).

---
Task ID: fix-riishe-withtimeout
Agent: main (Z.ai)
Task: Fix RIISHE chat API build error — missing withTimeout export from @/lib/router/router

Work Log:
- Root-caused the reported error: a prior partial fix had moved the withTimeout import to hosted-llm (real impl exists) but left a DEAD withTimeout import in router.ts:21 (never used there). Removed it.
- Fixed withTimeout timer leak: internal setTimeout was never cleared, keeping the event loop alive up to requestMs (90-180s) after every call. Now cleared via .finally() on race settlement.
- Documented honestly in the helper JSDoc: z-ai-web-dev-sdk exposes NO AbortSignal/options on create calls (verified dist/index.d.ts), so a timed-out underlying request CANNOT be cancelled; Promise.race only abandons the wait.
- Fixed adjacent real type errors in the route's compile graph (root-caused each): hosted-llm buildMessages maxHistoryMessages missing on CodeTaskRequest (in-narrowing); backends.ts 4 descriptors missing required retries (added truthful {maxAttempts:1, backoffMs:0} — router does no auto-retry); hosted-image size literal-union cast after runtime validation; sandbox runner NODE_ENV + stdio tuple typing; stage0-probe REPORT typed interface; tsconfig excludes for non-app examples/skills (already eslint-ignored); added @types/bun dev dep for bun:test types.
- Added tests/unit/timeout.test.ts: resolve-before-deadline, labeled rejection timing, late-rejection no-unhandled-crash, timer cleanup proof.

Stage Summary:
- Checks all actually run and pass: tsc --noEmit 0 errors (authoritative gate — next.config.ts has template default ignoreBuildErrors:true), eslint 0 errors, bun test 25 pass/0 fail (4 new timeout tests), next build compiled successfully.
- Runtime smoke on live dev server: unauthenticated POST /api/riishe/chat -> clean 401; authenticated -> real reply "TIMEOUT_FIX_VERIFIED" 405ms; SSE stream=1 -> real deltas; usage metering recorded; no runtime errors in dev.log.
