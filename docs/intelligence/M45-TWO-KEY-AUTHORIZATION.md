# M45 — Two-Key Authorization (docs/intelligence)

## The two keys (derived from the existing architecture — not invented)

M45 wires the conversational decision tool into the SAME two-key pattern M36-C established for specialist delegation, M37 for coding delegation, and M41 for missions:

| Key | What it is | Who/what controls it |
| --- | --- | --- |
| **Key 1 — server-side permission key** | `allowExecutionGovernance` in the route's permission set (`src/app/api/riishe/chat/route.ts`). Server-side authority; no client toggle. | The API route (server code). The orchestrator reads it from `ToolContext.permissions`. |
| **Key 2 — per-turn capability plan** | `capabilityPlan.executionGovernance` — deterministic detection of decision/plan/approval/execution/result vocabulary in the REAL user message (`conversation-intent.ts`). Narrowed per turn; document-attachment turns never open the universe. | The deterministic capability planner. |

The orchestrator computes the AND **before** the tool enters the model's universe (`selectTools`); the tool itself re-checks Key 1 in its execute path (defense-in-depth, mirroring the M41 mission tools). Missing either key ⇒ the tool universe stays closed (registry returns "not enabled") or the tool refuses ("Permission denied").

## Independence

The two checks are computed by different components from different inputs: Key 1 from the route's server-side policy; Key 2 from the deterministic text classifier over the user's message. Neither alone may open the tool universe, and — one level deeper — NEITHER key authorizes a protected OPERATION: `request_approval`/`execute_plan` additionally require the server-derived intent to match, and human-class actions require a granted Trust approval bound to the exact payload digest.

## Digest binding, expiry, revocation, replay

Unchanged from M44/Trust Engine, now exercised conversationally:

- `buildApprovalPayload(contract, plan)` covers action type, title, description, params, scope, risk, reversibility, idempotency key, plan version, plan digest, action id; `approvalDigest` = Trust Engine canonical sha-256.
- ANY modification (a changed param, a re-planned DAG, a wider scope) changes the digest ⇒ `validateApprovalBinding` rejects with `digest-mismatch` / `plan-stale`.
- Grants expire (TTL), are decided exclusively through `decideTaskApproval` (owner decision route), and are consumed server-side immediately before execution (consume-once ⇒ replay of a consumed approval fails).
- AI-generated text can manufacture NEITHER key NOR a grant: conversation only creates a `requested` approval row; the grant is a separate owner action.

## Delegated agents

- Delegation scope escalation is refused before any gate evaluation (`checkDelegation`: delegate scopes must be a subset of the grantor's; self-delegation refused).
- Delegated agents cannot reach a grant path: approvals are decided by owner users only (`validateApprovalDecision`), and the server-derived intent gate ignores whatever the model puts in tool input.

## When a component is unavailable

- Key 1 absent (route without the permission) → tool never enters the universe / refuses with "Permission denied" — honest, no fallback.
- Key 2 false (no governance vocabulary in the turn) → tool never enters the universe; the turn stays an ordinary chat turn.
- Trust Engine unavailable → `request_approval`/`execute_plan` fail honestly (error surfaced as a TOOL_ERROR; never converted to success).
- Token-based downstream providers unavailable (GitHub token, deploy token) → the adapters report HONEST UNAVAILABILITY; nothing is simulated.

## Security boundary notes

- No private keys, credentials or authorization secrets ever enter model context, prompts or logs: the GitHub/deploy tokens are read from the server environment inside the adapters and only ever placed into the Authorization header. The adapters' outputs carry SHAs, states and bounded summaries — never tokens. Log/config reads pass a redaction filter (`redactSecrets`).
- M44 owner-only approval rules and Trust Engine restrictions are preserved verbatim; M45 adds wiring, never bypasses.
