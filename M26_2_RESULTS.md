# M26.2 RESULTS — LAXII & JAZMII FULL CAPABILITY ACTIVATION

Milestone: M26.2 · Branch `feat/m26-2-media-capabilities`
(head `99b2470996110f383b43964d7bf9cc4851d4ceb2` + the docs commit that adds
this file) · Based on the verified local `feat/ai-operationalization`
(`411437144ee01abac07d7f0693cfaac0f6101e41`, parent = sanitized main
`4d134c5794cfe92ff7c8e477f536075e7c8bffb0`) — all six AI operationalization
commits preserved. Implementation-first: one implementation commit, then the
consolidated validation pass, then this documentation.

## 1. Verdict

**IMPLEMENTED AND VALIDATED with real model inference.** All four requested
capabilities now execute through real inference paths in the existing
product infrastructure, verified end-to-end through the actual HTTP routes,
durable queue, worker pools, storage and auth:

- **LAXII conversational editing: OPERATIONAL** (local engine + hosted lane
  behind one capability).
- **LAXII background removal: OPERATIONAL** (REAL neural matting — true
  alpha at full source resolution; 79%→39% transparent / 17%→54% opaque
  measured splits across fixtures, hair-quality edges from MODNet).
- **Local Diffusers worker: REAL but operator-optional** — the worker itself
  (pairing, lifecycle, graceful shutdown) is implemented and the registry
  reports its true state; masked object removal additionally gained a REAL
  LaMa lane so the capability is usable without the GPU worker.
- **JAZMII image-to-video: OPERATIONAL** (REAL local motion lane: RIFE
  neural in-between frames + ffmpeg, ffprobe-gated; diffusion-class I2V
  honestly evaluated and recorded as GPU-worker future work).

## 2. What was implemented (one commit: `99b24709…`)

83 files, +4,989/−63. Highlights:

- `src/lib/media/local-models.ts` (+ route `/api/laxii/local-models`): the
  local model manager — explicit SHA-256-pinned install/cancel, honest
  on-disk states (`not-installed | downloading | ready | corrupted`),
  ONE session per model with idle unload, measured OOM arena fix.
- `src/lib/laxii/segmentation.ts` / `bg-removal-local.ts`: real matting
  service + export pipeline (transparent PNG / explicit background JPEG /
  blurred-background portrait mode), honest no-subject gate with measured
  coverage stats.
- `src/lib/laxii/local-edit.ts` / `inpaint-local.ts` / `jobs.ts`: the local
  edit engine — conservative parsed plan (tone/look ops, background
  blur/recolor via matting, approved rotate/flip, masked LaMa removal),
  same job lifecycle as every processor (progress, cancellation, honest
  failure classes, per-user storage, usage metering, per-capability
  evidence keys).
- `src/lib/laxii/history.ts` (+ route, + UI panel, + `LaxiiEditHistory`
  Prisma model): append-only edit lineage; undo/restore are themselves
  recorded operations cloning base pixels into fresh assets; ownership
  scoped to the requesting user on every query/mutation.
- `src/lib/jazmii/i2v-local.ts` + `video-worker.ts` + JAZMII routes/UI: the
  local motion lane inside the SAME durable video job lifecycle
  (cancellation between segments, ffprobe completion gate, lane-class
  disclosure in provenance, honest 422 refusals of subject-motion asks).
- `src/lib/laxii/worker.py` pairing token (`BEAN_WORKER_TOKEN` echo +
  server-side validation, `storage/worker/` token file mode 600) and
  graceful signal handlers.
- Registry/router: three new backends (`bean-image-local-segmentation`,
  `bean-image-local-edit`, `bean-video-local-motion`) with real health
  probes (model-manager states), lane resolution (`resolveEditLane`),
  per-lane concurrency (acquire/release on the SAME backend — measured slot
  leak fix), and evidence-chain parity for the new lanes.
- Build/deploy: `scripts/copy-native-libs.mjs` wired into `bun run build`
  (standalone output previously missed `libonnxruntime.so.1` —
  `ERR_DLOPEN_FAILED` on first inference); `.gitignore` negations for four
  real source paths the `local-*` pattern was silently swallowing.

## 3. Consolidated validation (run AFTER implementation, once)

| Check | Result |
|---|---|
| **Real-inference acceptance** (`scripts/m262/acceptance.ts` against the production standalone server, real photos, real models) | **22/22 PASS** (`scripts/m262-out/acceptance.json`) — details below |
| Unit tests | **2,216 pass / 0 fail / 39,767 expectations / 163 files** — exact baseline restored plus the M26.2 pins (test-mock updates documented in-commit; 3 pre-existing env/mock staleness issues fixed: log-level sensitivity, history-row mock, lane-field pins) |
| TypeScript (`tsc -p tsconfig.m26-check.json`) | **0 errors** |
| Production build (`bun run build`) | **PASS** (standalone + route table + native-lib copy) |
| ESLint | M26.2-changed files: **0 errors / 0 warnings**; repo-wide baseline is 53 errors + 2,475 warnings, ALL in pre-existing `validation/m21/**` generated artifacts (excluded from TS checks, untouched by this milestone) |
| Secret scan (13-pattern scanner over the branch tip) | **0 `bean_session`**; the only new hits are the 4 SHA-256 model digests in the manifest (benign documented class); all other hits are the pre-existing benign classes recorded since M26.1 |
| Tracked-file safety | No model weights, no DB files, no recovery bundles, no passphrases, no user media in the commit; the only committed media are the 3 license-verified acceptance fixtures (`scripts/m262/fixtures/PROVENANCE.md`) |

### 3.1 The acceptance run, step by step (all through the real pipeline)

- Models: 4/4 `ready` with `sha256Ok=true` (real files on disk).
- LAXII edit: destructive rotate refused WITHOUT approval (400) before any
  job; generative "add a crown" refused honestly (422
  `CAPABILITY_UNSUPPORTED`); "brighten and warm" completed via the local
  engine with 97.9% of pixels changed at source dimensions (real edit).
- LAXII background removal (real studio portrait): MODNet matte,
  subjectFraction 0.5738; transparent PNG verified — 4 channels,
  38.7% fully transparent / 54.4% fully opaque pixels, source dims
  preserved; JPEG-with-explicit-background export completed.
- LAXII masked object removal (real scene photo, real brush rect): LaMa
  completed; **0 of 439,200 pixels beyond the shaped edit band differ from
  the original** — preservation-first holds bit-exactly outside the feather.
- History: lineage recorded; REAL undo/restore appended a restore row and
  cloned pre-edit pixels into a fresh asset.
- JAZMII I2V: subject-motion request refused honestly (422) BEFORE any job;
  accepted on the `local-motion` lane; REAL video generated (36 frames,
  42→12 RIFE segment calls per run, h264 416×320@12, duration 3s, validated
  by ffprobe); artifact owner-served (magic bytes verified, 63,902 bytes);
  lane class disclosed in provenance; a second user's access answered 404;
  cancellation honored (settled `failed/CANCELLED`, no artifact stored).
- Honest unsupported case: a uniform image fails with the measured reason
  ("no usable subject measured (subject fraction 0.0003)") — never a fake
  cutout.
- Capability rows (authenticated `/api/health`): measured
  `conversational-editing=operational background-removal=operational
  image-to-video=operational` — every state backed by the real completions
  above, never hardcoded.

### 3.2 Visual evidence (checked during validation, reproducible via `scripts/m262/visual-probe.ts`)

- The served transparent cutout renders a clean full-body silhouette with
  crisp hair edges over a checkerboard (real alpha, no clipping).
- The LaMa removal result is coherent scene content inside the mask.
- RIFE midpoint frames are clean real interpolations (no striping/noise).

## 4. Real model-integration bugs found and fixed (all measured)

1. **ONNX vision tensors are channels-first** — HWC-interleaved input fed as
   `[1,3,H,W]` produced garbage on ALL FOUR models (noise mattes, striped
   frames). Every lane de-interleaves explicitly now.
2. **MODNet tensor dims transposed** (`[1,3,W,H]` vs `[1,3,H,W]`) — silently
   corrupted every non-square input; square probes masked it.
3. **MODNet normalization** — the `Xenova/modnet` processor config requires
   [-1,1] (mean/std 0.5); plain 0..1 broke mattes on portraits the fixed
   pipeline segments near-perfectly.
4. **sharp corrupts 1-channel raw resize** in this environment (coverage
   collapsed 57%→19% with striping) — alpha upsampling is now pure bilinear
   typed-array math.
5. **Standalone build missing `libonnxruntime.so.1`** — native libs now
   copied post-build (deployment blocker removed).
6. **Preflight concurrency slot leak** on lane-selected submissions —
   acquire/release now name the same backend.
7. **Capability evidence chains** — the bg-removal chain now spans BOTH
   lanes (hosted + local), and validation-class outcomes (honest no-subject
   refusals) no longer pin a healthy lane to degraded/blocked.

Full contract documentation: `M26_2_MODEL_INTEGRATION.md` §3.

## 5. Honest limitations (not failures)

- **Diffusion-class image-to-video** (WAN 2.2 I2V / CogVideoX) needs a GPU
  worker class this host does not have; SVD is additionally non-commercial.
  The local motion lane animates the provided still with parsed motion and
  RIFE in-between frames and REFUSES subject-motion/added-content requests
  with the precise reason — the lane class is disclosed on every result.
- **Hosted lanes** (hosted conversational edit, hosted bg-removal, hosted
  T2V/T2I) require configured provider credentials through the existing
  gateway; without them the dashboard shows the real blocker, and the LOCAL
  lanes carry editing and background removal on their own.
- **Local Diffusers worker** requires explicit operator setup (Python
  worker, GPU, model downloads) and is registry-gated; `smart-edit` reports
  its true state and masked object removal remains usable via the LaMa lane.
- **MODNet domain**: trained on people; strongly non-human subjects can
  yield conservative mattes — measured stats accompany every run, and a
  matte without a usable subject fails honestly (validated).

## 6. Existing functionality preserved

RIISHE and CODE GIFTZ behavior untouched by the M26.2 diff (their routes,
retrieval, sandbox and approval paths unchanged); the AI device settings,
client-compute lanes and all gateway contracts are intact; the six AI
operationalization commits are preserved verbatim; the full unit suite
(2,216/0) is the pre-existing baseline plus the M26.2 pins. The queue,
provider registry, auth, usage tracking and structured errors are the SAME
infrastructure — no second media queue, no duplicated registry.

## 7. Publication

- Branch: `feat/m26-2-media-capabilities` (fast-forward from
  `feat/ai-operationalization`, no force-push, no history rewrite).
- Push to GitHub: attempted with the branch's existing remote configuration
  — see `M26_2_RESULTS.md` §8 for the exact outcome and remote SHA
  verification.

## 8. Push outcome (recorded 2026-11-18, exact commands and results)

The branch is complete, committed and verified locally (head
`03e8417` + implementation `99b24709`, fast-forward base
`411437144ee01abac07d7f0693cfaac0f6101e41`). The push itself is BLOCKED by
the execution environment, not by the work:

```
$ git push git@github.com:jon0471-dot/Bean-intelligence.git \
    HEAD:refs/heads/feat/m26-2-media-capabilities
error: cannot run ssh: No such file or directory
fatal: unable to fork
# (the execution sandbox has no SSH client binary at all)

$ git push https://github.com/jon0471-dot/Bean-intelligence.git \
    HEAD:refs/heads/feat/m26-2-media-capabilities
fatal: could not read Username for 'https://github.com': No such device or address
# (no push credentials exist in the environment)

$ git ls-remote https://github.com/jon0471-dot/Bean-intelligence.git \
    refs/heads/feat/m26-2-media-capabilities
# -> empty: the branch does NOT exist remotely; nothing was published
```

What this means:

- **No partial or fake publication**: the remote was verified UNCHANGED
  (`main` = `a01486289149e0347b41d111c376b8a2b078ad80`, feature =
  `6a84481c6ebc893ccb97e97ac5a353937194eac3`, new branch absent). No
  force-push was used or needed; the planned push is a plain non-force push
  of a NEW branch.
- **To publish**: from any environment with push credentials
  (`git remote add origin git@github.com:jon0471-dot/Bean-intelligence.git &&
  git push origin feat/m26-2-media-capabilities` from this workspace, or
  transferring the branch via `git bundle`/a mirror). The branch pushes as a
  normal fast-forward addition — it contains only the sanitized history plus
  the eight M26.1-AI/M26.2 commits and can never reintroduce the removed
  sensitive objects.
- **Verdict per the milestone contract**: implementation, validation,
  deliverables and the local verified commit are COMPLETE; the final
  remote-verify step is PENDING the push-capable environment above. This is
  recorded as an environment limitation, never as a completed publication.
