/**
 * BEAN Intelligence — PUBLIC product catalog.
 *
 * This is the ONLY product identity customers may see. It contains no
 * upstream model identifiers, no provider names, and no endpoint details.
 * Everything here is safe to ship to the browser bundle.
 *
 * Upstream model selection lives in src/lib/registry/backends.ts (private,
 * server-only, never imported by client code).
 */

export type BeanProductId = 'riishe' | 'laxii' | 'jazmii' | 'code-giftz' | 'gangzii'

export type BeanTask =
  | 'chat'
  | 'image-generation'
  | // LAXII preservation engine (2026-10-31): deterministic local enhancement is
    // a real, executed capability; generative editing routes to the local
    // Diffusers worker and stays honestly unavailable until that worker passes
    // its hardware preflight AND a real inference test (see
    // docs/models/LAXII-ENGINE-DECISION-MATRIX.md).
    'image-enhancement'
  | 'image-editing'
  | 'video-generation'
  // JAZMII AUTO DIRECTOR (2026-11-20): story-to-finished-video production.
  // Scene clips are still 'video-generation' jobs; 'video-production' is the
  // LOCAL orchestration + composition task on the durable queue.
  | 'video-production'
  | 'coding-task'
  // GANGZII audio tasks (server-side API surface):
  | 'speech-synthesis'
  | 'audio-transcription'
  | 'audio-conversion'
  // GANGZII AUDIO PRODUCTION (M27): deterministic local mixing/trim/fade/
  // ducking/loudness-master task on the durable queue. Distinct from
  // 'audio-conversion' (single-file transcode) so receipts can state WHICH
  // family of operations ran.
  | 'audio-production'
  | 'music-generation'
  // M40 — RIISHE retrieval/understanding lanes. REAL local-inference tasks
  // (OCR over scanned images/documents, genuine text embeddings and
  // cross-encoder passage reranking). They exist so capability records,
  // manifests and receipts can state WHICH family ran — there is no
  // user-facing task selector; the orchestrator routes automatically.
  | 'document-ocr'
  | 'text-embeddings'
  | 'passage-reranking'

export interface ProductCapability {
  /** Human-readable capability shown in the UI. */
  label: string
  /** Whether this capability is actually wired to a working backend today. */
  available: boolean
}

export interface BeanProduct {
  id: BeanProductId
  name: string
  tagline: string
  description: string
  task: BeanTask
  /** Capability list is derived from REAL configured backends at request time. */
  accent: string // gold accent hue token for UI
  icon: string // lucide icon key resolved client-side
}

export const BEAN_PRODUCTS: BeanProduct[] = [
  {
    id: 'riishe',
    name: 'RIISHE',
    tagline: 'Conversational intelligence',
    description:
      'Natural conversations, question answering, reasoning, summarization, writing and rewriting, multilingual assistance and structured outputs.',
    task: 'chat',
    accent: '#E7B94C',
    icon: 'message-square-text',
  },
  {
    id: 'laxii',
    name: 'LAXII',
    tagline: 'Image creation & preservation studio',
    description:
      'Generate images from text prompts, enhance existing images with a preservation-first pipeline that keeps original pixels intact, and edit with brush masks that only ever change the region you approve. Availability of each capability is reported truthfully.',
    task: 'image-generation',
    accent: '#F0C75E',
    icon: 'image',
  },
  {
    id: 'jazmii',
    name: 'JAZMII',
    tagline: 'Video generation engine',
    description:
      'Asynchronous text-to-video generation with job tracking, previews and export. Requires a deployed video backend; availability is reported truthfully.',
    task: 'video-generation',
    accent: '#D4AF37',
    icon: 'video',
  },
  {
    id: 'code-giftz',
    name: 'CODE GIFTZ',
    tagline: 'Coding intelligence',
    description:
      'Code generation and explanation, debugging and refactoring, test generation and isolated sandbox execution, review and implementation planning.',
    task: 'coding-task',
    accent: '#C9A227',
    icon: 'code-2',
  },
  {
    // M27 (2026-11-21): GANGZII is a REAL audio-production specialist —
    // local-first TTS (Kokoro-82M), the authorized hosted gateway, narration
    // production and deterministic ffmpeg audio tooling. Availability is
    // reported from measured engine health, never assumed.
    id: 'gangzii',
    name: 'GANGZII',
    tagline: 'Audio production studio',
    description:
      'Local-first text-to-speech narration, voice selection and preview, segment-level regeneration, audio mixing and mastering, and synchronized soundtracks for JAZMII videos. Engine availability is measured, not assumed.',
    task: 'speech-synthesis',
    accent: '#E8C96A',
    icon: 'audio-lines',
  },
]

export function getProduct(id: string): BeanProduct | undefined {
  return BEAN_PRODUCTS.find((p) => p.id === id)
}

/**
 * GANGZII limits — the values the engines GENUINELY enforce (measured
 * probes recorded in models/manifests/bean-audio-tts-hosted-primary.json;
 * speed 0.3 was rejected upstream, mp3 response_format is rejected, >1024
 * chars per chunk rejected — BEAN pre-validates all of these). M27: the
 * LOCAL Kokoro engine additionally caps each synthesis chunk at 400 chars
 * (its own split limit) — the request-level cap below covers both engines.
 */
export const GANGZII_LIMITS = {
  speedMin: 0.5,
  speedMax: 2.0,
  maxCharsPerRequest: 6000,
  outputFormat: 'wav',
  sampleRateHz: 24_000,
} as const

/** Flat provider-voice list (re-exported for the server routes' import). */
export { GANGZII_VOICES } from './gangzii-presets'

/**
 * Publicly displayable size options for LAXII. Must mirror the sizes the
 * configured backend actually supports (kept in sync via backends registry).
 */
export const LAXII_SIZES = [
  { value: '1024x1024', label: 'Square 1:1' },
  { value: '768x1344', label: 'Portrait 4:7' },
  { value: '864x1152', label: 'Portrait 3:4' },
  { value: '1344x768', label: 'Landscape 7:4' },
  { value: '1152x864', label: 'Landscape 4:3' },
  { value: '2048x1152', label: 'Landscape 16:9' },
  { value: '1152x2048', label: 'Portrait 9:16' },
  { value: '2048x1024', label: 'Wide 2:1' },
  { value: '1024x2048', label: 'Tall 1:2' },
] as const
