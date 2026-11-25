# M40 — IMPLEMENTATION REPORT: REAL HARDWARE ACCEPTANCE & UNIVERSAL AI CAPABILITY COMPLETION

> Branch: `feat/m40-real-hardware-capability-completion` · Window: 2026-11-24 → 2026-11-25
> Repository: `github.com/jon0471-dot/Bean-intelligence`
> Companion docs: `docs/ai/M40-BASELINE-RECOVERY.md` (Milestone 0 record), `docs/ai/MODEL-EXECUTION-MATRIX-M40.md`, `docs/ai/MISSING-CAPABILITIES-M40.md`, `docs/ai/RTX-5060-TI-ACCEPTANCE-M40.md`, `docs/ai/LOW-SPEC-ACCEPTANCE-M40.md`.
> Governing rules honored throughout: no placeholder responses, no mock inference, no simulated success, no lifecycle-state inflation; "a GPU capability probe … is NOT proof of actual model inference"; **no claim that every model works merely because all tests pass**; no new user-visible hardware/model/runtime controls; no merge into `main` without separate owner authorization.

## 1. Summary

M40 makes BEAN's registered AI capabilities genuinely runnable and honestly
reported on compatible hardware — including low-spec hosts — without adding a
single new user-facing control. The three capabilities M39 declared missing
(OCR, embeddings, reranking) now run as REAL inference lanes through the
existing infrastructure; the full 32-lane execution matrix was re-run against
the live production server in this window; a real-hardware RTX 5060 Ti
acceptance harness (ten-point checklist) and the exact Windows-PC commands are
delivered (the GPU pass itself is honestly pending owner hardware acceptance);
low-spec execution was MEASURED on a genuinely constrained 2-vCPU/4 GB host;
and five-product end-to-end acceptance evidence was captured through the real
UI/routes with zero page errors and zero fabricated outcomes.

## 2. Milestone record

### Milestone 0 — SAFE BASELINE RECOVERY (commit `8caa3c5`, m40.0)

Fresh fetch + independent SHA verification (none assumed): baseline
`origin/main` `eff0d969…` exactly as instructed; M39.5 `e856d571…` and M39.6
`8f9c1fba…` verified reachable, M39.6 descending from M39.5; M40 branch created
at `origin/main` and fast-forwarded to `8f9c1fba` (no cherry-picks, no
rewrite); `main` untouched. Full record: `docs/ai/M40-BASELINE-RECOVERY.md`.
*Post-window note (recorded, verified by fresh fetch at report time): the owner
subsequently merged the branch to `main` via PR #20 and PR #21 — the only
merges into `main`, both owner-authorized; the working branch continues on top
of that history with ordinary fast-forward pushes only.*

### Milestones 1–4 — audit, harness, low-spec, missing capabilities

| Commit | Content (see the per-milestone docs for full evidence) |
|---|---|
| `37504b7` (m40.1) | OCR + embeddings + reranking as REAL CPU lanes; capability-record verbs, engine-catalog entries, manifests, admin-gated install + companion-artifact integrity; RIISHE `search_document` tool (no vector DB); 20 new tests; full suite 2817 pass |
| `32c0aac` (m40.2) | registry honesty: real router adapter map reconciles drift-free; ORT wasm assets realigned to the LOCKED onnxruntime-web build (sha256-verified); standalone output tracing carries tesseract.js + kokoro-js runtimes |
| `d03358c` (m40.3) | RTX 5060 Ti acceptance harness driving the REAL segmentation lane through the ten-point checklist + measured sandbox smoke (honest refusal path); exact Windows-PC commands (`RTX-5060-TI-ACCEPTANCE-M40.md` §4). **No GPU inference is claimed from this sandbox.** |
| `add3ce4` (m40.4) | genuine low-spec execution MEASURED on the real 2-vCPU/4041 MB CPU-only host (NOT a simulated profile): OCR cold 622 ms / steady 84–107 ms (confidence 94.0); embeddings cold 179 ms / steady 59–73 ms (cos 0.9654 vs −0.0227); rerank cold 142 ms / steady 63–72 ms (relevant-top-1); idle reaper measured LIVE (`BEAN_LOCAL_MODEL_IDLE_UNLOAD_MS=4000`: RSS 237.1 → 212.7 MB, post-reaper inference still succeeds) |
| `ab7209e` (m40.5) | execution matrix completed 12/12 against the live server + two measured-live defects fixed (tesseract worker path / vision-429 upload corruption), 9 new regression tests, pre-fix run preserved as the honest defect trail |

### Milestone 5 — PRODUCT END-TO-END ACCEPTANCE (this window)

`scripts/m40-acceptance/product-e2e.ts` drives the five flagship products
through their REAL routes with task-specific validation
(`scripts/m40-acceptance/out/product-e2e-m40.json`; budgeted runner,
`--merge`/`--only` for honest partial windows):

- **RIISHE**: document-understanding PASS (extraction persisted `ready`); image-OCR route PASS (REAL local OCR recorded beside the vision lane, whose independent rate-limit was honestly noted — the m40.5 contract holding in production); text-generation and document-grounded-QA honest nulls (upstream 429, §5).
- **CODE GIFTZ**: honest null this window (same upstream throttle). Last verified REAL generation + sandbox execution: M39 same-day runs 2026-11-24 (FizzBuzz stdout-verified) — `MODEL-EXECUTION-MATRIX-M39.md` §2.
- **LAXII**: deterministic enhancement PASS (256×256 fixture → structurally decoded PNG); invalid-input rejection PASS (garbage bytes → HTTP 400 "File is not a decodable image", nothing accepted silently). Local MODNet/LaMa lanes validated in the same window by the matrix (matte + inpaint outputs).
- **JAZMII**: local motion lane PASS (REAL RIFE artifact served, provenance `local-motion-rife`); hosted T2V honesty lane — poll window elapsed under the upstream 429 and **no success was claimed**; the job remains tracked to a truthful terminal state.
- **GANGZII**: engine-install PASS (Kokoro-82M q8 sha256-verified) + synthesis PASS (184,844-byte RFF-validated WAV).
- **Score: 8 PASS / 4 honest-unavailable / 0 FAIL** — every null carries its exact external reason; nothing faked.

### Milestone 6 — PRIVACY AND RELIABILITY

`scripts/m40-acceptance/privacy-reliability-sweep.sh`
(`out/privacy-reliability-sweep.txt`, 10/10 green): no Ollama (the only two
"ollama" strings are the explicit policy-refusal comments), no miner
indicators, no hardcoded key literals, no cross-visitor compute dispatch; the
consent gate, SHA-256 integrity verification, bounded concurrency caps,
abort/cancellation, memory-feasibility gates and the own-session-only privacy
rule (`src/lib/client-compute/privacy.ts`: "no visitors' hardware used for
other users' jobs") are all present and exercised by the 112-test M39 battery,
re-verified green in the M40 full-suite run. No hidden paid fallbacks; no
silent model downloads (consent + checksum gate proven live when the RTX
harness smoke showed the registry REFUSING a download where the runtime was
unavailable).

### Milestone 7 — UI AND LIVE PREVIEW

Real app driven at the final worktree HEAD via the browser automation CLI;
evidence in `validation/m40-ui/final-head/` (dashboard desktop + 390×844
mobile, all five product workspaces, `console.txt`, `page-errors.txt`):

- The black-gold BEAN interface is unchanged; **no** hardware/model/runtime selector, settings panel or toggle was added (the LAXII "Process large images on this device" toggle is the pre-existing optional consent control).
- Availability chips report the MEASURED state truthfully (e.g. "Conversational chat Rate limited (HTTP 429)", "Masked edit needs worker", "Local Diffusers worker Not configured") — the honesty surface working live.
- **Zero page errors**; console contains only dev-mode HMR/React-DevTools info lines.
- Internal provider/model names do not appear in customer-visible UI (asserted by the m40.5 composition tests and observed across the captured screens).

### Milestone 8 — VERIFICATION AND DOCUMENTATION

Validation at the final HEAD (all commands run in this window):

| Check | Result |
|---|---|
| Full test suite (`bun test --isolate tests/`) | **2827 pass / 0 fail / 5 skip across 214 files** (42,429 expect calls) |
| Type check (`npx tsc --noEmit`) | **no NEW error files vs the pre-M40 baseline** (44 error files, identical set) |
| ESLint (all touched + new files) | clean (exit 0) |
| Prisma (`bunx prisma validate`) | valid |
| Production build (`bun run build`) | success (workers built, ORT assets copied, standalone output + native libs traced) |
| Security/privacy sweep | 10/10 green (§ above) |

Documentation set completed: this report + `MODEL-EXECUTION-MATRIX-M40.md` +
`MISSING-CAPABILITIES-M40.md` + the earlier `RTX-5060-TI-ACCEPTANCE-M40.md`,
`LOW-SPEC-ACCEPTANCE-M40.md`, `M40-BASELINE-RECOVERY.md`.

## 3. Commit & push manifest (all normal fast-forward pushes, remote SHA verified via `git ls-remote` after each push)

| Commit | Milestone | Remote-verified |
|---|---|---|
| `8caa3c5` m40.0 | baseline recovery record | at push time (see baseline doc §2) |
| `37504b7` m40.1 | OCR/embeddings/reranking real lanes | yes (m40.1 session) |
| `32c0aac` m40.2 | registry honesty + ORT realignment | yes |
| `d03358c` m40.3 | RTX harness + doc | yes |
| `add3ce4` m40.4 | low-spec measured probe + doc | yes |
| `ab7209e` m40.5 | matrix 12/12 + measured fixes | `git ls-remote` = `ab7209e…` (this window) |
| this commit | product E2E + privacy sweep + UI evidence | verified at push |
| docs commit | the three M40 docs | verified at push |

## 4. What M40 does NOT claim (the honest remainder)

1. **No RTX GPU inference claim.** The sandbox has no WebGPU adapter (physical fact). The acceptance harness + exact Windows-PC commands are delivered (`RTX-5060-TI-ACCEPTANCE-M40.md` §4); ten-of-ten `ok:true` there IS the RTX acceptance.
2. **No physical low-end-device browser claim.** Real constrained-host CPU measurements exist; a physical old-laptop pass remains a separate, unclaimed evidence class.
3. **No hosted-LLM re-validation claim for this window.** The upstream gateway returned sustained 429s throughout; the breaker refused to worsen it. Hosted-LLM lanes are honest nulls with the reason recorded, and the last verified hosted inference (M39, 2026-11-24: RIISHE chat + GIFTZ sandbox PASS) is dated and cited — never silently reused as if it were same-window evidence.
4. **No claim that every model works because tests pass.** Per-capability operational status is exactly the matrix (§2/§3) + the missing-capabilities ledger; dormant-credential, not-deployed and never-implemented backends are named as such.
5. `jazmii.video-generation-wan` remains **not implemented** (registry `enabled:false`) — an honest non-existent lane, not a hidden stub.
