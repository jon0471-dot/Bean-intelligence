# RIISHE — Final Preview Acceptance Test Results

- **Date**: 2026-11-03, 02:53–03:16 UTC
- **Target**: `https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai` (public preview domain)
- **Method**: No production code modified. HTTP/SSE suite over the public preview domain (harness: `scripts/preview-acceptance.py`, evidence: `scripts/preview-acceptance-out/`), plus a real headless-browser pass for console/network evidence.
- **Verdict**: ❌ **Overall acceptance NOT claimed complete** — the preview in its normal (default-route) form is unavailable (502). Functional backend suite: **6 / 9 PASS**. One environmental root cause explains all three failures.

## Blocking environment finding

| Probe | Result |
| --- | --- |
| `GET /` (default preview route) | **HTTP 502** — platform placeholder page (Z logo, auto-reload) |
| `GET /api/health` (default route) | **HTTP 502** |
| `GET /api/health?XTransformPort=3100` (steered) | **HTTP 200** `ok:true` |

**Root cause chain (measured, not assumed):** platform ingress → sandbox ingress `:81` default handle → `localhost:3000` → **nothing listening** (dev server dead since ~01:48 UTC; `dev.log` last write `2026-11-03T01:48:03Z`; `localhost:3000` refuses connections). The 02:20:22 UTC platform restart started the **production standalone build** (`bun server.js`, PID 4822) on `127.0.0.1:3100` — healthy — but the ingress default still targets `:3000`. Restoring the preview requires a **platform-side action only** (restart that brings the app onto the ingress default target, or re-point the ingress default to the live instance). No process was started/killed/signaled and no ingress config was touched, per platform rules.

**Browser-level confirmation (headless Chromium):** default route renders the platform placeholder; even the steered URL loads correct HTML (`<title>BEAN Intelligence — Brand-Owned AI Platform</title>`) but every in-app asset/XHR (which omits the steering param) fails: network log shows **all `/_next/static/*` chunks, fonts, CSS → 502** → page cannot hydrate. Screenshots: `browser-default-route.png`, `browser-steered-home.png`.

## Item-by-item results

| # | Item | Result | Exact evidence |
| --- | --- | --- | --- |
| 1 | Application homepage loads | **FAIL (default route)** | Default route: HTTP 502 (placeholder). Steered to live instance: HTTP 200, 9,964 bytes, correct title, BEAN/RIISHE markers present. |
| 2 | `/api/health` | **FAIL (default route)** | Default route: HTTP 502. Steered: HTTP 200, `ok:true`, `live:true`, `riishe.available:true` (live completion probe), research probe live (`web_search`, 1 result). |
| 3 | Open existing RIISHE conversation | **PASS** (on the serving instance) | Conversation list: HTTP 200 — 16 conversations / 32 messages. Opened existing conversation `cmw02vp7k0017qapy175j01r5` (FIFA 2026 final eval thread): detail HTTP 200, full 2-row history returned. |
| 4 | Normal prompt — complete streaming | **PASS** | SSE HTTP 200; 8 deltas / 22 chars; first token 726 ms; `done` event with `partial:false` + `messageId` + `durationMs:730`; no premature EOF; no error frames. |
| 5 | Long response — no silent termination | **PASS** | 1,906 deltas / 9,023 chars over 18.7 s; continuous token arrival (first content 1.6 s → last 18.7 s; **max inter-frame gap 0.79 s**); `done partial:false`; no premature EOF. |
| 6 | Tamil Unicode output | **PASS** | 213 deltas / 247 chars; **217 Tamil codepoints** streamed; zero U+FFFD replacement chars. |
| 7 | Final answer persisted correctly | **PASS** | 3/3 turns byte-exact: streamed == persisted (22==22, 9,023==9,023, 247==247 incl. 217 Tamil chars). |
| 8 | Browser console / network errors | **FAIL (preview-path)** | All failures are the 502 ingress issue (assets + API on non-steered URLs). On the working path: **zero SSE error frames, zero unexpected HTTP statuses**; SSE headers correct (`text/event-stream`, `cache-control: no-cache, no-transform`). |
| 9 | Existing conversation history intact | **PASS** (on the serving instance) | 16 → 18 conversations (only +2 new from this test); all 16 pre-existing still present; opened conversation's old rows **byte-identical**, only appended (2 → 4 rows). Real DB `db/custom.db` untouched (mtime 01:36 UTC, predates tests). |

## Honest scope caveats

1. **Items 3–9 ran against the live production instance** (`bun server.js` on `:3100`, started by the platform 02:20:22 UTC) **addressed through the real public preview domain** — the same ingress and the same instance the preview would serve, but reached via the ingress' steering query (`?XTransformPort=3100`), not the default route.
2. **Database isolation**: that instance is process-env-wired to the E2E copy `scripts/e2e-verify-out/verify.db` (proven by mtime: `verify.db` written exactly during the test window 03:11:38Z; `db/custom.db` untouched since 01:36). So "existing conversation" = existing on the serving instance's DB; the real user database was provably **not exercised** (and remains intact).
3. **Server-side stdout** of the platform-started instance is not readable from this shell; error evidence is HTTP/SSE-level (complete for the tested path).
4. **Audited 02:37 run's "PERSIST FAIL" (t2) reconciled**: the raw `t2-long.sse` contains exactly **1 reset event** (verification rewrite); the old harness double-counted across the reset. Reset-aware accounting matches the persisted row — re-confirmed independently by this run's reset-aware parser (0 resets in all three live turns, exact persistence).

## Unblocking step

Platform-side only: restart the preview so the app listens on the ingress' default target (`:3000`), or re-point the ingress default to the live `:3100` instance. Then re-run `python3 scripts/preview-acceptance.py` — the default-route probes will flip to 200 and all 9 items can go green on the normal preview path.
