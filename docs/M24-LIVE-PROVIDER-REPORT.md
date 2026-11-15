# M24 — Live-Provider End-to-End Validation: Delivery Report

Milestone: CODE GIFTZ — M24 · Branch: `main`
Baseline before work: `e6fe3a514cde4212a5ebe1b2c556657570785b6d` (verified against both local
HEAD and `origin/main` via `git ls-remote` before any change).
Companion audit: `docs/M24-LIVE-PROVIDER-AUDIT.md`.
Machine-readable evidence: `validation/m24/reports/acceptance.json` (assembled from per-harness
reports; screenshots and ZIPs under `validation/m24/evidence/`).

**Headline: 169/169 validation checks passed across 26 steps — 23 steps LIVE_VERIFIED,
3 OFFLINE_VERIFIED (honestly labeled controlled-injection / module-level), 0 BLOCKED,
0 FAILED, 0 NOT_TESTED.**

---

## 1. Commit and verified remote SHA

Filled in at delivery time (see the final response): the commit SHA, the push verification
(`git ls-remote origin/main` == local HEAD), and the clean working tree confirmation are recorded
in the milestone response and in `validation/m24/reports/acceptance.json`.

## 2. Provider/model actually used (LIVE)

- Backend: `bean-code-llm-hosted-primary` — the Z.ai authorized hosted gateway via
  `z-ai-web-dev-sdk` (`ZAI.create()`), credential resolved through the platform-managed
  `/etc/.z-ai-config` mechanism (presence verified; values never read into any report or log).
- Model identity is provider-managed and intentionally not disclosed to tenants
  (`registry/backends.ts`); the gateway exposes it as `bean-code-hosted` on `/api/v1`.
- Readiness evidence (`validation/m24/reports/provider-readiness.json`): credential
  `platform-managed` + present, gateway host reachable via the free liveness probe (no quota
  consumed), breaker cold, coding backend enabled with `maxAttempts: 1`.

## 3. Live vs offline test results

| Area | Status | Source |
|---|---|---|
| Provider readiness | LIVE_VERIFIED | provider-readiness.json |
| Generation (real request → complete project) | LIVE_VERIFIED (12/12) | live-workflow.json |
| Persistence + reopen + hash integrity | LIVE_VERIFIED (5/5) | live-workflow.json |
| Targeted edit (one-line change, reviewable diff) | LIVE_VERIFIED (7/7) | live-workflow.json |
| Real-Chromium preview (desktop/mobile/reduced-motion/interaction) | LIVE_VERIFIED (10/10) | live-workflow.json + screenshots |
| Controlled defect → real detection → LIVE AI repair → verified fix | LIVE_VERIFIED (9/9) | live-workflow.json + screenshots |
| Version history + rollback-as-new-version | LIVE_VERIFIED (9/9) | live-workflow.json |
| ZIP export + secret scan + independent extraction/build | LIVE_VERIFIED (8/8) | live-workflow.json + m24-final-export.zip |
| M23 file operations via real HTTP API (zero provider calls) | LIVE_VERIFIED (39/39) | fileops-regression.json |
| Controlled upstream failures through the REAL adapter/breaker code | OFFLINE_VERIFIED (10/10, controlled injection) | failure-modes.json |
| Unified gateway failure semantics + live tiny completion + usage truthfulness | LIVE_VERIFIED (4/4) | failure-modes.json |
| Job lifecycle (queued → cancelled, honest states) | LIVE_VERIFIED (3/3) | failure-modes.json |
| M21 fixtures on isolated copies (build + Chromium + export) | LIVE_VERIFIED (browser/build) + OFFLINE_VERIFIED (hash isolation, exporter module) — 30/30 | fixtures-regression.json |
| Security & privacy (IDOR, CSP, injection, leakage, paths, sandbox) | 21 LIVE_VERIFIED + 2 OFFLINE_VERIFIED steps — 23/23 | security.json |
| Cost/usage discipline | LIVE_VERIFIED | cost-usage.json |

## 4. Generation and persistence evidence

- Realistic request ("FocusBoard" task tracker, self-contained single file) → provider generated
  `main.html` (+ engine-injected `NOTICES.md`, `vendor/gsap.min.js`, `vendor/ScrollTrigger.min.js`)
  in a streamed turn (first token < 30 s, > 10 deltas, terminal `done`, auto version snapshot).
- Static gates on the generated project: dependency analysis (no missing imports), preview audit
  (no missing assets, no broken links), self-contained-entry check.
- Persistence: reopen returns byte-identical files (sha256 map compared), `lastOpenedAt`
  recorded, version history accessible, every version passes live integrity validation.
  Real SQLite rows (`db/custom.db`) — no in-memory substitute anywhere.

## 5. Targeted-edit evidence and changed-file hashes

- Request: change `<h1>FocusBoard</h1>` → `<h1>FocusBoard Pro</h1>`, one file only.
- Result (after the audit fixes): exactly `main.html` changed, terminal `changes` list equals the
  actual changed set, unrelated files byte-for-byte identical, new version snapshot created.
  Before/after sha256 of the changed file recorded in
  `live-workflow.json → targeted-edit.data.beforeAfterHashes`.
- The provider did NOT regenerate the application (≤ 2 files changed check passes with 1).

## 6. Browser preview and interaction evidence

Real Chromium (Playwright 1.57): desktop 1440×900 render with the requested heading; add-task
interaction with zero console errors; mobile 390×844 without horizontal overflow; reduced-motion
context clean; no failed network requests; preview document embeds the M22 error-capture
bootstrap. Screenshots: `preview-desktop.png`, `preview-interaction.png`, `preview-mobile.png`,
`preview-reduced-motion.png`.

## 7. Real error capture and repair evidence

- A reproducible defect (`renderLegacyFooter(nonExistentHelper())` script block) was injected
  into an ISOLATED copy through the real editor pipeline (with `expectedUpdatedAt`).
- Real Chromium captured the actual runtime error (`ReferenceError: renderLegacyFooter is not
  defined`) — screenshot `defect-console-error.png`.
- The LIVE provider drafted a repair; only the reported file changed (`main.html`), the defect
  block was removed, static checks re-ran clean, and the browser verified zero console/page
  errors after the fix — screenshot `repair-verified.png`. Nothing was suppressed or weakened.
- Process note (honest): the isolated repair copy is duplicated BEFORE the targeted-edit request.
  A copy taken after an unsatisfied edit request caused the provider to apply the stale request
  instead of the repair (conversation-history contamination) — measured in run 3 and documented
  in the audit (G4).

## 8. Version and rollback evidence

Generation, targeted edit and repair each created their own version; integrity checks pass on
every version; rollback to the first version created a NEW `rollback` version (history
append-only, all previous versions still accessible) and the workspace matched the target
version byte-for-byte (per-file historical content fetch; the rollback-marker file was removed
by the restore). M23 file-op mutations followed by rollback behave identically
(`fileops-regression.json`).

## 9. M23 regression results

- `scripts/m23/acceptance.ts` re-run: **16/16 steps passed** (real isolated SQLite; M21 fixtures
  hash-verified untouched; cleanup leaves zero fixture projects in product storage).
- PLUS the new live-API regression (`validation/m24/harness/fileops-regression.ts`): **39/39** —
  create/rename/move/batch-move, reference-impact detection + separately-approved repair,
  destructive delete with bound confirmation, protected-path and root-deletion refusal,
  stale-plan rejection, cross-project opId refusal, ambiguity clarification listing every match,
  traversal/absolute-path refusal, idempotent replay, rollback after mutation. **Zero provider
  calls** — deterministic file operations are fully available during a provider outage.

## 10. Export and independent build results

- `GET /api/code-giftz/projects/[id]/export` returned a verified archive (`unzip -t` clean);
  README + `manifest.json` with per-file sha256 present; no `node_modules`/`.env`/secret files;
  secret content scan clean; path-traversal-safe entry names.
- The archive was extracted OUTSIDE product storage and the extracted app was served and loaded
  in Chromium (h1 present, zero page/console errors) — evidence
  `validation/m24/evidence/{m24-final-export.zip, extracted/, independent-build/}`.
- The three M21 fixture copies exported through the real exporter module also verify (30/30).

## 11. Security and privacy results (23/23)

- IDOR: cross-account project detail/export/preview/versions/file-op-execute all refused with
  404 (no existence leak); an unauthorized execute attempt mutated nothing.
- Preview isolation: CSP `default-src 'none'; script-src 'unsafe-inline'…`, `nosniff`.
- Prompt injection through project files (rename/delete/exfiltrate instructions) executed
  nothing, leaked nothing, and the service stayed healthy — deterministic file-ops never read
  instructions from file content.
- Secret leakage: gateway apiKey value absent from server logs and every saved report; no
  session cookies in reports.
- Malicious paths: `assertSafeProjectPath` rejects traversal/absolute; `applyFiles` (the single
  content-write path) throws before any write; export layer covers archive escape.
- Sandbox: hostile probe saw NO `DATABASE_URL`, NO provider key, network blocked, wall-clock
  respected; per-run isolation profile reported honestly.
- Failure handling: cloud-metadata endpoints refused even under the local-rig hatch; 429 → typed
  `UpstreamRateLimitError` with provider `Retry-After` honored (measured 12 000 ms clamp-in-range);
  consecutive 429s open the per-class breaker (fail-fast, no retry storm); 5xx/malformed → typed
  failures, never fabricated output; recovery works after the window.

## 12. Actual test counts and quality gates (no coverage reduced)

| Gate | Result |
|---|---|
| `bun run test` (full suite) | **1885 pass / 0 fail** across 133 files (38 649 expect calls) |
| TypeScript (`bunx tsc --noEmit`) | 0 errors in `src/`, `tests/`, Prisma and all M24 files; 137 pre-existing errors remain in unrelated one-off tooling scripts (same class on baseline; outside the build include path) |
| ESLint (`src/` + new tests) | 0 problems; repo-wide lint is red on baseline AND M24 tree with identical pre-existing generated-fixture findings |
| Production build (`bun run build`) | exit 0 |
| Security tests | 23/23 M24 checks + full-suite security suites green |
| M21 fixture regression | 30/30 (isolated copies; originals untouched) |
| M22 persistence regression | 11/11 (`scripts/m22/acceptance.ts`) |
| M23 file-operation regression | 16/16 (`scripts/m23/acceptance.ts`) + 39/39 live-API |
| Real SQLite integration | every M22/M23/M24 evidence run persisted to real databases |
| Real browser tests | Playwright Chromium throughout M24 (previews, defect, repair, fixtures, independent build) |
| ZIP integrity + secret scan | clean on all four archives |
| Preserved inventory | 168 React Bits components, 15 GSAP patterns, 13 Vanta effects, internal AI design skills, existing UI restrictions — untouched |

M24 added tests only: `tests/unit/code-preview-inline.test.ts` (5) + 4 frontend-intel-engine
regression tests. No test was deleted, skipped or weakened.

## 13. Known limitations and blockers

1. **Mid-stream connection loss** is indistinguishable from a clean end on Bun fetch, and the
   hosted SDK discards the `[DONE]` sentinel and `finish_reason` (measured live: a SUCCESSFUL
   hosted stream surfaces no `finish_reason` at all — `scripts/m24/probe-stream-shape.ts`).
   Partial provider text is therefore delivered verbatim (nothing fabricated, nothing marked
   complete beyond what arrived); hang protection exists via idle/total stream timers;
   provider-reported truncation (`finish_reason: length`) IS surfaced as the typed
   `UpstreamTruncatedError` with bounded continuation. Not fixable without SDK wire access.
2. **Conversation-history contamination** (G4): a project duplicated after an unsatisfied edit
   request can steer a later repair turn toward the stale request. Mitigated in validation design
   (isolated copy taken before edits); product-level fix would require message pruning — out of
   M24 scope, documented in the audit.
3. `/api/v1/chat/completions` has no tools/function-calling surface; the external streaming lane
   has no fetch-level timeout (idle/total guards apply). Pre-existing, unchanged.
4. Providers report no cost data — metering stays request/token-based with `costMicros` honestly
   null; no monetary budget enforcement exists (documented product posture).
5. Self-verification defaults to disabled (`BEAN_VERIFY_ENABLED`); static deterministic checks
   run instead.
6. No blockers remain: live credentials were available (platform-managed), so nothing in this
   milestone is BLOCKED.

## 14. Artifacts

- `validation/m24/reports/acceptance.json` — assembled machine-readable acceptance (labels:
  LIVE_VERIFIED / OFFLINE_VERIFIED / BLOCKED / FAILED / NOT_TESTED).
- `validation/m24/reports/{provider-readiness,live-workflow,fileops-regression,failure-modes,fixtures-regression,security,cost-usage,quality-gates}.json`
- `validation/m24/evidence/` — screenshots (desktop/mobile/reduced-motion/defect/repair), four
  verified ZIP archives, extracted + independently built copies.
- `validation/m24/fixtures/` — isolated M21 fixture copies (originals hash-verified untouched).
- `validation/m24/harness/` — the six reusable validation harnesses + assembler.
- `scripts/m24/probe-provider.ts`, `scripts/m24/probe-stream-shape.ts` — readiness/stream probes.
