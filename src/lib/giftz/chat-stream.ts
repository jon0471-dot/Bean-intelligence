/**
 * BEAN Intelligence — CODE GIFTZ chat SSE lifecycle (extracted, unit-testable).
 *
 * ROOT-CAUSE FIX (2026-11-03 "network error" / `Invalid state: Controller is
 * already closed`): the previous route built its ReadableStream inline with a
 * bare `controller.enqueue` on every delta. When the browser side of a long
 * generation went away (user Stop, tab close, transport death), the runtime
 * cancelled the stream, the NEXT delta's enqueue threw synchronously, the
 * catch block's own error-frame enqueue threw AGAIN, and the `finally` block's
 * `controller.close()` threw a THIRD time out of `start()` — the exact
 * `codegiftz.chat_failed "Invalid state: Controller is already closed"` line
 * in dev.log. The upstream generation also kept running until that first
 * throwing enqueue instead of being unwound promptly, and a client that lost
 * its connection mid-answer saw the browser's raw `TypeError: network error`
 * with no typed category.
 *
 * This module owns the whole SSE turn lifecycle with those defects removed:
 *  - every controller operation is guarded; a closed/errored controller can
 *    never throw out of the lifecycle (the crash is structurally impossible);
 *  - client disconnect (ReadableStream.cancel + Next.js request.signal) sets
 *    a guard that (a) stops enqueueing, (b) asks the generation to unwind at
 *    the next delta, (c) still finishes persisting a FULLY generated answer
 *    so history stays consistent with the workspace;
 *  - `: keepalive` comment frames flow during silent stretches (thinking
 *    pause, slow tokens) using the shared stream-config heartbeat cadence —
 *    comments are transport noise per the SSE spec, never content;
 *  - exactly ONE terminal frame is ever sent: `done` after the assistant
 *    message is persisted, or one typed error frame (`upstreamStreamErrorPayload`
 *    classes plus an honest PERSIST_FAILED class) — a failed turn is never
 *    presented as a completion and a completed turn never reports an error;
 *  - usage/audit/file-list work after persistence can NEVER break a persisted
 *    turn (logged, not thrown) — metering must not take down an answer;
 *  - the concurrency slot is released EXACTLY once on every path.
 *
 * Known platform limitation (recorded, unchanged): the authorized gateway SDK
 * exposes no AbortSignal, so an in-flight upstream request cannot be killed
 * from here. The guard unwinds at the NEXT delta (or the configured idle
 * timeout when the provider is silent) — the same best-effort contract as
 * sseDeltas' cleanup.
 */
import { streamConfig } from '@/lib/riishe/stream-config'
import { solveWithContinuation } from '@/lib/riishe/continuation'
import { UpstreamTruncatedError } from '@/lib/adapters/hosted-llm'
import type { ChatTurn } from '@/lib/adapters/types'

/** Thrown by the generator callback to unwind a turn whose client is gone.
 *  Never rendered to anyone — the client that caused it cannot receive it. */
export class ClientDisconnectedError extends Error {
  constructor(message = 'client disconnected mid-generation') {
    super(message)
    this.name = 'ClientDisconnectedError'
  }
}

export function isClientDisconnected(e: unknown): boolean {
  return e instanceof Error && e.name === 'ClientDisconnectedError'
}

/** Generation guard handed to runTurn: checked between deltas so a cancelled
 *  turn stops consuming the upstream promptly instead of running to completion. */
export interface GenerationGuard {
  readonly aborted: boolean
}

/** One turn event from the generation loop (same wire shapes as before). */
export interface GiftzTurnEvent {
  delta?: string
  stage?: string
}

export interface GiftzFileChange {
  path: string
  change: 'added' | 'modified'
  diff: unknown
}

export interface GiftzTurnResult {
  content: string
  changes: GiftzFileChange[]
  durationMs: number
  tokensInEst: number
  tokensOutEst: number
  /** How many provider passes the answer spanned (0 = single pass). */
  continuationCount: number
  /** Self-verification summary (null when verification is disabled/skipped).
   *  Public fields only — the verifier's internal trace never rides the wire. */
  verification?: {
    status: 'verified' | 'corrected' | 'corrected-unverified' | 'unverified' | 'skipped'
    attempts: number
    corrections: number
    issuesFound: number
  } | null
  /** Frontend Intelligence summary + checks (ADDITIVE; frontend turns only). */
  frontend?: import('@/lib/frontend-intel/types').FrontendTurnResult
  /** ADDITIVE (shared research gateway): research provenance artifact. */
  research?: import('@/lib/intel/techdocs-reach').GiftzResearchArtifact
}

export interface GiftzChatStreamDeps {
  projectId: string
  /** Generates the answer. May throw typed upstream errors; MUST honor the
   *  guard between deltas (throw ClientDisconnectedError) so cancellation
   *  unwinds. The guard is also readable directly for coarse checks. */
  runTurn: (
    onEvent: ((e: GiftzTurnEvent) => void) | undefined,
    guard: GenerationGuard,
  ) => Promise<GiftzTurnResult>
  /** Persist the assistant message EXACTLY once. Must resolve for a `done`. */
  persistAssistant: (result: GiftzTurnResult) => Promise<{ messageId: string }>
  /** Post-persistence work (usage, audit, file list). Failures are logged and
   *  NEVER fail the turn — the answer is already committed. */
  afterPersist?: (
    result: GiftzTurnResult,
    messageId: string,
  ) => Promise<{ files?: Array<{ path: string; origin: string }> } | void>
  /** Honest failure class for a thrown error (typed upstream payload). */
  failurePayload: (e: unknown) => { error: string; code: string; partial: true }
  /** Concurrency slot release — called EXACTLY once per stream. */
  release: () => void
  /** SSE `: keepalive` cadence; defaults to the shared stream-config value. */
  heartbeatMs?: number
  /** Next.js request.signal — fires when the HTTP client disconnects. */
  disconnectSignal?: AbortSignal | null
  log?: (event: string, data?: Record<string, unknown>) => void
}

/**
 * Build the CODE GIFTZ chat turn as a ReadableStream of SSE bytes.
 * Wire contract (unchanged for consumers): `data: {"stage":…}` thinking,
 * `data: {"delta":…,"projectId":…}` content, one terminal
 * `data: {"done":true,…}` OR `data: {"error":…,"code":…,"partial":true}`,
 * then a clean close. `messageId` on done is additive.
 */
export function createGiftzChatStream(deps: GiftzChatStreamDeps): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const heartbeatMs = deps.heartbeatMs ?? streamConfig().heartbeatIntervalMs
  const startedAt = Date.now()

  // Shared between start() and cancel(): a disconnect can arrive from either
  // the runtime cancelling the stream or request.signal aborting.
  let clientGone = false
  const guard: { aborted: boolean } = { aborted: false }

  const markClientGone = (why: string) => {
    if (clientGone) return
    clientGone = true
    guard.aborted = true
    deps.log?.('codegiftz.client_disconnected', { why, projectId: deps.projectId })
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let terminalSent = false
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined

      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (clientGone) return false
        try {
          controller.enqueue(chunk)
          return true
        } catch {
          // The controller was closed/errored under us (client went away and
          // the runtime tore the stream down). Degrade to no-op — this is the
          // branch that makes the historical crash impossible.
          markClientGone('enqueue-after-close')
          return false
        }
      }
      const sendJson = (obj: Record<string, unknown>): boolean =>
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))

      if (deps.disconnectSignal) {
        if (deps.disconnectSignal.aborted) markClientGone('signal-already-aborted')
        else deps.disconnectSignal.addEventListener('abort', () => markClientGone('request-signal'), { once: true })
      }

      // Heartbeat: `: keepalive` comments during silent stretches so idle
      // intermediaries never reap a live turn. Ignored by every SSE client.
      if (heartbeatMs > 0) {
        heartbeatTimer = setInterval(() => {
          if (!clientGone && !terminalSent) safeEnqueue(encoder.encode(': keepalive\n\n'))
        }, heartbeatMs)
      }

      void (async () => {
        try {
          const result = await deps.runTurn((e) => {
            // Unwind the generation PROMPTLY when the client is gone instead
            // of letting the upstream run to completion for nobody.
            if (guard.aborted) throw new ClientDisconnectedError()
            if (typeof e.delta === 'string') {
              sendJson({ delta: e.delta, projectId: deps.projectId })
            } else if (e.stage) {
              sendJson({ stage: e.stage })
            }
          }, guard)

          // Persist FIRST (even when the client is gone): a fully generated
          // answer belongs in history exactly once, consistent with any file
          // changes already applied. Never duplicated — this is the only call.
          let messageId: string | null = null
          try {
            const persisted = await deps.persistAssistant(result)
            messageId = persisted.messageId
          } catch (persistError) {
            if (clientGone) {
              // Nowhere to report it — keep an honest server-side trace.
              deps.log?.('codegiftz.persist_failed', {
                projectId: deps.projectId,
                clientGone: true,
                contentChars: result.content.length,
                message: persistError instanceof Error ? persistError.message : String(persistError),
              })
            } else {
              deps.log?.('codegiftz.persist_failed', {
                projectId: deps.projectId,
                contentChars: result.content.length,
                message: persistError instanceof Error ? persistError.message : String(persistError),
              })
              terminalSent = true
              sendJson({
                error:
                  'The answer was generated but could not be saved to your history. ' +
                  'The text below is preserved — copy it if you need it. Retrying will not lose your question.',
                code: 'PERSIST_FAILED',
                partial: true,
              })
            }
            return
          }

          if (clientGone) return // answer persisted; no frames to a gone client

          // Usage/audit/file-list: best-effort AFTER the answer is committed.
          let files: Array<{ path: string; origin: string }> = []
          try {
            const extra = await deps.afterPersist?.(result, messageId)
            files = extra?.files ?? []
          } catch (metaError) {
            deps.log?.('codegiftz.post_persist_failed', {
              projectId: deps.projectId,
              messageId,
              message: metaError instanceof Error ? metaError.message : String(metaError),
            })
          }

          terminalSent = true
          sendJson({
            done: true,
            projectId: deps.projectId,
            messageId,
            durationMs: Date.now() - startedAt,
            changes: result.changes,
            files,
            verification: result.verification ?? null,
            ...(result.frontend ? { frontend: result.frontend } : {}),
            ...(result.research ? { research: result.research } : {}),
          })
        } catch (e) {
          if (isClientDisconnected(e) || clientGone) {
            // A cancelled turn is a normal lifecycle event, not an error: the
            // guard unwound the generation, nothing is reported to nobody.
            return
          }
          deps.log?.('codegiftz.chat_failed', {
            projectId: deps.projectId,
            message: e instanceof Error ? e.message : String(e),
          })
          const payload = deps.failurePayload(e)
          terminalSent = true
          sendJson({ error: payload.error, code: payload.code, partial: true })
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer)
          try {
            deps.release() // exactly once, every path
          } catch (releaseError) {
            deps.log?.('codegiftz.release_failed', {
              message: releaseError instanceof Error ? releaseError.message : String(releaseError),
            })
          }
          try {
            // Always ATTEMPT the close so any still-attached consumer sees a
            // deterministic end; if the runtime already closed/errored the
            // controller (disconnect paths) the throw is swallowed — this is
            // the branch that makes the historical crash impossible.
            controller.close()
          } catch {
            /* already closed/errored — nothing to do */
          }
        }
      })()
    },
    cancel() {
      markClientGone('stream-cancelled')
    },
  })
}

/**
 * Per-message char allowance for CONTINUATION passes. The accumulated partial
 * rides as one assistant message; if the adapter sliced it (maxPromptChars),
 * the continuation would resume from a truncated referent and REPEAT text the
 * client already received. Continuation passes therefore get a larger,
 * still-bounded allowance; first-pass behavior is unchanged.
 */
export const CONTINUATION_MAX_PROMPT_CHARS = 64_000

export interface GenerateTurnArgs {
  /** The original turn messages (system + curated history + user turn). */
  baseMessages: ChatTurn[]
  /** One upstream streaming pass (the adapter's chatStream, pre-bound). */
  chatStream: (messages: ChatTurn[], pass: number) => AsyncGenerator<string, void, unknown>
  /** Live delta forwarding (client-facing stream; every pass's deltas flow). */
  onDelta?: (delta: string) => void
  /** Generation guard — a cancelled turn unwinds at the next delta. */
  guard?: GenerationGuard
  /** Continuation bound; defaults to the shared RIISHE bound (1 pass). */
  maxContinuations?: number
}

/**
 * Generate one CODE GIFTZ turn with CONTROLLED CONTINUATION (2026-11-03):
 * when the provider cuts the answer at its output-length limit
 * (finish_reason "length" — measured live: a 17.8k-char coding answer died
 * mid-stream), the turn CONTINUES from the exact partial instead of failing:
 *  - every delta of every pass is forwarded live (one continuous client
 *    stream; the wire protocol never changes);
 *  - the concatenated text is the honest FULL answer, persisted byte-exact;
 *  - the bound keeps worst-case upstream cost controlled — when it is
 *    reached, the typed UpstreamTruncatedError propagates with everything
 *    produced so far attached (partial preserved, never a fake completion);
 *  - a cancelled turn unwinds through continuation passes exactly as through
 *    a single pass (ClientDisconnectedError is never mistaken for truncation).
 */
export async function generateTurnWithContinuation(
  args: GenerateTurnArgs,
): Promise<{ content: string; continuationCount: number }> {
  let passIndex = 0
  return solveWithContinuation({
    baseMessages: args.baseMessages,
    maxContinuations: args.maxContinuations,
    solvePass: async (messages) => {
      const pass = passIndex++ // 0 = first pass, 1+ = continuations
      let passContent = ''
      try {
        for await (const delta of args.chatStream(messages, pass)) {
          if (args.guard?.aborted) throw new ClientDisconnectedError()
          passContent += delta
          args.onDelta?.(delta)
        }
      } catch (e) {
        // Streaming passes have already emitted their partial as deltas;
        // attach it so the continuation has the exact referent (and so the
        // bound-reached error carries everything produced).
        if (e instanceof UpstreamTruncatedError && passContent.length > 0) {
          throw new UpstreamTruncatedError(e.message, passContent)
        }
        throw e
      }
      return passContent
    },
  })
}
