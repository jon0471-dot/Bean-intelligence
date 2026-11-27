# M45 — Repository Execution (docs/intelligence)

## Scope

`src/lib/riishe/mission/repository-adapter.ts` — the REAL execution path for repository actions (M44 classified them but refused honestly because no path existed). Typed operations only; there is NO generic shell.

## Read-only operations

| Operation | Notes |
| --- | --- |
| `inspectRepository` | metadata (full name, default branch, visibility, description) |
| `listBranches` / `listCommits` | bounded to 30 entries |
| `compareRevisions` | ahead/behind + changed files |
| `listPullRequests` / `getPullRequest` | identity, state, head sha, merged |
| `remoteDivergence` | **independent transport**: local `git ls-remote` (no API quota), falling back to a ref GET; reports in-sync/diverged |

## Approved write operations (authorization-gated upstream)

| Operation | Policy | Independent verification |
| --- | --- | --- |
| `createBranch` | feature branches only; requires 40-hex source sha | ref GET must return the same sha |
| `commitToBranch` | path validation, bounded content (400k chars), message 3–4000 | commit GET on the returned sha |
| `fastForwardBranch` | ancestor check FIRST (compare API); non-descendant refused; `force:false` structurally — **force pushes impossible** | `git ls-remote` (or ref GET) must match the target |
| `createPullRequest` | title/body bounds; 422 refused honestly | PR GET: open + head sha present |
| `updatePullRequest` | title/body/state only | PR GET state match |

A write whose independent read DISAGREES is recorded UNVERIFIED — the runner's postcondition verdict then fails honestly (never success-shaped).

## Policy

- **Allowlist**: `jon0471-dot/Bean-intelligence` by default; owner-controlled via `BEAN_REPO_ALLOWLIST` (comma-separated, max 8).
- **Protected branches**: `main|master|develop|release/*|hotfix/*|production|prod` (+ `*/main`, `*/master`) refused BEFORE any network call. Server-side branch protection remains the authoritative layer at GitHub.
- **Credentials**: `GITHUB_TOKEN` from the server environment, read inside the adapter, only ever placed into the Authorization header; never returned, logged, or model-visible. Absent token ⇒ write operations report HONEST UNAVAILABILITY (never simulated); read-only inspection works unauthenticated against public repos within platform rate limits.
- **Rate limits**: HTTP 403/429 with a rate-limit message ⇒ honest unavailability with a truthful reason (not a repo failure, not a pass).

## Action-type wiring (M44 vocabulary extended)

- `repo-inspect` — NEW, read-only, no approval (idempotency-ledger postcondition).
- `repo-commit` — compensable, self-authorized inside granted scope; fallback postcondition `commit-present` with the sha resolved AT RUNTIME from the adapter's independent evidence (`runtimeVerificationContract`).
- `repo-push` — irreversible, human approval required; fallback `remote-ref-equals`.
- `repo-pull-request` — NEW, irreversible-class (publication), human approval required; verified via independent PR GET (`value-equals pullRequestState=open`).

## What it deliberately does NOT do

- No merge into main (branch protection + policy), no force push, no history rewriting, no repository creation/deletion, no release publishing, no arbitrary REST passthrough, no shell.
- Live PR creation against the owner's repository was NOT performed during acceptance (owner authorization rule); scenario 14 verifies the creation+verification path over an injected transport, classified MOCKED.
