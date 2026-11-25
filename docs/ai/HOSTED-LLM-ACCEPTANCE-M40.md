# M40 — HOSTED LLM ACCEPTANCE (provider evidence, verbatim)

> Branch: `feat/m40-real-hardware-capability-completion` · Window: 2026-11-24 → 2026-11-25 (M40 → M40.9)
> Companion docs: `docs/ai/MODEL-EXECUTION-MATRIX-M39.md` §2 (the prior same-day hosted verification), `docs/M40-IMPLEMENTATION-REPORT.md`, `docs/M40.9-FINAL-ACCEPTANCE-REPORT.md`.
> Governing rules honored: never report a provider-generated response as successful model execution when the provider was unavailable; never bypass the 429 circuit breaker; no key rotation, no rate-limit evasion, no additional accounts, no paid fallbacks; unavailable evidence is preserved verbatim with exact reasons.

## 1. Evidence chain at a glance

| Window | Upstream state | Hosted-LLM verdict | Where recorded |
|---|---|---|---|
| **M39 same-day runs — 2026-11-24** | provider healthy | **Real PASS**: 26/26 incl. RIISHE chat + CODE GIFTZ generation + sandbox execution | `MODEL-EXECUTION-MATRIX-M39.md` §2 |
| **M40 window — 2026-11-25 morning (m40.5/m40.6)** | sustained upstream **429** the whole window | **Honest unavailable**: breaker refused further calls "to avoid worsening the throttle"; 8 PASS / 4 honest-null / 0 FAIL, every null carries the exact 429 reason | `product-e2e-m40.json` (m40.6), `MODEL-EXECUTION-MATRIX-M40.md` |
| **M40.9 first attempt — 2026-11-25 15:55 UTC** | upstream **still 429** on genuine attempts | **Honest unavailable**: real 429s observed (chat, web_search, TTS classes) → breaker opened → subsequent calls honestly skipped | this doc §2, dev-log lines quoted verbatim |
| **M40.9 recovery attempt — 2026-11-25 16:00–16:04 UTC** | **provider recovered** | **Real PASS with validated execution**: RIISHE chat + grounded QA + CODE GIFTZ generation + real sandbox execution, all task-validated | this doc §3, `out/product-e2e-m40.json` |

The hosted-LLM acceptance is therefore **VERIFIED REAL for this window** (§3) —
after a recovery re-run performed strictly through the breaker's own natural
cooldown, never by bypassing or resetting it.

## 2. M40.9 first attempt: real 429s observed, breaker behavior measured (15:55 UTC)

Fresh dev server (breakers closed by construction — in-process state), provider
availability inspected first via `/api/health` (all products "operational" at
that moment — reachability-only; the breaker is derived from REAL attempts).
The acceptance lanes then made REAL calls and the upstream returned real 429s:

- chat class — `API request failed with status 429: {"error":"Too many requests, please try again later"}` (thrown through `orchestrateTurn`, `src/lib/riishe/orchestrator.ts:491`);
- functions/web-search class — `Function invoke failed with status 429: {"error":"Too many requests, please try again later"}`; GIFTZ degraded honestly: "documentation retrieval unavailable (web_search is rate-limited upstream …); answering from model knowledge — no source is claimed";
- TTS class — `API request failed with status 429` (same verbatim body).

The breaker then opened and every subsequent chat-class call was refused
without a network request (recorded verbatim, with job ids):

```
15:55:53.105Z engine.riishe_chat_failed  jobId cmwwb2fa8000cl2j71kpuoumn code=UPSTREAM_RATE_LIMITED
  "chat completion not attempted: upstream gateway is rate-limited (HTTP 429 observed moments ago); call skipped to avoid worsening the throttle"
15:55:55.868Z engine.riishe_chat_failed  jobId cmwwb2id9000zl2j7pte1pnj8 code=UPSTREAM_RATE_LIMITED  (same message)
15:55:58.997Z engine.giftz_coding_failed jobId cmwwb2kjd001ql2j7xx80thda code=UPSTREAM_RATE_LIMITED  (same message)
```

The health surface derived the honest product states from this real evidence
(`riishe: rate-limited`, `code-giftz: rate-limited`, local lanes operational)
— the refusal is the breaker working as designed, not an outage of BEAN code.

## 3. M40.9 recovery attempt: provider recovered — REAL hosted execution validated (16:00–16:04 UTC)

Cooldown policy: `60s × 2^(streak−1)`, capped at 600 s
(`src/lib/upstream/gateway.ts`). After waiting past the natural cooldown
window (first 429 15:55:34 → re-run started ≈16:00), the SAME acceptance was
re-run (`--only riishe-chat,giftz --merge`) — the breaker's next real call is
the designed recovery verification, so **no breaker bypass, no cooldown reset,
no credential change** occurred. Result — the provider had recovered:

| Lane (backend `bean-llm-hosted-primary` / `bean-code-llm-hosted-primary`) | ok | Validated execution evidence |
|---|---|---|
| `riishe.text-generation` | **PASS** | real chat completion; persisted answer: **"The capital of France is Paris."** — content-validated, not just HTTP 200 |
| `riishe.document-understanding` | PASS | text extraction persisted (125 chars, `ready`) |
| `riishe.document-grounded-qa` | **PASS** | grounded answer persisted: **"Lisbon hosts the offsite, and the budget code is BX-77."** — BOTH planted facts recovered correctly from the attached document (content-level validation of grounding, not just a response) |
| `code-giftz.code-generation` | **PASS** | real coding job completed (project `cmwwbcqxe006il2j7v8lyodbb`) |
| `code-giftz.project-delivery` | **PASS** | `fizzbuzz.py` delivered with real FizzBuzz code |
| `code-giftz.sandbox-execution` | **PASS** | **REAL sandbox run, exit 0, no timeout**, stdout verified as the correct sequence for 1..15: `1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz` |

Machine-readable evidence: `scripts/m40-acceptance/out/product-e2e-m40.json`
(summary at capture time: 13 PASS / 1 honest-unavailable / 0 FAIL — the one
null being the prior-window JAZMII T2V record, refreshed by the full M40.9
regression). Post-run `/api/health`: all five products back to `operational`.

## 4. Rules compliance record

- The circuit breaker was **never bypassed**: the recovery attempt waited for
  the breaker's own cooldown to lapse; the breaker then admitted the call by
  design. No env knob, no code path, no timing trick forced a call through.
- No key rotation, no provider-hint evasion, no additional accounts, no paid
  fallback, no retry storm (two acceptance runs total, separated by the
  cooldown window; per-lane single attempts inside each run).
- The first attempt's 429 evidence is PRESERVED above verbatim — the window
  boundary between "unavailable" and "verified" is explicit (15:55 vs 16:04
  UTC), and no earlier null was retroactively upgraded: lanes re-ran and their
  records were replaced by the runner's own `--merge` semantics.

## 5. Honest scope statement

- This verifies the **hosted chat + hosted coding + document-grounding lanes**
  (`riishe-chat`, `giftz`) in this window. The hosted video lane (JAZMII T2V)
  has its own provider and its own throttle history — it is classified by the
  M40.9 full regression (`docs/M40.9-FINAL-ACCEPTANCE-REPORT.md`), never by
  this chat-class recovery.
- A provider outage can recur at any time; the acceptance contract is that
  BEAN degrades honestly and recovers without operator intervention — both
  now demonstrated in the same window (§2 refusal → §3 recovery).
