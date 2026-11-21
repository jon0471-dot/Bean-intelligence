# 04 — Trust Engine Specification (implemented 2026-11-20)

The Trust Engine is the shared, cross-product execution-evidence layer: what
BEAN planned, what it actually did, what evidence it used, what it verified,
what it could not do, and how a task can be cancelled or resumed. It is built
**on** the existing task/job infrastructure, not beside it.

## 1. Data model (additive, `prisma/schema.prisma`)

| Model | Purpose | Key rules |
|---|---|---|
| `TrustTask` | one meaningful agent task | 8-state status; verification summary required for completed-family outcomes; `failureNote` required for failed/cancelled; links (`jobId`, `conversationId`, `projectId`) never copies |
| `TrustStep` | planned vs actually-attempted steps | per-task monotonic `seq`; append-only advance (`planned→running→done|failed|skipped`), never rewinds |
| `TrustEvidence` | provenance ledger | `kind` (source/document/tool-output/artifact/measurement/limitation); `origin` **separates extracted facts from model interpretation**; optional sha-256 `digest` + `locator` |
| `TrustApproval` | scoped approval decisions | sha-256 `actionDigest` over canonical action JSON binds decision to the EXACT action; single-action scope; requested→granted/denied→consumed/expired |
| `TrustCheckpoint` | safe resume points | append-only; newest `valid` row is the resume point; older rows auto-`superseded`; payload holds only safe state |

All rows cascade with the owning user. No existing table or column was
touched. Every free-text field is size-bounded (`TRUST_LIMITS`).

## 2. Truthful lifecycle (`src/lib/trust/types.ts`)

```
planned → running ⇄ waiting_for_approval → completed
                                         → completed_with_limitations
                                         → partially_completed
                                         → failed | cancelled
```

- Illegal transitions are rejected **before** any write; terminal rows are immutable.
- **Never-pretend rules enforced in `tasks.ts`, not by callers:**
  - `finalizeTrustTask` refuses a completed-family outcome with an empty
    verification summary — a task is never marked completed merely because an
    LLM returned a response;
  - `failTrustTask` / `cancelTrustTask` require truthful notes;
  - CAS conditional writes make concurrent double-settles impossible.
- **Honest outcome mapping** (`mapRiisheStatesToOutcome`): response states
  assigned from actual execution (`UNVERIFIED`, `PARTIALLY_VERIFIED`,
  `TOOL_UNAVAILABLE`, empty) downgrade to `completed_with_limitations` — the
  mapping can never upgrade an unverified answer to plain `completed`.

## 3. Execution receipts (`src/lib/trust/receipt.ts`)

The receipt **is** the ledger: task + steps + evidence + approvals +
checkpoints composed read-only with a sha-256 `receiptDigest` over the
canonical content (deterministic; any ledger change changes the digest).
Nothing is copied into a separate store, so a receipt cannot drift. Exposed at
`GET /api/trust/tasks/[id]/receipt` and in the Tasks UI.

## 4. Scoped approvals (`src/lib/trust/approvals.ts`)

- `requestTaskApproval` pauses the task (`waiting_for_approval`) and records
  the exact proposed action + digest.
- The owner grants/denies via `POST /api/trust/tasks/[id]/approvals/[approvalId]`
  (audited as `trust.approval.grant|deny`). The UI surfaces pending approvals
  on the Tasks view.
- **Consume-once:** `consumeTaskApproval` atomically flips `granted→consumed`
  immediately before the action; a second consumption returns
  `already_consumed` — duplicate side effects are structurally prevented.
  Approval for one action is never unlimited future permission.
- Grants expire (`expired` is terminal for consumption); tasks resume only
  when no requested approvals remain.

## 5. Checkpoints and recovery (`src/lib/trust/checkpoints.ts`)

Executors persist safe state at natural boundaries (`writeTrustCheckpoint`);
`latestValidTrustCheckpoint` is the resume point; `supersedeTrustCheckpoint`
marks a checkpoint consumed so recovery never replays it twice. Retry safety
follows the existing queue rules (bounded attempts, 429 never retried, cancel
checks between checkpoints). **Recovery is not claimed for a task type until
it is implemented and verified.**

## 6. Integration (shipped 2026-11-20)

- **RIISHE background turns** (`src/lib/ai-engine/riishe-chat-handler.ts` +
  `src/lib/trust/adapters/riishe.ts`): every background job creates a
  TrustTask; orchestration stages become steps (`researching/tools/solving/
  verifying` → retrieval/tool/generation/verification); attached documents and
  retrieved sources become evidence with channel/engine provenance; the final
  outcome is derived from the real response states. Recording is best-effort —
  a trust failure is logged and never breaks the user's turn.
- **Memory-command turns** settle as honest receipts reflecting the real
  database write (refusals and zero-change outcomes recorded as limitations).
- **API:** `GET /api/trust/tasks` (list, filtered), `GET /api/trust/tasks/[id]`
  (full ledger), `GET …/receipt`, `POST …/cancel` (also raises the
  cooperative cancel flag on the linked job), `POST …/approvals/[approvalId]`.
  All session-authenticated and owner-scoped (IDOR-safe 404s).
- **UI:** "Task receipts" view (`src/components/bean/tasks.tsx`, nav group
  Platform) — list + detail with verification panel, limitations, steps
  timeline, evidence with `model interpretation` tagging, approval actions,
  digest details. Verified at desktop and mobile sizes (mobile overflow fixed
  and re-verified).

## 7. Deliberate non-goals for the foundation (Phase 1 remainder)

Interactive SSE turns, CODE GIFTZ / LAXII / JAZMII adapters, and executor
resume-from-checkpoint are specified but not yet wired — see 03 §Phase 1
"REMAINING". They must reuse this exact ledger; no second trust architecture.
