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

## M41.7 addendum (2026-11-26) — mission-aware deliverable verification

Repairs the M41 addendum's recorded blocker (the hosted audit auditing the
file-fenced reply instead of the deliverable). Same architecture, honest
targets — no second verifier.

| Agent role | Change | State |
|---|---|---|
| Quality/verification | audits the EXTRACTED DELIVERABLE (hosted pipeline, mission-aware input with deterministic pre-check facts + file-inventory anchor) AND the real persisted CodeFile rows (document: the ten-check contract incl. citation correspondence to the exact handed-off sources; website: static-site audit reusing preview-audit — entry + resolvable references, no package.json demand) | implemented + live-verified (document mission completed with the persisted report verified; website mission completed with the persisted build verified: 11 files, references resolve; hosted probe pass@1.0 on the real project) |
| CODE GIFTZ (engineering) | mission-delegated coding jobs carry the trusted verification context (server-only third parameter — the model tool structurally cannot alter its own acceptance contract); job results carry honest verificationSkippedReason | implemented + live-verified |
| RIISHE (central orchestrator) | mission executor loads the persisted workspace snapshot project-scoped and passes it to the pure verifiers; orphaned-mission sweeper settles ledgers whose driver died terminally (harness-exposed gap) | implemented + live-verified |

Post-fix acceptance: 20 PASS / 4 honest-unavailable / 0 FAIL (24 rows; original
evidence preserved byte-for-byte as `mission-evidence-m41-PREFIX.json`).
Results: `docs/agents/M41.7-ACCEPTANCE-RESULTS.md` · Contract:
`docs/agents/M41.7-DELIVERABLE-VERIFICATION-CONTRACT.md` · Report:
`docs/M41.7-IMPLEMENTATION-REPORT.md`

## M43 addendum (2026-11-27) — real-world intelligence & evidence reasoning

Every specialist now consumes VERIFIED EVIDENCE, not raw references, through the same M42 contract:

- **Shared evidence layer** (`src/lib/research/evidence.ts` + `source-trust.ts` + `claim-verification.ts` + `contradiction-reasoning.ts` + `freshness.ts`): claim-scoped records with identity/provenance/independence; claim verification with the honest 8-outcome ladder (verified | strongly-supported | partially-supported | contradicted | outdated | insufficient-evidence | unverifiable | source-unavailable — never a forced PASS); authority = host class × claim kind (frequency/population-proof by construction).
- **RIISHE**: claim-evidence-strength audit + uncertainty statements in the existing verification note (repair prompt weakened overreaching statements to evidence-backed strength).
- **CODE GIFTZ**: official OSV.dev advisories appended to the tech-docs block (deterministic dispatch; UGC never enters the engineering prompt; version-range check instruction).
- **Mission payloads**: additive claims/uncertainty/attribution/freshness fields over what was actually retrieved; quality gate pass rules UNCHANGED (audit notes ride in reasons).
- **Knowledge memory**: `EvidenceKnowledge` records with THE GUARD (unverified notes can never become trusted knowledge), dedupe→supersession chains, per-user isolation, owner-scoped retraction.
- Evidence: docs/intelligence/M43-ACCEPTANCE-MATRIX.md — live acceptance 20 PASS / 0 unavailable / 0 FAIL; unit suites 109; full tree 3099/0/10; UI unchanged.
