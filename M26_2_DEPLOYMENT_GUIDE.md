# M26.2 DEPLOYMENT GUIDE — LAXII & JAZMII Real Capability Lanes

Milestone: M26.2 · Branch `feat/m26-2-media-capabilities`. This guide covers
every deployment shape honestly: what works out of the box, what needs an
explicit operator step, and what is honestly unavailable on a given host.

## 1. What each lane needs

| Capability | Engine | Needs | Without it |
|---|---|---|---|
| LAXII text-to-image, hosted conversational edit, hosted bg-removal | Authorized hosted provider | Provider credentials via the existing gateway (no client-side keys) | `PROVIDER_UNAVAILABLE`-class honest states; the dashboard shows the real blocker |
| LAXII deterministic enhancement | Sharp, in-process | Nothing (always available) | — |
| LAXII conversational edit (local engine) | Local edit engine (`bean-image-local-edit`) | LaMa + a matting model installed | Honest refusal; capability row reflects the missing model |
| LAXII background removal (local) | Local segmentation (`bean-image-local-segmentation`) | MODNet (or u2netp fallback) installed | Honest `not-installed` state; capability row degrades truthfully |
| LAXII smart-edit / object-removal (GPU) | Local Diffusers worker (`workers/laxii-diffusers/`) | Python worker + GPU + explicit setup | Jobs refuse with the truthful `PROVIDER_UNAVAILABLE` message; masked removal still works via the local LaMa lane |
| JAZMII text-to-video | Hosted provider | Provider credentials | Honest blocker state |
| JAZMII image-to-video (local motion lane) | RIFE + ffmpeg | `rife` model installed + ffmpeg present | Honest refusal naming the exact missing piece |

## 2. Install the local models (explicit, every host)

Model weights NEVER ship in Git. Install exactly what you need:

```bash
# one-off bootstrap (idempotent; SHA-256 verified against the manifest):
bun -e '
import { installLocalModel, allLocalModelStates } from "./src/lib/media/local-models";
for (const id of ["modnet", "lama", "rife", "u2netp"]) {
  const s = await installLocalModel(id);
  console.log(id, s.state);
}
console.table(allLocalModelStates().map(s => ({ id: s.id, state: s.state, sha256Ok: s.sha256Ok })));
'
```

- Artifacts land in `storage/models/<id>/` (override with
  `BEAN_LOCAL_MODELS_DIR`), atomic (temp + rename), verified by byte length
  AND SHA-256; a mismatch is recorded `corrupted` and never served.
- Downloads are cancellable (`cancelLocalModelInstall`) and show progress.
- Do not install models you will not use — each is a separate explicit
  choice; the capability rows name exactly which model each lane needs.

## 3. Runtime dependencies

- **ffmpeg + ffprobe** (JAZMII export + completion gate): `apt install ffmpeg`
  (Debian/Ubuntu), `brew install ffmpeg` (macOS), `winget install ffmpeg`
  (Windows). Verified with ffmpeg 7.1.x in the validation environment.
- **onnxruntime-node** — already in `package.json`; the production build now
  copies the native libraries into the standalone output
  (`scripts/copy-native-libs.mjs`, wired into `bun run build`). A standalone
  deployment built before this milestone fails with
  `ERR_DLOPEN_FAILED: libonnxruntime.so.1` — rebuild once after pulling.

## 4. Build & run (production)

```bash
bun install
bunx prisma generate && bunx prisma db push      # schema incl. LaxiiEditHistory
bun run build                                    # workers + ort assets + next build + native libs
DATABASE_URL=file:/absolute/path/dev.db bun .next/standalone/server.js
```

Deployment notes that matter (measured):

- **The standalone server chdirs into `.next/standalone/`** — relative
  `storage/` state lives there unless `DATABASE_URL` (and any state paths)
  are ABSOLUTE. Use an absolute `DATABASE_URL` (the committed `start` script
  does). The models root is resolved from `process.cwd()` — either install
  models AFTER the chdir'd layout is in place, or set `BEAN_LOCAL_MODELS_DIR`
  to an absolute path so the standalone server and any CLI bootstrap agree.
- **Dev server memory**: `next dev` (turbopack) can exceed a 4 GB sandbox
  while compiling the full app (measured OOM at ~3.1 GB RSS). For
  resource-constrained hosts, validate against the production build
  (`bun run build` + standalone server), which is also the deployment shape.
- **Node vs Bun**: the standalone server runs under both; validation used Bun.

## 5. Optional local Diffusers worker (GPU hosts only)

`workers/laxii-diffusers/worker.py` is an independent child process, never
network-exposed:

- The server spawns it and passes a per-deployment pairing token
  (`storage/worker/laxii-worker.token`, mode 600). The worker echoes the
  token in its ready signal; a mismatched/missing token is rejected
  (`WORKER_AUTH`) and the process is killed — no stale or hostile worker is
  trusted, and no ports are opened.
- Setup: `python -m venv` + `pip install -r requirements.txt`
  (see `workers/laxii-diffusers/README.md`; Windows helpers in
  `workers/laxii-diffusers/windows/`), model downloads via
  `workers/laxii-diffusers/local/download_models.py` (explicit).
- Lifecycle: idle-unload reaper, graceful SIGTERM/SIGINT (pipelines unloaded
  before exit), health preflight gates the registry backend
  (`generative-worker` capability row reports the real state).

## 6. Environment reference

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./db/dev.db` (dev) | Prisma datasource; use ABSOLUTE paths in production |
| `BEAN_LOG_LEVEL` | `info` | Structured log floor |
| `BEAN_LOCAL_MODELS_DIR` | `<cwd>/storage/models` | Local model weights root |
| `BEAN_MATTE_SHORT_EDGE` / `BEAN_MATTE_MAX_SIDE` | 512 / 1024 | MODNet working geometry (shortest edge 512, /32-snapped, long-side cap) |
| `BEAN_I2V_MAX_SIDE` / `BEAN_I2V_MAX_FRAMES` | 512 / 240 | Local motion-lane working resolution and timeline budget |
| `LAXII_WORKER_TOKEN` | generated | Pairing token override for the Diffusers worker |

## 7. Platform support statement (honest)

- **Linux (x86_64, CPU)**: validated end-to-end in this milestone — all four
  local lanes run on CPU; this is the reference deployment.
- **macOS (Apple Silicon)**: onnxruntime-node and sharp ship arm64 builds;
  ffmpeg via Homebrew. Expected to work; not validated in this environment
  (no hardware here) — reported as unvalidated, not unsupported.
- **Windows (CPU/CUDA)**: supported by onnxruntime-node and the worker
  helpers (`workers/laxii-diffusers/windows/`); the CUDA EP is used
  automatically when the GPU + CUDA provider are present, CPU otherwise.
  Not validated in this environment.
- **GPU acceleration (NVIDIA CUDA)**: used automatically by
  onnxruntime when available; the local motion lane's CPU budgets
  (`BEAN_I2V_*`) still apply and the encoded dims reported by ffprobe are
  the truth, never the request.
- **Mobile browsers**: the local SERVER lanes above are server-side; the
  browser-local AI lanes (WebGPU/WASM) are documented in
  `BEAN_AI_DEPLOYMENT_GUIDE.md` (M26.1) and unaffected here.

## 8. Capability truth

Every capability row (`/api/health`, per-product capability endpoints, and
the LAXII/JAZMII panels) is derived from measured evidence: real completed
jobs, real on-disk model states, real worker probes — never configuration
optimism. A missing model, a missing credential, or a disabled worker each
produce a DISTINCT, truthful state with recovery guidance. Do not hardcode
statuses; the rows flip only when real work completes.
