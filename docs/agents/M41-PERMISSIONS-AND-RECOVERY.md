# M41 — Permissions, Safety and Recovery

> Every guarantee on this page is enforced in code and pinned by tests (`tests/unit/riishe-mission-safety.test.ts`, `tests/unit/riishe-mission-executor.test.ts`, `tests/unit/riishe-mission-core.test.ts`). Nothing relies on caller discipline.

## 1. Authorization scopes (structurally safe)

The fixed kind→scope routing (`KIND_AUTH_SCOPE`) admits EXACTLY four scopes — there is no vocabulary entry for deletion, publishing, deployment or external communication, so a mission can never grow one:

| Scope | Kinds | Boundary |
|---|---|---|
| `project-write` | `code-build`, `document-draft` | Writes files ONLY inside one user-owned engineering project, through the coding turn's real diff/version/rollback pipeline; destructive rename/move/delete exist only in the CODE GIFTZ product surface behind their own gates and are unreachable from missions |
| `asset-create` | `image-asset`, `video-asset`, `audio-asset` | Creates new media assets under the user's own account via the standard specialist jobs |
| `retrieval-read` | `research`, `knowledge` | Read-only live retrieval (authorized gateway lanes) and the Knowledge Atlas |
| `mission-inspect` | `verify-deliverable` | Read-only integrity inspection of artifacts this mission produced |

`assertMissionVocabularyIsSafe` re-asserts the structural property (fail-loudly) and is exercised by tests and callable at mission creation.

## 2. Delegation permission discipline (two-key, unchanged)

`delegate_mission` / `cancel_mission` are `explicit` tools: the route authority (`allowMissionDelegation`) AND the deterministic per-turn capability plan must BOTH agree before the model may act. `check_mission` is a standard read-only, owner-scoped probe. The specialist delegations underneath keep every preflight gate (availability, rate limit, quota, budget, dedupe, per-user active caps) — a mission cannot bypass what the product surfaces enforce.

## 3. Secrets never enter prompts, logs or ledger rows

- `sanitizeEvidenceText` redacts system-credential shapes (API keys, bearer tokens, GitHub/AWS tokens, private-key blocks, basic-auth URLs) at EVERY mission-ledger payload write (`executionJson`, `verificationResultJson`, `artifactJson` — transition, retry and resubmission paths).
- User prose is stored bounded but otherwise untouched (it is the user's own data).
- Handoff digests strip URL query strings (token surface) and are bounded; a static sweep asserts no credential literal exists in the mission module sources.

## 4. Tool outputs are untrusted input

- Verifiers parse worker payloads by SHAPE (never trusting embedded claims).
- Handoffs are labeled DATA blocks (`HANDOFF_SAFETY_LABEL`): injected instructions in upstream text stay bounded, attributed, inert — they can only ever become a quoted excerpt inside a specialist objective, never a command path. Pinned by the injection test (objective's real instruction stays first; injection text carried verbatim as data).

## 5. Cancellation propagation

`requestMissionCancel` (owner-only, active missions only) sets the ledger flag; the runner polls it every scheduling round and: signals every active specialist job through the engine's `requestCancel`, cancels all pending/ready tasks, keeps finished tasks' recorded results, settles the mission `cancelled` with a truthful note and cancels the Trust task. Live-verified in the acceptance window (cancel → `cancelled`, all tasks terminal, provider-side job signalled).

## 6. Durable execution and recovery

- Missions ride the SAME durable engine as every product job (`mission-run` on the riishe pool): claim → lease → heartbeat → crash recovery. The driver self-settles like the director worker.
- Task state is persisted per transition (CAS `updateMany` + status guard — concurrent settles are rejected structurally).
- Specialist jobs are durable rows on their own: a re-claim resumes from the LEDGER — verified tasks are never re-executed (pinned by the resume test), interrupted submissions are re-delegated within the attempt budget, completed specialist jobs are verified on resume.
- Bounded everything: per-task execution timeout (≤20 min), attempts (≤2), corrections (≤1), parallel lanes (≤3), mission wall clock (≤45 min), scheduling rounds (≤400). Deadline and round-cap settlements cancel active work and mark the remainder honestly.
- Trust Engine provenance: one Trust task per mission, planned steps per task, artifact/limitation evidence rows, and a finalize/fail/cancel that CARRIES a verification summary built from actual task states — a completed-family outcome without verification is a programming error, exactly as the Trust contract requires.

## 7. Per-user isolation

Every read is owner-scoped (`getMissionForOwner`/`listMissionsForOwner` filter by userId; foreign ids are honest 404s). Specialist work is submitted under the CALLER's user id — never anyone else's. Live-verified (foreign GET/cancel → 404) in the acceptance window.
