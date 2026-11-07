# BEAN — Real Model Acceptance Record

> Truth contract: a capability is operational **only** with real successful acceptance evidence. Mock output never counts. Throttled/unavailable attempts are recorded as what they are. Last update: 2026-11-07.

## 1. Background AI ENGINE — infrastructure acceptance (2026-11-07)

Run: `scripts/ai-engine/acceptance.ts` → `scripts/ai-engine/out/acceptance-results.json`

| Step | Result | Evidence |
|---|---|---|
| auth (register+login) | **PASS** | HTTP 200 |
| RIISHE background submit | **PASS** | HTTP 202, persistent job id `cmw6234zh…` returned immediately |
| RIISHE job execution | **honest-unavailable** | ended `failed`/`rate_limited` — sustained account-wide 429 throttle window; **exactly ONE upstream attempt, zero retries** (429 protocol) |
| CODE GIFTZ background submit | **PASS** | HTTP 202, job id returned |
| CODE GIFTZ job execution | **honest-unavailable** | same throttle; single gated attempt, breaker fail-fast recorded |
| LAXII t2i via product route (engine-claimed) | **PASS** (submit) + **honest-unavailable** (render) | HTTP 202 → `failed`/`rate_limited` with the honest throttle message |
| JAZMII t2v submit | **PASS** (submit) + **honest-unavailable** (render) | single gated attempt, 429-safe |
| duplicate-submission guard | **PASS** | identical active payload rejected (HTTP 429 `CONCURRENCY_LIMIT`) |
| cancel | **PASS** | queued job settled `cancelled` immediately |
| owner-scoped history | **PASS** | 5+ jobs retrievable |

**Restart survival (Phase 8 background test) — PROVEN LIVE 2026-11-07 07:03Z** (`scripts/ai-engine/restart-survival.ts`):

1. job `cmw624mst…` submitted → status `queued`;
2. **server process killed** while the job was queued;
3. server restarted (preview supervisor);
4. embedded engine boot recovery claimed the orphaned job;
5. job executed (single honest upstream attempt) and settled `failed`/`rate_limited`.

The job crossed a process death and was executed afterwards — background execution independent of the browser session and of process lifetime.

**Engine unit acceptance**: 17 dedicated tests (CAS claims, lease/heartbeat, retry policy — rate_limited never retried — cancel settlement, recovery takeover, event-log monotonicity, dedupe, legacy status normalization). Full regression: **1102 pass / 0 fail / 70 files**. Stress probe: 40/40 claim→fail cycles clean (`scripts/ai-engine/stress-probe.ts`).

**UI acceptance**: Background-jobs drawer exercised in the browser (`scripts/ai-engine/out/ui-*.png`): submit from the drawer → job listed live → honest per-job status/error display.

## 2. Product capability evidence (cumulative)

| Product / capability | Status | Real evidence |
|---|---|---|
| RIISHE live chat (streaming, multilingual, research, persistence) | **OPERATIONAL** (throttled during throttle windows) | prior acceptance runs with real streamed answers, Tamil conversations, persisted threads (see prior session reports + `scripts/finalcap-out/`); current runs single-attempt-429 during the sustained throttle |
| RIISHE **background** chat + retrieval after restart | **ENGINE OPERATIONAL**; model run recorded honestly during throttle | submit→restart→settled flow above; answer persistence path identical to the live route (shared orchestrator + persistence code) |
| LAXII text-to-image | **OPERATIONAL** (real artifacts on record: `storage/laxii/…`, prior acceptance 2026-11-04, JPEG magic verified) | currently throttled — single attempts recorded |
| LAXII deterministic enhancement + preservation edit | **OPERATIONAL** | prior acceptance runs |
| LAXII masked generative editing (local Diffusers) | **UNAVAILABLE** (no GPU on this host — honest) | worker code complete, preflight/license gates in place; enablement requires GPU-host acceptance |
| JAZMII T2V + I2V | **OPERATIONAL** (real MP4 artifacts + verified magic bytes, 2026-11-04 evidence) | currently throttled — single attempts recorded |
| CODE GIFTZ coding chat + real sandbox execution | **OPERATIONAL** (prior real code artifacts + verified FizzBuzz-style executions) | currently throttled — single attempts recorded |
| CODE GIFTZ background coding | **ENGINE OPERATIONAL**; model run honestly recorded during throttle | shared turn core (continuation + verification + file extraction) unit-tested; submission/execution/terminal paths proven live |
| Local llama.cpp GGUF chat lane | **IMPLEMENTED, DORMANT** (no llama-server configured here) | adapter + registry + credential resolution live; activation = operator starts llama-server (WORKER-OPERATIONS.md); health verifies a real completion before serving |
| Local Diffusers / Wan 2.2 TI2V-5B | **UNAVAILABLE** (no GPU host wired) | honest registry entries + GPU plan |

## 3. Honesty rules honored in this record

- Every non-pass is labeled what it is (`honest-unavailable`), with the provider's real cause.
- Zero retry loops against throttled endpoints anywhere in the engine (enforced in code: `rate_limited` is terminal; breakers open; all fallbacks credential-gated).
- No mock output counted as model acceptance (mocks are used only in infrastructure unit tests).
- Provider/model identities stay server-side; no API keys in browser code; no purchases made.
