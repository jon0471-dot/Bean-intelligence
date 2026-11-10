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
import { hostedVideoAdapter } from '@/lib/adapters/hosted-video'
import { localLaxiiAdapter } from '@/lib/laxii/local-adapter'
import { diffusersWorkerAdapter } from '@/lib/laxii/diffusers-adapter'
import { openAiCompatibleAdapter } from '@/lib/providers/openai-compatible'
import { llamaCppAdapter } from '@/lib/providers/llamacpp'
import { wrapWithProviderFallback } from '@/lib/providers/routing'
import { assertProviderBudget } from '@/lib/providers/cost-guard'
import { assertAccountQuotaForUserRequest } from '@/lib/providers/account-quota'
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
  // PROVIDER RESILIENCE (2026-11-07): the prepared OpenAI-compatible
  // fallback for chat/coding. Dormant without credentials (its own
  // credential gate + registry `enabled` keep it unroutable until the
  // operator sets BEAN_PROVIDER_OPENAI_*).
  'bean-llm-openai-compatible': openAiCompatibleAdapter,
  // FREE-FIRST (2026-11-07): the local llama.cpp GGUF lane for chat/coding.
  'bean-chat-local-llamacpp': llamaCppAdapter,
  'bean-image-hosted-primary': hostedImageAdapter,
  // LAXII preservation engine (2026-10-31): deterministic local engine +
  // the (currently disabled) local Diffusers worker adapter.
  'bean-image-local-sharp': localLaxiiAdapter,
  'bean-image-selfhosted-diffusers': diffusersWorkerAdapter,
  // LAXII — authorized hosted image editing (conversational edit path).
  'bean-image-hosted-edit': hostedImageAdapter,
  // JAZMII — authorized hosted video backend (async task + polling adapter).
  'bean-video-hosted-primary': hostedVideoAdapter,
  'bean-video-selfhosted-candidate': {
    backendId: 'bean-video-selfhosted-candidate',
    health: async () => ({
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      detail: 'The self-hosted video worker candidate is not deployed (planned open-weight path, hardware-gated).',
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
  /** MUTABLE ref: backend id that ACTUALLY served the request. Falls back
   *  only via explicitly configured, credential-verified providers; usage
   *  recording reads this so attribution stays truthful. */
  servedBy: { backendId: string }
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

  // 3.5 provider request budgets (operator-set spend guards):
  //  a. the PER-PRODUCT budget (Phase 6, cost-guard.ts), then
  //  b. the SHARED ACCOUNT budget (zero-downtime recovery, 2026-11-11):
  //     all four products ride ONE provider account whose real daily
  //     ceiling is enforced by the provider at the account level — this
  //     gate counts every product's usage together and refuses new work
  //     only when the WHOLE account budget is gone (real user requests
  //     may use the full budget; the user reserve only constrains
  //     automated enhancement consumption — see account-quota.ts).
  await assertProviderBudget(userId, productId, product.name)
  await assertAccountQuotaForUserRequest(userId, productId, product.name)

  // 4. concurrency (per-user and total, in-flight)
  acquireSlot(enabled[0], userId)

  // 5. backend selection — first enabled candidate. Fallback happens only
  // via the backend's explicit `fallbacks` list (credential-verified,
  // audit-logged — see providers/routing.ts).
  const backend = enabled[0]
  const adapter = ADAPTERS[backend.id]
  if (!adapter) {
    releaseSlot(backend.id, userId)
    throw new BeanApiError('NO_BACKEND', 'The configured backend has no executable adapter.')
  }
  const servedBy = { backendId: backend.id }
  return wrapWithProviderFallback(
    { backend, adapter, release: () => releaseSlot(backend.id, userId), servedBy },
    ADAPTERS,
    { productId, task: expectedTask },
  )
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

/**
 * Background-worker adapter resolution (engine path).
 *
 * Identical routing rules as `preflight` EXCEPT the HTTP-facing gates that
 * the SUBMIT path already enforced (per-minute rate limit, daily quota,
 * concurrency slots): a worker executing an accepted job must not be
 * double-charged or rejected by per-request throttles. What REMAINS active:
 * product availability, the operator's provider request budget, and the
 * credential-verified fallback chain (never a silent incompatible switch).
 */
export async function resolveBackgroundAdapter(
  userId: string,
  productId: BeanProductId,
  task?: BeanTask,
): Promise<PreflightOk> {
  const product = getProduct(productId)
  if (!product) throw new BeanApiError('NOT_FOUND', 'Unknown BEAN product.')
  const expectedTask = task ?? product.task
  const enabled = getBackendsForProduct(productId).filter(
    (b) => b.task === expectedTask && b.enabled,
  )
  if (enabled.length === 0) {
    const candidates = getBackendsForProduct(productId).filter((b) => b.task === expectedTask)
    throw new BeanApiError(
      candidates.length > 0 ? 'PRODUCT_UNAVAILABLE' : 'NO_BACKEND',
      candidates.length > 0
        ? `${product.name} is not operational yet. ${candidates[0].unavailableReason ?? ''}`.trim()
        : `No backend is configured for ${product.name}.`,
    )
  }
  // Operator spend guards stay active for worker executions (per-product
  // budget + the shared account budget — a worker executing an accepted
  // job must not push the account past its real ceiling either).
  await assertProviderBudget(userId, productId, product.name)
  await assertAccountQuotaForUserRequest(userId, productId, product.name)

  const backend = enabled[0]
  const adapter = ADAPTERS[backend.id]
  if (!adapter) throw new BeanApiError('NO_BACKEND', 'The configured backend has no executable adapter.')
  const servedBy = { backendId: backend.id }
  return wrapWithProviderFallback(
    { backend, adapter, release: () => undefined, servedBy },
    ADAPTERS,
    { productId, task: expectedTask },
  )
}

export type { ChatRequest, ChatResult, ImageRequest, ImageResult }
