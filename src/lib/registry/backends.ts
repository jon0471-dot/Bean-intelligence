/**
 * BEAN Intelligence — PRIVATE backend / model registry.
 *
 * ⚠️ SERVER-ONLY. Never import this file from client components. It contains
 * upstream provider identities, secret references and deployment details.
 * This module is the single source of truth the router consults when mapping
 * a BEAN product to an authorized inference backend.
 *
 * Truth policy (non-negotiable):
 *  - A backend is `enabled: true` ONLY if a real integration exists here.
 *  - `modelIdentity` is what the provider actually discloses to this tenant.
 *    Where the provider does not disclose the checkpoint, we record exactly
 *    that instead of guessing a model name.
 *  - Health is measured, not assumed (see adapters + /api/health).
 *  - No backend = clear NO_BACKEND error. Never a fabricated fallback.
 */

import type { BeanProductId, BeanTask } from './products'

export type DeploymentMode = 'authorized-hosted' | 'self-hosted'

/**
 * LAXII preservation engine (2026-10-31):
 *  - 'local-process' marks a backend that runs IN this application process
 *    (or as a child process on the same host) with no upstream service.
 */
export type ImageEndpointType = 'managed-sdk' | 'http' | 'gpu-worker' | 'local-process'

export interface BackendDescriptor {
  id: string
  /** BEAN product this backend can serve. */
  productId: BeanProductId
  task: BeanTask
  /** Upstream provider or deployment owner (admin-visible). */
  provider: string
  /** Actual model identity as disclosed by the provider. May be undisclosed. */
  modelIdentity: string
  /** Immutable revision when the provider exposes one; null otherwise. */
  revision: string | null
  endpointType: ImageEndpointType
  deploymentMode: DeploymentMode
  /** Runtime / hardware requirements (admin-visible, informational). */
  runtime: string
  /** Real limits enforced by BEAN and/or the provider. */
  limits: Record<string, unknown>
  /** Licensing posture as verified for THIS deployment arrangement. */
  license: {
    name: string
    commercialUse: 'authorized' | 'restricted' | 'not-applicable'
    note: string
    sourceUrl: string
    verifiedAt: string
  }
  /** How inputs/outputs are handled by the provider. */
  dataHandling: string
  /** Usage metering configuration. costUnit=null when provider reports no cost data. */
  metering: { unit: string; costUnit: string | null }
  /** Secret references (env var NAMES only — never values). */
  secrets: string[]
  /** Explicitly authorized fallback backend ids (empty = no fallback). */
  fallbacks: string[]
  /** Whether this backend may serve traffic right now. */
  enabled: boolean
  /** If disabled, the truthful customer-facing reason. */
  unavailableReason?: string
  /** Concurrency policy applied by the router. */
  concurrency: { maxInFlightPerUser: number; maxInFlightTotal: number }
  /** Timeout policy in milliseconds. */
  timeouts: { requestMs: number; queueMs: number }
  /** Retry policy for transient upstream failures. */
  retries: { maxAttempts: number; backoffMs: number }
}

/**
 * The authorized hosted gateway (z-ai-web-dev-sdk) is the provider made
 * available to this deployment by the platform operator's agreement. It
 * exposes a managed SDK; the underlying checkpoint identity is NOT disclosed
 * to tenants, so the registry records that fact verbatim.
 */
const HOSTED_LLM: BackendDescriptor = {
  id: 'bean-llm-hosted-primary',
  productId: 'riishe',
  task: 'chat',
  provider: 'Z.ai authorized hosted inference gateway',
  modelIdentity:
    'Provider-managed language model; exact checkpoint not disclosed to tenant',
  revision: null,
  endpointType: 'managed-sdk',
  deploymentMode: 'authorized-hosted',
  runtime: 'Provider-managed runtime (no tenant-side GPU required)',
  limits: {
    maxPromptChars: 12000,
    maxHistoryMessages: 24,
    streaming: true,
    thinking: 'disabled',
  },
  license: {
    name: 'Access governed by platform inference agreement',
    commercialUse: 'authorized',
    note:
      'Inference consumed through the authorized gateway available to this deployment. No upstream weights are redistributed by BEAN.',
    sourceUrl: 'https://z.ai',
    verifiedAt: '2026-10-24',
  },
  dataHandling:
    'Prompts and completions are processed by the provider under its platform terms. BEAN does not log raw prompt content by default.',
  metering: { unit: 'request', costUnit: null },
  secrets: ['ZAI_GATEWAY_CREDENTIALS (managed by platform runtime)'],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 2, maxInFlightTotal: 16 },
  timeouts: { requestMs: 90_000, queueMs: 5_000 },
  // Truthful policy: the router issues exactly one attempt per request and
  // does not auto-retry; failures surface to the customer immediately.
  retries: { maxAttempts: 1, backoffMs: 0 },
}

const HOSTED_IMAGE: BackendDescriptor = {
  id: 'bean-image-hosted-primary',
  productId: 'laxii',
  task: 'image-generation',
  provider: 'Z.ai authorized hosted inference gateway',
  modelIdentity:
    'Provider-managed text-to-image model; exact checkpoint not disclosed to tenant',
  revision: null,
  endpointType: 'managed-sdk',
  deploymentMode: 'authorized-hosted',
  runtime: 'Provider-managed GPU runtime (no tenant-side GPU required)',
  limits: {
    sizes: [
      '1024x1024',
      '768x1344',
      '864x1152',
      '1344x768',
      '1152x864',
      '1440x720',
      '720x1440',
    ],
    maxPromptChars: 4000,
    outputFormat: 'jpeg',
    typicalLatencyMs: 60_000,
    imageToImage: false,
  },
  license: {
    name: 'Access governed by platform inference agreement',
    commercialUse: 'authorized',
    note:
      'Generated images are delivered to the customer; upstream model weights are not redistributed or resold by BEAN.',
    sourceUrl: 'https://z.ai',
    verifiedAt: '2026-10-24',
  },
  dataHandling:
    'Prompts are processed by the provider under its platform terms. Generated files are stored under BEAN storage with per-user access checks.',
  metering: { unit: 'image', costUnit: null },
  secrets: ['ZAI_GATEWAY_CREDENTIALS (managed by platform runtime)'],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 4 },
  timeouts: { requestMs: 180_000, queueMs: 10_000 },
  // Truthful policy: one attempt per image job; no automatic retry.
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * LAXII — deterministic local enhancement engine (Sharp, in-process).
 * ENABLED because it is real and executed: masks, compositing, grading and
 * metrics run on this host with no upstream dependency. It deliberately does
 * NOT do generative work — see bean-image-selfhosted-diffusers below.
 * License 'not-applicable': BEAN-local deterministic processing, no third
 * party processes customer pixels.
 */
const LOCAL_SHARP_ENGINE: BackendDescriptor = {
  id: 'bean-image-local-sharp',
  productId: 'laxii',
  task: 'image-enhancement',
  provider: 'BEAN Intelligence (in-process deterministic engine)',
  modelIdentity: 'Deterministic Sharp image operations — no ML model involved',
  revision: null,
  endpointType: 'local-process',
  deploymentMode: 'self-hosted',
  runtime: 'Node.js + Sharp 0.34.x on the application host (CPU)',
  limits: {
    maxInputPixels: 16_777_216, // 4096x4096 guard — larger uploads are rejected, not silently downscaled
    ops: ['auto-orient', 'denoise', 'exposure-white-balance', 'grade', 'local-contrast', 'lanczos-upscale'],
    generative: false,
  },
  license: {
    name: 'Not applicable — BEAN-local deterministic processing (Sharp is Apache-2.0)',
    commercialUse: 'not-applicable',
    note:
      'Customer pixels are processed by BEAN-owned code on the BEAN host. No upstream provider sees the image.',
    sourceUrl: 'https://sharp.pixelplumbing.com',
    verifiedAt: '2026-10-31',
  },
  dataHandling:
    'Images never leave the application host. Artifacts are stored under BEAN storage with per-user access checks.',
  metering: { unit: 'image', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 2, maxInFlightTotal: 8 },
  timeouts: { requestMs: 120_000, queueMs: 10_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * LAXII — local Diffusers worker (generative editing: masked inpaint,
 * reference-guided generation, identity conditioning, model upscaling).
 *
 * DISABLED until BOTH gates pass and are recorded in worklog.md:
 *  1. The worker's hardware preflight passes on the target GPU host
 *     (RTX 5060 Ti 16 GB — reported, not verified from this sandbox).
 *  2. A REAL inference acceptance test completes (a generated/inpainted
 *     image actually produced and verified).
 * This sandbox has no GPU, no torch and ~7.6 GB free disk, so the worker
 * code ships with an honest preflight that reports missing requirements
 * here instead of pretending. Model/license selection:
 * docs/models/LAXII-ENGINE-DECISION-MATRIX.md.
 */
const DIFFUSERS_WORKER: BackendDescriptor = {
  id: 'bean-image-selfhosted-diffusers',
  productId: 'laxii',
  task: 'image-editing',
  provider: 'BEAN Intelligence (planned local Diffusers worker)',
  modelIdentity:
    'Selected candidates: SD 1.5-inpaint / SDXL-base (OpenRAIL-M / OpenRAIL++-M), IP-Adapter (h94, Apache-2.0), PuLID-SDXL, Real-ESRGAN x4plus (BSD-3), big-lama (Apache-2.0), YuNet (MIT) — see decision matrix',
  revision: null,
  endpointType: 'gpu-worker',
  deploymentMode: 'self-hosted',
  runtime: 'Python 3.10+ worker, torch/CUDA, diffusers ≥0.42 — requires ≥8 GB free VRAM class GPU',
  limits: {
    note: 'Limits become enforceable only when this backend is enabled after a verified inference test.',
  },
  license: {
    name: 'Mixed per component — see docs/models/LAXII-ENGINE-DECISION-MATRIX.md (verified 2026-10-31)',
    commercialUse: 'restricted',
    note:
      'Selected set avoids non-commercial weights (InstantID/IP-Adapter-FaceID/FLUX-dev tiers rejected). SFace identity metric is provisional pending a training-data provenance review.',
    sourceUrl: 'https://github.com/huggingface/diffusers',
    verifiedAt: '2026-10-31',
  },
  dataHandling:
    'Images and masks are processed by the BEAN worker on the BEAN GPU host. No external service receives customer pixels. Identity embeddings, when computed, stay local and are never exported.',
  metering: { unit: 'image', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: false,
  unavailableReason:
    'Generative editing is not operational: the local Diffusers worker has not passed its hardware preflight and no real inference test has completed in this environment (no GPU). Deterministic enhancement (Strict Preserve without generative steps) remains available.',
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 300_000, queueMs: 30_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * JAZMII — authorized hosted video generation (async task API).
 *
 * ENABLED with the same truth policy as the other hosted backends: the
 * adapter executes REAL submissions (provider task id) and REAL polling;
 * outputs are downloaded server-side, validated by container magic bytes
 * and re-served from BEAN storage. The provider-managed checkpoint is NOT
 * disclosed to tenants — recorded verbatim. Latency/limit figures below
 * are BEAN's own enforced policies, not provider claims.
 */
const HOSTED_VIDEO: BackendDescriptor = {
  id: 'bean-video-hosted-primary',
  productId: 'jazmii',
  task: 'video-generation',
  provider: 'Z.ai authorized hosted inference gateway',
  modelIdentity:
    'Provider-managed text-to-video / image-to-video model; exact checkpoint not disclosed to tenant',
  revision: null,
  endpointType: 'managed-sdk',
  deploymentMode: 'authorized-hosted',
  runtime: 'Provider-managed GPU runtime (no tenant-side GPU required); async task submission + polling',
  limits: {
    maxPromptChars: 2000,
    qualityModes: ['speed', 'quality'],
    audio: 'provider-supported flag (with_audio), off by default',
    sizeFormat: 'WxH pass-through; the live-accepted set is established by the acceptance run and recorded afterwards',
    maxOutputBytes: 100 * 1024 * 1024,
    pollIntervalMs: 5_000,
    maxPollDurationMs: 15 * 60_000,
    cancellation: 'Provider exposes no cancel API — BEAN cancellation means stop-tracking (stated honestly in UI/API)',
  },
  license: {
    name: 'Access governed by platform inference agreement',
    commercialUse: 'authorized',
    note:
      'Generated videos are delivered to the customer; upstream model weights are not redistributed by BEAN. No proprietary application (e.g. Flow) is copied or implied.',
    sourceUrl: 'https://z.ai',
    verifiedAt: '2026-11-04',
  },
  dataHandling:
    'Prompts and optional reference images are processed by the provider under its platform terms. Output videos are stored under BEAN storage with per-user access checks; provider URLs are never exposed.',
  metering: { unit: 'video-job', costUnit: null },
  secrets: ['ZAI_GATEWAY_CREDENTIALS (managed by platform runtime)'],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 30_000, queueMs: 10_000 },
  // Truthful policy: one submission per job; polling failures surface honestly.
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * JAZMII — planned SELF-HOSTED video worker (candidate). The authorized
 * hosted backend above is the live path; this disabled entry records the
 * planned open-weight deployment candidate set honestly (Wan 2.2-class,
 * hardware-gated). The router serves JAZMII from the FIRST enabled backend
 * for the product; this one stays disabled until a real GPU worker passes
 * its preflight + a verified inference test.
 */
const VIDEO_PLANNED: BackendDescriptor = {
  id: 'bean-video-selfhosted-candidate',
  productId: 'jazmii',
  task: 'video-generation',
  provider: 'BEAN Intelligence (planned self-hosted GPU worker)',
  modelIdentity:
    'Not selected yet — candidate evaluation in docs/models/MODEL-EVALUATION-REPORT.md (e.g. Wan 2.2 / HunyuanVideo class checkpoints)',
  revision: null,
  endpointType: 'gpu-worker',
  deploymentMode: 'self-hosted',
  runtime: 'Requires GPU worker (≥24GB VRAM class) + async job queue',
  limits: {
    // Placeholder limits are NOT advertised as active. enabled=false ensures
    // the router never accepts video jobs until a real worker is deployed.
    note: 'Limits become enforceable only when this backend is enabled.',
  },
  license: {
    name: 'Under review — see LICENSING-REPORT.md',
    commercialUse: 'restricted',
    note:
      'Video checkpoints under evaluation have heterogeneous license terms (e.g. Apache-2.0 vs community licenses). Commercial deployment is NOT yet authorized.',
    sourceUrl: 'https://github.com/Wan-Video',
    verifiedAt: '2026-10-24',
  },
  dataHandling: 'To be defined with the selected checkpoint and hosting site.',
  metering: { unit: 'video-job', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: false,
  unavailableReason:
    'No video-generation backend is deployed. BEAN does not simulate video jobs — deployment of a licensed GPU worker is required before JAZMII can accept requests.',
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 1 },
  timeouts: { requestMs: 900_000, queueMs: 60_000 },
  // Inactive backend: policy becomes enforceable only when enabled.
  retries: { maxAttempts: 1, backoffMs: 0 },
}

const HOSTED_CODE_LLM: BackendDescriptor = {
  id: 'bean-code-llm-hosted-primary',
  productId: 'code-giftz',
  task: 'coding-task',
  provider: 'Z.ai authorized hosted inference gateway',
  modelIdentity:
    'Provider-managed language model used for coding tasks; exact checkpoint not disclosed to tenant',
  revision: null,
  endpointType: 'managed-sdk',
  deploymentMode: 'authorized-hosted',
  runtime: 'Provider-managed runtime for generation; BEAN-local restricted sandbox for execution',
  limits: {
    maxPromptChars: 12000,
    sandbox: {
      engine: 'child-process isolate',
      timeoutMs: 15_000,
      maxOutputBytes: 64_000,
      network: 'not restricted at process level (documented limitation; containerize in production)',
    },
  },
  license: {
    name: 'Access governed by platform inference agreement',
    commercialUse: 'authorized',
    note:
      'Code generation via the authorized gateway; generated code is executed only inside the BEAN restricted sandbox with explicit user approval.',
    sourceUrl: 'https://z.ai',
    verifiedAt: '2026-10-24',
  },
  dataHandling:
    'Code snippets submitted for generation are processed by the provider under its platform terms. Sandbox execution happens locally with ephemeral workspaces.',
  metering: { unit: 'request', costUnit: null },
  secrets: ['ZAI_GATEWAY_CREDENTIALS (managed by platform runtime)'],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 2, maxInFlightTotal: 8 },
  timeouts: { requestMs: 120_000, queueMs: 5_000 },
  // Truthful policy: one attempt per coding task; no automatic retry.
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/** Private registry — the only place product→backend mappings exist. */
export const BACKEND_REGISTRY: BackendDescriptor[] = [
  HOSTED_LLM,
  HOSTED_IMAGE,
  LOCAL_SHARP_ENGINE,
  DIFFUSERS_WORKER,
  HOSTED_VIDEO,
  VIDEO_PLANNED,
  HOSTED_CODE_LLM,
]

export function getBackendsForProduct(productId: BeanProductId): BackendDescriptor[] {
  return BACKEND_REGISTRY.filter((b) => b.productId === productId)
}

export function getBackend(id: string): BackendDescriptor | undefined {
  return BACKEND_REGISTRY.find((b) => b.id === id)
}
