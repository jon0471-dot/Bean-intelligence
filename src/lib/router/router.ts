/**
 * BEAN Intelligence — PRIVATE routing layer.
 *
 * Routing rules (enforced in order, server-side only):
 *  1. Resolve the requested BEAN product + task (never an upstream model).
 *  2. Check product availability.
 *  3. Apply rate limits and durable daily quotas.
 *  4. Enforce per-user and total concurrency limits.
 *  5. Select an enabled backend whose capabilities match the request.
 *  6. Validate the request against the backend's REAL limits.
 *  7. Execute with timeout/retry policy; normalize the response.
 *  8. Record actual usage (tokens/images/duration); cost stays null when
 *     the provider reports none.
 *  9. Fall back ONLY to explicitly configured, compatible backends.
 * 10. Return clear BEAN error codes — never fabricated success.
 */
import { getBackend, getBackendsForProduct, type BackendDescriptor } from '@/lib/registry/backends'
import { getProduct, type BeanProductId, type BeanTask } from '@/lib/registry/products'
import { BeanApiError } from '@/lib/api/errors'
import { checkDailyQuota, checkRateLimit } from '@/lib/auth/ratelimit'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { localLaxiiAdapter } from '@/lib/laxii/local-adapter'
import { diffusersWorkerAdapter } from '@/lib/laxii/diffusers-adapter'
import type {
  ChatRequest,
  ChatResult,
  ImageRequest,
  ImageResult,
  TaskAdapter,
} from '@/lib/adapters/types'

const ADAPTERS: Record<string, TaskAdapter> = {
  // The hosted LLM gateway serves both RIISHE (chat) and CODE GIFTZ
  // (coding-task); it is registered under each backend id it backs.
  'bean-llm-hosted-primary': hostedLlmAdapter,
  'bean-code-llm-hosted-primary': hostedLlmAdapter,
  'bean-image-hosted-primary': hostedImageAdapter,
  // LAXII preservation engine (2026-10-31): deterministic local engine +
  // the (currently disabled) local Diffusers worker adapter.
  'bean-image-local-sharp': localLaxiiAdapter,
  'bean-image-selfhosted-diffusers': diffusersWorkerAdapter,
  'bean-video-selfhosted-candidate': {
    backendId: 'bean-video-selfhosted-candidate',
    health: async () => ({
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      detail: 'No video-generation worker is deployed in this environment.',
    }),
  },
}

// ---- concurrency in-flight counters --------------------------------------
const inFlight = new Map<string, { perUser: Map<string, number>; total: number }>()

function acquireSlot(backend: BackendDescriptor, userId: string): void {
  const state = inFlight.get(backend.id) ?? { perUser: new Map(), total: 0 }
  const mine = state.perUser.get(userId) ?? 0
  if (mine >= backend.concurrency.maxInFlightPerUser) {
    throw new BeanApiError(
      'CONCURRENCY_LIMIT',
      'You already have the maximum number of concurrent jobs for this product. Wait for one to finish.',
    )
  }
  if (state.total >= backend.concurrency.maxInFlightTotal) {
    throw new BeanApiError(
      'CONCURRENCY_LIMIT',
      'BEAN is at capacity for this product right now. Please retry shortly.',
    )
  }
  state.perUser.set(userId, mine + 1)
  state.total += 1
  inFlight.set(backend.id, state)
}

function releaseSlot(backendId: string, userId: string): void {
  const state = inFlight.get(backendId)
  if (!state) return
  const mine = state.perUser.get(userId) ?? 0
  if (mine <= 1) state.perUser.delete(userId)
  else state.perUser.set(userId, mine - 1)
  state.total = Math.max(0, state.total - 1)
}

// ---- shared pre-flight ----------------------------------------------------

export interface PreflightOk {
  backend: BackendDescriptor
  adapter: TaskAdapter
  /** Must be called exactly once when the adapter call finishes (or fails). */
  release: () => void
}

/**
 * Steps 1–5 of the routing rules. Throws customer-safe BeanApiErrors.
 * On success a concurrency slot is acquired; the caller MUST invoke
 * `release()` when the backend call finishes, in a finally block.
 */
export async function preflight(
  userId: string,
  productId: BeanProductId,
  task?: BeanTask,
): Promise<PreflightOk> {
  // 1. product + task identity
  const product = getProduct(productId)
  if (!product) throw new BeanApiError('NOT_FOUND', 'Unknown BEAN product.')
  const expectedTask = task ?? product.task

  // 2. availability
  const candidates = getBackendsForProduct(productId).filter((b) => b.task === expectedTask)
  const enabled = candidates.filter((b) => b.enabled)
  if (candidates.length > 0 && enabled.length === 0) {
    throw new BeanApiError(
      'PRODUCT_UNAVAILABLE',
      `${product.name} is not operational yet. ${candidates[0].unavailableReason ?? ''}`.trim(),
    )
  }
  if (enabled.length === 0) {
    throw new BeanApiError('NO_BACKEND', `No backend is configured for ${product.name}.`)
  }

  // 3. rate limit + quota
  const rl = checkRateLimit(`${userId}:${productId}`, 20, 60_000)
  if (!rl.allowed) {
    throw new BeanApiError(
      'RATE_LIMITED',
      `Too many requests. Try again in ${rl.retryAfterSec}s.`,
    )
  }
  const quota = await checkDailyQuota(userId, productId)
  if (!quota.allowed) {
    throw new BeanApiError(
      'QUOTA_EXCEEDED',
      `Daily quota reached for ${product.name} (${quota.used}/${quota.limit}). Resets at midnight.`,
    )
  }

  // 4. concurrency (per-user and total, in-flight)
  acquireSlot(enabled[0], userId)

  // 5. backend selection — first enabled candidate. Fallback happens only
  // via the backend's explicit `fallbacks` list; none are configured today.
  const backend = enabled[0]
  const adapter = ADAPTERS[backend.id]
  if (!adapter) {
    releaseSlot(backend.id, userId)
    throw new BeanApiError('NO_BACKEND', 'The configured backend has no executable adapter.')
  }
  return { backend, adapter, release: () => releaseSlot(backend.id, userId) }
}

/** Step 6 — request validation against the backend's real limits. */
export function assertChatRequest(backend: BackendDescriptor, messages: ChatRequest['messages']) {
  const maxPromptChars = Number(backend.limits.maxPromptChars ?? 12000)
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) {
    throw new BeanApiError('VALIDATION_ERROR', 'A message is required.')
  }
  if (lastUser.content.length > maxPromptChars) {
    throw new BeanApiError(
      'CAPABILITY_UNSUPPORTED',
      `Message exceeds the ${maxPromptChars}-character limit of the current ${backend.task} backend.`,
    )
  }
  return {
    maxPromptChars,
    maxHistoryMessages: Number(backend.limits.maxHistoryMessages ?? 24),
  }
}

export type { ChatRequest, ChatResult, ImageRequest, ImageResult }
