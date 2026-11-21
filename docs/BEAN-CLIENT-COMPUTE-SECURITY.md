# BEAN Client-First Hybrid Compute Engine — Security

Milestone: BEAN client-first hybrid compute · Companion docs:
`docs/BEAN-CLIENT-COMPUTE-AUDIT.md`, `docs/BEAN-CLIENT-COMPUTE-ARCHITECTURE.md`,
`docs/BEAN-CLIENT-COMPUTE-IMPLEMENTATION-REPORT.md`.

## 1. Threat model summary

The engine executes code on the VISITOR'S device and touches the BEAN backend. The
security boundaries follow the existing BEAN contracts and the spec's non-negotiables:

1. **The visitor's device is untrusted for server decisions.** Client reports are
   evidence only; nothing server-authoritative (auth, quotas, storage, validation,
   provider calls) moved to the client.
2. **BEAN's own code runs in the visitor's browser voluntarily** — every device task
   requires explicit consent, and consent state is re-read on every scheduling and
   fallback decision.
3. **Project/user data is untrusted input to kernels.** Kernels are pure functions;
   project code is never executed client-side (analysis is text scanning only).

## 2. Consent and resource-use controls

| Control | Implementation |
|---|---|
| No hidden compute | `isDeviceComputeAllowed()` gate runs before every device target selection; without consent the gate refuses with an honest reason (unit-tested) |
| Local-only guarantee | Kind-level `privacy: 'local-only'` AND user-level local-only mode both force `backendFallbackAllowed() = false`; re-checked per attempt, not per task |
| No background mining | Tasks are never started while the tab is hidden (`shouldDeferForVisibility`); `pagehide` releases all resources; no timers or continuous GPU work exist anywhere in the engine |
| One heavy model | `ResourceManager.acquireHeavyModel()` — single slot; acquisition failure is honest |
| Bounded concurrency | Device-task cap (2 / 1 conservative) enforced by admission gate; worker pool cap enforced by the CPU engine semaphore (wall-clock test) |
| Conservative mobile defaults | Conservative profile (mobile hint / low memory bucket / insecure context / software GPU) lowers budgets and concurrency |

## 3. Privacy of user data

- **No silent upload**: the LAXII on-device preprocessing runs BEFORE the user's
  explicit upload action; the upload itself is the pre-existing user action and the
  server re-validates everything (decode + geometry measured server-side).
- **Nothing leaves the device without consent**: device tasks run entirely locally;
  the only network surface is (a) the user's own existing product flows and (b) the
  opt-in sanitized capability report.
- **Sanitized reports**: the report schema accepts ONLY booleans, coarse numbers,
  tier and installed-model ids — no vendor/architecture strings, no user agents, no
  task payloads, no prompt text (tested: injected extra fields never reach storage).
- **Diagnostics redaction**: `redactForDiagnostics()` truncates long strings with an
  explicit size note and reduces objects to type labels; progress notes are
  adapter-authored, payload-free text.
- **Project code never leaves the device for the advisory scan**: the CODE GIFTZ
  analysis kind is registered `local-only`; a real-worker execution in the harness
  confirmed project files stay on-device.

## 4. Model download policy (supply-chain safety)

1. Downloads are refused unless an operator has pinned a trusted SHA-256 for the exact
   model version — the registry ships with `sha256: null` precisely so nothing can be
   fetched from an unverified source by default.
2. Source origin allow-list: HTTPS on `huggingface.co` (+ subdomains) only.
3. Explicit user approval is required AFTER the real byte size is measured and shown
   (`measureSize()` HEAD probe; unmeasurable length keeps `sizeUnverified: true` and
   the download flow still refuses without a pinned checksum).
4. Storage quota checked BEFORE any bytes are fetched (≥100 MB headroom preserved).
5. Install state requires checksum verification + cache metadata match; browsers
   evicting storage simply returns the model to not-installed (verified, never faked).
6. No model ships with the app; no large download ever happens automatically.

## 5. Browser-side execution safety

- **GPU lane is registry-gated**: an operation runs on WebGPU only if it has a
  compatibility entry AND the measured adapter satisfies it; unknown operations are
  refused with a reason (tested). Fallback (software) adapters are refused unless the
  entry allows them.
- **Worker kernels are serialized self-contained functions**; the serialization parity
  tests pin that what runs in the worker is what the repo ships. Native/bound
  functions are refused. Kernels receive JSON-cloneable payloads only.
- **No eval of project code**: the CODE GIFTZ kernel scans text; it never executes the
  scanned code. The generated-project sandbox approval contract (`approval: true`,
  `unshare`/`prlimit` runner) is untouched and out of reach of this engine.
- **Buffer hygiene**: every GPU buffer created during a task is destroyed when the
  task ends (success or failure); device loss and OOM map to honest states.
- **Timeouts are enforced** (scheduler deadline race + engine-level timeouts), so a
  wedged kernel cannot pin a slot forever.

## 6. Server-side route security (`/api/client-compute/reports`)

- `requireUser()` (session auth) on both POST and GET; unauthenticated → 401 envelope.
- Rate limited via the shared sliding-window limiter (10/min/user) with truthful
  `Retry-After` on 429.
- Zod-validated bounded payload; unknown fields are stripped BEFORE storage (verified
  by test that injected `userAgent`/`gpuVendor`/`promptText` never reach the DB row).
- Ownership: GET returns only the caller's own rows (per-user isolation tested); the
  table carries `userId` with cascade delete; cross-user reads are impossible by query
  shape.
- Audited (`client-compute.report`) with tier metadata only; audit log contains no
  report payload beyond tier/conservative.

## 7. Additive schema change

`ClientComputeReport` is a purely additive table (verified via `prisma migrate diff`
before `prisma db push`: one CREATE TABLE + one CREATE INDEX, no existing table
touched). Pre-migration backup: `backup/db-clientcompute-pre-20261116.db` (SQLite
`VACUUM INTO`, integrity_check ok). The DB in this sandbox contained 0 users; the
E2E test user was created through the real registration API during verification.

## 8. Credentials and privileges — unchanged

- Provider credentials (`/etc/.z-ai-config`, `BEAN_PROVIDER_OPENAI_*`,
  `BEAN_CREDENTIALS_MASTER_KEY`) remain server-only; the engine never reads them and
  ships no secret material.
- Agent Reach / Obscura binaries, the OS sandbox, the durable job engine and all
  authoritative counters are untouched server systems (audit Section 3).
- The engine adds no new auth surface, no new scopes, and no new API-key capability.

## 9. Remaining risks (recorded honestly)

1. **Kernels are first-party code executed on visitor devices.** A malicious kernel
   could abuse the visitor's device — mitigated by (a) kernels being small pure
   functions in this repository, (b) the consent gate, (c) the compatibility registry.
   A third-party kernel pathway must not be added without a review gate.
2. **`Function.prototype.toString` serialization** relies on the kernel being
   self-contained; the parity tests catch violations for shipped kernels, but a new
   kernel that closes over mutable state would only fail at runtime (honest
   `kernel failed to load` state — never silent corruption).
3. **Blob-URL workers inherit the page's CSP.** The app currently sets no CSP on its
   own pages (only the preview iframe has `default-src 'none'`). If a strict CSP with
   `worker-src`/`script-src` restrictions is added later, `worker-src blob:` (or
   equivalent) must be allowed — recorded as a deployment note.
4. **Cache Storage eviction** can silently drop installed models; the engine detects
   this and reports not-installed, but re-download requires re-approval by policy.
5. **The report endpoint stores device-derived coarse facts** (hardwareConcurrency,
   deviceMemory bucket, storage quota). These are capability checks the spec permits;
   they are per-user visible only and carry no identifiers.
