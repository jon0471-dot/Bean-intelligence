# W6 LIVE ACCEPTANCE — 2026-11-05 (GO-LIVE FINALIZATION)

## Verdict

| Mode | Result | Artifact |
| --- | --- | --- |
| W6 **local** evaluation | **PASS** — ground truth 4/4 executed, order-focus detection 8/8, verifier-report contract 8/8 | `scripts/giftz-verify-out/w6-eval-local-1793850167660.json` (fresh this session) |
| W6 **live** evaluation | **BLOCKED today** — the documented live mode was executed and exited its bounded gateway wait with **zero attempts burned and nothing fabricated** | no live-run artifact (by design: one is written only by a completed live run) |

**Benchmark claim: unchanged and honest.** Previous live best remains **66/67**
(`docs/reports/W6-ACCEPTANCE-REPORT.md`, single miss analyzed and fixed in code since). A "67/67"
claim is only ever produced by a completed live-run artifact — none exists today, so none is made.

## What was executed (existing documented command, no new commands, no bypassed checks)

```
bun scripts/giftz-w6-eval.ts live 300
```

Live mode behavior (existing contract, verified again this session): spawns the isolated `:3100`
instance with `BEAN_VERIFY_ENABLED=true`, waits a BOUNDED 300 s for the gateway chat class to probe
healthy, then either runs the case set through the REAL product chat route (verification enabled,
compared against the W1–W5 baseline) or exits BLOCKED. Measured output this session:

```
gateway still throttled/unavailable (120/300s)…
gateway still throttled/unavailable (270/300s)…
GATEWAY NEVER HEALTHY — live W6 eval skipped (zero attempts burned, nothing fabricated)
```

## Why live was blocked (measured, not assumed)

The shared provider account's chat class — the same class RIISHE and CODE GIFTZ ride — has been
returning HTTP 429 to every real probe since **2026-11-05T01:27:41Z** through at least
**05:32:58Z** (51 consecutive observed 429s at the 600 s escalation cap; telemetry in
`/api/health` → `gateway.breaker`). The W6 live mode's gateway gate correctly refused to burn a
single case attempt into a throttling gateway. This is the same blocker documented in
`GO-LIVE-FINALIZATION.md` §1 and `GO-LIVE-CAPABILITY-MATRIX.md`.

## Self-verification loop status (unchanged by this session)

The W6 self-verification closed loop — generation → independent verification → comparison →
correction → re-verification — is implemented and verified locally: real execution in local mode,
malformed verifier replies never guessed into passes, corrections cycle, final test execution. The
live leg of the loop (actual provider execution end-to-end) awaits provider recovery.

## Re-run (when the provider becomes available)

```bash
bun scripts/giftz-w6-eval.ts live 900   # bounded gateway wait; BLOCKED(2) if still throttled
```

A completed run writes `scripts/giftz-verify-out/w6-eval-live-<ts>.json` with per-case checks,
verification statuses and corrections, and prints the order score. Only that artifact may update the
benchmark claim.
