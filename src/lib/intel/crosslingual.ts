/**
 * BEAN Intelligence — cross-lingual retrieval expansion.
 *
 * A user may ask in Tamil/Hindi/Arabic/… while the best-indexed sources are
 * English. The shared research pipeline keeps the ORIGINAL wording as the
 * first query (the user's language is authoritative for their intent) and
 * adds AT MOST ONE bounded English query variant so broad English indexing
 * is covered too.
 *
 * Honesty contract: the expansion uses ONE fast bounded model call; ANY
 * failure (timeout, gateway error, malformed output) returns an empty
 * addition — the pipeline degrades to original-language-only search and
 * records that. No silent translation of the user's intent is ever forced.
 */

import { guardedChatCompletion } from '@/lib/adapters/hosted-llm'
import { detectLanguage, LANGUAGE_NAMES } from './language'

const EXPANSION_TIMEOUT_MS = Number(process.env.BEAN_INTEL_CROSSLINGUAL_TIMEOUT_MS ?? 6_000)

interface ExpansionCompletion {
  choices?: Array<{ message?: { content?: string } }>
}

const EXPANSION_SYSTEM =
  'You convert a non-English question into ONE concise English web-search query for a fact-checking retrieval step. ' +
  'Keep every proper noun, place name, person name and technical term EXACTLY as written in the original ' +
  '(they are searchable even inside an English query). Output the query text only — no quotes, no explanation, max 30 words.'

/** Small per-process cache: identical messages (retries, regenerates) never pay twice. */
const cache = new Map<string, string | null>()
const CACHE_MAX = 256

export function clearCrosslingualCacheForTests(): void {
  cache.clear()
}

/**
 * Produce the English query variant for a message, or null when the message
 * is already English/undetermined, too long, or the expansion call failed.
 */
export async function englishQueryVariant(message: string, transport?: (m: string) => Promise<string>): Promise<string | null> {
  const trimmed = message.trim()
  if (!trimmed || trimmed.length > 2000) return null

  const profile = detectLanguage(trimmed)
  // English or undetermined prompts gain nothing from an English variant.
  if (profile.primary === 'en' || profile.primary === 'und') return null
  // Low-confidence non-Latin detection (short prompts): expansion still runs,
  // but the caller records it as best-effort.
  if (cache.has(trimmed)) return cache.get(trimmed) ?? null

  let variant: string | null = null
  try {
    const run = transport
      ? transport(trimmed.slice(0, 1200))
      : (async () => {
          // CHAT-RECOVERY (2026-11-10): routed through the shared chat-class
          // guard (fail-fast while the 429 breaker is open — the catch below
          // already drops the variant honestly) instead of a raw SDK call.
          const completion = await guardedChatCompletion({
            messages: [
              { role: 'assistant', content: EXPANSION_SYSTEM },
              {
                role: 'user',
                content: `Question language: ${LANGUAGE_NAMES[profile.primary]}.\nQuestion: ${trimmed.slice(0, 1200)}`,
              },
            ],
            thinking: { type: 'disabled' },
          })
          return ((completion as ExpansionCompletion).choices?.[0]?.message?.content ?? '').trim()
        })()
    const text = await Promise.race([
      run,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('cross-lingual expansion timeout')), EXPANSION_TIMEOUT_MS)),
    ])
    if (typeof text === 'string') {
      const cleaned = text.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ')
      // Plausibility: 6..280 chars, must contain at least 3 letters.
      if (cleaned.length >= 6 && cleaned.length <= 280 && (cleaned.match(/[A-Za-z]/g) ?? []).length >= 3) {
        variant = cleaned
      }
    }
  } catch {
    variant = null
  }

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(trimmed, variant)
  return variant
}

/** Injected transport type shared with englishQueryVariant. */
type VariantTransport = (m: string) => Promise<string>

/**
 * Expansion step for the research pipeline: given the message and its
 * current query list, return AT MOST ONE added English variant query.
 * Never mutates the input. Never returns a duplicate of an existing query.
 */
export async function expandQueriesForLanguage(
  message: string,
  queries: readonly string[],
  transport?: VariantTransport,
): Promise<{ added: string[]; language: string; note: string | null }> {
  const profile = detectLanguage(message)
  if (profile.primary === 'en' || profile.primary === 'und') {
    return { added: [], language: profile.primary, note: null }
  }
  const variant = await englishQueryVariant(message, transport)
  if (!variant) {
    return {
      added: [],
      language: profile.primary,
      note: `cross-lingual expansion unavailable; searched in ${LANGUAGE_NAMES[profile.primary]} only`,
    }
  }
  const dup = queries.some((q) => q.trim().toLowerCase() === variant.toLowerCase())
  if (dup) return { added: [], language: profile.primary, note: null }
  return { added: [variant], language: profile.primary, note: null }
}
