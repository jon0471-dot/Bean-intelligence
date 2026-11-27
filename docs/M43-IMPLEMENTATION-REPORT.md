# M43 — Implementation Report

> Branch: `feat/m43-real-world-intelligence` · Baseline: `fee31c2` (stacked on the verified complete M42 history `9d05757` + reconciled main `5cad5a0` via a normal merge) · Final tip of the implemented work: see the commit table. Companion docs: `docs/intelligence/M43-{EVIDENCE-ARCHITECTURE,SOURCE-TRUST-POLICY,CONTRADICTION-AND-UNCERTAINTY,KNOWLEDGE-FRESHNESS,ACCEPTANCE-MATRIX}.md`.

## 1. Objective (restated)

Transform BEAN from a system that retrieves web references into an evidence-driven intelligence system — claim-level verification, domain-sensitive trust, honest contradiction representation, freshness policy, and knowledge retention with provenance — consumed by ALL products through their existing workflows, with no second engine, no new product, no UI change.

## 2. Phase 0 — baseline recovery (what was found, exactly)

- `origin/main` = `5cad5a0` (Merge PR #32). M42's PR #32 verified merged.
- `feat/m42-universal-web-research-access` tip = `9d05757` — exact match to the reported tip.
- The four reported branch-only commits exist and are NOT in main: `a75b62b` (M42.5 race sinks + live 7-consumer acceptance), `ace7023` (complete M42 documentation set), `e02b551` (final verification sweep), `9d05757` (merge-state record).
- **PR #33 does not exist** (GitHub redirects `/pull/33` → `/issues/33`; `pull/33/head` ref missing). PR #32's title page confirms the merge.
- M43 was created stacked on `9d05757` (the COMPLETE M42 history, not the incomplete main baseline) and reconciled with `5cad5a0` via a NORMAL merge `fee31c2` (one worklog conflict resolved keeping both the M41.7 and 0-M42 entries; no history rewritten; every commit preserved). The merge's parent set: `9d05757` + `5cad5a0`; the pushed tip was remote-verified before any implementation.
- Stale local working-tree artifacts (pre-sync M41/M41.7 files already pushed) were preserved in a labeled stash, never deleted.

## 3. Commit trail (each pushed and independently remote-SHA-verified at commit time)

| Commit | Content |
|---|---|
| `fee31c2` | m43.0 baseline: stack on 9d05757 + reconcile main (normal merge) |
| `95f8dee` | m43.1 shared evidence representation + domain-sensitive source trust (23 tests) |
| `03ce9dc` | m43.2 claim-level fact verification — the 8-outcome ladder (22 tests) |
| `8b60027` | m43.4 contradiction & uncertainty reasoning — M37 engine reused, 10 kinds (16 tests) |
| `8f0e217` | m43.5 knowledge freshness — seven domain policies, supersession chains (13 tests) |
| `12a2cef` | m43.6 traceable knowledge memory — EvidenceKnowledge model + THE GUARD (18 tests) |
| `ebdbf49` | m43.7 all-product integration — RIISHE orchestrator, CODE GIFTZ advisories, mission payloads, quality audit (7 tests) |
| `3f5abca` | m43.9 security/privacy/copyright hardening (10 tests) |
| `dd84b44` | m43.10 the 20-area live acceptance suite + recorded evidence JSON |
| `d0e7dff` | m43.11 suite-found mock fix (bisected; baseline verified) + environment restores recorded |
| `9f02b04` | m43.12 live UI walk record (5 screenshots + console.txt) |

Documentation commit (this one) follows.

## 4. Test evidence

- Full suite on the final tree: **3099 pass / 0 fail / 10 standing honest skips** across 231 files (M42 recorded 2990/0/10; +109 = the M43 suites). The 10 skips are the standing real-model/render suites (MiniLM inference, reranker, OCR, HyperFrames) — unchanged from M42's record.
- M43 suites: 109 tests across 7 files (`tests/unit/m43-*.test.ts`), all green; neighbor suites re-run green (research family, mission executor/verifier/core 61, claim grounding/repair 66).
- tsc: zero errors in all changed files; the 18 pre-existing baseline errors are untouched.
- eslint: clean on every touched file (verified per commit).
- prisma: schema valid; `db push` applied additively (EvidenceKnowledge CREATE TABLE + 4 indexes; row counts 0 → 0; production DB migration remains an owner operation).
- Production build: `next build` exit 0 (BEAN_BUILD_NO_STANDALONE=1, the documented 4 GB-sandbox mode).
- Secret sweep: the only new persisted artifacts are committed docs/tests/acceptance JSON — no credentials (the suite runs with userId: null and stores no secrets; the knowledge-store redaction test pins credential redaction at write time).

## 5. Live acceptance (2026-11-27 window)

`scripts/m43-acceptance/evidence-suite.ts`: **20 PASS / 0 HONEST-UNAVAILABLE / 0 FAIL** (13 LIVE + 7 FIXTURE; 0 traced late rejections), evidence JSON committed verbatim. Highlights: real official advisory CVE-2020-28500 (GHSA-29mw-wpgm-hmr9) retrieved from osv.dev through the M42.3b lane; the Node.js LTS objective verified over 5 real sources with an honest `partially-supported` (no primary authority this window — recorded, never upgraded); per-user isolation and foreign-retraction refusal proven. The M42.5 unhandledRejection tracer runs inside the suite; late gateway losers are recorded, never fatal, never hidden.

## 6. Live UI walk (Phase 11)

Real app on the pushed branch tip (`next dev`): sign-in → dashboard (5 product cards, honest availability chips — LAXII Degraded with Blocked rows, GANGZII Kokoro Unavailable — measured, not assumed) → RIISHE workspace → LIVE grounded chat probe (Node.js Active LTS): real answer from live sources, Sources(3) disclosure, verification note visible in the EXISTING citation surface. **Zero new research dashboards, source settings, model controls or configuration panels. Black-and-gold identity intact. 0 page errors; console dev-mode info only.** Artifacts: `validation/m43-ui/` (5 screenshots + console.txt).

## 7. Environment incidents (recorded honestly, same recycled-sandbox interference family)

- The sandbox auto-commit daemon flipped HEAD to the stray local main commit during Phase 0 (the M40/M41.7 documented pattern). Mitigated with a dedicated git worktree (`.m43work`) — all M43 work ran there; the pushed branch was never affected.
- The cleanup driver later wiped BOTH gitignored `node_modules` copies mid-walk (~4 GB). Git-tracked trees were untouched. Recovered: `bun install --frozen-lockfile` (981 packages) + `prisma generate` (fresh installs lack the generated client) + pinned vocab re-verified (SHA-256 `07eced375cec144d…`, 231,508 bytes — exact). One dev-server OOM/restart cycle (the documented 4 GB dev-mode pattern).
- One suite regression WAS introduced by M43 and fixed: the narrowed `techdocs-reach` test mock missing the new export (M43.11) — found via full-suite bisection to the exact pair, proven against the baseline tree (0 fail there), fixed with a pass-through mock. No test weakened; the full suite was re-run green end to end after every fix.

## 8. Remaining honest limitations

See `docs/intelligence/M43-EVIDENCE-ARCHITECTURE.md` §10. Summary: deterministic (not model-side) claim reasoning; `updatedAt` never invented; direct-lane overflow-only pack merge; no embedding-assisted knowledge recall (no duplicate vector store); EvidenceKnowledge production DB migration is an owner operation; acceptance rows are one recorded window — re-runs re-record, never overwrite; BEAN does not claim to know everything or to reach every website (M42 boundary, unchanged).
