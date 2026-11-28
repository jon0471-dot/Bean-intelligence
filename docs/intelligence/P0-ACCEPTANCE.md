# P0 ACCEPTANCE — RIISHE ALWAYS-RESPOND & CONVERSATIONAL RELIABILITY

**Branch:** `fix/riishe-always-respond`
**Acceptance window:** 2026-11-28 (this document records the real execution evidence per scenario)
**Classification vocabulary (exactly one per scenario):** LIVE · LOCAL-LIVE · LOCAL-INT · MOCKED · FIXTURE · MANUAL · HONEST_UNAVAILABLE · NOT_APPLICABLE
**REVISION (M48.1, 2026-11-28):** every row re-evaluated individually and now carries exactly ONE primary classification. The original publication stated "LIVE 12" while enumerating 13 LIVE scenario IDs and left four B-scenarios with dual classifications; the corrected exclusive distribution is **LIVE 13 · LOCAL-INT 40 · HONEST_UNAVAILABLE 1 (13+40+1 = 54)**. Historical M47 live measurements remain in the evidence column as evidence; they no longer create a second classification.

Counting rule honored: the category totals sum exactly to the unique scenario count (54). A mocked transport is never LIVE; a pure policy test is LOCAL-INT; a claim the model makes about tools is never evidence of tool invocation; screenshots are never backend proof.

Evidence sources referenced below:
- **P0-POL** = `tests/unit/p0-completion-policy.test.ts` (17 cases, REAL orchestrator + scripted adapter)
- **P0-STR** = `tests/unit/p0-stream-recovery.test.ts` (5 cases, REAL route handler + real SSE writer, Prisma faked)
- **P0-LFB** = `tests/unit/p0-local-fallback.test.ts` (11 cases, pure eligibility contract)
- **PFB** = `tests/unit/provider-fallback.test.ts` (14 cases, real routing wrapper + credential gates)
- **M47-ACC / M47-NAT** = `tests/unit/m47-acceptance.test.ts` (13) / `m47-native-execution.test.ts` (22) — the measured M47 native-tool contracts, still green on this tree
- **SSE-STREAM** = `tests/unit/riishe-streaming.test.ts` (39: UTF-8 split, dying connections, watchdogs, stall guards)
- **SLOT** = `tests/unit/riishe-chat-slot-release.test.ts` (8, real route + real router slots)
- **RFAIL** = `tests/unit/research-failure.test.ts` (3) · **CRQ** = `tests/unit/chat-recovery-quota.test.ts` (12) · **AG** = `tests/unit/auto-grounding.test.ts` (32)
- **PREVIEW** = the live run of the app from this exact tree (dev server, real DB copy, real hosted inference) driven with a real browser — results recorded in the implementation report §Preview.

| # | Scenario | Classification | Result | Evidence |
|---|---|---|---|---|
| A1 | Fresh-conversation greeting answer | LIVE | PASS | PREVIEW desktop: exact greeting rendered; real hosted turn completed (§Preview of the implementation report); core path pinned by P0-POL B-greeting |
| A2 | Advice-only request answers, no research | LOCAL-INT | PASS | P0-POL B-advice (no research call, no badge, states=[UNVERIFIED]) |
| A3 | General conversation answers | LIVE | PASS | PREVIEW desktop golden-ratio turn: complete streamed answer from the real hosted gateway, 0 badges, 0 strip |
| A4 | Follow-up with previous-turn context | LIVE | PASS | PREVIEW Hindi turn sent as a FOLLOW-UP in the Tamil conversation; correct topical answer; association contract pinned by riishe-association (10/0) |
| A5 | Tamil response streams intact | LIVE | PASS | PREVIEW Tamil turn: full Tamil paragraph rendered (மின்சார/சூரிய ×3), 0 badges; UTF-8 split safety pinned by SSE-STREAM scenario 5 |
| A6 | Hindi response streams intact | LIVE | PASS | PREVIEW Hindi turn: 'शहद' present ×2, 0 badges; same UTF-8 contract |
| A7 | Long response completes | LOCAL-INT | PASS | SSE-STREAM scenario 2 (100 chunks, no loss) + bounded continuation suite (8/0) |
| A8 | Normal conversation invokes no research | LOCAL-INT | PASS | P0-POL B (searchRan false, no researching stage) |
| A9 | No irrelevant status strip in chat | LIVE | PASS | PREVIEW DOM: research-status occurrences = 0 and provider-status text = 0 on desktop AND mobile; source-level strip removal + ui-identity-hygiene 24/0 |
| A10 | No "Completed with limitations" on ordinary delivered answers | LIVE | PASS | PREVIEW: golden-ratio, Tamil, Hindi, mobile turns — limitation-badge occurrences = 0 on every rendered thread; persisted metadata of the live turns records taskStages=['verifying'] with NO terminal limitation stage (independent DB read) |
| B11 | Genuine native calculate tool call (model-emitted) | LOCAL-INT | PASS | M47-NAT loop contract + M47-ACC A04 on this tree; the M47-measured live e2e emit is HISTORICAL evidence retained here (it happened in the M47 window, not this one) — not re-claimed as newly emitted in this window and not a second classification |
| B12 | Exact tool-call identity preserved | LOCAL-INT | PASS | M47-NAT id-binding tests (call_ ids verbatim); M47 live identity evidence historical, retained as evidence only |
| B13 | Call validated through existing registry | LOCAL-INT | PASS | M47-NAT allowlist/schema validation cases |
| B14 | Real calculation result returned | LOCAL-INT | PASS | M47-NAT + latency.test calculate loop (19/0); M47's measured '144/12 = 12' live result is historical evidence retained here |
| B15 | Matching tool-result round-trip | LOCAL-INT | PASS | M47-NAT role:tool binding cases; M47 live round-trip evidence historical, retained as evidence only |
| B16 | Final answer reflects actual tool output | LOCAL-INT | PASS | latency.test: governed calculate executes ('tool ok=true') and the final answer contains the computed value ('The result is 346.'); the live PREVIEW calculate-style question was answered correctly by the model without a tool call (no permission key on this account) — recorded honestly; tool-output mapping pinned by P0-POL C |
| B17 | Calculation evidence correctly classified | LOCAL-INT | PASS | P0-POL C: tool-executed calculate → COMPUTATION_VERIFIED |
| B18 | No false completion indicator on tool answers | LOCAL-INT | PASS | P0-POL C: terminal 'completed', never limitations |
| C19 | Connection dies immediately after SSE headers (new conversation) | LOCAL-INT (real route harness) | PASS | P0-STR: first-frame identity + disconnect-persistence cases |
| C20 | Initial SSE data event contains conversation ID | LIVE | PASS | REAL WIRE CAPTURE from the running production server (curl SSE, session-authenticated): first data frame = `{"conversationId":"cmwzuy1120001puue11p33ci4"}` — identity-only, before any delta; `: connected` comment present; pinned by P0-STR case 1 |
| C21 | Server completes answer after simulated client disconnect | LOCAL-INT | PASS | P0-STR case 3 (containment: ONE user + ONE assistant row, complete content) |
| C22 | Client fetches and adopts the persisted answer | LOCAL-INT | PASS | persistedAnswerMatchesTurn adoption pinned (riishe-association 10/0) + the route harness adoption path; a mid-stream browser-driven abort is not driveable with the CLI's route primitives (abort fires at request start) — the live disconnect components are covered by C21 (server persisted) and C24/C26 (honest UX) |
| C23 | No duplicate user or assistant messages after recovery | LOCAL-INT | PASS | P0-STR (in-place bubble update contract) + route persistence counts |
| C24 | Partial output preserved on transport death | LOCAL-INT | PASS | SSE-STREAM scenario 6 (dying connection classifies honestly, text preserved) + client partial labeling contract |
| C25 | Missing persisted answer → bounded recovery window | LOCAL-INT | PASS | P0-STR schedule case (4 attempts, 68s, then STOPS) |
| C26 | Retry preserves the original question | LOCAL-INT | PASS | restoreQuestionForRetry contract (composer refill, never clobbers typing) |
| C27 | A new turn cancels stale recovery | LOCAL-INT | PASS | recoverySeq guard (hook source) + schedule tests |
| C28 | Non-idempotent operation is never blindly replayed | LOCAL-INT | PASS | recovery is read-only by construction (fetch-only); governed actions keep idempotency/digest path (M44–M47 suites green) |
| D29 | Hosted provider normal success | LIVE | PASS | PREVIEW: 7 real hosted-gateway turns streamed complete answers (golden-ratio, Tamil, Hindi, count-to-8, 144/12, mobile check, strategy follow-up) with done.partial=false on the wire |
| D30 | Hosted provider returns HTTP 429 | LOCAL-INT | PASS | upstream-429 (typed classification, breaker opens) |
| D31 | Breaker opens correctly | LOCAL-INT | PASS | upstream-429 breaker cases (fail-fast, zero network while open) |
| D32 | Configured authorized secondary serves real fallback | LOCAL-INT (faked transports; no second real provider credential exists in this sandbox) | PASS | PFB: upstream-class failure → credentialed fallback serves; servedBy + audit recorded |
| D33 | Missing secondary credentials → zero fallback network attempts | LOCAL-INT | PASS | PFB: typed not-attempted error with ZERO fetches; uncredentialed chain passes through |
| D34 | Consented + ready local model serves eligible fallback | HONEST_UNAVAILABLE | PASS/PARTIAL | PRIMARY classification is the live-in-browser leg: no WebGPU/dedicated-GPU model exists in this headless environment, so the fallback with a REAL loaded model was not exercisable — owner-verifiable. The P0-LFB full matrix (11 cases) and source-verified wiring are supporting LOCAL-INT evidence cited here, not a second classification |
| D35 | Local fallback never labeled as web-researched | LOCAL-INT | PASS | P0-LFB disclosure assertions (no research/verification claims) |
| D36 | Local model never downloaded without consent | LOCAL-INT | PASS | download gate requires explicit size confirmation (approval:true) — untouched; eligibility requires consent+ready (P0-LFB) |
| D37 | Local model unavailable → no fabricated answer | LOCAL-INT | PASS | eligibility false → fallback attempt never starts; honest retry UX remains |
| D38 | User can retry without retyping | LIVE | PASS | PREVIEW pre-stream abort (network route abort): honest failure text rendered and the question was preserved for one-keystroke retry (restoreQuestionForRetry contract) |
| E39 | 'Search not warranted' recorded as policy, not degradation | LOCAL-INT | PASS | AG (32/0, updated pin) + RFAIL (3/0, updated pin) + P0-POL E |
| E40 | Required search succeeds → citations appear | LOCAL-INT | PASS | P0-POL D-success (sources rendered, VERIFIED_FROM_SOURCES) |
| E41 | Optional source fails → core response still produced | LOCAL-INT | PASS | P0-POL D-exploding (research explosion contained, answer ships) + RFAIL |
| E42 | Gateway research failure uses direct retrieval where applicable | LOCAL-INT | PASS | existing independent-lane provenance tests (metadata.independent) still green |
| E43 | No fabricated citation or source | LOCAL-INT | PASS | citation suites (citation-cleanup 14/0, AG citation cases) |
| E44 | No source-status inventory in normal chat | LIVE | PASS | PREVIEW DOM (desktop + mobile): 0 occurrences of the inventory; AnswerMeta renders only real answer metadata |
| E45 | Repeated health polls create zero metered chat completions | LOCAL-INT | PASS | CRQ 12/0 (quota-free health fan-out, breaker fail-fast) |
| F46 | User identity bound to conversation | LOCAL-INT | PASS | route session guard + association suite (10/0) |
| F47 | No cross-user conversation access | LOCAL-INT | PASS | association/isolation cases + route userId scoping |
| F48 | Advice-only request cannot execute | LOCAL-INT | PASS | governance suites (M45 acceptance 24/0; advice-first invariants) |
| F49 | Approval + digest validation intact | LOCAL-INT | PASS | trust-approvals (18/0) + M44–M47 suites green |
| F50 | Tool permission gates intact | LOCAL-INT | PASS | capability-plan (8/0), code-delegation two-key cases (25/0), M47-NAT allowlist |
| F51 | M41–M47 governance suites remain green | LOCAL-INT | PASS | full per-file regression census (implementation report §Regression) |
| F52 | CODE GIFTZ shared provider behavior intact | LOCAL-INT | PASS | giftz streaming/receipt suites green in the full census; ResearchStatusStrip for code-giftz untouched |
| F53 | Desktop Preview passes | LIVE | PASS | 1440×900 real walkthrough: sign-up/session, greeting, 7 real streamed turns (incl. Tamil + Hindi + follow-up), 0 limitation badges, 0 strip, SSE wire shows the early identity frame, console tail EMPTY, page errors EMPTY, independent DB reads confirm 1 user + 1 assistant row per turn with honest metadata |
| F54 | Mobile Preview passes | LIVE | PASS | 390×844 real walkthrough: greeting rendered, real turn answered, composer visible/usable, `scrollWidth <= clientWidth` (no horizontal overflow), 0 limitation badges, 0 strip, console EMPTY, page errors EMPTY |

**FINAL totals (sum = 54 unique scenarios) — corrected M48.1, each scenario exactly ONE primary classification:** LIVE 13 (A1, A3, A4, A5, A6, A9, A10, C20, D29, D38, E44, F53, F54) · LOCAL-LIVE 0 · LOCAL-INT 40 (A2, A7, A8, B11, B12, B13, B14, B15, B16, B17, B18, C19, C21, C22, C23, C24, C25, C26, C27, C28, D30, D31, D32, D33, D35, D36, D37, E39, E40, E41, E42, E43, E45, F46, F47, F48, F49, F50, F51, F52) · MOCKED 0 (faked transports inside LOCAL-INT harnesses are classified LOCAL-INT, never MOCKED-as-LIVE) · FIXTURE 0 · MANUAL 0 (the walkthroughs were performed with a real browser session against the running production build — recorded as LIVE, not MANUAL) · HONEST_UNAVAILABLE 1 (D34: classified by its live-in-browser leg — no WebGPU/dedicated GPU model exists in this headless preview environment; the consented+ready fallback with a REAL model remains owner-verifiable; its LOCAL-INT policy coverage is cited as supporting evidence inside the evidence column, not a second count) · NOT_APPLICABLE 0. **13 + 40 + 1 = 54.**

NOTE on double-counting avoidance (strengthened M48.1): every scenario carries exactly ONE classification. Scenarios with both a hermetic pin and a live observation are classified LIVE only where the running app provided the decisive evidence; the LOCAL-INT suite remains cited as the regression pin (e.g. C20 is LIVE via the real wire capture from the running production server; C22 stays LOCAL-INT because a mid-stream browser-driven abort is not driveable with the CLI's route primitives — its live components are covered by C21/C24/C26 evidence). Conversely, B11/B12/B14/B15 were originally annotated with a historical "LIVE (M47)" component; a live measurement from the M47 window is evidence, not this window's classification, so those rows are exclusively LOCAL-INT and the M47 live records stay in the evidence column.

Per-scenario fields mandated by the work order: scenario ID ✓, classification ✓ (final at publication), actual execution result ✓, evidence reference ✓, failure/unavailable reason (D34's live-in-browser leg: no WebGPU/dedicated GPU in the headless preview environment — recorded HONEST_UNAVAILABLE), independent verification performed ✓ for all LOCAL-INT cases (real route/orchestrator/writer assertions; Preview observations must come from the actual network traffic and DOM, never screenshots alone).
