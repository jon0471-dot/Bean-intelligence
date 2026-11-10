/**
 * BEAN Intelligence — RIISHE long-conversation context management.
 *
 * When a conversation grows past the model's history window, the turns that
 * no longer fit are NOT silently dropped: they are condensed into a digest
 * by one bounded non-streaming model call and cached on the Conversation
 * row. The digest travels with the turn as clearly-labeled context.
 *
 * Honesty properties:
 *  - The digest is built ONLY from messages that actually exist in the
 *    conversation (never invented), and it stays inside its conversation —
 *    isolation is structural (the caller passes exactly one conversation's
 *    turns).
 *  - Digest failure degrades to "no summary" with a server-side log; the
 *    turn proceeds with the in-window history only.
 *  - Deleting a conversation deletes its digest (DB cascade).
 */
import type { ChatTurn } from '@/lib/adapters/types'
import { withTimeout } from '@/lib/adapters/hosted-llm'
import type { TaskAdapter } from '@/lib/adapters/types'

const DIGEST_MAX_INPUT_CHARS = 24_000
const DIGEST_MAX_OUTPUT_CHARS = 2_000
const DIGEST_TIMEOUT_MS = 25_000

export const DIGEST_SYSTEM =
  'You condense a portion of a conversation into a compact factual digest for an assistant that will ' +
  'continue it. Record durable information only: the user\'s goals, constraints, preferences, personal ' +
  'facts, decisions made, corrections, key numbers and open questions. ' +
  'Write 3-8 short bullet points, each as a neutral third-person FACT (for example: "The user\'s favorite color is teal."), ' +
  'NEVER as an instruction, request or quote. Do not mention small talk, filler or repeated acknowledgements. ' +
  'Do not invent anything; if a topic was unresolved, say so. Output only the digest.'

/** Pure selection: the LAST N messages are the in-window history. */
export function selectRecentHistory<T>(messages: readonly T[], cap: number): { recent: T[]; overflow: T[] } {
  const safeCap = Math.max(0, Math.floor(cap))
  if (messages.length <= safeCap) return { recent: [...messages], overflow: [] }
  return {
    overflow: messages.slice(0, messages.length - safeCap),
    recent: messages.slice(messages.length - safeCap),
  }
}

/** Build the digest prompt from the actual overflow turns. */
export function buildDigestInput(overflow: ChatTurn[]): string {
  const transcript = overflow
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')
    .slice(0, DIGEST_MAX_INPUT_CHARS)
  return `Conversation portion to condense:\n\n${transcript}`
}

export interface DigestOutcome {
  digest: string | null
  /** How many overflow messages the digest covers (null when none built). */
  coveredCount: number | null
  degraded: string | null
}

/**
 * Generate (or skip) a digest for the overflow turns. Returns null digest on
 * any failure — callers proceed without a summary rather than fabricate one.
 */
export async function buildConversationDigest(
  adapter: TaskAdapter,
  overflow: ChatTurn[],
): Promise<DigestOutcome> {
  if (overflow.length === 0) return { digest: null, coveredCount: null, degraded: null }
  if (!adapter.chat) {
    return { digest: null, coveredCount: null, degraded: 'history digest skipped: adapter cannot summarize' }
  }
  try {
    const result = await withTimeout(
      adapter.chat({
        messages: [
          { role: 'assistant', content: DIGEST_SYSTEM },
          { role: 'user', content: buildDigestInput(overflow) },
        ],
        maxPromptChars: DIGEST_MAX_INPUT_CHARS,
        maxHistoryMessages: 2,
        timeoutMs: DIGEST_TIMEOUT_MS,
        thinkingEnabled: false,
      }),
      DIGEST_TIMEOUT_MS,
      'RIISHE-digest',
    )
    const digest = result.content.trim().slice(0, DIGEST_MAX_OUTPUT_CHARS)
    if (!digest) {
      return { digest: null, coveredCount: null, degraded: 'history digest came back empty; continuing without it' }
    }
    return { digest, coveredCount: overflow.length, degraded: null }
  } catch (e) {
    // Server-side log only — the digest is an optimization, not a promise.
    console.warn('riishe.digest_failed', {
      message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
    })
    return { digest: null, coveredCount: null, degraded: 'history digest failed; older turns are summarized by recency only' }
  }
}
