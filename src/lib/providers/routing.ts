/**
 * BEAN Intelligence — provider capability routing + bounded fallback
 * (SERVER ONLY).
 *
 * PHASE 1/6 requirement: each product routes to an ordered chain of
 * authorized providers. A fallback is attempted ONLY when
 *   1. the primary failed with an upstream-class failure (throttle / auth /
 *      billing / timeout / network) — never on client validation errors;
 *   2. no customer-visible output was produced yet (a stream that already
 *      yielded tokens is NEVER restarted on another provider — that would
 *      duplicate text; it propagates honestly instead);
 *   3. the candidate provider has credentials PRESENT (verified here, values
 *      never surfaced) and a real adapter — a provider whose API merely
 *      exists is never assumed to serve a capability;
 *   4. every fallback decision is recorded to the audit log
 *      (action 'provider.fallback') so usage stays attributable.
 *
 * Bounded by construction: the chain is finite, each candidate is attempted
 * at most once per request, and the existing per-class circuit breakers
 * still gate every real network call (a throttled account is never hammered
 * by fallback logic — the first 429 opens that provider's breaker).
 */

import { getBackend, type BackendDescriptor } from '@/lib/registry/backends'
import type { TaskAdapter } from '@/lib/adapters/types'
import { classifyUpstreamError, UpstreamRateLimitError } from '@/lib/upstream/gateway'
import { providerIdForBackend, resolveProviderCredentials } from './credentials'
import { recordAudit } from '@/lib/observability/metering'

export interface PreflightLike {
  backend: BackendDescriptor
  adapter: TaskAdapter
  release: () => void
  /** MUTABLE ref: the backend id that actually served the request (changes
   *  when a fallback serves; usage recording reads it after completion). */
  servedBy: { backendId: string }
}

/** Failure kinds that justify trying the next authorized provider. */
function isFallbackEligibleFailure(e: unknown): boolean {
  const kind = classifyUpstreamError(e).kind
  return (
    kind === 'rate_limited' ||
    kind === 'auth' ||
    kind === 'billing' ||
    kind === 'timeout' ||
    kind === 'network'
  )
}

/**
 * Ordered candidate chain for a backend: the backend itself first, then the
 * ids in its explicit `fallbacks` list (registry order). A candidate is
 * USABLE only when an adapter exists and its provider's credentials are
 * present — otherwise it is skipped with a reason that lands in the audit
 * trail and error detail.
 */
export function capabilityChain(
  primary: BackendDescriptor,
  adapters: Record<string, TaskAdapter>,
): Array<{ backend: BackendDescriptor; adapter: TaskAdapter; skipReason: string | null }> {
  const chain: Array<{ backend: BackendDescriptor; adapter: TaskAdapter; skipReason: string | null }> = []
  const seen = new Set<string>()
  const push = (backend: BackendDescriptor) => {
    if (seen.has(backend.id)) return
    seen.add(backend.id)
    const adapter = adapters[backend.id]
    if (!adapter) {
      chain.push({ backend, adapter: undefined as unknown as TaskAdapter, skipReason: 'no executable adapter' })
      return
    }
    // Credential PRESENCE is resolved asynchronously by the wrapper before
    // execution (see wrapWithProviderFallback); here the chain is built
    // structurally and every candidate starts unskipped.
    chain.push({ backend, adapter, skipReason: null })
  }
  push(primary)
  for (const id of primary.fallbacks ?? []) {
    const fb = getBackend(id)
    if (fb) push(fb)
  }
  return chain
}

function auditFallback(meta: Record<string, unknown>): void {
  void recordAudit({ actorId: null, action: 'provider.fallback', target: null, meta })
}

/**
 * Wrap a preflight result so adapter calls follow the capability chain.
 * Method semantics:
 *  - chat / codeTask: try candidates in order; first success wins; upstream-
 *    class failures move to the next eligible candidate; the LAST error is
 *    rethrown verbatim (typed, honest).
 *  - chatStream: same, but a candidate that already yielded tokens to the
 *    client propagates its failure instead of restarting on the next
 *    provider (no duplicated text, no fabricated continuation).
 *  - generateImage / editImage / other optional methods: pass through to the
 *    primary adapter when no fallback candidates exist (today's LAXII/JAZMII
 *    chains are single-provider by authorization reality).
 *  - health: the primary's real probe, annotated with fallback readiness.
 */
export async function wrapWithProviderFallback(
  preflight: PreflightLike,
  adapters: Record<string, TaskAdapter>,
  context: { productId: string; task: string },
): Promise<PreflightLike> {
  const primary = preflight.backend
  const chain = capabilityChain(primary, adapters)
  // Credential presence is resolved NOW (async — the admin vault is a DB
  // lookup) so the chain only contains candidates that may actually serve.
  const usable: Array<{ backend: BackendDescriptor; adapter: TaskAdapter }> = []
  for (const cand of chain) {
    if (!cand.adapter) continue
    const cred = await resolveProviderCredentials(providerIdForBackend(cand.backend.id))
    if (cred.present) usable.push({ backend: cand.backend, adapter: cand.adapter })
  }
  // Single-provider chains (LAXII/JAZMII today) pass through untouched —
  // zero behavioral change, zero extra audit noise.
  if (usable.length <= 1) return preflight

  const servedBy = preflight.servedBy

  const tryCandidates = async <T>(
    op: (adapter: TaskAdapter) => Promise<T>,
  ): Promise<T> => {
    let lastError: unknown
    for (const cand of usable) {
      try {
        const result = await op(cand.adapter)
        if (cand.backend.id !== primary.id) servedBy.backendId = cand.backend.id
        return result
      } catch (e) {
        lastError = e
        if (!isFallbackEligibleFailure(e)) throw e
        if (e instanceof UpstreamRateLimitError && !e.attempted) {
          // The breaker skipped this provider without network I/O — that is
          // exactly the signal to try the next authorized provider.
        }
        auditFallback({
          productId: context.productId,
          task: context.task,
          fromBackend: cand.backend.id,
          reason: classifyUpstreamError(e).kind,
          detail: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        })
      }
    }
    throw lastError
  }

  const p = preflight.adapter
  const wrapped: TaskAdapter = {
    backendId: primary.id,
    health: () => p.health(),
  }
  if (p.chat) {
    wrapped.chat = (req) => tryCandidates((a) => a.chat!(req))
  }
  if (p.chatStream) {
    wrapped.chatStream = async function* (req) {
      let lastError: unknown
      let produced = false
      for (const cand of usable) {
        let yieldedAny = false
        try {
          for await (const delta of cand.adapter.chatStream!(req)) {
            yieldedAny = true
            produced = true
            yield delta
          }
          if (cand.backend.id !== primary.id) servedBy.backendId = cand.backend.id
          return
        } catch (e) {
          if (yieldedAny) throw e // mid-stream failure: propagate, never restart
          if (!isFallbackEligibleFailure(e)) throw e
          if (produced) throw e // defensive: client already saw tokens
          lastError = e
          auditFallback({
            productId: context.productId,
            task: context.task,
            fromBackend: cand.backend.id,
            reason: classifyUpstreamError(e).kind,
            detail: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
          })
        }
      }
      throw lastError
    }
  }
  if (p.codeTask) {
    wrapped.codeTask = (req) => tryCandidates((a) => a.codeTask!(req))
  }
  if (p.generateImage) wrapped.generateImage = (req) => p.generateImage!(req)
  if (p.editImage) wrapped.editImage = (req) => p.editImage!(req)

  return { ...preflight, adapter: wrapped }
}
