/**
 * BEAN Intelligence — RIISHE SSE client consumption (pure, unit-testable).
 *
 * ROOT-CAUSE FIX (2026-11-01 "network error" / incomplete answers):
 * the previous client loop had four defects now fixed here:
 *  1. A stream that died mid-flight (platform proxy kill, TCP reset) surfaced
 *     Chromium's raw `TypeError: network error` to the user and left the
 *     partial answer WITHOUT its incomplete label.
 *  2. A stream that closed cleanly WITHOUT the orchestrator's `done` event
 *     was treated as SUCCESS — an incomplete response labeled as complete.
 *  3. The reader was never cancelled/released on failure.
 *  4. Parsing was line-based only: valid SSE frames with CRLF endings, or
 *     multi-line `data:` payloads, were not handled per spec.
 *
 * This module implements the read loop exactly per the SSE rules BEAN uses:
 *  - frames separated by a blank line (LF or CRLF);
 *  - `data:` lines within a frame joined with `\n` (multiline events);
 *  - `:` comment lines ignored (server keepalive frames);
 *  - bytes decoded with a streaming TextDecoder so UTF-8 characters split
 *    across network chunks reassemble correctly (Tamil/CJK safe);
 *  - the final decoder flush + residual frame processed before completion;
 *  - normal completion (a `done` event) is distinguished from unexpected
 *    termination (connection lost, protocol violation), and every failure
 *    carries an honest category instead of the browser's raw message.
 */

import type { MsgMeta } from '@/components/bean/riishe/use-riishe-chat'

export interface RiisheStreamEvent {
  delta?: string
  reset?: boolean
  done?: boolean
  error?: string
  code?: string
  conversationId?: string
  messageId?: string
  partial?: boolean
  tool?: { name: string; status: 'started' | 'done' | 'failed' }
  meta?: MsgMeta
  firstTokenMs?: number
  durationMs?: number
  // ---- CODE GIFTZ turn fields (additive; the consumer is product-agnostic) --
  projectId?: string
  changes?: Array<{ path: string; change: string; diff?: unknown }>
  files?: Array<{ path: string; origin: string }>
  /** RIISHE pipeline stages; CODE GIFTZ uses 'thinking' before first token. */
  stage?: 'researching' | 'tools' | 'solving' | 'verifying' | 'thinking'
}

export type StreamFailureKind =
  /** User pressed Stop / navigated away (AbortError). NOT an error to show. */
  | 'aborted'
  /** The HTTP connection itself failed or died mid-stream. */
  | 'network'
  /** No bytes (not even keepalives) for the watchdog window. */
  | 'timeout'
  /** Non-OK HTTP response before streaming started. */
  | 'http'
  /** Stream ended without the orchestrator's completion event. */
  | 'protocol'

export interface StreamFailureInfo {
  kind: StreamFailureKind
  message: string
  /** Status code for 'http' failures, otherwise null. */
  status: number | null
}

export interface ConsumeCallbacks {
  onEvent: (e: RiisheStreamEvent) => void
  /** The orchestrator's `done` event arrived — the turn really completed. */
  onComplete: (e: RiisheStreamEvent) => void
  /** Any non-abort failure. Never called after onComplete. */
  onFailure: (failure: StreamFailureInfo) => void
}

/** Client-side safety net: the server heartbeats every 15s, so a legitimate
 *  stream always shows bytes; silence beyond this window means the connection
 *  is truly wedged. Generous enough to never trip on slow generation. */
export const CLIENT_IDLE_WATCHDOG_MS = 60_000

/**
 * Incremental SSE frame parser. Feed it decoded text; it returns complete
 * events. Handles LF and CRLF, multi-line data payloads, and comment lines.
 */
export function createSseFrameParser(): {
  push(chunk: string): RiisheStreamEvent[]
  flush(): RiisheStreamEvent[]
} {
  let buffer = ''
  const FRAMES_RE = /\r?\n\r?\n/

  const parseFrame = (frame: string): RiisheStreamEvent | null => {
    const dataLines: string[] = []
    for (const rawLine of frame.split(/\r?\n/)) {
      if (rawLine.startsWith(':')) continue // comment / keepalive
      if (rawLine.startsWith('data:')) {
        // Spec: strip exactly one leading space after the colon.
        dataLines.push(rawLine.startsWith('data: ') ? rawLine.slice(6) : rawLine.slice(5))
      }
      // event:/id:/retry: fields are legal SSE but unused by BEAN — ignored.
    }
    if (dataLines.length === 0) return null
    const payload = dataLines.join('\n')
    if (payload.trim() === '[DONE]') return { done: true }
    try {
      return JSON.parse(payload) as RiisheStreamEvent
    } catch {
      // A malformed event is skipped, not fatal — the next frame may be fine.
      return null
    }
  }

  return {
    push(chunk) {
      buffer += chunk
      const events: RiisheStreamEvent[] = []
      let match: RegExpExecArray | null
      while ((match = FRAMES_RE.exec(buffer)) !== null) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const evt = parseFrame(frame)
        if (evt) events.push(evt)
      }
      return events
    },
    flush() {
      // Some writers emit the final frame without the trailing blank line.
      const rest = buffer
      buffer = ''
      const evt = rest.trim().length > 0 ? parseFrame(rest) : null
      return evt ? [evt] : []
    },
  }
}

/** Human-honest failure wording per category. No provider internals, no
 *  secrets, no raw browser error strings. */
export function streamFailureMessage(kind: StreamFailureKind, status: number | null): string {
  switch (kind) {
    case 'network':
      return 'The connection to RIISHE was lost mid-response. The text received so far is preserved — use Regenerate to produce a complete answer.'
    case 'timeout':
      return 'The response stalled and timed out before completing. The text received so far is preserved — try again in a moment.'
    case 'http':
      if (status === 401 || status === 403) return 'Your session is no longer valid. Please sign in again.'
      if (status === 429) return 'RIISHE is rate-limited right now. Please wait a little and try again.'
      if (status === 504 || status === 408) return 'The request timed out before the answer started. Please try again.'
      if (status === 502 || status === 503) return 'The AI gateway is temporarily unavailable. Please try again shortly.'
      return `The request failed (HTTP ${status ?? 'error'}). Please try again.`
    case 'protocol':
      return 'The response ended before the model finished. The text received so far is preserved as incomplete.'
    default:
      return 'The response could not be completed.'
  }
}

export function classifyHttpFailure(status: number, serverMessage?: string): StreamFailureInfo {
  const kind: StreamFailureKind =
    status === 429 || status === 408 || status === 504
      ? 'timeout'
      : status === 401 || status === 403
        ? 'http'
        : status === 502 || status === 503
          ? 'network'
          : 'http'
  return { kind, status, message: serverMessage ?? streamFailureMessage(kind, status) }
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/**
 * Consume one RIISHE SSE response to completion (or honest failure).
 * Guarantees:
 *  - callbacks see EVERY valid event, in order, exactly once;
 *  - onComplete fires only when the server's `done` event actually arrived;
 *  - onFailure fires for network death, watchdog timeout, or a stream that
 *    ended without `done` (protocol) — never after onComplete;
 *  - aborts surface as onFailure('aborted') (or thrown AbortError is caught
 *    internally — both stop consumption cleanly);
 *  - the reader is always released (cancel + catch) — no leaked locks.
 */
export async function consumeRiisheStream(
  res: Response,
  callbacks: ConsumeCallbacks,
  options: { signal?: AbortSignal; idleWatchdogMs?: number } = {},
): Promise<void> {
  const idleWatchdogMs = options.idleWatchdogMs ?? CLIENT_IDLE_WATCHDOG_MS
  const body = res.body
  if (!body) {
    callbacks.onFailure({ kind: 'protocol', status: null, message: streamFailureMessage('protocol', null) })
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseFrameParser()
  let completed = false
  let failed = false

  const handleEvent = (evt: RiisheStreamEvent) => {
    if (completed || failed) return
    if (evt.done) {
      completed = true
      callbacks.onComplete(evt)
      return
    }
    callbacks.onEvent(evt)
  }

  try {
    while (true) {
      let readPromise = reader.read()
      // Watchdog: an idle stream (no bytes at all) beyond the window is a
      // timeout, not a hang — abort the read and classify honestly.
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const winner = await Promise.race([
        readPromise.then(
          (r) => ({ type: 'read' as const, r }),
          (e) => ({ type: 'error' as const, e }),
        ),
        new Promise<{ type: 'watchdog' }>((resolve) => {
          watchdog = setTimeout(() => resolve({ type: 'watchdog' }), idleWatchdogMs)
        }),
      ])
      clearTimeout(watchdog)
      if (winner.type === 'watchdog') {
        failed = true
        await reader.cancel().catch(() => undefined)
        callbacks.onFailure({ kind: 'timeout', status: null, message: streamFailureMessage('timeout', null) })
        return
      }
      if (winner.type === 'error') throw winner.e
      const { done, value } = winner.r
      if (done) break
      const text = decoder.decode(value, { stream: true })
      for (const evt of parser.push(text)) handleEvent(evt)
      if (completed) break
    }
    if (!completed && !failed) {
      // Flush the decoder's tail (a UTF-8 char split at the very end) and any
      // residual complete frame the writer sent without a trailing newline.
      const tail = decoder.decode()
      for (const evt of [...parser.push(tail), ...parser.flush()]) handleEvent(evt)
    }
    if (!completed && !failed) {
      // Normal reader close WITHOUT the orchestrator's done event: an
      // unexpected termination — never reported as success.
      failed = true
      callbacks.onFailure({ kind: 'protocol', status: null, message: streamFailureMessage('protocol', null) })
    }
  } catch (e) {
    if (!completed && !failed) {
      failed = true
      if (isAbortError(e)) {
        callbacks.onFailure({ kind: 'aborted', status: null, message: 'Generation stopped.' })
      } else {
        callbacks.onFailure({ kind: 'network', status: null, message: streamFailureMessage('network', null) })
      }
    }
  } finally {
    // Release the stream resources on every exit path.
    if (!completed) await reader.cancel().catch(() => undefined)
    try {
      reader.releaseLock()
    } catch {
      // Reader already released by cancel() — nothing to do.
    }
  }
}
