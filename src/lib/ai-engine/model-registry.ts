/**
 * BEAN Intelligence — ENGINE MODEL REGISTRY (Phase 4).
 *
 * The provider-independent catalog the background engine routes against.
 * Each entry declares what a model/adapter can actually do and what it
 * costs/hardware it needs; routing NEVER substitutes an incompatible model
 * (a video task never lands on an image model, masked editing never lands
 * on a model without editing support, a local model never runs without its
 * hardware fit).
 *
 * Model selection is INTERNAL — there is no model-selection UI; users ask
 * products for capabilities and this registry decides the rest.
 *
 * Cost classification (free-first policy):
 *   free-local    open-weight model on our own hardware
 *   free-hosted   verified free hosted inference with remaining quota
 *   limited-free  free credits / restricted trial
 *   paid-api      requires paid credits
 *   unavailable   missing credentials / hardware / provider access
 *
 * SERVER-ONLY — never import from client code.
 */

import type { BeanProductId, BeanTask } from '@/lib/registry/products'
import { checkHardwareFit, type HardwareRequirement } from './gpu'

export type CostClass =
  | 'free-local'
  | 'free-hosted'
  | 'limited-free'
  | 'paid-api'
  | 'unavailable'

export interface ModelRegistryEntry {
  /** BEAN backend id (src/lib/registry/backends.ts is the execution source of truth). */
  backendId: string
  productId: BeanProductId
  task: BeanTask
  /** Internal label — admin/ops visibility only, never a user-facing choice. */
  label: string
  /** Repository / model source (where weights or the service live). */
  sourceUrl: string
  license: string
  /** Capability verbs this model actually supports (validated by adapters). */
  capabilities: string[]
  inputFormats: string[]
  outputFormats: string[]
  /** Context (chars) or resolution (px) ceilings. */
  limits: Record<string, unknown>
  maxDurationMs: number
  hardware: HardwareRequirement & { gpuWorker?: string }
  costClass: CostClass
  costNote: string
  /**
   * How availability is established: 'adapter' (the router's credential +
   * breaker checks), 'worker-preflight' (the local worker's real preflight),
   * 'never' (kept for documentation; routing always rejects).
   */
  availabilityCheck: 'adapter' | 'worker-preflight' | 'never'
  enabled: boolean
  unavailableReason?: string
}

export const AI_MODEL_REGISTRY: ModelRegistryEntry[] = [
  // ---------------------------------------------------------------- RIISHE
  {
    backendId: 'bean-llm-hosted-primary',
    productId: 'riishe',
    task: 'chat',
    label: 'Hosted chat primary (authorized gateway)',
    sourceUrl: 'https://z.ai',
    license: 'Access governed by platform inference agreement',
    capabilities: ['chat', 'streaming', 'multilingual', 'reasoning', 'summarization', 'rewrite', 'web-research'],
    inputFormats: ['text', 'document-context'],
    outputFormats: ['text-stream'],
    limits: { maxPromptChars: 12_000, maxHistoryMessages: 24 },
    maxDurationMs: 600_000,
    hardware: { vramMb: null },
    costClass: 'free-hosted',
    costNote: 'Consumed through the deployment platform\u2019s authorized gateway; no metered cost is reported to the tenant (costUnit null).',
    availabilityCheck: 'adapter',
    enabled: true,
  },
  {
    backendId: 'bean-llm-openai-compatible',
    productId: 'riishe',
    task: 'chat',
    label: 'Operator-configured OpenAI-compatible chat (dormant until credentials)',
    sourceUrl: 'https://platform.openai.com/docs/api-reference/chat',
    license: 'Per the operator\u2019s account with the configured provider',
    capabilities: ['chat', 'streaming', 'multilingual', 'reasoning', 'summarization', 'rewrite'],
    inputFormats: ['text'],
    outputFormats: ['text-stream'],
    limits: { maxPromptChars: 12_000, maxHistoryMessages: 24 },
    maxDurationMs: 600_000,
    hardware: { vramMb: null },
    // The SLOT is free to configure; the underlying provider depends on the
    // operator's account (OpenAI/Groq/Together/OpenRouter/DeepSeek = paid or
    // limited-free; HF Inference Providers router = limited-free monthly
    // credits). Classified conservatively.
    costClass: 'paid-api',
    costNote: 'Depends on the operator-configured provider (BEAN_PROVIDER_OPENAI_*). Verified free tiers usable via OpenAI-compatible base URLs: Hugging Face router (monthly inference credits), Google Gemini OpenAI-compat endpoint (free tier with rate limits).',
    availabilityCheck: 'adapter',
    enabled: false,
    unavailableReason: 'Dormant until BEAN_PROVIDER_OPENAI_API_KEY (or an admin-vault credential) is set.',
  },
  {
    backendId: 'bean-chat-local-llamacpp',
    productId: 'riishe',
    task: 'chat',
    label: 'Local GGUF chat via llama.cpp server (free-local)',
    sourceUrl: 'https://github.com/ggml-org/llama.cpp',
    license: 'Model-dependent (e.g. Qwen3 Apache-2.0, Dolphin JSON licenses ship with weights)',
    capabilities: ['chat', 'streaming', 'multilingual', 'reasoning', 'summarization', 'rewrite'],
    inputFormats: ['text'],
    outputFormats: ['text-stream'],
    limits: { maxPromptChars: 12_000, ggufQuantizations: ['Q4_K_M', 'Q5_K_M', 'Q8_0'] },
    maxDurationMs: 600_000,
    hardware: { vramMb: null, ramMb: 4_096, diskMb: 1_000, gpuWorker: 'llama-server (OpenAI-compatible /v1); GPU optional — CPU inference works, CUDA offload when available' },
    costClass: 'free-local',
    costNote: 'Open-weight GGUF model executed on BEAN hardware via llama.cpp. No per-request cost.',
    availabilityCheck: 'adapter',
    enabled: false,
    unavailableReason: 'Requires BEAN_LLAMACPP_BASE_URL (a running llama-server) + BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1 on the operator host.',
  },

  // ----------------------------------------------------------------- LAXII
  {
    backendId: 'bean-image-hosted-primary',
    productId: 'laxii',
    task: 'image-generation',
    label: 'Hosted text-to-image (authorized gateway)',
    sourceUrl: 'https://z.ai',
    license: 'Access governed by platform inference agreement',
    capabilities: ['text-to-image'],
    inputFormats: ['text'],
    outputFormats: ['jpeg'],
    limits: { maxPromptChars: 4_000, sizes: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'] },
    maxDurationMs: 180_000,
    hardware: { vramMb: null },
    costClass: 'free-hosted',
    costNote: 'Authorized gateway; no metered cost reported.',
    availabilityCheck: 'adapter',
    enabled: true,
  },
  {
    backendId: 'bean-image-hosted-edit',
    productId: 'laxii',
    task: 'image-editing',
    label: 'Hosted conversational image editing (authorized gateway)',
    sourceUrl: 'https://z.ai',
    license: 'Access governed by platform inference agreement',
    capabilities: ['image-to-image', 'conversational-edit'],
    inputFormats: ['image-data-url'],
    outputFormats: ['jpeg'],
    limits: { maxPromptChars: 4_000, preservation: 'whole-image regenerative edit — NOT pixel-preserving' },
    maxDurationMs: 180_000,
    hardware: { vramMb: null },
    costClass: 'free-hosted',
    costNote: 'Authorized gateway; no metered cost reported.',
    availabilityCheck: 'adapter',
    enabled: true,
  },
  {
    backendId: 'bean-image-local-sharp',
    productId: 'laxii',
    task: 'image-enhancement',
    label: 'Deterministic Sharp preservation engine (CPU, in-process)',
    sourceUrl: 'https://sharp.pixelplumbing.com',
    license: 'Sharp Apache-2.0 (BEAN-local processing, no third party sees pixels)',
    capabilities: ['enhancement', 'mask-compositing', 'upscale', 'grading'],
    inputFormats: ['png', 'jpeg', 'webp'],
    outputFormats: ['jpeg', 'png'],
    limits: { maxInputPixels: 16_777_216, generative: false },
    maxDurationMs: 120_000,
    hardware: { vramMb: null, ramMb: 1_024 },
    costClass: 'free-local',
    costNote: 'Deterministic CPU processing on BEAN host. No cost.',
    availabilityCheck: 'adapter',
    enabled: true,
  },
  {
    backendId: 'bean-image-selfhosted-diffusers',
    productId: 'laxii',
    task: 'image-editing',
    label: 'Local Diffusers worker — SD1.5-inpaint/SDXL + IP-Adapter + Real-ESRGAN + LaMa (free-local)',
    sourceUrl: 'https://github.com/huggingface/diffusers',
    license: 'OpenRAIL-M / OpenRAIL++-M (SD), Apache-2.0 (IP-Adapter, LaMa), BSD-3 (Real-ESRGAN), MIT (YuNet/SFace)',
    capabilities: ['masked-inpainting', 'image-to-image', 'reference-guided-generation', 'object-removal', 'upscale', 'brush-mask-preservation'],
    inputFormats: ['png', 'jpeg', 'mask'],
    outputFormats: ['png', 'jpeg'],
    limits: { maxInputPixels: 16_777_216, onePipelineResident: true },
    maxDurationMs: 300_000,
    hardware: { vramMb: 6_144, ramMb: 8_192, diskMb: 12_000, gpuWorker: 'workers/laxii-diffusers (Python, torch/CUDA; ≥6 GB free VRAM class)' },
    costClass: 'unavailable',
    costNote: 'Weights are free/open-license; execution requires a CUDA GPU host. This deployment host has no GPU — the worker ships ready and honestly reports unavailable until the operator\u2019s GPU host passes its preflight + acceptance.',
    availabilityCheck: 'worker-preflight',
    enabled: false,
    unavailableReason: 'No GPU on this host: masked generative editing is honestly unavailable here. Strict-Preserve deterministic editing remains available.',
  },

  // ---------------------------------------------------------------- JAZMII
  {
    backendId: 'bean-video-hosted-primary',
    productId: 'jazmii',
    task: 'video-generation',
    label: 'Hosted video (authorized gateway; async tasks)',
    sourceUrl: 'https://z.ai',
    license: 'Access governed by platform inference agreement',
    capabilities: ['text-to-video', 'image-to-video'],
    inputFormats: ['text', 'image-url'],
    outputFormats: ['mp4', 'webm'],
    limits: { maxPromptChars: 2_000, maxDurationSec: 12, maxPollDurationMs: 900_000, maxOutputBytes: 104_857_600 },
    maxDurationMs: 960_000,
    hardware: { vramMb: null },
    costClass: 'free-hosted',
    costNote: 'Authorized gateway; no metered cost reported.',
    availabilityCheck: 'adapter',
    enabled: true,
  },
  {
    backendId: 'bean-video-selfhosted-candidate',
    productId: 'jazmii',
    task: 'video-generation',
    label: 'Wan 2.2 TI2V-5B candidate (free-local, hardware-gated)',
    sourceUrl: 'https://github.com/Wan-Video/Wan2.2',
    license: 'Apache-2.0 (official Wan2.2 repo LICENSE)',
    capabilities: ['text-to-video', 'image-to-video'],
    inputFormats: ['text', 'image'],
    outputFormats: ['mp4'],
    limits: {
      nativeResolution: '1280x704@24fps (Wan2.2-VAE 16x16x4 compression)',
      // Hardware facts (checked 2026-11-07): the official HF card says TI2V-5B
      // "runs on single consumer-grade GPU such as the 4090" at 720P@24fps;
      // measured community figures put fp16 peak ~11 GB (INT8 ~5.4 GB, INT4
      // ~2.7 GB GGUF). A14B variants do NOT fit a 16 GB card at fp16.
      note: 'TI2V-5B fp16 peak ~11 GB -> RTX 5060 Ti 16 GB FITS with headroom; A14B does not. A REAL acceptance run on the operator GPU host is REQUIRED before this backend can ever be enabled (worker code does not exist yet).',
    },
    maxDurationMs: 3_600_000,
    hardware: { vramMb: 12_288, ramMb: 32_768, diskMb: 30_000, gpuWorker: 'Wan2.2 inference pipeline (torch/CUDA) — worker NOT yet implemented; candidate only' },
    costClass: 'unavailable',
    costNote: 'Open-weight (Apache-2.0) — free to run on our own hardware. This deployment has no GPU; the operator PC (RTX 5060 Ti 16 GB) COULD run TI2V-5B (~11 GB fp16 peak) but no worker is implemented and no acceptance run has happened — honestly unavailable until both exist.',
    availabilityCheck: 'never',
    enabled: false,
    unavailableReason: 'No GPU worker exists and this host has no GPU. TI2V-5B is hardware-feasible on the operator PC (fp16 ~11 GB peak, measured community figures) — implementing the worker + a real acceptance run is the documented path to enablement.',
  },

  // ------------------------------------------------------------ CODE GIFTZ
  {
    backendId: 'bean-code-llm-hosted-primary',
    productId: 'code-giftz',
    task: 'coding-task',
    label: 'Hosted coding model (authorized gateway)',
    sourceUrl: 'https://z.ai',
    license: 'Access governed by platform inference agreement',
    capabilities: ['code-generation', 'debugging', 'refactoring', 'explanation', 'multi-file-context', 'streaming'],
    inputFormats: ['text', 'code-context', 'attachments'],
    outputFormats: ['text-stream', 'code-files'],
    limits: { maxPromptChars: 12_000, sandbox: 'isolated child-process runtime, approval-gated' },
    maxDurationMs: 600_000,
    hardware: { vramMb: null },
    costClass: 'free-hosted',
    costNote: 'Authorized gateway; no metered cost reported.',
    availabilityCheck: 'adapter',
    enabled: true,
  },
]

/** Find registry entries that can serve a product+capability. */
export function modelsFor(productId: BeanProductId, capability: string): ModelRegistryEntry[] {
  return AI_MODEL_REGISTRY.filter(
    (m) => m.productId === productId && (m.capabilities.includes(capability) || m.task === capability),
  )
}

/**
 * Hardware gate used by the engine before queueing to a local worker.
 * A local model that does not fit THIS host is rejected with a reason —
 * never silently substituted, never assumed to fit.
 */
export async function hardwareGate(entry: ModelRegistryEntry): Promise<{ fits: boolean; reason: string | null }> {
  if (entry.hardware.vramMb === null && !entry.hardware.ramMb && !entry.hardware.diskMb) {
    return { fits: true, reason: null }
  }
  return checkHardwareFit(entry.hardware)
}
