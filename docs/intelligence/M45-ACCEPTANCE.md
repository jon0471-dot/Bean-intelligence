# M45 — Acceptance (docs/intelligence)

Suite: `tests/integration/m45-acceptance.test.ts` (24 scenarios) + unit suites `m45-decision-governance.test.ts` (23), `m45-repository-adapter.test.ts` (20), `m45-deployment-adapter.test.ts` (12). Exact counts of the final full runs live in `docs/M45_IMPLEMENTATION_REPORT.md`.

## Classification vocabulary

- **[LIVE]** — real external network integration.
- **[LOCAL-LIVE]** — real local processes/HTTP/fs; no external network.
- **[LOCAL-INT]** — real modules over fake Prisma delegates.
- **[MOCKED]** — injected transport; no network at all.
- **[MANUAL]** — performed outside the suite; recorded in the report.

## Scenario → classification → result shape

| # | Scenario | Class | Honest note |
| --- | --- | --- | --- |
| 1 | decision from conversational objective | LOCAL-INT | pinned honest evidence summary; engine still grades |
| 2 | advice never executes | LOCAL-INT | guard refuses inside execute path AND at the tool surface |
| 3 | structured proposal from evidence | LOCAL-INT | digest-bound plan; risk derived from type |
| 4 | missing evidence → honest uncertainty | LOCAL-INT | insufficient-evidence/escalated, gaps named |
| 5 | approval cannot be forged via text | LOCAL-INT | conversation leaves row `requested`; only owner decision grants |
| 6 | either key missing blocks | LOCAL-INT | permission-key refusal + registry gating |
| 7 | modified digest invalidates approval | MOCKED | `digest-mismatch` |
| 8 | stale approval rejected | LOCAL-INT | requested/denied/consumed/expired all `not-granted` |
| 9 | cross-user access rejected | LOCAL-INT | honest "Decision not found." (no leak) |
| 10 | read-only inspection of authorized repo | **LIVE** | real `git ls-remote` vs github.com (no API quota) |
| 11 | unauthorized repo rejected | LOCAL-INT | allowlist refusal before any network |
| 12 | approved branch op executed + verified | MOCKED | creation + independent ref GET agree |
| 13 | force-push/main changes rejected | MOCKED | protected-branch refusal; non-descendant refused |
| 14 | PR creation independently verified | MOCKED | **live PR creation NOT performed** (owner repo; owner rule) |
| 15 | deployed revision identified | LOCAL-LIVE | real fs + independent git query |
| 16 | unauthorized deployment rejected | LOCAL-INT | production disabled; staging honest-unavailable |
| 17 | authorized "staging" verification | LOCAL-LIVE | REAL loopback HTTP server; **no real staging environment exists — recorded honestly, not counted as a live deploy pass** |
| 18 | failed deployment verification ≠ success | LOCAL-LIVE | 404 endpoint ⇒ unhealthy; unreachable ⇒ null |
| 19/20 | cancellation/audit + no duplicate side effects | LOCAL-INT | blocked (ungranted) path writes nothing; single verified run |
| 21 | delegated agents cannot bypass | LOCAL-INT | scope escalation + intent gate |
| 22 | provider failures classified honestly | MOCKED | rate limit ⇒ honest-unavailable |
| 23 | M41–M44 regression green | suite run | exact counts in the implementation report |
| 24 | conversational UI workflow in Z.ai Preview | MANUAL | recorded in the implementation report with evidence |

## Security scenarios folded into the above

Tampered binding digest refused before any other check; one-shot turn ledger blocks duplicate state-consuming operations; delegated scope escalation refused before gates; no token/secret in any output (redaction filters on log/config reads; adapters never return credentials).

## No fabricated evidence

Every LIVE/LOCAL-LIVE row records what actually ran in this window. Absent infrastructure (staging, provider history, live PR creation) is asserted as HONEST UNAVAILABILITY or MOCKED — never silently counted as PASS.
