# 05 — Agent Capability Matrix

Per the brief §7: what each of the first three agents must do, what already
exists (measured 2026-11-20), and what is missing. Status: ✅ exists ·
🟡 partial · ❌ missing.

## Agent A — Research Agent

| Required capability | Status | Where it lives today | Gap |
|---|---|---|---|
| Research a user-defined question | ✅ | `src/lib/research/pipeline.ts` (refined ≤3 queries, dedupe, caches, page reads) | task-shaped wrapping |
| Gather available sources | ✅ | pipeline + `research/reach/*` (Agent Reach lanes, allowlisted), `research/direct.ts`, `research/browser/obscura.ts` | — |
| Summarize findings | ✅ | orchestrator solve stage + evidence packs | report structure (sections) |
| Compare claims / identify contradictions | 🟡 | `src/lib/verify/claims.ts` (grounding audit), `src/lib/riishe/claims.ts` (786-line claim audit + repair) | explicit contradiction surfacing in a report view |
| Produce a structured report | 🟡 | evidence packs + citations UI (`citation-view.ts`) | deliverable-shaped report artifact |
| Attach source references | ✅ | `EvidenceSourceView` with title/host/date/provenance; orphan markers stripped server-side | — |
| Record its execution receipt | ✅ for background turns | Trust Engine RIISHE adapter (live-verified 2026-11-20) | dedicated research-task receipts (Phase 3) |
| Never fabricate / never claim unopened sources | ✅ (enforced) | page-read provenance (`readEngine`), honest `degraded[]`, `stripUnresolvedMarkers` | keep under evaluation (08) |

## Agent B — Document Intelligence Agent

| Required capability | Status | Where it lives today | Gap |
|---|---|---|---|
| Read supported formats | ✅ | `src/lib/files/extract.ts`: text, PDF (text layer), DOCX, XLSX, PPTX; honest per-format notes; caps | scanned PDFs have no OCR (stated, not silently skipped) |
| Extract relevant information | ✅ | documents attached to turns (≤3, ownership-checked) in `riishe/chat` + background handler | — |
| Summarize / compare documents | 🟡 | orchestrator document context | explicit compare mode |
| Answer grounded in the material | 🟡 | document-aware turns | **grounded mode that refuses general-knowledge substitution when the user requires document-grounded answers** |
| Preserve page/section references | ❌ | extractors currently return plain text | locator capture per chunk (Phase 3) |
| Generate deliverables | 🟡 | existing file/export utilities in CODE GIFTZ surfaces | document deliverable pipeline |
| Provenance + receipts | ✅ (foundation) | TrustEvidence `document` rows (live-verified) + receipts | per-answer citation→document linkage |

## Agent C — CODE GIFTZ Engineering Agent

| Required capability | Status | Where it lives today | Gap |
|---|---|---|---|
| Inspect / understand a repository | ✅ | `src/lib/giftz/workspace.ts`, dependency analysis, frontend-intel catalog | — |
| Explain implementation / prepare change plans | ✅ | `src/lib/code/refactoring/plan.ts`, task modes | — |
| Make targeted changes, preserve unrelated functionality | ✅ | file-ops M23 (`planHash`-bound, staleness checks, atomic multi-file, post-exec verification) + versions M22 (append-only snapshots, rollback-as-new-version) | — |
| Display diffs | ✅ | `src/lib/code/diff.ts`, `src/lib/giftz/diff.ts`, editor UI | — |
| Run appropriate verification | ✅ | `src/lib/verification/pipeline.ts` (bounded verify→correct→re-verify; honest `unverified`), sandbox execution (`src/lib/sandbox/runner.ts`, `unshare -Urn` + rlimits) | — |
| Report exact outcomes and failures | ✅ | `CodeMessage.metaJson` verification summaries; honest job failures | TrustTask receipts per coding task (Phase 3 adapter) |
| Never claim tested/pushed without verification | ✅ | no push path exists in-product; verification states honest | keep as pinned test |
| Sandbox boundaries maintained | ✅ | unchanged (network namespace + rlimits + process separation) | — |

## Cross-cutting requirements

- All three agents share the Trust Engine ledger — one architecture, no
  per-agent evidence stores. (M33, 2026-11-23: the same single ledger now
  also records RIISHE memory-management receipts — create/edit/export/
  delete/replace/conflict-presented — via `src/lib/trust/adapters/
  riishe-memory.ts`; ID-only evidence, no memory content in any ledger field.)
- Approval-required actions (delete/overwrite files, publish, destructive
  commands) must request a scoped `TrustApproval` before execution (file-ops
  already implement the equivalent ledger; agents must route through it).
- Checkpoints: long-running coding tasks persist safe resume state (Phase 1
  remainder), and no recovery claim is made for a task type until implemented
  and verified.


## M41 addendum (2026-11-26) — autonomous multi-agent missions

| Agent role | Execution path | State |
|---|---|---|
| RIISHE (central orchestrator) | mission planning kernel + durable `mission-run` driver | implemented + unit-verified; live acceptance exercised coordination end-to-end |
| CODE GIFTZ (engineering) | real `coding-task` jobs via `submitCodingDelegation` | implemented + live-verified (real files produced: 4-file website build, report.md drafts); full verification blocked this window by the strict hosted audit / one provider truncation (recorded honestly) |
| LAXII (visual) | real image-generation jobs | implemented + live-verified (media workflow asset completed before the video) |
| JAZMII (video) | real text-to-video jobs (ffprobe stream gate) | implemented + live-verified (REAL servable video verified in the media workflow) |
| GANGZII (audio) | real speech-synthesis jobs (validated WAV) | implemented (mission lane); live window saw the audio side-task fail honestly (named in the mission summary) |
| Knowledge/research | real gateway retrieval + Knowledge Atlas | implemented + live-verified (6 real sources; 4 real atlas references) |
| Quality/verification | deterministic payload verifiers + aggregate deliverable gate + hosted self-verification | implemented + live-verified (verifier verdicts on done tasks; the audit gate's strictness on file-fenced replies recorded as requiring repair) |

Contracts: `docs/agents/M41-WORKFLOW-CONTRACTS.md` · Permissions/recovery: `docs/agents/M41-PERMISSIONS-AND-RECOVERY.md` · Acceptance: `docs/agents/M41-ACCEPTANCE-MATRIX.md`
