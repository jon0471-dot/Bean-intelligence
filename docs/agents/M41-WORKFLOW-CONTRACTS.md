# M41 — Workflow Contracts

> Every task emitted by the planner carries the full contract. This page pins the four canonical workflows: what is decomposed, in what order, with which verification criteria, and what each stage hands to the next. Evidence classes: `unit` = pinned by tests; `live` = exercised in the M41 acceptance window against the real app.

## A. Website build (`website-build`)

```
[asset-image]  (OPTIONAL — only when the objective names a logo/hero/banner/…)
     │ LAXII · image-generation job · requireArtifact
     ▼
[build]        CODE GIFTZ · coding-task · requireSelfVerification · minFileChanges≥1
               (sandbox pass required only for debug missions)
     ▼
[verify]       QUALITY · aggregate integrity gate over the chain
```

- Asset-before-build ordering is enforced by the dependency edge (the build integrates the asset).
- Deliverable: the engineering project with real file changes and a passing self-verification.
- Evidence: kernel `unit`; live acceptance in this window was **blocked** by provider truncation + the strict hosted audit (honest-unavailable / FAIL rows in `mission-evidence-m41.json`) — NOT claimed.

## B. Media production (`media-production`)

```
[asset-image]   LAXII   ─┐ (parallel where budgets allow)
[asset-audio]   GANGZII ─┤ (only with explicit spoken text — narration is never fabricated)
                        ├─► [asset-video]  JAZMII · T2V · requireArtifact + ffprobe stream gate
                        ▼        ▼
                     [verify]  aggregate gate: every artifact real + validated
```

- Deliverable: the video asset (`asset-video`), with the visual/audio assets delivered alongside.
- Handoff honesty: JAZMII's current product delegation is text-to-video only — generated images/audio are delivered as a verified SET, not spliced into the render. That limitation is stated, not hidden.
- Evidence: **live PASS** — `completed_partial` with a real verified hosted video; parallel-lane observations recorded (`imageDoneBeforeVideoDone: true`).

## C. Research → verified document (`research-document`)

```
[research]    KNOWLEDGE · real gateway search · minSources≥3 (titles+URLs — exactly what the lanes capture)
[knowledge]   KNOWLEDGE · Atlas consultation · minSources≥1 · INDEPENDENT SIDE TASK
     │(research)        │
     ▼                  └─► (side failure ⇒ completed_partial, deliverable intact)
[document]    CODE GIFTZ · coding-task · requireSelfVerification · minFileChanges≥1
              · requireSourceCitation (handoff must be cited) · deliverablePath=<noun>.md
     ▼
[verify]      aggregate gate + research-pack verification
```

- Handoff (`researchPackHandoff`): bounded sanitized digest of the REAL sources, appended to the document objective as a labeled DATA block; the citation contract makes the document verifier REQUIRE the handed-off sources.
- Evidence: retrieval lane **live PASS** (6 real sources); atlas lane **live PASS** (4 references); the document lane was **blocked** in this window by the hosted audit (see the architecture page §6) — honestly recorded, not claimed.

## D. Debug an application (`debug-app`)

```
[build]   CODE GIFTZ · coding-task · reproduce FIRST, minimal fix · requireSelfVerification
          · requireSandboxPass (the fix must RUN) · minFileChanges≥1
     ▼
[verify]  aggregate gate
```

- Deliverable: real file changes + a sandbox run that exits 0.
- Evidence: kernel `unit`; live run not exercised in this window (same verifier-strictness blocker as A — recorded honestly).

## Refusal contract (applies to every mission)

`planMission` refuses — with a truthful customer-safe reason — anything that is not a genuine multi-part execution objective: questions ("how do I build…"), short/oversized text, single-domain requests (served by the ordinary chat flow), and unrecognizable objectives. Refusals are pinned by tests and surfaced identically through chat tools and the REST API (HTTP 422 with the reason).

## Correction + failure semantics (all workflows)

- A `needs_correction` verdict (from the deterministic verifier OR the specialist's own hosted self-verification) triggers exactly one bounded correction round: the resubmission objective carries a `CORRECTION ROUND` digest with the concrete failure reasons (plus the research pack where relevant).
- Permanent specialist failures are terminal — retrying them forever would be dishonest noise; re-entry is strictly budgeted (attempts, or verification-driven corrections).
- Skip propagation reaches only unexecuted downstream tasks; retryable failures block nothing until they are unrecoverable.
