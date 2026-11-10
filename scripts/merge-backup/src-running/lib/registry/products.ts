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

export type BeanProductId = 'riishe' | 'laxii' | 'jazmii' | 'code-giftz'

export type BeanTask =
  | 'chat'
  | 'image-generation'
  | 'video-generation'
  | 'coding-task'

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
    tagline: 'Image generation studio',
    description:
      'Generate images from text prompts with supported dimensions and aspect ratios, live job progress, previews and downloadable files.',
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
]

export function getProduct(id: string): BeanProduct | undefined {
  return BEAN_PRODUCTS.find((p) => p.id === id)
}

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
  { value: '1440x720', label: 'Wide 2:1' },
  { value: '720x1440', label: 'Tall 1:2' },
] as const
