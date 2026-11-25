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
import { resolveOpenAiCompatibleCredential, resolveAnthropicCredential } from '@/lib/providers/credentials'
import { isLlamaCppConfigured } from '@/lib/providers/llamacpp'

export type DeploymentMode = 'authorized-hosted' | 'self-hosted'

/**
 * LAXII preservation engine (2026-10-31):
 *  - 'local-process' marks a backend that runs IN this application process
 *    (or as a child process on the same host) with no upstream service.
 */
export type ImageEndpointType = 'managed-sdk' | 'http' | 'gpu-worker' | 'local-process' | 'local-inference'

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
    commercialUse: 'authorized' | 'permitted' | 'restricted' | 'not-applicable'
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
  // PROVIDER RESILIENCE (2026-11-07): RIISHE chat falls back to the prepared
  // OpenAI-compatible provider, then the FREE-LOCAL llama.cpp lane — each
  // attempted ONLY when its own credentials/config exist (credential-gated,
  // audit-logged; a dormant slot is skipped, never assumed).
  fallbacks: ['bean-llm-openai-compatible', 'bean-chat-local-llamacpp'],
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
      '2048x1152',
      '1152x2048',
      '2048x1024',
      '1024x2048',
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
 * LAXII — authorized hosted IMAGE EDITING (images.edit endpoint).
 *
 * ENABLED: real image+prompt→edited-image execution through the gateway
 * (conversational editing, background changes, object insertion/removal via
 * prompt, lighting, restyle, variations). The preservation-critical masked
 * inpainting pipeline STILL requires the local Diffusers worker below — the
 * hosted endpoint cannot honor brush-mask pixel preservation, and BEAN does
 * not pretend otherwise.
 */
const HOSTED_IMAGE_EDIT: BackendDescriptor = {
  id: 'bean-image-hosted-edit',
  productId: 'laxii',
  task: 'image-editing',
  provider: 'Z.ai authorized hosted inference gateway',
  modelIdentity:
    'Provider-managed image editing model; exact checkpoint not disclosed to tenant',
  revision: null,
  endpointType: 'managed-sdk',
  deploymentMode: 'authorized-hosted',
  runtime: 'Provider-managed GPU runtime (no tenant-side GPU required)',
  limits: {
    maxPromptChars: 4000,
    outputSizes: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '2048x1152', '1152x2048', '2048x1024', '1024x2048'],
    inputImage: 'ownership-checked server-side; downscaled before submission to bound payload',
    preservation: 'whole-image regenerative edit — NOT pixel-preserving; masked preservation requires the local worker',
  },
  license: {
    name: 'Access governed by platform inference agreement',
    commercialUse: 'authorized',
    note:
      'Edited images are delivered to the customer; upstream model weights are not redistributed by BEAN.',
    sourceUrl: 'https://z.ai',
    verifiedAt: '2026-11-04',
  },
  dataHandling:
    'The submitted image and prompt are processed by the provider under its platform terms. Results are stored under BEAN storage with per-user access checks.',
  metering: { unit: 'image', costUnit: null },
  secrets: ['ZAI_GATEWAY_CREDENTIALS (managed by platform runtime)'],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 4 },
  timeouts: { requestMs: 180_000, queueMs: 10_000 },
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

/**
 * JAZMII — REAL local image-to-video lane (M26.2). Animates the submitted
 * still with parsed motion programs and synthesizes EVERY in-between frame
 * with RIFE neural frame interpolation (MIT), encoded by ffmpeg and gated
 * by the same ffprobe completion contract as the hosted lane. It is NOT
 * diffusion scene synthesis — the lane class is disclosed in provenance on
 * every result. Enabled after the recorded real inference acceptance run
 * (scripts/m262 validation), same policy as every registry backend.
 */
const LOCAL_VIDEO_MOTION: BackendDescriptor = {
  id: 'bean-video-local-motion',
  productId: 'jazmii',
  task: 'video-generation',
  provider: 'BEAN Intelligence local inference (onnxruntime-node)',
  modelIdentity: 'RIFE v4-class frame interpolation ONNX (MIT, upstream hzwer/Practical-RIFE; export FuryTMP/RIFE_fp32, SHA-256-pinned)',
  revision: 'rife_fp32 @ 6a31074c0f588648982b5e828aee6c27e005015a712a46ea63da48c65fa9a26b',
  endpointType: 'local-inference',
  deploymentMode: 'self-hosted',
  runtime: 'onnxruntime-node CPU EP + ffmpeg 7.x — no GPU required; working side capped (default 512px) for CPU budgets',
  limits: {
    maxPromptChars: 2000,
    durationSec: '3..12 (CPU lane caps effective fps at 24)',
    sizeFormat: 'WxH within 360..1920; working resolution snaps to /32 and stays within the CPU budget — the ENCODED dims are what ffprobe reports',
    maxFrames: '240 (BEAN_I2V_MAX_FRAMES)',
    laneClass: 'motion animation of the provided still (pan/zoom trajectory + neural in-between frames) — NOT generative scene synthesis',
  },
  license: {
    name: 'MIT (RIFE upstream + ONNX export)',
    commercialUse: 'permitted',
    note: 'Verified 2026-11-18 against upstream hzwer/Practical-RIFE (MIT) and the export repo license.',
    sourceUrl: 'https://github.com/hzwer/Practical-RIFE',
    verifiedAt: '2026-11-18',
  },
  dataHandling:
    'The reference image is resolved server-side (SSRF-guarded), processed by the BEAN local worker and stored under BEAN per-user storage. No external service receives the pixels.',
  metering: { unit: 'video-job', costUnit: null },
  secrets: [],
  fallbacks: [],
  // ENABLED (2026-11-18): a REAL end-to-end acceptance run completed through
  // the actual route/queue/worker path (real RIFE inference on real frames,
  // ffmpeg encode, ffprobe-validated artifact) — see M26_2_RESULTS.md and
  // scripts/m262-out/acceptance.json. The model must still be installed
  // explicitly on every deployment (honest 'not-installed' state otherwise).
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 1 },
  timeouts: { requestMs: 600_000, queueMs: 10_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * LAXII — REAL local segmentation backend (M26.2). MODNet (Apache-2.0,
 * u2netp fallback) alpha matting powering the background-removal lane:
 * true alpha at FULL source resolution, transparent PNG or explicit
 * background export. Enabled after the recorded real matting acceptance run.
 */
const LOCAL_IMAGE_SEGMENTATION: BackendDescriptor = {
  id: 'bean-image-local-segmentation',
  productId: 'laxii',
  task: 'image-editing',
  provider: 'BEAN Intelligence local inference (onnxruntime-node)',
  modelIdentity:
    'MODNet portrait matting ONNX (Apache-2.0, Xenova/modnet export, SHA-256-pinned) + U^2-Netp salient fallback (Apache-2.0)',
  revision: 'modnet @ 07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9; u2netp @ 309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  endpointType: 'local-inference',
  deploymentMode: 'self-hosted',
  runtime: 'onnxruntime-node CPU EP — no GPU required; matte runs at a capped working side and the alpha is upsampled to the FULL source resolution',
  limits: {
    maxAssetMb: 25,
    output: 'transparent PNG (source dimensions preserved) or JPEG/PNG flattened on an explicit background color / blurred background',
    honesty: 'a matte without a usable subject is an honest failure carrying measured coverage stats',
  },
  license: {
    name: 'Apache-2.0 (MODNet upstream + export; U-2-Net upstream)',
    commercialUse: 'permitted',
    note: 'Verified 2026-11-18 against ZHKKKe/MODNet (Apache-2.0) and xuebinqin/U-2-Net (Apache-2.0).',
    sourceUrl: 'https://github.com/ZHKKKe/MODNet',
    verifiedAt: '2026-11-18',
  },
  dataHandling:
    'Images are processed by the BEAN local worker; the original asset is never modified; outputs live in BEAN per-user storage.',
  metering: { unit: 'image', costUnit: null },
  secrets: [],
  fallbacks: [],
  // ENABLED (2026-11-18): REAL matting acceptance completed through the
  // actual route/queue/worker path (measured alpha coverage, source-
  // resolution preservation, transparent-PNG export) — M26_2_RESULTS.md.
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 120_000, queueMs: 30_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * LAXII — REAL local conversational-edit backend (M26.2). Parses the
 * instruction into a conservative executable plan (tone/look/background ops
 * via matting, masked removal via LaMa, approved geometry ops) and executes
 * it with real per-pixel operations. Generative synthesis requests fail
 * HONESTLY — the hosted lane remains the path for whole-image generative
 * edits. Enabled after the recorded real edit acceptance run.
 */
const LOCAL_IMAGE_EDIT: BackendDescriptor = {
  id: 'bean-image-local-edit',
  productId: 'laxii',
  task: 'image-editing',
  provider: 'BEAN Intelligence local inference (sharp + onnxruntime-node)',
  modelIdentity:
    'LaMa structural inpainting ONNX (Apache-2.0, OpenCV Zoo inpainting_lama, SHA-256-pinned) + MODNet matting for background-scoped ops',
  revision: 'lama @ 7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2',
  endpointType: 'local-inference',
  deploymentMode: 'self-hosted',
  runtime: 'sharp 0.34 + onnxruntime-node CPU EP — no GPU required; LaMa works at 512x512 internal resolution with exact outside-mask preservation',
  limits: {
    maxAssetMb: 25,
    plan: 'tone/look/background/masked-removal/approved-geometry ops only; unsupported generative instructions are refused with the reason',
    approval: 'destructive geometry ops (rotate/flip) require explicit user approval in the submit request',
  },
  license: {
    name: 'Apache-2.0 (LaMa OpenCV Zoo; big-lama upstream saic-mdal/lama)',
    commercialUse: 'permitted',
    note: 'Verified 2026-11-18 against opencv/opencv_zoo (Apache-2.0) and saic-mdal/lama (Apache-2.0).',
    sourceUrl: 'https://github.com/opencv/opencv_zoo/tree/main/models/inpainting_lama',
    verifiedAt: '2026-11-18',
  },
  dataHandling:
    'Instructions and images are processed by the BEAN local worker; original-image retention is structural (results are new assets); edit history is per-user.',
  metering: { unit: 'image', costUnit: null },
  secrets: [],
  fallbacks: [],
  // ENABLED (2026-11-18): REAL edit acceptance completed through the actual
  // route/queue/worker path (parsed plan, per-pixel ops, LaMa masked removal
  // with exact outside-mask preservation) — M26_2_RESULTS.md.
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 300_000, queueMs: 30_000 },
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
  // PROVIDER RESILIENCE (2026-11-07): CODE GIFTZ coding chat shares the same
  // credential-gated fallback chain as RIISHE chat.
  fallbacks: ['bean-llm-openai-compatible', 'bean-chat-local-llamacpp'],
  enabled: true,
  concurrency: { maxInFlightPerUser: 2, maxInFlightTotal: 8 },
  timeouts: { requestMs: 120_000, queueMs: 5_000 },
  // Truthful policy: one attempt per coding task; no automatic retry.
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * RIISHE + CODE GIFTZ — PREPARED OpenAI-compatible chat/coding fallback.
 *
 * The integration is REAL (adapter + routing + breaker + health probe) but
 * the provider is DORMANT until the operator sets its credentials in the
 * runtime environment: BEAN_PROVIDER_OPENAI_API_KEY (required),
 * BEAN_PROVIDER_OPENAI_BASE_URL / BEAN_PROVIDER_OPENAI_MODEL (optional).
 * No credential is invented, purchased or assumed. While dormant the
 * registry reports it disabled with the exact activation requirement, and
 * the fallback layer honestly reports the slot as 'not-configured'.
 * `enabled` is evaluated at process start from the real environment, so the
 * registry always states the truth about THIS runtime.
 */
const OPENAI_COMPATIBLE_LLM: BackendDescriptor = {
  id: 'bean-llm-openai-compatible',
  productId: 'riishe',
  task: 'chat',
  provider: 'Operator-configured OpenAI-compatible chat provider',
  modelIdentity: "The operator's configured model (BEAN_PROVIDER_OPENAI_MODEL, default gpt-4o-mini)",
  revision: null,
  endpointType: 'http',
  deploymentMode: 'authorized-hosted',
  runtime: 'Any OpenAI-compatible chat-completions endpoint (OpenAI, Groq, Together, OpenRouter, DeepSeek, self-hosted vLLM, …)',
  limits: {
    maxPromptChars: 12000,
    maxHistoryMessages: 24,
    streaming: true,
    note: 'Capability is verified by a real completion probe at health check — an endpoint that cannot complete chat is reported unhealthy, never assumed.',
  },
  license: {
    name: 'Access governed by the operator\u2019s account with the configured provider',
    commercialUse: 'authorized',
    note:
      'Activated only by the operator setting credentials for a provider they have authorized. BEAN never purchases or switches to an unapproved paid service on its own.',
    sourceUrl: 'https://platform.openai.com/docs/api-reference/chat',
    verifiedAt: '2026-11-07',
  },
  dataHandling:
    'Prompts and completions are processed by the configured provider under the operator\u2019s account terms. Credentials stay server-side and are never exposed to the browser.',
  metering: { unit: 'request', costUnit: null },
  secrets: ['BEAN_PROVIDER_OPENAI_API_KEY'],
  fallbacks: [],
  enabled: resolveOpenAiCompatibleCredential().present,
  unavailableReason:
    'Not configured: this prepared fallback activates only when the operator sets BEAN_PROVIDER_OPENAI_API_KEY (+ optional BEAN_PROVIDER_OPENAI_BASE_URL / BEAN_PROVIDER_OPENAI_MODEL) in the runtime environment. No account is created or purchased automatically.',
  concurrency: { maxInFlightPerUser: 2, maxInFlightTotal: 8 },
  timeouts: { requestMs: 90_000, queueMs: 5_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * M36-A — operator-configured Anthropic Messages slot.
 *
 * A REAL protocol adapter (`providers/anthropic.ts`: x-api-key +
 * anthropic-version headers, top-level system field, content_block_delta
 * streaming) for the official Anthropic Messages API. Dormant until the
 * operator configures a credential — exactly like the OpenAI-compatible
 * slot, the credential IS the authorization (cost policy: no automatic paid
 * fallback; this backend is NOT appended to any automatic fallback chain and
 * serves only when routing explicitly selects it). Capability is verified by
 * a real completion probe, never assumed.
 */
const ANTHROPIC_LLM: BackendDescriptor = {
  id: 'bean-llm-anthropic',
  productId: 'riishe',
  task: 'chat',
  provider: 'Operator-configured Anthropic Messages provider',
  modelIdentity: "The operator's configured model (BEAN_PROVIDER_ANTHROPIC_MODEL, default claude-haiku-4-5)",
  revision: null,
  endpointType: 'http',
  deploymentMode: 'authorized-hosted',
  runtime: 'Official Anthropic Messages API (POST /v1/messages, SSE streaming)',
  limits: {
    maxPromptChars: 12000,
    maxHistoryMessages: 24,
    streaming: true,
    note: 'Official Messages protocol — system prompts map to the top-level system field; capability verified by a real completion probe at health check.',
  },
  license: {
    name: 'Access governed by the operator\u2019s account with Anthropic',
    commercialUse: 'authorized',
    note:
      'Activated only by the operator setting credentials for an account they have authorized. BEAN never purchases or switches to an unapproved paid service on its own.',
    sourceUrl: 'https://docs.anthropic.com/en/api/messages',
    verifiedAt: '2026-11-23',
  },
  dataHandling:
    'Prompts and completions are processed by Anthropic under the operator\u2019s account terms. Credentials stay server-side and are never exposed to the browser.',
  metering: { unit: 'request', costUnit: null },
  secrets: ['BEAN_PROVIDER_ANTHROPIC_API_KEY'],
  fallbacks: [],
  enabled: resolveAnthropicCredential().present,
  unavailableReason:
    'Not configured: this slot activates only when the operator sets BEAN_PROVIDER_ANTHROPIC_API_KEY (+ optional BEAN_PROVIDER_ANTHROPIC_BASE_URL / BEAN_PROVIDER_ANTHROPIC_MODEL) or adds an encrypted admin-vault credential. No account is created or purchased automatically.',
  concurrency: { maxInFlightPerUser: 2, maxInFlightTotal: 8 },
  timeouts: { requestMs: 90_000, queueMs: 5_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * RIISHE + CODE GIFTZ — FREE-LOCAL llama.cpp GGUF lane (Phase: free-first).
 *
 * A `llama-server` started on BEAN's own hardware (operator PC or this host)
 * serves an OpenAI-compatible endpoint; models are open-weight GGUF files
 * (e.g. Qwen3 quantized, Dolphin GGUF, Mistral-family) — no Ollama, per
 * policy. Dormant until the operator wires BEAN_LLAMACPP_BASE_URL and opts
 * into local provider endpoints (SSRF guard). Capability is verified by a
 * REAL completion probe in the adapter's health check — a running server
 * alone never proves the model serves chat.
 */
const LOCAL_LLAMACPP_LLM: BackendDescriptor = {
  id: 'bean-chat-local-llamacpp',
  productId: 'riishe',
  task: 'chat',
  provider: 'BEAN Intelligence (local llama.cpp GGUF server)',
  modelIdentity: "Operator-loaded GGUF model (e.g. Qwen3 quantized / Dolphin GGUF); identity read live from the server's /v1/models",
  revision: null,
  endpointType: 'http',
  deploymentMode: 'self-hosted',
  runtime: 'llama.cpp llama-server (CPU inference; CUDA offload when a GPU is present) on the BEAN host',
  limits: {
    maxPromptChars: 12_000,
    maxHistoryMessages: 24,
    streaming: true,
    note: 'Model quality/latency depend on the loaded GGUF; health verifies a real completion, never a config value.',
  },
  license: {
    name: 'Per the loaded model\u2019s license (e.g. Apache-2.0 Qwen3; Dolphin JSON license shipped with weights)',
    commercialUse: 'authorized',
    note:
      'Open-weight inference on BEAN-owned hardware. BEAN does not download weights without the operator\u2019s explicit license acceptance (llama.cpp model cards document each license).',
    sourceUrl: 'https://github.com/ggml-org/llama.cpp',
    verifiedAt: '2026-11-07',
  },
  dataHandling:
    'Prompts and completions are processed by the local llama.cpp server on BEAN hardware; nothing leaves the host. Credentials (if any) stay server-side.',
  metering: { unit: 'request', costUnit: null },
  secrets: ['BEAN_LLAMACPP_API_KEY (optional; llama-server usually needs none)'],
  fallbacks: [],
  enabled: isLlamaCppConfigured(),
  unavailableReason:
    'Not configured: start llama-server with a GGUF model, then set BEAN_LLAMACPP_BASE_URL and BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1. The slot consumes nothing while dormant.',
  concurrency: { maxInFlightPerUser: 2, maxInFlightTotal: 4 },
  timeouts: { requestMs: 120_000, queueMs: 5_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * GANGZII — authorized hosted SPEECH SYNTHESIS (2026-11-18 wiring).
 *
 * ENABLED: the adapter executes REAL chunked synthesis through the gateway.
 * Every limit below is a MEASURED constraint from the 2026-10-27 live probe
 * evidence (models/licenses/gangzii-stage0-audio-probe-evidence.json and
 * scripts/beep-probe-out/): WAV containers only (mp3 rejected upstream),
 * 24 kHz mono 16-bit output, 1024 chars per chunk, speed [0.5, 2.0],
 * fixed 7-voice set, and the documented leading-tone artifact handled at
 * the source (per-chunk WAV) plus a defensive deterministic guard.
 */

/**
 * GANGZII — authorized hosted SPEECH RECOGNITION (2026-11-18 wiring).
 *
 * ENABLED: real ASR through the gateway. Measured constraints (2026-10-27):
 * only WAV and WebM containers are accepted (upstream error text verbatim),
 * output is plain text — no timestamps, no diarization.
 */

/**
 * GANGZII — deterministic local audio conversion (ffmpeg, in-process).
 * ENABLED: real local transcode with no model involved. Stereo "export" is
 * an explicitly-labeled DUAL-MONO duplication (the provider emits mono) and
 * the produced file is verified with ffprobe before it may be labeled.
 */

/**
 * JAZMII AUTO DIRECTOR (2026-11-20) — LOCAL composition backend.
 *
 * The story-to-finished-video orchestration runs ON this host: scene clips
 * come from HOSTED_VIDEO (the only video-generation backend), but assembly,
 * titles, transitions, audio mixing and the final encode are local FFmpeg /
 * pinned local HyperFrames processes (₹0 infrastructure, no paid rendering).
 * The engine actually used is recorded per production — the registry entry
 * describes the LOCAL stage only and never claims GPU or provider work.
 */
const LOCAL_VIDEO_COMPOSITION: BackendDescriptor = {
  id: 'bean-video-composition-local',
  productId: 'jazmii',
  task: 'video-production',
  provider: 'BEAN Intelligence (local composition engines)',
  modelIdentity: 'No model — deterministic local media assembly (FFmpeg filtergraph; pinned HyperFrames CLI when probed available)',
  revision: null,
  endpointType: 'local-process',
  deploymentMode: 'self-hosted',
  runtime: 'ffmpeg + ffprobe on the BEAN host; optional hyperframes@<pinned> with its managed headless Chrome (local render only)',
  limits: {
    maxProductionSeconds: 60,
    maxScenes: 8,
    sceneDurationRange: [3, 12],
    aspects: ['9:16', '16:9', '1:1'],
    engines: ['ffmpeg (always available)', 'hyperframes (probe + check gated)'],
  },
  license: {
    name: 'FFmpeg/LGPL+x264/GPL build per distro; HyperFrames Apache-2.0 (local CLI use)',
    commercialUse: 'authorized',
    note:
      'Composition runs local open-source tooling already present on the host. Scene footage comes from the authorized hosted video backend. No third-party cloud rendering is involved.',
    sourceUrl: 'https://github.com/heygen-com/hyperframes',
    verifiedAt: '2026-11-20',
  },
  dataHandling:
    'Scene clips and audio stay on the BEAN host through composition; nothing leaves the machine at this stage. Final files are stored under BEAN storage with per-user access checks.',
  metering: { unit: 'production', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 60 * 60_000, queueMs: 5_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * GANGZII — LOCAL-FIRST TTS engine (M27, 2026-11-21): Kokoro-82M v1.0 via
 * kokoro-js + onnxruntime-node on the BEAN host. ENABLED as the FIRST
 * engine in the gangzii speech-synthesis fallback chain — the engine's own
 * health check decides whether it can serve (model installed + ONNX session
 * loads); an uninstalled model honestly reports "not installed" and the
 * router falls through to the authorized hosted gateway below (recorded per
 * job so receipts always state which engine actually synthesized).
 *
 * Model lifecycle is EXPLICIT: download on user action (size shown before
 * install), sha256-verified against the published LFS metadata, pinned
 * revision, models stored OUTSIDE the repo under storage/models/, removal
 * refused while jobs are active. Apache-2.0 weights (hexgrad/Kokoro-82M);
 * phonemizer's bundled espeak-ng WASM is a GPL-3.0 server-side dependency.
 */
const LOCAL_KOKORO_TTS: BackendDescriptor = {
  id: 'bean-audio-tts-local-kokoro',
  productId: 'gangzii',
  task: 'speech-synthesis',
  provider: 'BEAN Intelligence (local ONNX TTS engine on the BEAN host)',
  modelIdentity: 'Kokoro-82M v1.0 (onnx-community/Kokoro-82M-v1.0-ONNX, q8 quantization, pinned revision)',
  revision: 'main (pinned at install; recorded in the install manifest)',
  endpointType: 'local-process',
  deploymentMode: 'self-hosted',
  runtime: 'Node.js + kokoro-js 1.2.1 + @huggingface/transformers (onnxruntime-node CPU) on the BEAN host',
  limits: {
    maxCharsPerRequest: 6000,
    maxCharsPerChunk: 400,
    sampleRateHz: 24_000,
    channels: 1,
    speedRange: [0.5, 2.0],
    modelDiskMbApprox: 92,
    device: 'cpu (GPU optional when onnxruntime supports it)',
  },
  license: {
    name: 'Apache-2.0 (model weights + kokoro-js); espeak-ng WASM (GPL-3.0) as unmodified server-side dependency',
    commercialUse: 'authorized',
    note:
      'Apache-2.0 weights permit commercial use; synthesized speech belongs to the BEAN user. The GPL component is used unmodified as a server-side phonemizer library and imposes no obligation on BEAN-generated audio.',
    sourceUrl: 'https://huggingface.co/hexgrad/Kokoro-82M',
    verifiedAt: '2026-11-21',
  },
  dataHandling:
    'Text is phonemized and synthesized ON the BEAN host; nothing leaves the machine during local synthesis (offline inference enforced: remote model fetch disabled at runtime).',
  metering: { unit: 'request', costUnit: null },
  secrets: [],
  fallbacks: ['bean-audio-tts-hosted-primary'],
  enabled: true,
  // Engine-level health (model installed + session loads) is measured per
  // request by the adapter; an uninstalled model falls through to the
  // hosted gateway with the reason recorded.
  unavailableReason:
    'The local model is not installed in this deployment. Installing it is an explicit user action (download size shown first); until then the authorized hosted gateway serves speech synthesis.',
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 300_000, queueMs: 10_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * GANGZII — the AUTHORIZED hosted gateway TTS path, now a proper registry
 * backend (M27). The adapter has been real and measured since 2026-10-27
 * (chunked WAV synthesis, 1024-char per-call limit, beep-artifact guard);
 * it previously ran OUTSIDE the router. Local-first policy: this engine
 * serves only when the local Kokoro engine cannot (not installed / load
 * failure / voice is a hosted-only preset) — the serving engine is recorded
 * on every job and receipt.
 */
const HOSTED_GANGZII_TTS: BackendDescriptor = {
  id: 'bean-audio-tts-hosted-primary',
  productId: 'gangzii',
  task: 'speech-synthesis',
  provider: 'Z.ai authorized hosted inference gateway',
  modelIdentity:
    'Provider-managed speech-synthesis model; exact checkpoint not disclosed to tenant (7-voice measured preset set)',
  revision: null,
  endpointType: 'managed-sdk',
  deploymentMode: 'authorized-hosted',
  runtime: 'Provider-managed runtime (no tenant-side GPU required); chunked WAV synthesis assembled by BEAN',
  limits: {
    maxCharsPerRequest: 6000,
    maxCharsPerChunk: 1024,
    sampleRateHz: 24_000,
    channels: 1,
    speedRange: [0.5, 2.0],
    voices: ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'],
  },
  license: {
    name: 'Access governed by platform inference agreement',
    commercialUse: 'authorized',
    note:
      'Speech synthesis consumed through the authorized gateway available to this deployment; no upstream weights are redistributed by BEAN.',
    sourceUrl: 'https://z.ai',
    verifiedAt: '2026-10-27',
  },
  dataHandling:
    'Submitted text is processed by the provider under its platform terms. Synthesized audio is stored under BEAN storage with per-user access checks.',
  metering: { unit: 'request', costUnit: null },
  secrets: ['ZAI_GATEWAY_CREDENTIALS (managed by platform runtime)'],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 300_000, queueMs: 10_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * GANGZII — audio production tools (M27): deterministic LOCAL ffmpeg mixing,
 * trimming, fades, ducking, loudness measurement and mastering exports.
 * No ML model is involved — this is measured signal processing, so the
 * "model identity" states exactly that. Enabled: ffmpeg + ffprobe are real
 * host dependencies verified by probe.
 */
const LOCAL_AUDIO_TOOLS: BackendDescriptor = {
  id: 'bean-audio-tools-local-ffmpeg',
  productId: 'gangzii',
  task: 'audio-production',
  provider: 'BEAN Intelligence (local deterministic audio processing)',
  modelIdentity: 'No model — deterministic FFmpeg filtergraph processing + ffprobe/ebur128 loudness measurement',
  revision: null,
  endpointType: 'local-process',
  deploymentMode: 'self-hosted',
  runtime: 'ffmpeg + ffprobe on the BEAN host (CPU)',
  limits: {
    maxUploadBytes: 26_214_400,
    maxInputSeconds: 3600,
    outputFormats: ['wav', 'mp3', 'm4a'],
    loudnessStandard: 'EBUR128 (integrated LUFS + true peak) via ffmpeg',
  },
  license: {
    name: 'FFmpeg/LGPL build per distro — local deterministic processing',
    commercialUse: 'authorized',
    note:
      'Customer audio is processed by BEAN-owned code on the BEAN host with local open-source tooling; no third-party service processes customer audio.',
    sourceUrl: 'https://ffmpeg.org',
    verifiedAt: '2026-11-21',
  },
  dataHandling:
    'Audio never leaves the application host during processing; artifacts are stored under BEAN storage with per-user access checks.',
  metering: { unit: 'request', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 600_000, queueMs: 10_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * GANGZII — Audio Lab LOCAL format conversion (mono/stereo export). The
 * same deterministic ffmpeg path as audio-production, registered under its
 * own task so the router maps BOTH task families without pretending they
 * are one capability. Stereo exports are dual-mono (measured provider
 * output is mono) and ffprobe-verified before being labeled.
 */
const LOCAL_AUDIO_CONVERT: BackendDescriptor = {
  id: 'bean-audio-convert-local-ffmpeg',
  productId: 'gangzii',
  task: 'audio-conversion',
  provider: 'BEAN Intelligence (local ffmpeg transcoder)',
  modelIdentity: 'No model — deterministic ffmpeg transcoding (mp3/ogg/flac/m4a/wav)',
  revision: null,
  endpointType: 'local-process',
  deploymentMode: 'self-hosted',
  runtime: 'ffmpeg + ffprobe on the BEAN host (CPU)',
  limits: {
    maxUploadBytes: 26_214_400,
    targets: ['mp3', 'ogg', 'flac', 'm4a', 'wav'],
    channels: [1, 2],
    stereoPolicy: 'dual-mono (channel duplication), never spatial stereo',
  },
  license: {
    name: 'FFmpeg/LGPL build per distro — local deterministic transcoding',
    commercialUse: 'authorized',
    note: 'Local open-source tooling on the BEAN host; no third-party service processes customer audio.',
    sourceUrl: 'https://ffmpeg.org',
    verifiedAt: '2026-10-27',
  },
  dataHandling: 'Audio never leaves the application host during conversion; artifacts stay under BEAN storage.',
  metering: { unit: 'request', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 300_000, queueMs: 10_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * GANGZII — authorized hosted ASR (Audio Lab transcription). Measured
 * 2026-10-27: WAV and WebM containers ONLY, plain-text transcript, no word
 * timestamps and no speaker diarization — limits recorded verbatim and
 * never embellished with invented alignment features.
 */
const HOSTED_GANGZII_ASR: BackendDescriptor = {
  id: 'bean-audio-asr-hosted-primary',
  productId: 'gangzii',
  task: 'audio-transcription',
  provider: 'Z.ai authorized hosted inference gateway',
  modelIdentity:
    'Provider-managed speech-recognition model; exact checkpoint not disclosed to tenant',
  revision: null,
  endpointType: 'managed-sdk',
  deploymentMode: 'authorized-hosted',
  runtime: 'Provider-managed runtime (no tenant-side GPU required)',
  limits: {
    containers: ['wav', 'webm'],
    output: 'plain text transcript only (no timestamps, no diarization)',
    maxUploadBytes: 26_214_400,
  },
  license: {
    name: 'Access governed by platform inference agreement',
    commercialUse: 'authorized',
    note: 'Speech recognition consumed through the authorized gateway available to this deployment.',
    sourceUrl: 'https://z.ai',
    verifiedAt: '2026-10-27',
  },
  dataHandling:
    'Uploaded audio is processed by the provider under its platform terms. Uploads stay under BEAN storage with per-user access checks.',
  metering: { unit: 'request', costUnit: null },
  secrets: ['ZAI_GATEWAY_CREDENTIALS (managed by platform runtime)'],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 300_000, queueMs: 10_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * RIISHE — REAL OCR backend (M40). Genuine optical character recognition on
 * image attachments and scanned documents through tesseract.js 6 (WebAssembly
 * CPU) with the SHA-256-pinned tessdata_fast `eng` language data. Replaces the
 * honest "OCR is not available in this deployment" gap recorded by M39.
 */
const LOCAL_DOCUMENT_OCR: BackendDescriptor = {
  id: 'bean-documents-ocr-local',
  productId: 'riishe',
  task: 'document-ocr',
  provider: 'BEAN Intelligence local inference (tesseract.js WebAssembly)',
  modelIdentity: 'Tesseract 5.3.x eng LSTM (tessdata_fast, SHA-256-pinned traineddata)',
  revision: 'ocr-eng-traineddata @ 7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  endpointType: 'local-inference',
  deploymentMode: 'self-hosted',
  runtime: 'tesseract.js 6 WebAssembly CPU — no GPU required; recognition runs in-process with a cached worker and the pinned language data served from the local-model manager',
  limits: {
    maxImageMb: 20,
    language: 'eng (tessdata_fast) — non-Latin scripts are honestly reported as not-recognized, never guessed',
    confidenceFloor: 40,
    honesty: 'text below the measured confidence floor or with no recognized characters is an honest no-usable-text outcome',
  },
  license: {
    name: 'Apache-2.0 (tesseract-ocr/tessdata_fast; tesseract.js 6 runtime)',
    commercialUse: 'permitted',
    note: 'Verified 2026-11-25 against tesseract-ocr/tessdata_fast (Apache-2.0). The tesseract.js WASM core ships via the npm lockfile (recorded boundary note).',
    sourceUrl: 'https://github.com/tesseract-ocr/tessdata_fast',
    verifiedAt: '2026-11-25',
  },
  dataHandling:
    'Images are processed by the BEAN local worker; extracted text is stored with the rest of the document text under the existing per-user document storage and access checks.',
  metering: { unit: 'image', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 90_000, queueMs: 30_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * RIISHE — REAL text-embedding backend (M40). Genuine 384-dim sentence
 * embeddings (all-MiniLM-L6-v2 quantized ONNX, SHA-256-pinned) on
 * onnxruntime-node CPU through the existing local-model manager. Feeds the
 * document retrieval lane; no new vector database is created.
 */
const LOCAL_TEXT_EMBEDDINGS: BackendDescriptor = {
  id: 'bean-embeddings-local-minilm',
  productId: 'riishe',
  task: 'text-embeddings',
  provider: 'BEAN Intelligence local inference (onnxruntime-node)',
  modelIdentity: 'all-MiniLM-L6-v2 sentence embeddings (Apache-2.0, Xenova/all-MiniLM-L6-v2 quantized ONNX export, SHA-256-pinned + pinned vocab.txt)',
  revision: 'minilm-l6-embeddings @ afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1; vocab @ 07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3; HF revision 751bff37182d3f1213fa05d7196b954e230abad9',
  endpointType: 'local-inference',
  deploymentMode: 'self-hosted',
  runtime: 'onnxruntime-node CPU EP — no GPU required; one resident session with idle unload, mean pooling + L2 normalization per the model card',
  limits: {
    dimensions: 384,
    maxTokensPerText: 512,
    quantization: 'int8 (model_quantized.onnx)',
    honesty: 'uninstalled/corrupted artifacts are honest unavailable states — never zero/hash/random vectors',
  },
  license: {
    name: 'Apache-2.0 (sentence-transformers/all-MiniLM-L6-v2 + Xenova export)',
    commercialUse: 'permitted',
    note: 'Verified 2026-11-25 against sentence-transformers/all-MiniLM-L6-v2 (Apache-2.0).',
    sourceUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2',
    verifiedAt: '2026-11-25',
  },
  dataHandling:
    'Text embedded on the BEAN host for the requesting conversation only; chunk vectors live in a bounded conversation-scoped in-process cache (not a database) and evaporate with the process.',
  metering: { unit: 'request', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 60_000, queueMs: 30_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/**
 * RIISHE — REAL passage-reranking backend (M40). Genuine cross-encoder
 * relevance scoring (ms-marco-MiniLM-L-6-v2 quantized ONNX, SHA-256-pinned)
 * on onnxruntime-node CPU. Orders candidate passages by MEASURED relevance —
 * never keyword-overlap heuristics presented as model scores.
 */
const LOCAL_PASSAGE_RERANK: BackendDescriptor = {
  id: 'bean-rerank-local-ms-marco-minilm',
  productId: 'riishe',
  task: 'passage-reranking',
  provider: 'BEAN Intelligence local inference (onnxruntime-node)',
  modelIdentity: 'ms-marco-MiniLM-L-6-v2 cross-encoder (Apache-2.0, Xenova/ms-marco-MiniLM-L-6-v2 quantized ONNX export, SHA-256-pinned + pinned vocab.txt)',
  revision: 'ms-marco-minilm-rerank @ e9d8ebf845c413e981c175bfe49a3bfa9b3dcce2a3ba54875ee5df5a58639fbe; vocab @ 07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3; HF revision a09144355adeed5f58c8ed011d209bf8ee5a1fec',
  endpointType: 'local-inference',
  deploymentMode: 'self-hosted',
  runtime: 'onnxruntime-node CPU EP — no GPU required; one resident session with idle unload; sigmoid relevance per (query, passage) pair',
  limits: {
    maxPairsPerRequest: 8,
    maxTokensPerPair: 512,
    quantization: 'int8 (model_quantized.onnx)',
    honesty: 'scores are real forward passes, capped pair counts keep CPU bounded',
  },
  license: {
    name: 'Apache-2.0 (cross-encoder/ms-marco-MiniLM-L-6-v2 + Xenova export)',
    commercialUse: 'permitted',
    note: 'Verified 2026-11-25 against cross-encoder/ms-marco-MiniLM-L-6-v2 (Apache-2.0).',
    sourceUrl: 'https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2',
    verifiedAt: '2026-11-25',
  },
  dataHandling:
    'Query/passage pairs are processed by the BEAN local worker for the requesting conversation only; nothing persists beyond the bounded conversation-scoped cache.',
  metering: { unit: 'request', costUnit: null },
  secrets: [],
  fallbacks: [],
  enabled: true,
  concurrency: { maxInFlightPerUser: 1, maxInFlightTotal: 2 },
  timeouts: { requestMs: 60_000, queueMs: 30_000 },
  retries: { maxAttempts: 1, backoffMs: 0 },
}

/** Private registry — the only place product→backend mappings exist. */
export const BACKEND_REGISTRY: BackendDescriptor[] = [
  HOSTED_LLM,
  OPENAI_COMPATIBLE_LLM,
  ANTHROPIC_LLM,
  LOCAL_LLAMACPP_LLM,
  HOSTED_IMAGE,
  HOSTED_IMAGE_EDIT,
  LOCAL_SHARP_ENGINE,
  DIFFUSERS_WORKER,
  LOCAL_IMAGE_SEGMENTATION,
  LOCAL_IMAGE_EDIT,
  HOSTED_VIDEO,
  LOCAL_VIDEO_MOTION,
  VIDEO_PLANNED,
  LOCAL_VIDEO_COMPOSITION,
  HOSTED_CODE_LLM,
  LOCAL_KOKORO_TTS,
  HOSTED_GANGZII_TTS,
  LOCAL_AUDIO_TOOLS,
  LOCAL_AUDIO_CONVERT,
  HOSTED_GANGZII_ASR,
  LOCAL_DOCUMENT_OCR,
  LOCAL_TEXT_EMBEDDINGS,
  LOCAL_PASSAGE_RERANK,
]

export function getBackendsForProduct(productId: BeanProductId): BackendDescriptor[] {
  return BACKEND_REGISTRY.filter((b) => b.productId === productId)
}

export function getBackend(id: string): BackendDescriptor | undefined {
  return BACKEND_REGISTRY.find((b) => b.id === id)
}
