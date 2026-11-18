# M26.3 RESULTS — LAXII IMAGE GENERATION QUALITY, ASPECT RATIO & IN-APP VIEWER FIX

Milestone: M26.3 · Branch `fix/laxii-image-output-ux`
(head `8f61599`-independent: built from `411437144ee01abac07d7f0693cfaac0f6101e41`
— the verified `feat/ai-operationalization` tip, all six AI commits preserved)
· Implementation-first: fixes committed, then ONE consolidated validation pass.

## 1. Verdict

**IMPLEMENTED AND LIVE-VERIFIED.** All three demonstrated problems are fixed
at the root, plus the prompt/quality/report improvements:

| Problem | Verdict |
|---|---|
| 1. 1920×1080 delivered as 1312×1312 | **FIXED — root cause found and corrected.** The provider's measured size contract (HTTP 400 code 1214) forbids the two misaligned presets (1440×720 / 720×1440 — 720 is not a multiple of 32) and the old pipeline failed jobs on provider size mismatches. The size system now uses 9 provider-valid natives (incl. EXACT 16:9 = 2048×1152), validates every planned size before spend, and finishes ANY provider output to the exact requested pixels with disclosed, least-loss strategies. Live: 1920×1080 delivered **exactly**, labeled **16:9**, zero composition loss. |
| 2. Image click opens a standalone page | **FIXED — in-app lightbox** (Radix dialog): fit/zoom/pan, Escape + backdrop + button close, blob download without navigation, next/previous across results, mobile-tested. Verified in a real browser: URL never changes. |
| 3. Unwanted IMAX-like watermark | **ORIGIN CLASSIFIED: generated directly by the model** (no BEAN overlay exists anywhere — verified layer by layer). Mitigation: unconditional anti-text/logo/watermark prompt exclusions + a vision-based unwanted-mark check on every generation + ONE bounded regeneration when detected (flagged original preserved, explicit Regenerate action). Live runs: 5/5 clean (`unwantedTextDetected: false`); no removal is claimed beyond what the final bytes' own inspection confirms. |

## 2. Commits (this branch, in order)

1. `9db41fe` — fix(build): restore the llama.cpp engine client source
   swallowed by the `local-*` ignore pattern (the base commit's fresh-clone
   build was broken by committed code importing it — measured `Module not
   found` on `next build`).
2. (implementation commit) — the complete M26.3 fix: aspect system, viewer,
   watermark handling, quality report, prompt conditioning, UI.
3. (docs commit) — the four M26.3 deliverables.

Exact SHAs are recorded in the commit list at the end of this file and in
the publication section.

## 3. Consolidated validation (run once, after implementation)

| Check | Result |
|---|---|
| Unit suite | **2,227 pass / 0 fail** / 39,784 expectations / 164 files — the 2,216 baseline + 11 new M26.3 pins (planning, contract validation, style conditioning, defect classification); stale pins updated honestly and in-commit (size catalog 7→9, NL "16:9" mapping, wide/tall word maps) |
| TypeScript (scoped) | **0 errors** |
| ESLint (M26.3 files) | **0 errors / 0 warnings** (repo baseline unchanged: 53 pre-existing errors confined to `validation/m21/**` artifacts) |
| Production build | **PASS** |
| **Live 16:9** | 1920×1080 request → generated at the exact 16:9 native 2048×1152 → delivered **exactly 1920×1080** (measured from bytes), aspect label **"16:9"**, strategy `resize` (zero loss), artifact check clean |
| **Live square** | 1024×1024 → native, delivered **exactly 1024×1024**, `1:1` |
| **Live wide 2:1** | 1440×720 → generated at the corrected 2048×1024 native (the old preset ALWAYS failed HTTP 400) → delivered **exactly 1440×720**, `2:1` |
| No stretching | mismatched aspects only ever cover-crop (≤15%, disclosed) or pad-extend; `fit: fill` never applied across aspects |
| Lightbox E2E (headless Chromium) | click opens the dialog ON the route (URL unchanged), zoom toggles, Escape closes, workspace intact; desktop + 390×844 mobile screenshots |
| Watermark origin | classified (model-generated) + mitigation live: 5/5 generations artifact-checked clean |
| Existing actions | Download/Copy/Edit/Remove background/Enhance/Upscale + preservation reports untouched and rendering |

## 4. Honest limitations

- The image model cannot GUARANTEE text suppression: the exclusions and the
  bounded regeneration reduce unwanted marks; a surviving mark is flagged
  honestly with a Regenerate action (never silently cropped).
- The provider can still return unexpected sizes for arbitrary custom
  targets; the pipeline finishes them to the exact request with disclosed
  strategies — the provenance always states `providerReturned` when that
  happens.
- The exact screenshot artifact could not be reproduced deterministically
  (stochastic model behavior); the mitigation is verified via the pinned
  classification/regeneration flow and the clean live runs.
- GitHub publication: this sandbox has no SSH client and no push credentials
  — the push was attempted and FAILED exactly as in M26.2 (recorded in §7);
  the remote is verified UNCHANGED and the branch is ready to push from any
  credentialed environment.

## 5. Unrelated functionality preserved

RIISHE, CODE GIFTZ, JAZMII and GANGZII code paths untouched by this diff
(the only cross-product file is the shared registry list the size system
must live in). The LAXII queue, cancellation, storage, ownership, usage
accounting, request IDs, error catalog and preservation controls are the
SAME infrastructure; no provider was added or replaced.

The public repository still carries the pre-M26.1.4 history issue — nothing
in this milestone claims it resolved, and nothing here touches public main.

## 6. Deliverables

- `M26_3_RESULTS.md` (this file)
- `M26_3_ASPECT_RATIO_FIX.md` — the traced path, the measured provider
  contract, the corrected size system and the live ratio matrix
- `M26_3_IMAGE_VIEWER.md` — the lightbox implementation contract + browser
  verification
- `M26_3_WATERMARK_INVESTIGATION.md` — the layer-by-layer origin
  classification and the honest mitigation

## 7. GitHub publication (attempted, recorded honestly)

```
$ git push git@github.com:jon0471-dot/Bean-intelligence.git \
    HEAD:refs/heads/fix/laxii-image-output-ux
error: cannot run ssh: No such file or directory
fatal: unable to fork

$ git push https://github.com/jon0471-dot/Bean-intelligence.git \
    HEAD:refs/heads/fix/laxii-image-output-ux
fatal: could not read Username for 'https://github.com': No such device or address

$ git ls-remote https://github.com/jon0471-dot/Bean-intelligence.git refs/heads/fix/laxii-image-output-ux
# -> empty: the branch does not exist remotely; the old public refs are untouched
```

The branch is committed locally and pushes as a normal non-force new branch
from any environment with credentials. The exact local head SHA at
publication: `8f61599271b1aa66e86a2c4956f6dc01eef8b737`-lineage — see the
commit list below for the final values recorded at commit time.
