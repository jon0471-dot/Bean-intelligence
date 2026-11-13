/**
 * LAXII — natural-language capability detection (2026-11-12).
 *
 * The unified conversational studio routes ordinary requests ("Create a
 * cinematic perfume advertisement.", "Change the bottle cap to gold…",
 * "Upscale this image to 4K.") onto the EXISTING backend capabilities:
 *
 *   generate        → task image-generation        (text-to-image)
 *   edit            → task image-editing, mode conversational-edit
 *   image-to-image  → task image-editing, mode conversational-edit
 *   bg-removal      → task image-editing, mode background-removal
 *   enhance         → task image-enhancement       (deterministic engine)
 *   upscale         → task image-enhancement + options.upscaleFactor
 *   masked-edit     → localized change → the inline mask flow, then the
 *                     existing smart-edit / object-removal modes
 *   clarify         → ask one short question instead of guessing
 *
 * Deterministic and pure: no LLM call, no fabricated understanding. When the
 * text does not clearly match a capability the classifier says so (clarify)
 * rather than guessing. The only NLP is conservative phrase matching over
 * explicit capability vocabulary.
 */

export type LaxiiIntent =
  | 'generate'
  | 'edit'
  | 'image-to-image'
  | 'bg-removal'
  | 'enhance'
  | 'upscale'
  | 'masked-edit'
  | 'clarify'

/** The one existing mode each intent maps onto (routes/queue untouched). */
export const INTENT_JOB_TASK: Record<Exclude<LaxiiIntent, 'clarify'>, string> = {
  generate: 'image-generation',
  edit: 'image-editing',
  'image-to-image': 'image-editing',
  'bg-removal': 'image-editing',
  enhance: 'image-enhancement',
  upscale: 'image-enhancement',
  'masked-edit': 'image-editing',
}

export interface IntentInput {
  text: string
  /** A fresh image rides along with this very message. */
  hasAttachedImage: boolean
  /** The conversation already shows an image (upload or result). */
  conversationHasImage: boolean
}

export interface IntentDecision {
  intent: LaxiiIntent
  /** Cleaned instruction — generation prompt or edit instruction. */
  prompt: string
  /** Preset size value (LAXII_SIZES) for generation, when detected. */
  size?: string
  /** Explicit custom dimensions for generation, when detected. */
  width?: number
  height?: number
  /** Lanczos factor for upscale intent (2 or 4). */
  upscaleFactor?: number
  /** masked-edit only: which existing masked mode runs once a mask exists. */
  maskMode?: 'smart-edit' | 'object-removal'
  /** clarify only: one short question, plus why. */
  clarifyQuestion?: string
  clarifyReason?: string
}

export const MIN_PROMPT_CHARS = 3

const LAXII_PRESET_SIZES: Record<string, string> = {
  square: '1024x1024',
  portrait: '768x1344',
  landscape: '1344x768',
  wide: '1440x720',
  tall: '720x1440',
}

const RATIO_PRESET_SIZES: Array<{ ratio: number; size: string }> = [
  { ratio: 1, size: '1024x1024' },
  { ratio: 768 / 1344, size: '768x1344' },
  { ratio: 864 / 1152, size: '864x1152' },
  { ratio: 1344 / 768, size: '1344x768' },
  { ratio: 1152 / 864, size: '1152x864' },
  { ratio: 2, size: '1440x720' },
  { ratio: 0.5, size: '720x1440' },
]

const BG_REMOVAL_RE =
  /\b(remove|delete|drop|erase|cut\s?out|get\s?rid\s?of|kill)\b[^.!?]*\b(background|bg|backdrop)\b|\b(transparent|see-?through|alpha)\b[^.!?]*\b(background|png)?\b|\bno\s+background\b|\bisolate\b[^.!?]*\b(subject|product|object)\b|\b(cut\s?out|cutout|knock\s?out)\b[^.!?]*\b(subject|product|person|photo|image|picture|foreground|item)\b/i
const UPSCALE_RE =
  /\b(upscale|up-?scale|enlarge|bigger|larger|increase\s+(the\s+)?resolution|higher\s+resolution|more\s+resolution)\b|\b(2|4|8)\s*[x×]\b|\b4k\b|\b8k\b|\bretina\b/i
const ENHANCE_RE =
  /\b(enhance|improve|sharpen|sharper|sharpness|crisper|clean\s?up|denoise|de-?noise|noise|better\s+quality|higher\s+quality|fix\s+(the\s+)?(lighting|exposure|colors?|colour)|restore|brighten|vivid|more\s+vibrant|pop)\b/i
const LOCALIZED_RE =
  /\b(only|just|solely|exclusively)\b[^.!?]*\b(remove|delete|erase|change|replace|recolor|move|swap|edit|fix)\b|\b(remove|delete|erase|change|replace|recolor|move|swap)\b[^.!?]*\b(only|just)\b|\b(object|person|thing|item|element|logo|text|watermark)\b[^.!?]*\b(on\s+the|in\s+the|at\s+the)\b\s*(left|right|top|bottom|corner|center|centre|background|foreground|side)/i
const REMOVE_OBJECT_RE = /\b(remove|delete|erase|get\s+rid\s+of|take\s+out)\b/i
const TRANSFORM_RE =
  /\b(transform|turn|convert|restyle|make\s+(it|this|the)\s+(look|feel|style)|make\s+(it|this)\s+(a|an)|into\s+(a|an|the)|as\s+(a|an)\s+(cinematic|painting|drawing|sketch|anime|cartoon))\b/i
const EDIT_RE =
  /\b(change|edit|modify|replace|swap|make\s+the|set\s+the|add|put|remove|delete|recolor|re-?color|adjust|tweak|retouch|update)\b/i
const CREATE_RE =
  /\b(create|generate|make|draw|design|produce|render|build|give\s+me|i\s+want|i\s+need|show\s+me|imagine|paint|illustrate)\b/i

function clampDimension(v: number): number | null {
  if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) return null
  if (v < 256 || v > 4096) return null
  return v
}

function nearestRatioPreset(w: number, h: number): string {
  const ratio = w / h
  let best = RATIO_PRESET_SIZES[0]
  let bestDelta = Math.abs(Math.log(ratio / best.ratio))
  for (const cand of RATIO_PRESET_SIZES.slice(1)) {
    const delta = Math.abs(Math.log(ratio / cand.ratio))
    if (delta < bestDelta) {
      best = cand
      bestDelta = delta
    }
  }
  return best.size
}

/** Pull explicit dimension hints ("1920x1080", "16:9", "portrait") from text. */
function extractSize(text: string): { size?: string; width?: number; height?: number } {
  const px = /(\d{3,4})\s*[x×]\s*(\d{3,4})/i.exec(text)
  if (px) {
    const w = clampDimension(Number(px[1]))
    const h = clampDimension(Number(px[2]))
    if (w && h) return { width: w, height: h }
  }
  const ratio = /(\d{1,2})\s*:\s*(\d{1,2})/.exec(text)
  if (ratio) {
    const rw = Number(ratio[1])
    const rh = Number(ratio[2])
    if (rw > 0 && rh > 0) return { size: nearestRatioPreset(rw, rh) }
  }
  for (const [word, size] of Object.entries(LAXII_PRESET_SIZES)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text)) return { size }
  }
  const p1080 = /\b(1920\s*x\s*1080|1080p|full\s?hd)\b/i.test(text)
  if (p1080) return { width: 1920, height: 1080 }
  return {}
}

function extractUpscaleFactor(text: string): number {
  if (/\b4k\b|\b8k\b|\b4\s*[x×]\b/i.test(text)) return 4
  if (/\b2\s*[x×]\b/i.test(text)) return 2
  return 2
}

function clarify(question: string, reason: string, prompt: string): IntentDecision {
  return { intent: 'clarify', prompt, clarifyQuestion: question, clarifyReason: reason }
}

const NO_IMAGE_QUESTION =
  'Which image should I work on? Attach one with the paperclip button, or ask me to generate one first.'
const VAGUE_IMAGE_QUESTION =
  'What should I do with this image? Describe the change for an edit, or say "enhance", "remove the background" or "upscale to 4K".'
const VAGUE_TEXT_QUESTION =
  'Tell me what image to create — describe the subject, style, lighting and mood, and I will generate it.'

/**
 * Classify one conversational request. Pure — no I/O, no provider calls.
 * Order: background removal → upscale → enhance → localized (mask) →
 * transform/edit → creation/default, so compound requests land on the
 * strongest matching capability ("upscale to 4K and sharpen" runs the
 * enhance engine with a 4× Lanczos factor in ONE job, never two).
 */
export function detectIntent(input: IntentInput): IntentDecision {
  const text = input.text.trim()
  const lower = text.toLowerCase()
  const hasImage = input.hasAttachedImage || input.conversationHasImage

  // Background removal (needs an image).
  if (BG_REMOVAL_RE.test(lower)) {
    if (!hasImage) return clarify(NO_IMAGE_QUESTION, 'background-removal-needs-image', text)
    return { intent: 'bg-removal', prompt: text }
  }

  // Upscale (needs an image) — also covers "upscale AND sharpen" compounds.
  if (UPSCALE_RE.test(lower)) {
    if (!hasImage) return clarify(NO_IMAGE_QUESTION, 'upscale-needs-image', text)
    return { intent: 'upscale', prompt: text, upscaleFactor: extractUpscaleFactor(lower) }
  }

  // Deterministic enhancement (needs an image).
  if (ENHANCE_RE.test(lower)) {
    if (!hasImage) return clarify(NO_IMAGE_QUESTION, 'enhance-needs-image', text)
    return { intent: 'enhance', prompt: text }
  }

  // Localized / masked change (needs an image; the mask flow asks next).
  if (LOCALIZED_RE.test(lower)) {
    if (!hasImage) return clarify(NO_IMAGE_QUESTION, 'masked-edit-needs-image', text)
    return {
      intent: 'masked-edit',
      prompt: text,
      maskMode: REMOVE_OBJECT_RE.test(lower) ? 'object-removal' : 'smart-edit',
    }
  }

  if (hasImage) {
    // Whole-image transform ("turn this photo into a cinematic portrait").
    if (TRANSFORM_RE.test(lower)) return { intent: 'image-to-image', prompt: text }
    // Whole-image conversational edit ("change the bottle cap to gold…").
    if (EDIT_RE.test(lower)) return { intent: 'edit', prompt: text }
    // An image with no actionable verb — ask instead of guessing.
    return clarify(VAGUE_IMAGE_QUESTION, 'image-no-action', text)
  }

  // No image anywhere: creation language (or a plain description) generates;
  // capability words without an image ask for one; fragments ask for detail.
  if (EDIT_RE.test(lower) || ENHANCE_RE.test(lower) || UPSCALE_RE.test(lower)) {
    return clarify(NO_IMAGE_QUESTION, 'capability-needs-image', text)
  }
  const size = extractSize(lower)
  if (CREATE_RE.test(lower) || text.length >= 12) {
    if (text.length < MIN_PROMPT_CHARS) return clarify(VAGUE_TEXT_QUESTION, 'prompt-too-short', text)
    return { intent: 'generate', prompt: text, ...size }
  }
  return clarify(VAGUE_TEXT_QUESTION, 'prompt-too-short', text)
}
