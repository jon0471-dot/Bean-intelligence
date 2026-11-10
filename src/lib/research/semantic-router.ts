/**
 * BEAN Intelligence — semantic freshness routing.
 *
 * The deterministic policy (policy.ts) is keyword-based and can never cover
 * every phrasing of a time-sensitive question. This module is the SECOND
 * half of the Auto routing decision: a fast, bounded LLM classification that
 * runs ONLY when the deterministic policy is not confident (the ambiguous
 * "no freshness signals" bucket).
 *
 * Honesty contract: the router can only INCREASE retrieval willingness
 * (never suppress a deterministic "search" verdict), every failure degrades
 * to the deterministic decision, and its reason is recorded so the choice is
 * auditable. Results are cached per process keyed by the exact message.
 */
import { z } from 'zod'
import { guardedChatCompletion } from '@/lib/adapters/hosted-llm'
import type { SearchDecision } from './policy'

const routingSchema = z.object({
  needsCurrent: z.boolean(),
  reason: z.string().min(3).max(300),
})

interface RoutingCompletion {
  choices?: Array<{ message?: { content?: string } }>
}

const ROUTER_SYSTEM =
  'You decide whether answering a question REQUIRES current, real-time information from the web ' +
  '(facts that change or may have changed recently), or whether stable knowledge is sufficient.\n' +
  'REQUIRES current information: who currently holds a public office or leadership position; election ' +
  'results and political events; recent news, announcements, appointments or deaths; current software ' +
  'versions, releases or documentation states; prices, product availability, market and financial data; ' +
  'sports results, schedules and standings; weather; anything explicitly anchored to today, a recent date ' +
  'or "as of" a date; whether something is still true/available/open now.\n' +
  'STABLE knowledge suffices: mathematics and logic; definitions and stable general knowledge; historical ' +
  'events firmly in the past (clearly dated before the last year); creative writing; ordinary explanations ' +
  'and how-to; programming concepts that do not depend on the latest documentation; opinions and analysis ' +
  'the user supplies the material for.\n' +
  'When unsure, prefer REQUIRES current information (an unnecessary search costs seconds; an unverified ' +
  'answer costs trust).\n' +
  'Respond with JSON only: {"needsCurrent": true|false, "reason": "<max 25 words>"}'

/** Injectable completion transport (tests inject a stub; prod uses the gateway). */
export type RoutingTransport = (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<string>

async function gatewayTransport(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
  // CHAT-RECOVERY (2026-11-10): routed through the shared chat-class guard
  // (fail-fast while the 429 breaker is open — semanticFreshnessCheck
  // already returns null on any transport error and the caller falls back
  // to the deterministic freshness decision) instead of a raw SDK call.
  const completion = await guardedChatCompletion({
    messages,
    thinking: { type: 'disabled' },
  })
  return (completion as RoutingCompletion).choices?.[0]?.message?.content ?? ''
}

export interface SemanticRoutingResult {
  needsCurrent: boolean
  reason: string
}

/** Small per-process cache: identical messages (regenerates, retries) do not pay twice. */
const cache = new Map<string, SemanticRoutingResult>()
const CACHE_MAX = 256

export function clearRoutingCacheForTests(): void {
  cache.clear()
}

/**
 * Classify whether the question needs live/current information.
 * Returns null when the semantic check is unavailable (timeout, gateway
 * error, malformed output) — the caller must fall back to the deterministic
 * decision and may surface that degradation honestly.
 */
export async function semanticFreshnessCheck(
  message: string,
  transport: RoutingTransport = gatewayTransport,
  timeoutMs = 7_000,
): Promise<SemanticRoutingResult | null> {
  const trimmed = message.trim()
  if (!trimmed || trimmed.length > 2000) return null

  const cached = cache.get(trimmed)
  if (cached) return cached

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const classified = await Promise.race([
      transport([
        { role: 'assistant', content: ROUTER_SYSTEM },
        { role: 'user', content: trimmed.slice(0, 2000) },
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('semantic routing timeout')), timeoutMs)
      }),
    ])
    const jsonMatch = classified.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = routingSchema.safeParse(JSON.parse(jsonMatch[0]))
    if (!parsed.success) return null
    const result: SemanticRoutingResult = {
      needsCurrent: parsed.data.needsCurrent,
      reason: parsed.data.reason,
    }
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(trimmed, result)
    return result
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Combined Auto-mode decision: the deterministic policy first; when it is
 * NOT confident, the semantic router adjudicates. The semantic layer can
 * only ADD retrieval (never suppress a deterministic search verdict).
 * Returns the decision plus whether the semantic layer ran and what it said
 * (for honest degradation notes when it was unavailable).
 */
export async function resolveAutoSearchDecision(
  message: string,
  deterministic: SearchDecision,
  transport?: RoutingTransport,
): Promise<{ decision: SearchDecision; semantic: SemanticRoutingResult | null; semanticRan: boolean }> {
  if (deterministic.search) return { decision: deterministic, semantic: null, semanticRan: false }
  const semantic = await semanticFreshnessCheck(message, transport)
  if (!semantic) {
    return { decision: deterministic, semantic: null, semanticRan: false }
  }
  if (semantic.needsCurrent) {
    return {
      decision: {
        search: true,
        risk: 'high',
        recencyDays: 180,
        reason: `semantic router: ${semantic.reason}`,
      },
      semantic,
      semanticRan: true,
    }
  }
  return {
    decision: { ...deterministic, reason: `${deterministic.reason}; semantic router: ${semantic.reason}` },
    semantic,
    semanticRan: true,
  }
}
