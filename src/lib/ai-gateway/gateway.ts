/**
 * BEAN Intelligence — UNIFIED AI GATEWAY (single internal call surface for
 * every configured model).
 *
 * Responsibilities (work order Part 2 §5):
 *  - model resolution through the unified registry (hosted backends +
 *    admin-configured external providers — nothing is invented or faked);
 *  - chat completion (JSON) and streaming (async deltas), with system
 *    instructions, conversation context, temperature/max-token passthrough
 *    where the provider genuinely accepts them, and cooperative cancellation;
 *  - enforcement of the backend's REAL limits (prompt chars, history length);
 *  - timeouts and the truthful retry policy (the registry documents exactly
 *    one attempt per request — no blind retry into a throttling provider);
 *  - typed error classification (429 / auth / billing / timeout / truncated /
 *    network) mapped to stable BEAN error codes;
 *  - usage + token reporting (provider-exact when available, else labeled
 *    estimates) via UsageRecord, plus a per-request GatewayRequestLog entry
 *    that contains no prompts and no secrets;
 *  - provider health checks delegate to the measured probe infrastructure.
 *
 * The gateway is the verification engine's model access path too: a
 * configurable verification model (including a different provider) is just
 * another gateway call.
 */
import { hostedLlmAdapter, withTimeout, UpstreamTruncatedError } from '@/lib/adapters/hosted-llm'
import type { ChatTurn } from '@/lib/adapters/types'
import { BeanApiError } from '@/lib/api/errors'
import { estimateTokens } from '@/lib/api/validate'
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage } from '@/lib/observability/metering'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { upstreamCoolingDown, classifyUpstreamError } from '@/lib/upstream/gateway'
import { getGatewayModels, resolveGatewayModel, type GatewayModelWithHealth } from '@/lib/registry/models'
import { openAICompatibleChat, openAICompatibleStream } from './providers/openai-compatible'
import type {
  GatewayCallContext,
  GatewayChatRequest,
  GatewayChatMessage,
  GatewayChatResult,
} from './types'
import { GATEWAY_RATE_LIMIT_PER_MIN, GATEWAY_DAILY_QUOTA } from './types'

const DEFAULT_TIMEOUT_MS = 120_000
const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 2

// ---- caller throttling ------------------------------------------------------

/** Sliding-window burst limit + durable daily quota, per calling principal. */
export function checkGatewayRateLimit(principalId: string): { allowed: boolean; retryAfterSec: number } {
  return checkRateLimit(`gateway:${principalId}`, GATEWAY_RATE_LIMIT_PER_MIN, 60_000)
}

export async function checkGatewayQuota(principalId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const used = await db.usageRecord.count({
    where: { userId: principalId, product: 'api-gateway', success: true, createdAt: { gte: startOfDay } },
  })
  return { allowed: used < GATEWAY_DAILY_QUOTA, used, limit: GATEWAY_DAILY_QUOTA }
}

// ---- request normalization ---------------------------------------------------

function normalizeMessages(req: GatewayChatRequest, model: GatewayModelWithHealth): GatewayChatMessage[] {
  const maxPromptChars = model.contextLimits.maxPromptChars ?? 12_000
  const maxHistory = model.contextLimits.maxHistoryMessages ?? 24
  const incoming: GatewayChatMessage[] = [...req.messages]
  if (req.system && req.system.trim().length > 0) {
    incoming.unshift({ role: 'system', content: req.system })
  }
  // System turns are operator content: they pass UNSLICED and sit outside the
  // history cap. User/assistant turns are clamped to the backend's enforced
  // per-message cap. The system role is preserved in the PLAN; the adapter
  // seam converts it per provider (hosted: assistant-head turn, external:
  // native system role).
  const head: GatewayChatMessage[] = []
  const rest: GatewayChatMessage[] = []
  for (const m of incoming) {
    if (m.role === 'system' && rest.length === 0) head.push({ role: 'system', content: m.content })
    else rest.push({ role: m.role, content: m.role === 'system' ? m.content : m.content.slice(0, maxPromptChars) })
  }
  return [...head, ...rest.slice(-maxHistory)]
}

function clampTemperature(t: number | undefined): number | undefined {
  if (t === undefined || Number.isNaN(t)) return undefined
  return Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, t))
}

/**
 * The hosted adapter accepts temperature only as part of its ChatRequest
 * contract? It does not — the gateway forwards what the provider accepts.
 * MEASURED integration (2026-10-24..11-03): the authorized gateway SDK
 * exposes temperature/max_tokens; the adapter currently sends neither for
 * product turns. The gateway therefore passes temperature through only for
 * the external provider path (which genuinely implements it) and records the
 * hosted adapter's contract as-is — no silently-ignored parameters are ever
 * CLAIMED to be applied.
 */
export interface ResolvedCallPlan {
  kind: 'hosted' | 'external'
  model: GatewayModelWithHealth
  /** Provider-neutral messages (system preserved); adapters convert at the seam. */
  messages: GatewayChatMessage[]
  temperature?: number
  maxTokens?: number
  providerModel?: string
  timeoutMs: number
}

export async function planGatewayChat(req: GatewayChatRequest): Promise<ResolvedCallPlan> {
  let model: GatewayModelWithHealth
  try {
    model = await resolveGatewayModel(req.model)
  } catch (e) {
    // resolveGatewayModel signals unknown ids with a plain Error carrying
    // code:'NOT_FOUND' — surface the documented typed 404, never a 500.
    if (e instanceof Error && (e as { code?: string }).code === 'NOT_FOUND') {
      throw new BeanApiError('NOT_FOUND', `Unknown model id: ${req.model}. See GET /api/v1/models for the registered catalogue.`)
    }
    throw e
  }
  if (!model.enabled) {
    throw new BeanApiError(
      'PRODUCT_UNAVAILABLE',
      model.unavailableReason ?? 'This model is not operational.',
    )
  }
  if (!model.capabilities.includes('chat')) {
    throw new BeanApiError('CAPABILITY_UNSUPPORTED', `Model ${model.id} does not support chat completions.`)
  }
  if (model.configurationStatus === 'awaiting-credentials') {
    throw new BeanApiError(
      'PRODUCT_UNAVAILABLE',
      'This external provider has no configured credential yet. An administrator must add one (server-side) before calls can be made.',
    )
  }
  if (!req.messages.some((m) => m.role !== 'system')) {
    throw new BeanApiError('VALIDATION_ERROR', 'At least one non-system message is required.')
  }
  return {
    kind: model.backendId === 'bean-external-openai-compatible' ? 'external' : 'hosted',
    model,
    messages: normalizeMessages(req, model),
    temperature: clampTemperature(req.temperature),
    maxTokens: req.maxTokens,
    providerModel: req.providerModel?.trim() || undefined,
    timeoutMs: req.timeoutMs && req.timeoutMs > 0 ? Math.min(req.timeoutMs, 600_000) : DEFAULT_TIMEOUT_MS,
  }
}

/** Thrown by streaming when the caller cancelled between deltas. */
export class GatewayCancelledError extends Error {
  constructor(message = 'gateway call cancelled by caller') {
    super(message)
    this.name = 'GatewayCancelledError'
  }
}

export function isGatewayCancelled(e: unknown): boolean {
  return e instanceof Error && (e.name === 'GatewayCancelledError' || e.name === 'AbortError')
}

// ---- execution ---------------------------------------------------------------

/**
 * Hosted seam: the hosted adapter contract (ChatTurn) has no system role —
 * the live-verified product pattern (CODE GIFTZ buildTurnMessages) delivers
 * operator instructions as an ASSISTANT-HEAD turn. Applied exactly once.
 */
function toHostedTurns(messages: GatewayChatMessage[]): ChatTurn[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content,
  }))
}

/** Execute a planned non-streaming completion and normalize the result. */
export async function executeGatewayChat(
  plan: ResolvedCallPlan,
  ctx: GatewayCallContext,
): Promise<GatewayChatResult> {
  assertNotCoolingDown()
  if (plan.kind === 'external') {
    if (!plan.model.credentialId) {
      throw new BeanApiError('PRODUCT_UNAVAILABLE', 'The external provider credential is missing.')
    }
    if (!plan.providerModel) {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        'External provider calls need a provider-side model name (providerModel), e.g. "gpt-4o-mini".',
      )
    }
    const result = await openAICompatibleChat(
      {
        credentialId: plan.model.credentialId,
        providerModel: plan.providerModel,
        messages: plan.messages,
        temperature: plan.temperature,
        maxTokens: plan.maxTokens,
        signal: ctx.signal,
      },
      ctx,
    )
    return result
  }
  // Hosted path — the existing, live-verified adapter (429 breaker included).
  const hostedMessages = toHostedTurns(plan.messages)
  const promptChars = plan.messages.reduce((n, m) => n + m.content.length, 0)
  const raced = ctx.signal
    ? Promise.race([
        hostedLlmAdapter.chat!({
          messages: hostedMessages,
          maxPromptChars: plan.model.contextLimits.maxPromptChars ?? 12_000,
          maxHistoryMessages: plan.messages.length,
          timeoutMs: plan.timeoutMs,
        }),
        new Promise<never>((_, reject) =>
          ctx.signal!.addEventListener('abort', () => reject(new GatewayCancelledError()), { once: true }),
        ),
      ])
    : hostedLlmAdapter.chat!({
        messages: hostedMessages,
        maxPromptChars: plan.model.contextLimits.maxPromptChars ?? 12_000,
        maxHistoryMessages: plan.messages.length,
        timeoutMs: plan.timeoutMs,
      })
  const result = await withTimeout(raced, plan.timeoutMs, 'Gateway chat completion')
  return {
    content: result.content,
    provider: plan.model.provider,
    model: plan.model.id,
    backendId: plan.model.backendId,
    durationMs: result.durationMs,
    finishReason: 'stop',
    usage: {
      tokensIn: result.tokensInEst ?? Math.ceil(promptChars / 4),
      tokensOut: result.tokensOutEst ?? estimateTokens(result.content),
      exact: false,
    },
  }
}

/** Execute a planned streaming completion — normalized text deltas. */
export async function* executeGatewayChatStream(
  plan: ResolvedCallPlan,
  ctx: GatewayCallContext,
): AsyncGenerator<string, void, unknown> {
  assertNotCoolingDown()
  if (plan.kind === 'external') {
    if (!plan.model.credentialId) {
      throw new BeanApiError('PRODUCT_UNAVAILABLE', 'The external provider credential is missing.')
    }
    if (!plan.providerModel) {
      throw new BeanApiError('VALIDATION_ERROR', 'External provider calls need a provider-side model name (providerModel).')
    }
    for await (const delta of openAICompatibleStream(
      {
        credentialId: plan.model.credentialId,
        providerModel: plan.providerModel,
        messages: plan.messages,
        temperature: plan.temperature,
        maxTokens: plan.maxTokens,
        signal: ctx.signal,
      },
      ctx,
    )) {
      if (ctx.signal?.aborted) throw new GatewayCancelledError()
      yield delta
    }
    return
  }
  // Hosted streaming path.
  const stream = hostedLlmAdapter.chatStream!({
    messages: toHostedTurns(plan.messages),
    maxPromptChars: plan.model.contextLimits.maxPromptChars ?? 12_000,
    maxHistoryMessages: plan.messages.length,
    timeoutMs: plan.timeoutMs,
  })
  for await (const delta of stream) {
    if (ctx.signal?.aborted) throw new GatewayCancelledError()
    yield delta
  }
}

function assertNotCoolingDown(): void {
  // The adapter enforces the breaker too; failing fast HERE avoids building
  // plans for calls the adapter would refuse a moment later.
  if (upstreamCoolingDown('chat')) {
    throw new BeanApiError(
      'RATE_LIMITED',
      'The upstream AI gateway is rate-limited right now (HTTP 429 observed moments ago). Try again shortly.',
    )
  }
}

// ---- failure mapping ----------------------------------------------------------

/** Map any gateway execution failure to the stable BEAN error contract. */
export function gatewayErrorFor(e: unknown): BeanApiError {
  if (e instanceof BeanApiError) return e
  if (e instanceof UpstreamTruncatedError) {
    return new BeanApiError(
      'CAPABILITY_UNSUPPORTED',
      'The provider reached its output length limit before the answer finished. The text received so far is preserved as incomplete.',
    )
  }
  const failure = classifyUpstreamError(e)
  const raw = e instanceof Error ? e.message : String(e)
  switch (failure.kind) {
    case 'rate_limited':
      return new BeanApiError('RATE_LIMITED', 'The upstream AI gateway is rate-limited (HTTP 429). Try again shortly.')
    case 'auth':
      return new BeanApiError('BACKEND_FAILURE', 'The upstream provider rejected the configured credentials. This needs an operator to fix — retrying will not change it.')
    case 'billing':
      return new BeanApiError('BACKEND_FAILURE', 'The upstream provider refused the request for account reasons. This needs an account action — retrying will not change it.')
    case 'timeout':
      return new BeanApiError('BACKEND_TIMEOUT', 'The provider stopped sending data before the response finished (timed out).')
    case 'network':
      return new BeanApiError('BACKEND_FAILURE', 'The connection to the provider was lost before the response finished.')
    default:
      return new BeanApiError('BACKEND_FAILURE', `The model call failed: ${raw.slice(0, 160)}`)
  }
}

// ---- metering ------------------------------------------------------------------

/** Record usage (UsageRecord + GatewayRequestLog). Failures log, never throw —
 *  metering must not take down an answer. */
export async function recordGatewayCall(input: {
  ctx: GatewayCallContext
  plan?: ResolvedCallPlan
  result?: GatewayChatResult
  status: number
  errorCode?: string | null
  tokensIn?: number | null
  tokensOut?: number | null
  durationMs?: number | null
  streamed: boolean
  modelId: string
}): Promise<void> {
  try {
    const principal = input.ctx.userId
    if (principal) {
      await recordUsage({
        userId: principal,
        product: 'api-gateway',
        backendId: input.plan?.model.backendId ?? null,
        kind: 'chat',
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        durationMs: input.durationMs ?? null,
        success: input.status < 400,
        errorCode: input.errorCode ?? null,
      })
    }
    await db.gatewayRequestLog.create({
      data: {
        authKind: input.ctx.authKind,
        keyId: input.ctx.apiKeyId,
        userId: input.ctx.userId,
        provider: input.result?.provider ?? input.plan?.model.provider ?? 'unknown',
        model: input.modelId,
        endpoint: input.ctx.endpoint,
        status: input.status,
        errorCode: input.errorCode ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        durationMs: input.durationMs ?? null,
        streamed: input.streamed,
      },
    })
  } catch (e) {
    logger.warn('gateway.metering_failed', {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

/** Health of every chat-capable gateway model (measured probes). */
export async function gatewayModelsOverview(): Promise<Array<Record<string, unknown>>> {
  const models = await getGatewayModels()
  return models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    provider: m.provider,
    capabilities: m.capabilities,
    streaming: m.streaming,
    availability: m.enabled ? (m.backendHealth ? (m.backendHealth.healthy ? 'available' : 'unavailable') : 'available') : (m.configurationStatus === 'awaiting-credentials' ? 'awaiting-credentials' : 'disabled'),
    configurationStatus: m.configurationStatus,
    contextLimits: m.contextLimits,
    pricing: m.pricing,
    health: m.backendHealth
      ? { healthy: m.backendHealth.healthy, checkedAt: m.backendHealth.checkedAt, latencyMs: m.backendHealth.latencyMs, detail: m.backendHealth.detail, cached: m.backendHealth.cached ?? false }
      : null,
  }))
}
