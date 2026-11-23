# M33 — RIISHE Project Memory Completion (Phase 2, memory milestone)

Implementation report — 2026-11-23. Branch `feat/riishe-project-memory-completion`,
based on the freshly fetched verified `origin/main` (`0bac07a0d441302fea2c72559774ffbd086c9d11`).
This is a product implementation milestone: user-controlled memory management,
conservative conflict detection, explainable recall and Trust-receipt coverage
for real memory operations — all built by extending the existing RIISHE memory
implementation (no rebuild of RIISHE, its chat architecture, the database or
the Trust Engine).

## 1. What shipped (features, not audits)

| Feature | What the user gets | Where it lives |
|---|---|---|
| **A — Memory management** | View all memories with creation + last-updated timestamps; create explicitly; edit in place; delete one / delete all (both confirmed); search/filter; live N/50 counter with near-cap and at-cap states; JSON export download | `src/components/bean/riishe/riishe-memory-manager.tsx` (new), embedded in the existing Settings experience (`src/components/bean/settings.tsx`); API in `src/app/api/riishe/memory/route.ts` |
| **A — Edit API (PATCH)** | Optimistic-concurrency edit: the mutation constrains id + owner + the observed `updatedAt` in one conditional write; a stale screen gets `409 EDIT_CONFLICT` with the current row so the user reconciles — nothing is silently overwritten, the draft is never silently discarded | `PATCH` in the memory route; `EDIT_CONFLICT` added to the BEAN error contract (409) |
| **A — Export API** | `GET /api/riishe/memory?export=json` streams an `attachment` (`bean-riishe-memory-<date>.json`) containing ONLY the authenticated user's rows: memory id, content, createdAt, updatedAt + the export timestamp and format marker. No session tokens, no API keys, no credentials, no internal provider identifiers, no other users' data | memory route `GET` |
| **B — Conflict detection** | Deterministic, scoped detection of same-topic/different-value candidates ("My timezone is IST" vs "My timezone is UTC"), with per-candidate confidence (`likely` vs `ambiguous` for value refinements), matched IDs and content | `detectPotentialMemoryConflicts` in `src/lib/riishe/memory.ts` (pure, regex/string only) |
| **B — Decision flow** | The management UI presents candidates and the user explicitly chooses: **Replace** (one named row), **Keep both**, or **Cancel** (closes without writing anything). Replacement re-verifies ownership AND version in the delete-then-create sequence; a moved version is a 409 with the current row — nothing is replaced | memory route `POST` `decision` field; manager dialog |
| **C — Explainable recall** | Every chat turn that selected memories persists an accurate `memoryContext` record: which memory IDs were included, when the selection happened, the policy label + truthful description, the actual injected count and the store size at selection time. The chat shows a small expandable "Memory context" section on relevant answers — contents load through the owner-scoped memory API at expand time; deleted entries show an honest unavailable reference | orchestrator input/metadata (`orchestrator.ts`, `states.ts`, `memory.ts` composer); UI in `riishe-messages.tsx`; metadata type in `use-riishe-chat.ts` |
| **D — Trust receipts** | Real memory operations record receipts in the EXISTING ledger: created / edited / exported / deleted / delete-all / user-confirmed replacement / potential-conflicts presented. Chat save receipts note conflicts presented. No second audit architecture | `src/lib/trust/adapters/riishe-memory.ts` (new helper over `createTrustTask`/`planTrustSteps`/`addTrustEvidence`/`finalizeTrustTask`); chat adapter `completeMemory` extended with `conflictCount` |

## 2. API behavior (exact)

**PATCH /api/riishe/memory** — body `{ id, content, expectedUpdatedAt }`.
`requireUser` first; delegate-unavailable → 503 PRODUCT_UNAVAILABLE. Content
normalized (whitespace), length 3–480, sensitive patterns refused (same guard
as chat). Ownership checked first — a foreign id resolves to 404 NOT_FOUND
(IDOR-safe). Duplicate-of-another-row refused (400, existing duplicate
contract preserved). Then a single conditional update
`updateMany({ where: { userId, id, updatedAt: expected } })`: count 1 →
200 with the fresh row; count 0 → re-fetch to distinguish honestly: gone →
404 ("deleted while you were editing"), still there → **409 EDIT_CONFLICT**
with `error.detail` JSON `{ current: { id, content, updatedAt } }`. Logs carry
memory id + character count only — never content.

**POST /api/riishe/memory** — body `{ content, decision? }` where `decision`
is `{ kind: 'keep-both' }` or `{ kind: 'replace', memoryId, expectedUpdatedAt }`
or absent. Order of guarantees: sensitive refusal → (replace branch)
duplicate-of-any-row refusal → conditional delete constrained by
`userId + id + updatedAt` (0 → 404 if gone / 409 EDIT_CONFLICT with current
row if changed) → cap re-check against reality → create. Non-replace branch:
duplicate refusal → conflict detection → **candidates returned, NOTHING
written** (requiresChoice + candidates[] with id/content/topicKey/confidence/
updatedAt) unless `decision: keep-both` → cap check → create.

**GET /api/riishe/memory** — list (newest first) or `?export=json`
attachment. List payload is exactly `{ id, content, createdAt, updatedAt }`
per row. Export payload: `{ format, exportedAt, count, memories[] }` with the
same per-row fields.

**DELETE /api/riishe/memory** — `?id=` (ownership pre-checked; foreign id →
404) or `?all=1` (owner-scoped count returned).

## 3. UI behavior (exact)

New "RIISHE memory" section in Settings (existing Settings experience — no
competing navigation), BEAN black-and-gold (`bean-glass`, champagne gold
accents, existing shadcn primitives):

- counter chip `N / 50` turning amber near the cap and red at the cap;
- create box with live `0/480` counter and cap-aware disabled state;
- per-row Created / Updated stamps ("Updated" only when the row was edited);
- search filter (client-side; the store is capped at 50);
- Edit → inline textarea with counter, Save/Cancel; stale server state renders
  the reconciliation card (current stored text + your kept draft + "Continue
  editing my draft" / "Discard draft and reload") — a closed edit never means
  "overwritten anyway";
- Delete → per-row confirmation dialog quoting the content;
- Delete all → confirmation dialog with the truthful count;
- Export JSON → blob download with server-provided filename; feedback banner
  for success/error states; loading state; honest empty state ("Nothing in
  memory yet…"); honest degraded note when the memory service is initializing;
- conflict dialog: heading "Possible conflicting memory", per-candidate
  content + confidence chip ("likely conflict" / "possible overlap") +
  "Replace this" per candidate, footer Keep both / Cancel, and the explicit
  statement "Nothing was stored yet".

Chat: `Memory context (N)` expandable — rendered ONLY on assistant messages
whose persisted metadata recorded included memories (or a non-empty store with
nothing included); never a badge on every message. Expanded it shows the
counts ("N of your M saved memories were included…"), the truthful policy
text, the included entries resolved through `GET /api/riishe/memory`, the
honest unavailable reference for entries deleted since, and the fixed honesty
line: inclusion is what the record establishes — whether the answer drew on a
specific memory is not tracked or claimed.

## 4. Privacy guarantees (enforced, not stated)

- Every endpoint authenticates with the existing `requireUser`; every query
  and mutation constrains by the authenticated user id (cross-user attempts
  return 404 without touching the foreign row — pinned by tests).
- Optimistic concurrency on edits and replacements (version-checked
  conditional mutations; no blind writes).
- No memory CONTENT in logs (ids + char counts only), none in message
  metadata (IDs only — contents load through the owner-scoped API at expand
  time), and none in TrustEvidence (bounded references = memory row ids).
- Export contains only the owner's rows and the promised fields.
- No automatic or silent memory creation; no automatic replacement or
  deletion — every destructive/replacing action is an explicit, re-verified
  user decision.
- Sensitive-data rejection preserved on create AND edit (passwords, API
  keys/tokens, card numbers, government ids).
- No third-party providers, no paid infrastructure introduced — ₹0/month
  budget unchanged; Prisma schema untouched (the existing `updatedAt` column
  is the concurrency guard; no redundant fields added, no migration run).

## 5. Conflict-detection limitations (honest scope)

- Deliberately conservative: only two scoped topic templates participate —
  the assignment shape ("my/our <subject> is/are/: <value>") and the
  preference shape ("I <prefer/like/want/favor> <value>", topic-scoped by the
  value's head noun). Memories that parse into no template never produce a
  claim (insufficient evidence → no claim).
- A preference conflict requires the same head noun ("I prefer detailed
  answers" vs "I prefer concise answers" matches; "I prefer tea" vs "I prefer
  concise answers" does not). Preference phrasings whose head noun differs
  from the real object are honestly MISSED (e.g. "I like tea more than
  coffee" heads on "coffee").
- Exact duplicates (case/whitespace-insensitive, today's contract) are
  refused as duplicates, not conflicts; a trailing-punctuation variant
  ("IST." vs "IST") is neither refused nor flagged — a known, documented gap.
- Value overlaps (one value extending the other) are labeled `ambiguous`
  (possible refinement) rather than `likely`.
- The detector is a WARNING ONLY: it never mutates anything; replacement
  happens exclusively through the explicit user decision flow.
- No LLM is involved anywhere in the decision — deterministic regex/string
  rules only; the model is never an authority over memory contents.

## 6. Memory recall explanation policy

- The selection remains exactly as it was: the most recently created
  memories, bounded (12 per turn, 200 characters each) — PRESERVED this
  milestone (no measured defect justifies changing it).
- `memoryContext` is composed by the orchestrator from the SAME records that
  fed the prompt injection, so the explanation cannot drift from reality:
  IDs are the injected entries, `injectedCount` is the real count after
  bounds/clipping, `totalMemoriesAtSelection` is the route's count at fetch
  time, `selectedAt` is the composition timestamp.
- The policy text states the truth: "Selected as your most recently created
  memories… RIISHE does not rank memories by relevance — recency is the only
  selection criterion." Nothing anywhere claims semantic ranking.
- Included-in-context ≠ referenced-in-answer: the first is established by the
  server; the second is never asserted (no evidence exists). The UI says so
  explicitly.
- All three chat paths (interactive SSE, non-streaming JSON, background job
  worker) fetch the selection with IDs + the store count and pass them to the
  orchestrator; metadata (including `memoryContext`) is persisted identically
  on all paths, so explanations survive conversation reloads. SSE wire
  contract unchanged — the change is additive metadata only.
- The chat save command ("remember …") now also surfaces POTENTIAL conflicts
  honestly in its receipt (bounded quotes, keep-both default, instructions
  for replace), while the structured Replace/Keep-both/Cancel decision
  interface lives in the memory manager.

## 7. Tests and exact results

New/extended suites (67 tests across 3 files; all hermetic, fake-db/mock
idiom of the repo):

| Suite | Coverage |
|---|---|
| `tests/unit/riishe-memory.test.ts` (25) | existing command-detection/sensitive/dup/bounds/receipts tests PLUS conflict detection (spec's three examples, different-topic non-conflicts, ambiguous refinements, duplicate-not-conflict, multi-candidate, purity), conflict-aware receipts, recall composition (counts, 12-bound, empty store, policy-truth) |
| `tests/unit/riishe-memory-management.test.ts` (27) | the memory API with real Request objects: create/list/edit/export/delete-one/delete-all, duplicate refusal, 50-cap, 480-limit, sensitive refusal, decision point (nothing stored), keep-both, user-confirmed replace, stale replace (409 + current row), stale edit (409 + content intact), duplicate-of-another-row edit, cross-user edit/replace/delete (IDOR), unauthenticated list/export/delete, malformed content/version, concurrent-replacement (moved version removes nothing) |
| `tests/unit/riishe-memory-recall.test.ts` (15) | real `orchestrateTurn`: zero/one/12-bound/13+ records, recent-first order inside the actual system prompt, clipped long entries, honest nothing-included record, NO fabricated metadata for legacy `memories` inputs, policy text never claims semantic ranking, static wiring contract that the interactive route (both call sites), non-streaming path and background handler all supply `memoryRecords`/`memoryTotalCount` and persist metadata, Trust receipt recorder (task kind, ID-only evidence, limitation-honest conflict receipt) |

Full-suite and static checks, all run fresh at the milestone integration
boundary (2026-11-23):

| Check | Result |
|---|---|
| `bun test --isolate tests/` | **2501 pass / 0 fail / 5 skip** (189 files) — includes all 67 new M33 tests; no regressions |
| `npx tsc --noEmit` | **0 errors repo-wide** (src + tests) |
| `eslint` on all 19 touched code/test files | clean |
| `bunx prisma validate` | schema valid (schema unchanged by M33) |
| `bun run build` | success; `/api/riishe/memory` route registered; 4 warnings, all pre-existing in files untouched by M33 (`instrumentation.ts` Edge note, `gangzii/tts-engine` optional module probe, `media/local-models` optional imports) |
| Secret/security scan of the complete diff | no tokens/keys/credentials; no new env access; no memory content in any log call, metadata field or TrustEvidence; no leftover TODO/placeholder markers |

## 8. Desktop/mobile visual verification (screenshots inspected)

Ran the real dev server against a fresh local SQLite (schema pushed
additively), a disposable account, and exercised the REAL endpoints; then
inspected rendered screenshots at 1440×900 and 390×844. Transparency note:
the sandbox workspace was recycled mid-session and restored an older tree
alongside the M33 changes; the live UI/API checks below ran against that
working tree, whose M33 files are the exact blobs committed here (verified
per-file diff before publication), and the final commit was rebuilt on top of
the verified `origin/main` base and re-verified with the full suite (§7),
tsc, lint, build in a clean worktree at the published SHA.

| Check | Result |
|---|---|
| Settings → RIISHE memory section (desktop, full page) | counter `18 / 50`, create box, search, Export JSON, Delete all, rows with timestamps — renders in BEAN identity |
| Conflict decision dialog (desktop, live: "My timezone is UTC" against stored "My timezone is IST") | candidate with "likely conflict" chip, Replace this / Keep both / Cancel; "Nothing was stored yet" stated |
| Keep-both outcome (desktop, live) | feedback "Saved to memory.", counter advanced, both rows listed |
| Chat "Memory context (12)" expander (desktop, persisted metadata through a real reload) | counts line, truthful policy text, 12 entries resolved through the owner-scoped API, honesty line |
| Deleted-memory reference (live delete then reload + expand) | "memory unavailable — deleted or changed after this response" + "1 of the included 12 entries no longer resolve" — no stale reconstruction |
| Mobile 390×844: chat expander with deleted reference | wraps cleanly, no horizontal overflow (scrollWidth == clientWidth) |
| Mobile Settings memory manager | stacked layout, all controls reachable, no overflow |
| Mobile edit state | textarea + 18/480 counter + Save/Cancel inline, no overlap |
| Mobile delete-all confirmation | truthful count in copy, destructive action gated |

Screenshots retained locally under `download/m33-visual/` (not committed —
they contain the disposable account's data).

## 9. Known limitations

1. Conflict detection covers the two scoped topic templates only (see §5) —
   it is conservative by design; recall (not false-positive) is the accepted
   trade-off and the UI labels every candidate as a decision, never a verdict.
2. Exact-duplicate key remains case/whitespace-insensitive (today's
   contract); punctuation-only variants pass as "new" rows.
3. `referenced-in-answer` is not asserted anywhere (no evidence path exists
   in this milestone); the UI/docs state inclusion-only semantics.
4. The chat save command keeps both on potential conflicts (safe default);
   the structured replace flow lives in the memory manager — chat users get
   the conflict quote + "forget …" / Settings guidance instead.
5. Prisma schema untouched → `updatedAt` is `@updatedAt` and changes on ANY
   update; the optimistic guard therefore treats any intervening write as a
   conflict (correct, if strict).
6. Visual verification used a locally seeded conversation for the
   memory-context expander (metadata shape identical to what both live paths
   persist — the wiring is pinned by the static contract test and the live
   memory API was exercised for real); the RIISHE model backend itself is not
   reachable from this sandbox, so a live end-to-end model turn was not run.
7. Publication hygiene: a mid-session workspace recycle had placed the first
   working commit on top of the sandbox's auto-commit chain (old working-tree
   lineage, 285 files of drift vs `origin/main`). That state was NEVER
   pushed. The published commit was reconstructed deterministically via git
   plumbing — `origin/main`'s tree plus exactly the 23 M33 file blobs, with
   the one drift-contaminated file (`use-riishe-chat.ts`) rebuilt as
   `origin/main` + the additive M33 metadata type only (verified: pure
   addition, zero deletions) — then fully re-verified (§7 numbers are from
   the reconstructed tree) and pushed as a normal fast-forward. The stray
   local state is tagged `backup/m33-drift-base-744aa60` for the record.

## 10. Phase 2 honesty statement

Phase 2 of the February 2027 plan comprises memory completion, MODEL
TRANSPARENCY and task-progress/receipt display in chat. **M33 completes only
the memory milestone.** Model transparency (provider/runtime info visible
without leaking private registry data) and task-progress + receipt display in
chat are NOT implemented in this milestone and remain open — Phase 2 is NOT
claimed complete.
