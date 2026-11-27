# M46 — IMPLEMENTATION REPORT

> Branch `feat/m46-production-readiness-live-operations` · recorded 2026-11-28 · every SHA below independently verified (local git + live `git ls-remote`).

## 1. Verified baseline

Established in `docs/M46_BASELINE.md` (commit `3eec7f3`): `origin/main` = `50e1c7622b43acc531806e0b7f97aa21f42a6050` (PR #37 merge, parents `7ff0556` + `83d9be1`, authored by jon0471-dot 2026-11-27); the complete M45 trail (`01fdac5→deb5cdf→0350e40→9f9950e→b70c2f6→83d9be1`) verified inside main; PR #36/37 double-merge pattern documented; watchdog ACTIVE → M46 runs in the linked worktree `/home/z/my-project/m46-wt`; the M45 acceptance 27-vs-24 accounting discrepancy root-caused and reconciled with appended-only corrections.

## 2. Exact commit trail (all pushed + remote SHA verified with `git ls-remote` after each push)

| SHA | Milestone | Content (abbreviated) |
| --- | --- | --- |
| `3eec7f3` | M46.0 | baseline reconciliation + M45 security/readiness audit (12/12 invariants verified in source) + acceptance accounting correction (appended-only) |
| `593ddd7` | M46.1 | conversational tool-calling reliability: tool-invocation module (protocol honesty, invocation-outcome classification, observational ledger), orchestrator wiring (backendId plumb, policy check, declined observation), governance prompt guide, SECURITY FIX closed action vocabulary, 28-case suite |
| `00bab43` | M46.2 | GitHub credential readiness diagnostics: least-privilege visibility, failure categories, leak-proof by construction, 8-case suite |
| `e60cda3` | M46.3 | real GitHub write lane: `BEAN_TEST_REPOSITORY` explicit config, write-uncertainty reconciliation (never blind-retried, never SUCCEEDED), `readBranchFile`, every Phase-4 failure scenario pinned, 19-case suite |
| `54239f0` | M46.4 | real local staging lane: prerequisites naming, scope separation, independent verification (BUILD_ID + health + smoke + match), reconciliation, retained-build rollback, 9-case suite |
| `e6bdd48` | M46.5 | database migration readiness: reviewed additive migration, real-DB preflight (ran for real, zero impact), isolated SQLite tests, owner apply path, 3-case suite |
| (this commit) | M46.7 | the nine-document set + handoff/worklog updates |

## 3. Changed files (branch delta vs `50e1c76`, docs commit included: 20 code/test files + prisma migration + script + 9 docs + handoff/worklog)

Source: `tool-invocation.ts` (new), `orchestrator.ts`, `prompts.ts`, `mission/action-contract.ts`, `mission/conversation-intent.ts`, `mission/repository-adapter.ts`, `mission/deployment-adapter.ts`, `mission/credential-diagnostics.ts` (new), `mission/action-runner.ts`, `app/api/riishe/chat/route.ts`. Tests: 5 new suites (67 cases). Infra: `prisma/migrations/20261128_m46_execution_decision_additive/migration.sql` (new), `scripts/m46-migration-preflight.py` (new). **Zero changes to package.json/bun.lock/UI redesign/existing integrations.**

## 4. Live integration results

- **LIVE (real external):** `git ls-remote` inspection of the authorized repository (S15); the four real model turns (S04 — result honestly NOT DEMONSTRATED: 0 tool calls, every decline measured); forged-approval conversational turn rejected (S08).
- **LOCAL-LIVE (real local processes/fs):** staging lane verified deploys (buildId match, health, smoke) + reconciliation + rollback; migration preflight ran against an isolated copy of the REAL production SQLite (purely additive, zero data impact); real-app walkthrough on the production build (health 200, register 200, real chat turns 200, browser session with 0 console/page errors).
- **LOCAL-INT / MOCKED / MANUAL:** see `docs/intelligence/M46-ACCEPTANCE.md` (exact per-scenario table, reconciled 32-row totals).

## 5. Security findings

1. **Closed action-type vocabulary (fixed in M46.1):** unknown model-proposed action types previously produced contracts with UNDEFINED risk/reversibility and leaked arbitrary strings into digest-bound plans — now refused outright.
2. **Ordering sensitivity (pre-existing, documented):** m45-acceptance → m45-decision-governance non-isolated ordering leaks a fake-DB seam (8 failures) — verified pre-existing via stash-test against the pristine M45 tip; suppressed by `--isolate`.
3. **CSRF strictness:** the walkthrough's 403 confirmed the origin allowlist is strict by design (no wildcards) — correct behavior, configured via `BEAN_TRUSTED_ORIGINS`.
4. No secrets anywhere: token crosses modules only into auth headers; diagnostics leak-proof (pinned); branch-delta secret scan clean (the one `ghp_`-shaped string is the intentional fake in the leak test); the production DB and credential store never read.

## 6. UI walkthrough evidence

See `M46-ACCEPTANCE.md` §"Real-application walkthrough" — desktop + mobile, real sign-in, real governance turn, honest statuses, 0 console errors, decline observability verified server-side.

## 7. Remaining limitations (owner-operated configuration)

| Capability | State | Missing prerequisite |
| --- | --- | --- |
| Live GitHub write lane | HONEST-UNAVAILABLE (implementation complete, 19-case rehearsal green) | `GITHUB_TOKEN` (least-privilege, integration-scoped) + a dedicated `BEAN_TEST_REPOSITORY` |
| Model-initiated governed tool calls | Declined in all sampled windows on the hosted lane (measured per turn) | per-provider tool-calling reliability; native function calling when a lane exposes it (registry verb intentionally not invented) |
| External staging deployment | HONEST-UNAVAILABLE | `BEAN_DEPLOY_PROVIDER`/`BEAN_DEPLOY_TOKEN`; local lane ready (`BEAN_STAGING_ROOT`/`BEAN_STAGING_BASE_URL`/`BEAN_STAGING_DEPLOY_TOKEN`) |
| Production DB migration | READY, owner-operated | run `scripts/m46-migration-preflight.py` then the printed apply procedure |
| Dependency audit tooling | unavailable in this sandbox (no `bun pm audit`; no package-lock) | registry audit access; audit surface unchanged (zero dependency changes) |

## 8. Publication state

Branch `feat/m46-production-readiness-live-operations` — every milestone commit pushed and remote-verified; normal fast-forward pushes only. **Nothing merged into main; M46 awaits the owner's merge decision.**
