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
  endpointType: 'managed-sdk' | 'http' | 'gpu-worker'
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
}

/**
 * JAZMII — video generation. NO compatible backend exists in this
 * environment (no GPU worker, no authorized video endpoint). The registry
 * records the PLANNED self-hosted candidate set honestly; the router will
 * refuse traffic with a clear NO_BACKEND error instead of faking jobs.
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
}

/** Private registry — the only place product→backend mappings exist. */
export const BACKEND_REGISTRY: BackendDescriptor[] = [
  HOSTED_LLM,
  HOSTED_IMAGE,
  VIDEO_PLANNED,
  HOSTED_CODE_LLM,
]

export function getBackendsForProduct(productId: BeanProductId): BackendDescriptor[] {
  return BACKEND_REGISTRY.filter((b) => b.productId === productId)
}

export function getBackend(id: string): BackendDescriptor | undefined {
  return BACKEND_REGISTRY.find((b) => b.id === id)
}
