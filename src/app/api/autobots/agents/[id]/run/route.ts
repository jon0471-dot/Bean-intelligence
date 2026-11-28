/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS run API.
 *
 * POST /api/autobots/agents/[id]/run → ONE agent turn through the EXISTING
 * RIISHE orchestration (`riishe` chat product). Every gate the RIISHE chat
 * route applies, this route applies identically: auth, body validation,
 * product preflight (availability, rate limit, daily quota, budget guard,
 * concurrency slot), capability assertion, streaming SSE with heartbeats,
 * Trust Engine receipts, usage metering and honest failure classification.
 *
 * Agent-specific composition (server-authoritative only):
 *  - tool permissions derive from the agent's capabilityKey (fixed
 *    vocabulary) — persona/instruction text is NEVER consulted;
 *  - the persona block is the bounded, untrusted-framed string built by
 *    agent-run.ts and appended by the orchestrator;
 *  - the transcript persists in the agent's own workspace (AutobotMessage),
 *    scoped to (agent, user).
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { BeanApiError, handle } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight, assertChatRequest } from '@/lib/router/router'
import { recordUsage } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'
import { orchestrateTurn } from '@/lib/riishe/orchestrator'
import { createRiisheTurnRecorder } from '@/lib/trust/adapters/riishe'
import { CHAT_BACKEND_CAPABILITIES } from '@/lib/riishe/classify'
import type { ToolContext } from '@/lib/riishe/tools/types'
import { metadataToJson, type MessageMetadata } from '@/lib/riishe/states'
import { createSseWriter } from '@/lib/riishe/sse'
import { upstreamStreamErrorPayload, upstreamErrorCode } from '@/lib/upstream/gateway'
import { agentPermissionSet, boundedPersonaBlock, loadAgentHistory, resolveAgentConversation } from '@/lib/autobots/agent-run'
import type { ChatTurn } from '@/lib/adapters/types'

const runSchema = z.object({
  message: z.string().min(1, 'Enter a message.').max(12000),
  /** Continue an existing workspace conversation (owner-checked). */
  conversationId: z.string().min(1).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const tRequest = Date.now()
  let releaseOnce: () => void = () => undefined
  let slotReleased = false
  const release = () => {
    if (!slotReleased) {
      slotReleased = true
      releaseOnce()
    }
  }
  let sseHandoff = false
  try {
    return await handle(async () => {
      const user = await requireUser()
      const { id: agentId } = await params
      const body = await parseBody(request, runSchema)

      // Same product preflight as RIISHE chat: availability, burst rate
      // limit, durable daily quota, provider budget guard, concurrency slot.
      const { backend, adapter, release, servedBy } = await preflight(user.id, 'riishe', 'chat')
      releaseOnce = release
      if (!adapter.chat || !adapter.chatStream) {
        release()
        throw new BeanApiError('NO_BACKEND', 'The chat backend is missing its adapter.')
      }

      // Agent + conversation resolution — owner-scoped on BOTH ids; an
      // archived agent is an honest 409; foreign ids are honest 404s.
      const { agent, conversationId } = await resolveAgentConversation(
        user.id,
        agentId,
        body.conversationId,
      )

      const caps = assertChatRequest(backend, [{ role: 'user', content: body.message }])

      // History window (tail-loaded, chronological). The workspace has no
      // cross-conversation digest in M49.1 — the bounded window is the honest
      // context scope; long-conversation digests are an M49.2 candidate.
      const history: ChatTurn[] = await loadAgentHistory(conversationId, caps.maxHistoryMessages)

      // The permission set derives from capabilityKey ONLY (server data).
      // Persona/instructions are untrusted persona framing, never authority.
      const toolContext: ToolContext = {
        permissions: agentPermissionSet(agent.capabilityKey),
        userId: user.id,
        conversationKey: `autobot:${conversationId}`,
        conversationId,
        documents: new Map(),
      }

      const personaBlock = boundedPersonaBlock(agent)

      // Dangling-retry collapse (same honest-history contract as RIISHE chat):
      // a previous turn that failed before producing any answer leaves a
      // trailing user row; re-sending that question replaces the dangling row
      // instead of accumulating duplicate questions. Never triggers after an
      // ANSWERED turn (the trailing row is the assistant's).
      const trailing = await db.autobotMessage.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, role: true, content: true },
      })
      if (trailing && trailing.role === 'user' && trailing.content === body.message) {
        await db.autobotMessage.delete({ where: { id: trailing.id } })
      }

      await db.autobotMessage.create({
        data: { conversationId, role: 'user', content: body.message },
      })

      const wantsStream = new URL(request.url).searchParams.get('stream') === '1'

      // ---- JSON path (non-streaming callers/tests) --------------------------
      if (!wantsStream) {
        try {
          const result = await orchestrateTurn({
            userMessage: body.message,
            history,
            caps,
            adapter,
            backendId: servedBy.backendId,
            nonStreaming: true,
            backendCapabilities: CHAT_BACKEND_CAPABILITIES,
            toolContext,
            personaBlock,
            userId: user.id,
          })
          await db.autobotMessage.create({
            data: {
              conversationId,
              role: 'assistant',
              content: result.content,
              tokensEstIn: result.tokensInEst,
              tokensEstOut: result.tokensOutEst,
              latencyMs: result.durationMs,
              metadata: metadataToJson(result.metadata),
            },
          })
          await db.autobotConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
          await db.autobotAgent.update({
            where: { id: agent.id },
            data: { executionCount: { increment: 1 }, lastExecutedAt: new Date() },
          })
          await recordUsage({
            userId: user.id,
            product: 'riishe',
            backendId: servedBy.backendId,
            kind: 'chat',
            tokensIn: result.tokensInEst,
            tokensOut: result.tokensOutEst,
            durationMs: result.durationMs,
            success: true,
          })
          logger.info('autobots.performance', {
            path: 'json',
            conversationId,
            task: result.task,
            preflightMs: Date.now() - tRequest,
          })
          return new Response(
            JSON.stringify({
              ok: true as const,
              conversationId,
              content: result.content,
              durationMs: result.durationMs,
              metadata: result.metadata,
            }),
            { headers: { 'content-type': 'application/json' } },
          )
        } catch (e) {
          throw new BeanApiError(upstreamErrorCode(e), e instanceof Error ? e.message : 'The backend call failed.')
        } finally {
          release()
        }
      }

      // ---- SSE streaming path (same wire protocol as RIISHE chat) ----------
      const convId = conversationId
      const agentIdForTouch = agent.id
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const writer = createSseWriter(controller, {
            onClosed: (reason) => {
              if (reason === 'client_gone') {
                logger.info('autobots.stream_client_disconnected', { conversationId: convId })
              }
            },
          })
          const t0 = Date.now()
          let succeeded = false
          let full = ''
          let firstTokenAt: number | null = null
          let finalMetadata: MessageMetadata | null = null
          // Trust Engine: the agent turn gets the SAME receipt contract as a
          // RIISHE turn — one recorder, no second receipt system. Best-effort.
          const trust = createRiisheTurnRecorder({
            userId: user.id,
            message: body.message,
            conversationId: convId,
          })
          await trust.begin()
          try {
            writer.comment('connected')
            // Early conversation id frame (same P0 R2 contract as RIISHE chat):
            // the client learns its key before any slow work begins.
            writer.send({ conversationId: convId })
            const result = await orchestrateTurn({
              userMessage: body.message,
              history,
              caps,
              adapter,
              backendId: servedBy.backendId,
              backendCapabilities: CHAT_BACKEND_CAPABILITIES,
              toolContext,
              personaBlock,
              userId: user.id,
              onEvent: (e) => {
                trust.onEvent(e)
                if (e.type === 'delta') {
                  if (firstTokenAt === null) firstTokenAt = Date.now()
                  full += e.delta
                  writer.send({ delta: e.delta, conversationId: convId })
                } else if (e.type === 'reset') {
                  full = ''
                  writer.send({ reset: true })
                } else if (e.type === 'stage') {
                  writer.send(e)
                } else if (e.type === 'research') {
                  writer.send({ research: { queries: e.queries } })
                } else if (e.type === 'tool') {
                  writer.send({ tool: e })
                } else if (e.type === 'task') {
                  trust.onTaskEvent(e)
                  writer.send({ task: { stage: e.stage, ...(e.detail ? { detail: e.detail } : {}) } })
                }
              },
            })
            finalMetadata = result.metadata
            succeeded = full.trim().length > 0
            await trust.complete(result, { persisted: succeeded })
            logger.info('autobots.performance', {
              path: 'sse',
              conversationId: convId,
              task: result.task,
              preflightMs: Date.now() - tRequest,
              firstTokenMs: firstTokenAt !== null ? firstTokenAt - t0 : null,
              ...(result.metadata.timings ?? {}),
            })
            if (succeeded) {
              await db.autobotMessage.create({
                data: {
                  conversationId: convId,
                  role: 'assistant',
                  content: result.content,
                  tokensEstIn: result.tokensInEst,
                  tokensEstOut: result.tokensOutEst,
                  latencyMs: result.durationMs,
                  metadata: metadataToJson(result.metadata),
                },
              })
              await db.autobotConversation.update({ where: { id: convId }, data: { updatedAt: new Date() } })
              await db.autobotAgent.update({
                where: { id: agentIdForTouch },
                data: { executionCount: { increment: 1 }, lastExecutedAt: new Date() },
              })
            }
            await recordUsage({
              userId: user.id,
              product: 'riishe',
              backendId: servedBy.backendId,
              kind: 'chat',
              tokensIn: result.tokensInEst,
              tokensOut: succeeded ? result.tokensOutEst : null,
              durationMs: Date.now() - t0,
              success: succeeded,
              errorCode: succeeded ? null : 'BACKEND_FAILURE',
            })
            writer.send({
              done: true,
              conversationId: convId,
              durationMs: Date.now() - t0,
              partial: !succeeded,
              ...(firstTokenAt !== null ? { firstTokenMs: firstTokenAt - t0 } : {}),
              ...(finalMetadata ? { meta: finalMetadata } : {}),
            })
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e)
            logger.warn('autobots.stream_failed', { message: errorMessage.slice(0, 300) })
            const payload = upstreamStreamErrorPayload(e)
            const errorCode = payload.code === 'UPSTREAM_RATE_LIMITED'
              ? 'UPSTREAM_RATE_LIMITED'
              : payload.code === 'UPSTREAM_AUTH'
                ? 'UPSTREAM_AUTH'
                : payload.code === 'UPSTREAM_BILLING'
                  ? 'UPSTREAM_BILLING'
                  : payload.code === 'UPSTREAM_TIMEOUT'
                    ? 'UPSTREAM_TIMEOUT'
                    : payload.code === 'UPSTREAM_TRUNCATED'
                      ? 'UPSTREAM_TRUNCATED'
                      : 'BACKEND_FAILURE'
            await recordUsage({
              userId: user.id,
              product: 'riishe',
              backendId: servedBy.backendId,
              kind: 'chat',
              tokensIn: Math.ceil(body.message.length / 4),
              durationMs: Date.now() - t0,
              success: false,
              errorCode,
            })
            await trust.failed({ errorCode, errorMessage })
            // Persist the honest failure: the user turn remains with a
            // truthful failure marker, never a fabricated answer.
            await db.autobotMessage.create({
              data: {
                conversationId: convId,
                role: 'assistant',
                content: `This turn failed (${errorCode}). ${errorMessage.slice(0, 400)}`,
              },
            })
            writer.send(payload)
          } finally {
            release()
            writer.close()
          }
        },
      })

      // The stream's own finally owns the slot release (same M26 G-4 contract
      // as RIISHE chat): the outer finally must not double-release.
      sseHandoff = true
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        },
      })
    })
  } finally {
    // The slot can NEVER outlive the request handler. After the SSE handoff
    // the stream's finally owns the release — defer to it.
    if (!sseHandoff) release()
  }
}
