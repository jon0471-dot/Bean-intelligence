# M45 — Verification and Recovery (docs/intelligence)

## Independent verification (preserved and extended)

M44's rule is untouched: **success cannot be declared before an independent postcondition verdict** — `EXECUTING → SUCCEEDED` remains structurally illegal; only `VERIFYING` with `confirmed` opens `SUCCEEDED`.

M45 adds the observation gatherers for the new real paths:

| Action | Independent method | Postcondition |
| --- | --- | --- |
| `repo-commit` | commit GET after creation | `commit-present` (sha resolved at runtime from the adapter's independent evidence) |
| `repo-push` | `git ls-remote` (different transport than the write) or ref GET | `remote-ref-equals` |
| `repo-pull-request` | PR GET (identity + state + head) | `value-equals pullRequestState=open` |
| `repo-inspect` / `deployment-inspect` | bounded idempotency ledger | `no-duplicate-effect` |
| `deployment-release` | independent health probe of the deployed revision | `health-ok` |
| `deployment-inspect health` | REAL HTTP probe; unhealthy ⇒ healthy=false; unreachable ⇒ null | never auto-confirmed |

`runtimeVerificationContract` stamps execution-time values (commit sha, PR state) into the postconditions **from the adapter's independent evidence only** — an unverified execution keeps its placeholder, which then fails or stays inconclusive honestly. A write whose independent read disagrees is recorded UNVERIFIED and its verdict fails.

## Failure classification and recovery (M44 recovery module, exercised conversationally)

- Failures classify as `transient | permanent | authorization | verification` (`classifyFailure`); retries are bounded by the contract's retry policy and allowed ONLY for transient failures.
- Cancellation voids every gate state at the next check; the audit trail preserves exactly what ran.
- Inconclusive verification ⇒ `RECOVERY_REQUIRED` — never silently converted to success.
- Conversational surfaces: `explain_outcome` reports customer-safe explanations per state (Blocked = "refused before running", Failed = the honest reason, Recovery required = "needs recovery, not counted as a success").
- The M43 knowledge guard stands: unverified execution observations never become trusted knowledge; the M44 policy self-modification guard still refuses any action that tries to modify safety policy or grant permissions.

## Honest unavailability as a first-class outcome

Every adapter distinguishes `executed / failed / honest-unavailable`. Provider rate limits (GitHub 403/429), missing credentials (GitHub token, deploy token), missing providers (deployment history) are unavailabilities with truthful reasons — never failures of the target system and never success-shaped responses.
