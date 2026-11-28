# M47 — SECURITY AND RECOVERY

## Security invariants (unchanged by the native channel — and re-pinned)

1. **A native tool call is untrusted input.** It crosses the same gates as a text call: registry allowlist → the tool's own validate() → per-request permission keys → capability-plan authorization → route permission → in-tool permission recheck → M44 Trust Engine → digest-bound owner approval where required. Nothing in the native path reads a model field to decide authorization.
2. **The model cannot approve its own action.** `request_approval` creates an ungranted, digest-bound request; the grant flows only through the owner-only Trust decision route; consumption is server-side and consume-once.
3. **A tool call cannot expand its own permissions.** Action contracts are re-derived server-side from ACTION TYPE (risk/reversibility never caller-lowered — the M46 closed-vocabulary fix); unknown action types are refused outright.
4. **Credentials never leak.** Tokens exist only inside the adapter's Authorization header; diagnostics report configured/unavailable + least-privilege scopes and are leak-proof (pinned: M47-A20 with token-shape absence; M46's fake-`ghp_` leak test stays green). M47 read no secret values: env presence checks only.
5. **Prompt guidance is reliability-only.** The new NATIVE_TOOL_PROTOCOL changes the wire SYNTAX, not a single rule of honesty; every gate stays server-side under both protocols.

## New refusal surface (M47)

`validateNativeCalls` refuses BEFORE execution with honest classes: `tool-not-enabled` / `malformed-arguments` / `missing-call-identity`; every refused call id still receives a truthful `role:'tool'` error result; refusals are degraded-noted and counted per turn. The loop executes any bounded number of accepted calls (≤5/pass, ≤3 rounds) — an unmeasured multi-call capability can never break it.

## Recovery rules (existing infrastructure, re-validated)

- **Write uncertainty**: a write-class transport failure is `reconciliation-required` — the remote MAY have applied it. The outcome is VERIFYING or RECOVERY_REQUIRED, never SUCCEEDED; remote state is inspected through INDEPENDENT read paths before anything is retried; the write is never blind-retried (exactly one request, pinned).
- **Deployment uncertainty**: verification incomplete → UNVERIFIED with `reconciliationRequired=true`; mid-deploy process death → reconciliation-required; recovery always inspects the deployed revision + runtime health first.
- **Stale approvals**: rejection pinned (M44/M45 suites, re-run green). **Digest modification** invalidates approval (same). **Cross-user access** rejected (conversation binding; same).
- **Cancellation**: caller cancellation propagates (gateway + adapter seams; M26 fixes untouched).
- **Credential revocation/absence**: honest-unavailable outcomes at every seam; no alternative secret sources are tried; activation is an owner operation.

## Audit integrity

Audit events continue through the Trust ledger (`addTrustEvidence`) and the observability logger; M47 added `riishe.tool_loop.native` and `riishe.tool_invocation.recorded`/`declined` lines carrying identities and counts only. Cross-user isolation rides the unchanged conversation-binding digest (M45 suites re-run green).

## Session-specific environment findings (recorded honestly)

- Turbopack rejects a symlinked `node_modules` ("points out of the filesystem root") → production build requires a real install; `bun install --frozen-lockfile` + `prisma generate` is the documented recovery (981 packages; build then exit 0).
- The gitignored pinned MiniLM vocab was absent after worktree setup → reinstalled from the manifest-pinned source, SHA-256 `07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3` verified exactly (231,508 bytes) — the M42/M43/M46-documented procedure.
- Batched multi-file test runs interfere via `mock.module` leakage (proven pre-existing: byte-identical failure set on the pristine merge tree); per-file runs are the hermetic regression strategy.
