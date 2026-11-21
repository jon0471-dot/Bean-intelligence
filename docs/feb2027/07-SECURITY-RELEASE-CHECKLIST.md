# 07 — Security & Privacy Release Checklist

Owner-controlled gates first; implementation-hygiene second. A green check
requires **verified evidence**, never intention.

## A. Publication gate (BLOCKING for any GitHub publication)

| # | Item | State 2026-11-20 | Blocking? |
|---|---|---|---|
| A1 | Rewritten history actually published to GitHub (`main` tip = rewritten base, verified by fresh `git ls-remote`) | ❌ not started (remote still at pre-rewrite SHAs; staging clone lost — M26.1.2) | **BLOCKS all publication** |
| A2 | Fresh-clone proof that the 8 DB blob SHAs are unreachable from published refs | ❌ pending A1 | BLOCKS |
| A3 | Recovery bundle + off-machine encrypted copy with owner attestation | ❌ source artifacts lost; owner attestation never received | BLOCKS history-rewrite re-derivation |
| A4 | Collaborator notification delivered (`jon0471-dot`, `ebinj-dev`) | ❌ draft only | BLOCKS |
| A5 | Provider-credential residual check (owner confirmation on real-key use) | ⏳ pending owner | BLOCKS release claim |
| A6 | WIP recovery: owner ran `M26_1_5_R2_OWNER_VERIFIER` on their PC; 10/10 restoration checks pass → record `GATE 1 CLOSED — OWNER VERIFIED` | ⏳ verifier ready (`VERIFIER READY — OWNER EXECUTION REQUIRED`); re-delivery of the run-2 package/verifier to the owner is an open transfer item | required for the recovery claim only |
| A7 | Explicit owner authorization specifying exact refs + SHAs for any force/lease push | ❌ not sought; general launch approval does NOT authorize history rewriting | BLOCKS |

**Standing rule while A1–A7 are open:** commit locally on safe branches; no
push, merge, rewrite, force-push; never delete/overwrite recovery bundles;
never treat a sanitized local clone as proof of a cleaned remote.

## B. Application security (verified mechanisms — keep green)

| # | Item | Evidence base |
|---|---|---|
| B1 | AuthN: scrypt passwords; opaque 256-bit session tokens; httpOnly SameSite=None+Secure cookie; Origin-checked CSRF compensation | `docs/security/SECURITY.md`, `src/lib/auth/*` |
| B2 | AuthZ: owner-scoped rows everywhere (404-on-mismatch); admin server-enforced; API keys SHA-256-hashed, scoped, project-bound; portal guards | `src/lib/security/*` |
| B3 | Trust Engine surfaces follow the same rules (owner-scoped 404s, audited decisions, no secrets in trust rows) | new 2026-11-20; tests pin scoping |
| B4 | Sandbox isolation for code execution (network namespace + rlimits + process separation; documented containerization TODO before multi-tenant scale) | `src/lib/sandbox/runner.ts`, SECURITY.md |
| B5 | Injection defenses: deterministic echo-directive guard; untrusted-content framing; Agent Reach argv-only allowlist surface; SSRF/DNS-rebinding-safe URL guard | `src/lib/verify/injection.ts`, `src/lib/research/reach/*`, `url-guard.ts` |
| B6 | Secrets hygiene: env names only in docs; masked hints; AES-256-GCM credential envelopes; no secrets in logs; audit log without payloads | `observability/*`, `security/provider-credentials.ts` |
| B7 | Privacy: per-user isolation of conversations/memory/documents; retention controls; GDPR account deletion (live-used 2026-11-20 for the test account); client-compute reports sanitized (no UA/vendor strings) | schema + `account/settings` route |
| B8 | Rate limits/quotas/budgets: per-user sliding windows, daily quotas, per-product budgets, shared-account reserve | `auth/ratelimit.ts`, `cost-guard.ts` |

## C. Pre-release verification checklist (must be re-run at RC)

1. `bun test --isolate tests/` — 0 fail (2224/0 measured 2026-11-20).
2. `npx tsc --noEmit` — 0 errors. 3. `eslint src tests` — clean.
4. `bun run build` — success.
5. Security & secret scan over changed files (repo convention §0 workflow).
6. Fresh-clone install test (`bun install` → `db:generate` → `db:push` → build → start).
7. Authorization & project isolation tests (cross-user 404 matrix).
8. Failure / cancellation / recovery path tests.
9. UI inspection at desktop + mobile sizes (overflow, overlap, controls).
10. Supported-capability matrix published with measured states (06/08).

No item above may be reported green without its evidence artifact or command
output recorded in the completion report.
