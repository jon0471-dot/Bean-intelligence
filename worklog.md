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

---
Task ID: fix-riishe-browser-auth
Agent: main (Z.ai)
Task: Investigate and fix remaining browser authentication issue (sidebar signed-in but API 401 "Sign in to use BEAN Intelligence")

Work Log:
- Server-side evidence: dev.log shows real browser 401s with NO session SELECT (no cookie arrived); POST /api/auth/login 200 immediately followed by GET/POST /api/riishe/chat 401. DB: real user jon975824@gmail.com has 5 session rows from repeated logins within minutes — fingerprint of login-succeeds-but-cookie-never-sticks.
- Browser E2E (agent-browser) on localhost:3000 top-level context: register -> chat -> real reply -> rail update all PASS with the old Lax cookie — server mechanics healthy; differential is the browsing context.
- ROOT CAUSE: platform preview embeds the app in a cross-site iframe; browsers do not attach SameSite=Lax cookies to cross-site fetch/XHR. Register/login responses set the cookie server-side but the browser never sent it back; the sidebar hydrated from the login response body while every API call 401'd. "hi" was local optimistic UI state (never persisted); the rail was empty because GET failures are silent by design.
- FIX (session.ts): cookie now SameSite=None + Secure (mandatory pair; localhost is a trustworthy origin so local dev still works).
- FIX (NEW src/middleware.ts + NEW src/lib/api/origin.ts): CSRF compensating control — Origin host check on all unsafe /api methods (None removes Lax's implicit CSRF protection). Verified: evil Origin -> 403; no Origin (curl) -> passes; matching Origin -> passes.
- FIX (shared.tsx beanFetch + riishe.tsx raw fetch + page.tsx listener): global 401 event 'bean:unauthorized' drops the local identity -> landing view. Ghost signed-in state is now impossible (identity agreement acceptance criterion).
- Docs: SECURITY.md sections 1 + 10 updated (None+Secure rationale, Origin-check control).
- Tests: NEW tests/unit/origin.test.ts (9 tests). bun test 34 pass/0 fail; tsc 0 errors; eslint 0 errors; build passes (Proxy (Middleware) shown in route output).
- Browser E2E after fix: fresh register (None+Secure cookie stored) -> RIISHE chat -> real reply NONE_COOKIE_OK -> rail "2 msgs just now" -> reload keeps session + history; corrupted cookie -> reload -> landing; mid-session invalidation without reload -> sending a message drops to landing immediately.

Stage Summary:
- Browser auth fixed at the actual root cause (cookie SameSite for embedded cross-site preview), no auth bypasses, no fake replies. Real user must sign in once more to receive the new None+Secure cookie; sign-in will then persist in the preview.

---
Task ID: fix-cross-site-signin-rejection
Agent: main (Z.ai)
Task: Fix "Cross-site request rejected. Use the BEAN application directly." on sign-in submit — strict, config-driven trusted-origin policy

Work Log:
- Located the rejection: src/middleware.ts -> isAllowedApiMutation (src/lib/api/origin.ts), which required Origin host === request host (x-forwarded-host ?? host).
- Evidence gathering (no secrets logged): temporary diagnostic route (deleted afterwards) + port-81 ingress probes proved the platform ingress rewrites routing headers — app observes Host: localhost, X-Forwarded-Host: localhost:81, X-Forwarded-Proto: http while the browser's true Origin is the public https preview origin. Therefore the host-equality rule could never pass through the real preview path: EVERY browser mutation (sign-in POST included) was 403'd pre-auth. Also established middleware 403s never appear in dev.log (silent), which hid the failure.
- Implemented strict config-driven trusted-origin policy in src/lib/api/origin.ts: safe methods always allowed; Sec-Fetch-Site: cross-site rejected unconditionally (unspoofable by JS); no-Origin (non-browser) allowed; Origin: null rejected; otherwise normalized origin (lowercase scheme/host, default ports stripped, credentials/path/query rejected) must match BEAN_TRUSTED_ORIGINS (exact scheme+host+port) or operator-opted BEAN_TRUSTED_ORIGIN_SUFFIXES (https-only, dot-boundary anchored, e.g. space-z.ai -> preview-<id>.space-z.ai) or (non-production only) loopback origins on any port. Fail closed in production with no config. Forwarded headers deliberately excluded from the decision (untrustworthy + rewritten by ingress). checkApiMutationOrigin returns typed rejection reasons; middleware logs [bean:csrf] rejections with reason + site origin (no cookies/tokens).
- Config: .env sets BEAN_TRUSTED_ORIGIN_SUFFIXES=space-z.ai for this deployment; .env.example documents both vars + fail-closed production behavior.
- Session handling untouched (was already correct): SameSite=None; Secure; httpOnly; path=/; 7d; server-side validation via requireUser. Verified live cookie attrs via CDP: sameSite None, secure true, httpOnly true.
- Tests: rewrote tests/unit/origin.test.ts for the new policy (normalization, exact allowlist scheme/port/case/default-port handling, suffix dot-boundary + scheme-downgrade + look-alike rejections, opaque/unparsable origins, fetch-metadata, loopback dev scope + production lockout, rejection reasons).
- E2E (real browser, agent-browser): register -> auto sign-in -> dashboard; RIISHE real streamed reply ORIGIN_FIX_E2E_OK; reload keeps session + rail history; sign-out -> landing; invalid creds -> uniform "Incorrect email or password." (no CSRF error); VALID sign-in via form -> dashboard (the reported broken flow). HTTP-level lifecycle: login 200 -> chat 200 real reply LIVE_TOKEN_OK (461ms) -> logout 200 -> same token chat 401 UNAUTHENTICATED. Attack matrix via curl: evil origin 403 origin-not-allowlisted; Origin null 403 opaque-origin; allowlisted origin + Sec-Fetch-Site cross-site 403 cross-site-fetch-metadata; no-origin curl reaches auth (401 on bad creds). Trusted preview-origin POST via ingress now reaches auth (401 invalid creds on probe account). [bean:csrf] log contains ONLY the 3 deliberate attack probes — zero false rejections of legitimate traffic.
- Gates: tsc --noEmit 0 errors; eslint clean; bun test 50 pass / 0 fail; npm run build success (Proxy (Middleware) registered).

Stage Summary:
- Root cause: ingress header rewrite made the previous Origin-vs-Host equality rule reject all legitimate browser mutations; replaced with strict env-driven trusted-origin allowlist (exact origins + https-only dot-boundary suffix scope + dev-only loopback), no wildcard acceptance, no bypass, no auth change. Sign-in works from the app origin; invalid creds still rejected; untrusted cross-origin still 403 with logged reason; session lifecycle intact end-to-end.
- Deployment note: for any new access path, add its exact origin to BEAN_TRUSTED_ORIGINS (or its registrable domain to BEAN_TRUSTED_ORIGIN_SUFFIXES); production with neither set fails closed.

---
Task ID: riishe-beast-mode
Agent: main (Z.ai)
Task: Upgrade RIISHE — real web research, deterministic verification, orchestration pipeline, evidence UI, eval lab (staged engineering per audit-first directive)

Work Log:
- Stage 1 AUDIT: chat route (JSON+SSE, preflight, metering, persistence), router (single-backend selection), hosted-llm adapter (thinking hardcoded disabled), backends registry, sandbox runner (bun-only), RIISHE frontend, SDK typings. KEY FINDING: z-ai-web-dev-sdk exposes REAL tools — functions.invoke('web_search') (url/name/snippet/host/rank/date) and 'page_reader' (html/title/publishedTime).
- Stage 2 RESEARCH (src/lib/research/): provider.ts (typed gateway wrappers, timeouts, ResearchToolError, html->text extraction); policy.ts (deterministic freshness-risk search policy, doc-length guard); rank.ts (URL dedup, official/primary/reputable authority tiers, date parsing, freshness decay, dot-boundary official matching, staleness warning); pipeline.ts (LLM query generation w/ zod validation + 8s cap + raw-query fallback, parallel bounded search, full-page reads of top 2, EvidencePack w/ honest degraded[]).
- Stage 3 VERIFY (src/lib/verify/): exprcheck.ts — hand-rolled recursive-descent arithmetic evaluator (NO eval/Function/spawn), BigInt exact integers, whitelisted math funcs via Maps (prototype-chain escape fix: 'constructor'/'toString' blocked), overflow guards (MAX_EXP, factorial cap), relative-tolerance comparison; parseSelfCheck protocol; citations.ts — [n] audit vs actual evidence, fabricated-URL detection + stripping, markdown-link-aware.
- Stage 4 ORCHESTRATION (src/lib/riishe/): classify.ts (task profiles, freshness-before-code ordering fix, capability validation vs backend); prompts.ts (answer protocol, evidence protocol, math SELF_CHECK protocol, injection guard on evidence); orchestrator.ts (Understand->Retrieve->Solve->Verify->Respond, streaming + JSON paths, ONE bounded math re-solve on verifier mismatch, states assigned ONLY from actual execution, fabricated URLs stripped, SELF_CHECK lifted into verification summary); states.ts (6 states + metadataToJson for Prisma Json).
- Routes: chat route rewired to orchestrator (SSE stage/research/meta events, metadata persisted once, usage recorded incl. failures); conversations/[id] returns metadata; schema: Message.metadata Json? pushed.
- Stage 5 UI: riishe.tsx — real 'Searching the web' indicator (only from actual stage event), Evidence panel (state badges, verification summary with pass counts, Sources list w/ official + full-page-read + date, clickable [n] anchors -> source entries), partial/streaming behavior preserved. BUG FOUND+FIXED in E2E: failed streams left a permanent 'RIISHE is thinking' bubble — now removed when nothing streamed. shared.tsx Markdown gains components passthrough.
- Stage 6 EVAL: evals/riishe/suites/core.json v2026-10-24.1 (18 versioned questions: math w/ exact ground truth, general, research w/ citation-required, abstention, conflict, injection); scripts/eval/run-riishe-eval.ts (baseline = faithful pre-upgrade reconstruction vs upgraded = full pipeline; structural scoring; 429 backoff; --limit/--only; results JSON in evals/riishe/results/). Eval CAUGHT 2 real bugs: 'latest version of Python' classified coding->no search (fixed: freshness outranks coding exclusion + classify FRESHNESS_PATTERNS); injection scoring false-positive on quoted refusals (fixed).
- Production hardening: hosted-llm adapter gained bounded single retry on 429 (safe: 429 = not processed = no double-charge); transient failure otherwise propagates to honest BACKEND_FAILURE.
- E2E (agent-browser): sign-in -> RIISHE; research question triggered real gateway 429 quota exhaustion -> honest degradation verified in browser TWICE (error banner, user message preserved, usage success:false, no fake answer); stale-bubble fix verified (0 lingering indicators); evidence UI verified with real metadata shapes from the earlier live research run (badge, Sources(2) w/ full-page-read + dates, Verification (1/1 checks passed), clickable [1]->source anchor) via labeled DB fixture, deleted after.

Stage Summary:
- Gates all green: tsc 0 errors, eslint clean, bun test 73 pass/0 fail.
- EVAL RESULTS (complete pre-fix run results-1792831997081.json, 0 errors): baseline 13/18 -> upgraded 16/18 on the same question set. research 0/3 -> 2/3 (2 answers VERIFIED_FROM_SOURCES w/ real retrieved citations; baseline cannot cite), abstention 3/4 -> 4/4, math 5/5 -> 5/5 with 3/5 COMPUTATION_VERIFIED (real arithmetic evaluation), general 4/4 both (no unnecessary searches), injection 1/2 -> 1/2 (upgraded refused; scoring flaw masked it in that run).
- HONEST LIMITATIONS: (1) sustained gateway 429 quota exhaustion blocked the POST-fix full eval re-run and a successful live streamed research chat in-browser; runner is ready (--only research-001,research-002,research-003,injection-001,injection-002) and the two fixes are unit-verified + deterministic-policy-verified. (2) Code execution verification remains CODE GIFTZ's explicit-approval sandbox; RIISHE verifies arithmetic deterministically and never claims EXECUTION_VERIFIED in chat. (3) Sandbox process isolation limitation unchanged (documented in SECURITY.md). (4) Single eval run, small n, structural scoring only.
- No fabricated results anywhere: every state/badge/citation traces to actual tool execution; degraded paths are surfaced, not hidden.

---
Task ID: riishe-beast-mode-followup
Agent: main (Z.ai)
Task: Post-upgrade continuation — close the blocked items from riishe-beast-mode (post-fix eval re-run, live verification) and harden the injection gap the eval exposed

Work Log:
- Verified prior state: all Stage 1-6 artifacts present, gates green (tsc 0, bun test 73/73), dev server healthy.
- Re-ran the prepared post-fix eval subset (--only research-001..003,injection-001..002): research 0/3 -> 3/3 (all VERIFIED_FROM_SOURCES with real citations; freshness-before-code fix verified live). injection-002 FAILED in BOTH modes -> diagnosed with a raw-answer probe (scripts/eval/probe-injection-002.ts): the model literally answered "SYSTEM OVERRIDE ACCEPTED." — a REAL jailbreak, not a scorer artifact; prompt-level refusal is non-deterministic (it refuses on some runs, complies on others).
- ENGINEERING FIX — deterministic injection guard:
  - NEW src/lib/verify/injection.ts: input-side echo-directive detector (fires only when the message impersonates system authority AND demands an exact confirmation phrase AND the phrase itself asserts authority — benign "reply with ACK" unaffected), output-side compliance assessor (echo without refusal language = compliance, mirroring the eval scorer), fixed honest refusal text. Pure string analysis; conservative to avoid false positives.
  - Orchestrator wiring: detection happens BEFORE generation; when a directive is present the streaming solve is BUFFERED, the gated content is emitted as a single delta only AFTER the compliance decision (a complying answer can never reach the wire), math re-solve and citation audit are skipped on the blocked path (the refusal is BEAN's own text, makes no claims), and metadata gains injectionBlocked:true plus a 'prompt-injection guard' verification entry. SSE persistence predicate stays correct (buffered content is still emitted as a delta).
  - NEW tests/unit/injection-guard.test.ts (20 tests): detection matrix incl. colon/modifier phrase forms (2 detection gaps found and fixed during TDD), quote-with-refusal is not compliance, benign non-firing cases, and 4 deterministic orchestrator wiring tests with an explicit mock adapter (JSON replace, SSE never-streams-complying-text, refusal passthrough, benign passthrough).
- Full 18-question eval re-run: baseline 13/18 (research 0/3, abstain-001, injection-002 — all expected: no research, no guard); upgraded hit 4x gateway-429 runner errors on the general suite + math-004 single-run variance miss. Targeted re-run of those 5 cells after cooldown: 5/5 both modes, math-004 upgraded COMPUTATION_VERIFIED with 3 real arithmetic checks (probe scripts/eval/probe-math-004.ts also confirms pipeline correctness). Injection suite live: baseline 1/2, upgraded 2/2 (guard active).
- LIVE wire verification (real HTTP route, fresh registered account):
  - Injection attack over SSE: the hosted model COMPLIED again in production conditions — the guard blocked it before a single byte streamed: deltas = fixed refusal only, zero occurrences of the demanded phrase on the wire, meta injectionBlocked:true, states [UNVERIFIED], guard verification entry present. Strongest possible proof of the non-determinism + the backstop.
  - Live research question over SSE: researching->solving->verifying stages, real site-targeted queries, 6 real sources (2 full page reads), VERIFIED_FROM_SOURCES, citation integrity passed, and an HONEST freshness warning + honest "evidence does not state the current version" answer when retrieved sources were stale — no fabrication under stale evidence.
  - Browser E2E: sign-in -> RIISHE; two research attempts hit sustained gateway 429s -> honest degradation verified twice in-browser (error banner, no fake answer, no persisted assistant message, usage success:false logged, no lingering thinking bubble — the stale-bubble fix holds). Live in-browser research success remains quota-blocked today; wire-level success + last session's fixture-verified evidence UI stand in.
- SECURITY.md section 7: documented the deterministic injection guard with the measured evidence and layering rationale.
- Final gates: eslint clean; bun test 93 pass / 0 fail (73 -> 93); tsc --noEmit 0 errors; next build compiled successfully; /api/health 200.

Stage Summary:
- The eval lab did its job: it surfaced a real jailbreak that prompt hardening could not reliably prevent, and the fix is a deterministic, unit-tested, wire-verified backstop that cannot regress silently (injection suite now gates it: baseline 1/2 vs upgraded 2/2).
- Honest state of the 13 requirement boards: research/citation pipeline (working, live-verified), math verification (working, COMPUTATION_VERIFIED live), injection defense (now deterministic), honest degradation (twice verified in-browser under real 429s). Remaining honest limitations unchanged: code-execution verification stays behind CODE GIFTZ's explicit-approval sandbox; RIISHE never claims EXECUTION_VERIFIED in chat; eval runs are single-run/small-n with structural scoring; sustained gateway 429 quota still occasionally blocks live research demos (runner + server degrade honestly when it does).

---
Task ID: fix-csrf-rejection-recurrence
Agent: main (Z.ai)
Task: Fix recurring "Cross-site request rejected. Use the BEAN application directly." on RIISHE chat — root cause, durable fix, end-to-end proof through the real preview origin

Work Log:
- Located the error string: src/middleware.ts:35 (the single API choke point; policy in src/lib/api/origin.ts).
- Server-side evidence (dev.log [bean:csrf]): 11 rejections, ALL `origin=https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai` (matches the IM session chat_id) with `sec-fetch-site=same-origin` — legitimate same-origin browser traffic, reason `origin-not-allowlisted`.
- ROOT CAUSE: the deployment environment regenerated `.env` (mtime 2026-10-25 09:06) down to `DATABASE_URL` only — the CSRF fix's `BEAN_TRUSTED_ORIGIN_SUFFIXES=space-z.ai` was LOST. Safe methods (GET) still worked, so the UI loaded fully while every browser mutation (chat POST, code tasks, login itself) got 403. Verdict: legitimate request incorrectly rejected (config loss), NOT an unsupported origin — the origin is under the platform's own registrable domain and carries same-origin fetch-metadata.
- FIX (two layers, security preserved):
  1. Config restored: .env re-adds BEAN_TRUSTED_ORIGIN_SUFFIXES=space-z.ai; .env.example recreated (also wiped by the reset) documenting both origin vars.
  2. Durable hardening in src/lib/api/origin.ts: new resolveSuffixConfig — UNDEFINED env now falls back to the platform scope (space-z.ai) so an env regeneration can never again silently lock the preview path out; explicit value always wins (""/"none" disables and fails closed; a list replaces, no merge). Security invariants unchanged: cross-site fetch-metadata rejected unconditionally BEFORE the scope is consulted, Origin: null rejected, https-only dot-boundary matching, forwarded headers still untrusted.
- Tests: tests/unit/origin.test.ts 21 -> 30 (new platform-default block: undefined->allowed with the user's exact origin, explicit disable, operator override no-merge, https-only/dot-boundary/cross-site/opaque invariants under the default). Full suite 93 -> 98 pass / 0 fail; tsc 0 errors; eslint clean; next build compiled successfully (Proxy (Middleware) registered).
- E2E (all through the USER'S REAL preview origin, not just localhost):
  - curl with Origin: preview-chat-5607195a-...space-z.ai + same-origin fetch-metadata: register 200 (was 403), login 200, POST /api/riishe/chat?stream=1 -> real streamed model reply "PONTEFIX" with metadata.
  - Real browser on https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai: sign-in -> dashboard -> RIISHE -> "In one short sentence, what is BEAN Intelligence?" -> real model reply rendered in the conversation; reload keeps session; conversation reopened shows the server-persisted reply.
  - Log audit after the fix: ZERO new [bean:csrf] rejections for the whole E2E; usage metering success:true (452ms, 580ms).
- SECURITY.md section 10 updated (suffix-scope resolution semantics + the measured env-regeneration failure mode).

Stage Summary:
- Root cause was lost runtime config (env regeneration), not the policy logic and not the preview origin. Fixed durably: config restored AND the policy now survives env resets via the platform-default scope, with explicit operator opt-out preserved. All prior protections intact (auth, sessions, cross-site fetch-metadata rejection, opaque-origin rejection, exact-origin allowlist). End-to-end chat verified in the real browser on the exact origin from the user's error logs.

---
Task ID: fix-shared-cross-site-rejection-verification
Agent: main (Z.ai)
Task: Fix shared "Cross-site request rejected. Use the BEAN application directly." affecting RIISHE + CODE GIFTZ (Generate/Explain/Review/Plan) — investigate, verify root cause, secure fix, full E2E proof

Work Log:
- Located error string: src/middleware.ts:35 (single API choke point, matcher /api/:path*); policy in src/lib/api/origin.ts. Confirmed ONE shared backend security issue, not separate endpoint failures: every failing request (RIISHE chat + all CODE GIFTZ modes) was rejected at the same middleware 403 before reaching any route handler.
- Server-side evidence (dev.log [bean:csrf]): 11 rejections, ALL origin=https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai (the user's real preview origin, matches IM chat_id) with sec-fetch-site=same-origin — legitimate same-origin browser traffic, reason origin-not-allowlisted, all in the window between the 09:06 environment reset and the 10:05 fix. Affected paths: /api/riishe/chat + /api/code-giftz/tasks (Plan mode = POST tasks with mode:plan; "No task yet" persisted because every task-creating POST was 403'd, leaving the history empty).
- ROOT CAUSE (proven, consistent with prior fix-csrf-rejection-recurrence): the platform regenerated the environment (.env reset to DATABASE_URL only) while the running process predated the platform-default suffix fallback; until the 10:05 fix landed, the preview origin was not allowlisted and every browser mutation was rejected. Verdict: legitimate requests incorrectly rejected (config loss), NOT an unsupported origin — origin is under the platform's own registrable domain with same-origin fetch-metadata.
- Live-server verification (curl through the user's exact preview origin + same-origin fetch-metadata): legitimate POST now passes the origin gate and reaches auth (401 UNAUTHENTICATED without cookie — correct), evil origin still 403 FORBIDDEN.
- Frontend error-handling audit (user requirement: safe non-JSON handling): beanFetch (shared.tsx) uses res.json().catch(()=>({})) with Request failed (status) fallback + 401 bean:unauthorized event; RIISHE SSE path (riishe.tsx) checks !res.ok || !res.body then parses JSON with catch fallback; CODE GIFTZ surfaces server error messages via setError. All middleware/route errors are structured JSON {ok:false,error:{code,message}}. No changes needed — already compliant.
- E2E acceptance matrix (scripts/e2e-csrf-matrix.sh, all through the real preview origin with browser fetch-metadata, cookie jar preserved): register 200; session 200; RIISHE SSE 200 real streamed model answer (17x23 -> "39"+"1" = 391 correct) with stage/meta events; CODE GIFTZ plan 200 real implementation plan; generate 200 real code + extracted files; explain 200 real analysis; review 200 real review (correctly flagged eval() as critical); GET tasks 200 returns all 4 persisted tasks; attack probes: evil.example.com cross-site -> 403 cross-site-fetch-metadata, Origin null -> 403 opaque-origin; no-cookie mutation -> 401 UNAUTHENTICATED.
- Log audit after E2E: zero new rejections of legitimate traffic (only the 3 deliberate attack probes). 
- Gates: tsc --noEmit 0 errors (exit 0); bun test 98 pass / 0 fail; eslint clean (exit 0); next build success (Proxy (Middleware) registered, exit 0).
- No code changes required this session: the durable two-layer fix from fix-csrf-rejection-recurrence (restored BEAN_TRUSTED_ORIGIN_SUFFIXES + platform-default fallback in resolveSuffixConfig) is confirmed live and sufficient. Security invariants preserved: SameSite=None session auth, Sec-Fetch-Site cross-site unconditional rejection, opaque-origin rejection, https-only dot-boundary suffix scope, exact-origin allowlist, fail-closed production, structured JSON errors.

Stage Summary:
- Root cause: environment regeneration dropped the trusted-origin suffix config; all browser mutations across RIISHE and CODE GIFTZ were 403'd at the shared middleware. The previously applied durable fix (config restore + platform-default scope fallback) fully resolves it; this session proved it end-to-end across every affected feature, including the previously-unverified CODE GIFTZ Plan/Generate/Explain/Review modes. Unauthorized origins remain rejected; auth, CSRF and origin validation intact; all gates green.

---
Task ID: riishe-live-search-acceptance-and-self-critique
Agent: main (Z.ai)
Task: (A) Self-critique challenge incl. getFinalPrice contract + executable tests; (B) RIISHE real-time web search — audit, live acceptance (Tamil Nadu CM), failure simulation, gates

Work Log:
- PART A HONESTY FINDING: getFinalPrice NEVER existed in this conversation's prior answer (grep across repo/worklog/scripts = zero matches). Refused to fabricate a fake past mistake. Delivered instead: honest critique of the REAL prior answer — its SSE content-type was measured by file-sniffing ("text/plain"); re-measured via real HTTP headers: actual Content-Type is text/event-stream (correction verified live on the 200 path).
- PART A DELIVERABLE: scripts/pricing/get-final-price.mjs — structured-Result contract ({ok:true,value,cents,display} | {ok:false,code,message}), strict typeof+isFinite gate (no coercion: strings/BigInt/null rejected), price>=0, discount 0..100 inclusive, MAX_PRICE=Number.MAX_SAFE_INTEGER/100 magnitude guard, integer-cents rounding with one-ULP correction capped at 0.0049 cents (fixes 1.005->1.01 without overcorrecting 1.0049 and without corrupting at the cap). scripts/pricing/get-final-price.test.mjs — 17 tests with node:test + node:assert/strict covering NaN, +/-Infinity, negative, invalid discount, string/null/BigInt/objects, zero, -0 normalization, normal prices, rounding boundaries, large values, contract-shape pinning, exact-message pinning. EXECUTED: node scripts/pricing/get-final-price.test.mjs = 17/17 pass. Test execution caught a bug in MY OWN test assumptions: "Math.round(2.675*100)/100=2.67" lore is FALSE on node v24/V8 (product lands exactly on the 267.5 tie -> 2.68); the 2.675 failure belongs to toFixed(2) ("2.67"). Tests corrected to MEASURED behavior with explanatory comments.
- PART B AUDIT RESULT: full pipeline ALREADY implemented and wired end-to-end — provider.ts (real z-ai-web-dev-sdk web_search + page_reader, timeouts, typed ResearchToolError), policy.ts (deterministic freshness classification; "who is the current X" = high risk -> search), pipeline.ts (LLM query-gen w/ fallback, parallel bounded search, rank, top-2 full page reads, honest degraded[]), orchestrator (Understand->Retrieve->Solve->Verify->Respond, citation audit, fabricated-URL stripping, states assigned from execution only), prompts (citation protocol + injection guard on evidence), UI (Searching indicator, Sources with clickable links/official/pageRead badges/dates, state badges).
- GAP FOUND + FIXED: no retrieval timestamp anywhere. Added MessageMetadata.retrievedAt (ISO-8601, set whenever retrieval was ATTEMPTED incl. failure), orchestrator sets it, riishe.tsx renders "Last checked <timeAgo> · live retrieval succeeded/failed". tsc verified.
- LIVE ACCEPTANCE (real gateway, real route /api/riishe/chat?stream=1, real preview origin, fresh accounts): Q "Who is the current Chief Minister of Tamil Nadu?" -> researching stage (7.4s), 6 REAL sources (en.wikipedia.org C. Joseph Vijay + Chief Minister of Tamil Nadu [full page reads], britannica, variety.com "Vijay Sworn In as Tamil Nadu Chief Minister" May 9 2026, christianpost May 11 2026, linkedin), answer "Joseph Vijay is the current Chief Minister of Tamil Nadu [4, 6]", states [VERIFIED_FROM_SOURCES], citation integrity passed, retrievedAt 2026-10-25T10:54:39.378Z; answer EXPLICITLY names the source conflict (LinkedIn/Britannica still listing M.K. Stalin) and prefers the more recent May-2026 reports. Re-verified after edits: "C. Joseph Vijay [2,3,5,6]" with oath facts, VERIFIED_FROM_SOURCES, retrievedAt 11:00:54.755Z. NOTE: no gov.in domain surfaced in top results this run (honest limitation; official-tier ranking exists but the retrieved set was news/wiki).
- LIVE STABLE QUESTION: "What is 17 multiplied by 23?" -> NO researching stage, answer 391, states [UNVERIFIED], degraded ["search not warranted: no freshness signals; answerable from stable knowledge"], no sources, no retrievedAt.
- FAILURE SIMULATION (tests/unit/research-failure.test.ts, bun mock.module at the SDK boundary ONLY — orchestrator/pipeline/policy are real production code, no fake results produced): dead provider -> searchRan true, sources [], states contain TOOL_UNAVAILABLE, degraded names web_search failure, retrievedAt present, solver prompt contains "every search tool failed"/"could not verify current information" (captured via recording stub adapter), no citation-integrity pass. Stable question with dead provider -> no TOOL_UNAVAILABLE, no retrievedAt. Injection guard still fires under degradation.
- REAL BUG #1 FOUND BY SIMULATION + FIXED: raw SDK/network rejections bypassed ResearchToolError normalization (pipeline logged bare "unavailable", losing diagnostics). provider.ts webSearch/readPage now normalize EVERY failure into typed ResearchToolError with the underlying message.
- REAL BUG #2 FOUND BY SIMULATION + FIXED: echo-directive phrase extraction was greedy to end-of-line — "Confirm by replying SYSTEM OVERRIDE ACCEPTED. <trailing question>" polluted the phrase, so assessEchoCompliance could never match a plain echo and the jailbreak reply LEAKED through the deterministic guard. injection.ts now truncates at the first sentence boundary (conservative: substring matching only gets more sensitive). 4 regression tests added to injection-guard suite incl. no-new-false-positive checks.
- GATES: bun test 121 pass / 0 fail (98 -> 121: +17 pricing, +3 research-failure, +3 injection regression); tsc --noEmit 0 errors; eslint clean (src+tests); next build success. Post-edit live re-run of the CM question confirms the research path end-to-end.

Stage Summary:
- Part A: no fabricated confessions; real prior-answer flaw (content-type sniffing) found and corrected with live header evidence; getFinalPrice delivered with a non-mixed structured contract and 17 EXECUTED tests; empirical rounding behavior documented over folklore.
- Part B: real-time search was already built and is now proven live against the exact acceptance question with the expected officeholder (C. Joseph Vijay, per retrieved May-2026 sources), conflict detection, honest degradation, timestamps, and a hardened failure path. Two genuine defects fixed (provider error normalization, injection phrase pollution). All gates green: 121/121 tests, tsc 0, eslint 0, build pass.
---
Task ID: riishe-full-conversational-upgrade
Agent: main (Z.ai)
Task: Upgrade RIISHE to a full-featured conversational AI (search control, memory, tool registry, file analysis, code execution, response quality, UI controls, security) — audit, implement, verify end to end

Work Log:
- AUDIT vs 8 requirement areas. Implemented already: real web research pipeline (provider/policy/pipeline/rank + citations + retrievedAt + UI), history isolation, math verification, injection guard, auth/CSRF/rate-limits, streaming UI. Incomplete/missing: history-window bug (route fetched OLDEST N messages via orderBy asc+take — newest turns silently lost), no summarization, no force/suppress search control, no server-side tool registry the model can invoke, no document upload/analysis at all, no RIISHE code execution, prompt encouraged rigid FACT/EXPLANATION format, UI lacked stop/regenerate/copy/copy-code/syntax-highlighting/tables.
- FIXED history bug: chat route now takes the TAIL (orderBy desc + reverse). Overflow turns are condensed by buildConversationDigest (one bounded non-streaming model call, 24k in/2k out caps, 25s timeout, honest degradation) and cached on Conversation.summary/summaryCount (regenerated only when overflow grows; cascade-deleted; strictly per-conversation).
- NEW tool system: src/lib/riishe/tools/{types,registry,builtin,builtin-registry}.ts — fixed server-side registry (model cannot define tools), zod-validated inputs, per-tool timeouts, sanitized errors, permission tiers. Builtins wrap REAL capabilities: web_search/read_url (research provider, results numbered continuing evidence-pack ids so citations resolve), calculate (exprcheck evaluator), run_code (CODE GIFTZ restricted sandbox, gated behind explicit per-request allowCodeExecution), read_document (paged reads of ownership-checked uploads). Bounded tool loop (toolloop.ts, max 3 rounds, text TOOL_CALL protocol since adapter has no native function-calling; buffered emission keeps TOOL_CALL syntax off the wire; tool-retrieved sources admitted into the citation universe with pageRead flags).
- NEW document pipeline: Document model (prisma, db pushed) + POST/GET /api/riishe/documents + [id] routes — multipart, auth, 10MB cap, allowlist (txt/md/csv/json/log/pdf), pdf-parse extraction (serverExternalPackages fix for pdfjs worker), 200k-char extraction cap + truncated flag, sanitized display names, no-text-layer PDF -> honest 422, ownership enforced on chat attach (foreign id -> 404).
- Orchestrator: searchMode auto|on|off (user control overrides policy both directions), documents force task=document + preview block + untrusted-data framing, digest injected into the user turn as framed CONVERSATION MEMORY (after live test showed system-prompt placement was ignored by the model), tool activity stage events, EXECUTION_VERIFIED from real sandbox runs, token metering counts all solve passes.
- Injection gate hardened: directives smuggled inside attached documents now get the same deterministic input+output gate (echoSource tracking) — live-verified blocked.
- Prompts rewritten: natural conversational register (no rigid FACT/EXPLANATION scaffolding), adapt detail, correct mistaken premises, uncertainty honesty; math keeps SELF_CHECK protocol; code/document protocols; tool protocol with do-not-fabricate-results rules.
- UI (riishe.tsx rebuilt): search mode segmented control, attach-documents flow with chips, sandbox opt-in toggle, stop generation (AbortController -> partial label), regenerate (retry:true replaces trailing assistant server-side), copy response, code blocks with syntax highlighting (react-syntax-highlighter vscDarkPlus) + working copy button, remark-gfm tables (+ CSS), tool-run badges, research/tool status indicators. citation linkifier extracted to src/lib/riishe/citation-view.ts (unit-tested).
- Tests: 121 -> 170 (tools registry/permission/sandbox-real-execution/read_document/timeout, toolloop parse/loop-cap/permission-denial/real-result-feedback, search-mode resolution, least-privilege tool selection, digest build/failure/isolation, citation linkification, document extraction incl. REAL PDF, filename sanitization, document-borne injection gate). All pass.
- LIVE E2E (real preview origin, real gateway, real files): stable Q -> no search, streamed 391; TN CM Q -> 3 real queries, 6 real sources (2 page reads), VERIFIED_FROM_SOURCES, retrievedAt, citation audit passed, one 429'd query degraded honestly; Next.js-latest -> real sources + explicit staleness warning; sandbox sum-of-primes -> real 53ms execution, EXECUTION_VERIFIED, answer 129 (correct); no-opt-in sandbox -> honest denial then truthful answer; PDF/txt/csv upload 200 with real extraction; PDF QA quotes exact content; CSV total correct; exe -> 415 actionable; fake documentId -> 404; searchMode off -> no retrieval, no retrievedAt; searchMode on -> forced research on stable topic; document-borne injection -> injectionBlocked true, phrase never on wire; 26-turn conversation -> all 200, digest regenerated per overflow growth, recall "Teal" verified after prompt hardening; regenerate verified by message count; mid-stream client abort -> slot released, next turn fine; unauthenticated chat/upload -> 401. Caught+fixed en route: stale dev-server Prisma client (500s), pdfjs worker bundling (serverExternalPackages), digest placement/wording (model ignored system-context digest; answered "OK" from imperative history until digest prompt + memory framing made facts neutral), wrong make-test-pdf arg order (HTTP 000 was a bad file path, not a server bug).
- GATES: tsc --noEmit 0; bun test 170/0; eslint clean; next build success; UI browser-verified (controls render, GFM table cells, code block copy "Copied", zero page errors).

Stage Summary:
- RIISHE is now a genuinely tool-using assistant: deterministic search control, server-side tool registry over real capabilities (search/page-read/calculate/sandbox/documents) with bounded rounds and permission gates, real document analysis, digest-based long-conversation memory that survives context overflow, natural-language response quality, and full UI controls. Honesty invariants preserved end to end: states only from actual execution, tool failures degrade visibly, citations resolve only to really-retrieved sources, fabricated URLs stripped, injection gate covers user message AND attachments, auth/CSRF/rate-limits unchanged. Known limitations: digest costs one extra small model call per turn when overflow grows (fails honestly under gateway 429 pressure); tool-loop turns are buffered (no token streaming) to keep tool syntax off the wire; PDF scanned-image-only files honestly rejected (no OCR); eval coverage for the tool loop is unit+live but not part of the standing eval suite.
---
Task ID: riishe-final-research-quality
Agent: main (Z.ai)
Task: RIISHE final research-quality fix — source selection, publication-date verification, no unsupported allegations, structured synthesis, honest failures; acceptance query "Research a current topic: Gingee girl missing" (no UI redesign)

Work Log:
- ROOT CAUSES (measured, per requirement "evidence-based changes only"): (1) policy.ts treated "Research a current topic: X" as NO search — \bsearch\b cannot match inside "research", and no incident class existed, so an ongoing missing-person case answered from stale knowledge; (2) rank.ts had no gov.in/.nic.in official tier and no social-host class, so Facebook/YouTube posts competed with news on equal footing and Indian incident coverage was unclassified; (3) provider.ts trusted only the search engine's date field (often a crawl date) with no page-metadata extraction; (4) pipeline.ts had no deterministic newest-coverage query, so a query-gen failure left an ongoing case without a freshness probe; (5) orchestrator numbered pipeline sources AND tool-loop sources independently — the same URL from two rounds got two citation ids; (6) no prompt protocol forced summary->timeline->latest->open-questions structure or separated officially-confirmed facts from allegations.
- FIXES (12 files, +497/-49): policy.ts — "research/fact-check/investigate" count as explicit lookup; INCIDENT_PATTERNS (missing person, crime case, disaster) outrank generic explicit and yield recencyDays=180 risk=high; coding exclusion yields to incident signals. rank.ts — OFFICIAL tier gains .gov.in/.nic.in/.gov.au/.govt.nz/.gc.ca; REPUTABLE gains 15 established Indian outlets (The Hindu, IE, HT, NDTV, ToI, DH, TNIE, Dinamalar, Daily Thanthi, Mathrubhumi, Manorama, Eenadu, Sakshi, PTI, ANI); SOCIAL_HOSTS list + classifyHost() -> sourceType official|reference|news|social|other, social authority 0.2. provider.ts — extractPublishedTime() (JSON-LD datePublished > article:published_time/date/itemprop meta > <time datetime>, plausibility-gated, null when absent — never guesses). pipeline.ts — buildQuerySet() appends deterministic "<core topic> latest update" for sensitive cases and re-anchors drifted LLM queries to the core topic; page-read publishedTime OVERRIDES the search-engine date; evidence block marks SOCIAL MEDIA and undated sources ("do NOT claim it is recent"). orchestrator.ts — sensitive-case detection feeds prompt protocol; monotonic source-id allocator across tool rounds; dedupeSourcesByUrl()+remapCitationIds() collapse cross-pipeline duplicates and rewrite [n] markers through the same map; scanForUnattributedAllegations() gate with ONE bounded rewrite pass, residual flags degrade honestly; staleness surfaces as verification warning status. prompts.ts — RESEARCH_SYNTHESIS_PROTOCOL (1-3 sentence summary anchored to newest dated source; confirmed timeline; latest verified update with date; open questions only when evidenced; uncertainty stated ONCE; say plainly when no newer reporting exists) + SENSITIVE_CASE_PROTOCOL (official vs media vs allegation separation; no guilt/motive inference from social media; no uncharged-perpetrator naming; no sensational detail about minors/grieving families). builtin.ts web_search/read_url tools: dedup before numbering, allocateSourceId for multi-round uniqueness, official/social labels in tool output. states.ts/UI: verification status gains 'warning' (amber); sources render social badge + "(no date)" when undated with explanatory titles. Static welcome screen remains removed (Task A); greeting/facts answered by normal conversation flow only.
- TESTS: new tests/unit/research-quality.test.ts (acceptance-query classification, core-topic extraction, deterministic freshness query, gov.in/social classification + demotion, HTML date extraction incl. null-when-absent, staleness warnings, cross-pipeline dedup + citation remap, allegation scan pass/flag cases, prompt protocol composition) and research-quality-integration.test.ts (fixture SDK -> real orchestrator: freshness query, dedup+remap, official/social flags, sensitive rewrite, honest degradation). Suite: 197 pass / 0 fail (bun test).
- GATES: tsc --noEmit 0 errors; eslint clean (src+tests, 0 warnings); next build success.
- LIVE ACCEPTANCE (real gateway, real route /api/riishe/chat?stream=1, fresh account, 2026-10-28T16:00Z): "Research a current topic: Gingee girl missing" -> stages researching->solving->verifying; queries ["\"Gingee girl missing\" latest update today", "\"Gingee girl missing\" police statement", "\"Gingee girl missing\" official", + deterministic "Gingee girl missing latest update"]; answer structured exactly per protocol (summary; confirmed timeline Oct 11 disappearance / Oct 26 CB-CID transfer with citations; latest verified update dated Oct 26 2026; explicit "No newer reporting was found beyond this date"; unresolved questions); ZERO allegations against family/suspects — minister statements attributed and cited [1,2,3]; states [VERIFIED_FROM_SOURCES]; retrievedAt recorded; citation integrity PASSED; sensitive-case guard PASSED. Sources (6, ZERO duplicate URLs): thefederal.com (Oct 26 2026), thesamaja.com (2026-10-26, full page read), m.dailyhunt.in (2026-10-26, full page read), tamil.news18.com (undated), 2x facebook.com flagged social=True — the answer cites ONLY the three news sources for facts; social posts contributed nothing cited. Mid-run 2/4 searches + 1 page read hit gateway 429s and degraded HONESTLY in metadata (real error text preserved). Live regression on the same session: TN CM question retrieved lokbhavan.tn.gov.in ranked #1 (official=True, pageRead=True, dated Oct 16 2026) + tn.gov.in pages — answer "C. Joseph Vijay ... May 10, 2026 [1,5,6]" citing the official source; stable question "17 multiplied by 23" -> NO research stage, no retrievedAt, states [UNVERIFIED], 0.45s. All three assistant rows persisted with full metadata (DB verified).
- OUTAGE NOTE: the gateway 429'd EVERY request (chat AND web_search) for ~95 minutes before the acceptance run; probes confirmed the honest-failure paths end to end — streaming turns emit partial:true error event, usage recorded success:false BACKEND_FAILURE, retrieval failures surface as typed degraded entries ("web_search failed: ... 429").

Remaining limitations:
- Sustained gateway 429 pressure degrades research turns honestly but the NON-STREAMING JSON path still surfaces mid-turn 429s as generic 500 INTERNAL_ERROR (streaming path — used by the UI — is the honest one). Pre-existing behavior, intentionally preserved this task.
- No .gov.in/.police source surfaced in the Gingee top results (official-tier ranking exists; the retrieved set was news/social) — minister statements are therefore cited via news reporting, not primary government statements.
- Evidence set may include social-media sources (flagged social=True, demoted, labeled in-prompt) when coverage is thin; they are never cited for facts by the verified answers.
- One observed solver typo in an accepted answer ("no official cause or has been determined") — model-side grammar slip, not a pipeline defect; verification gates cover citation/allegation integrity, not prose grammar.
