/**
 * BEAN Intelligence — RIISHE SSE wire writer (server side, unit-testable).
 *
 * ROOT-CAUSE FIX (2026-11-01 "network error" / premature stream termination):
 * the previous route wrote NOTHING to the SSE response during the long
 * silent phases of a turn — research (multi-query search + page reads,
 * measured 20-60s+), the buffered tool-loop/injection-gate solve, and the
 * gap before the model's first token. Reverse proxies on the hosting path
 * kill a streaming connection that stays idle for their (shorter) idle
 * window; the client's `reader.read()` then rejects with Chromium's literal
 * `TypeError: network error`, the partial answer stays on screen, and the
 * turn is lost mid-flight.
 *
 * This writer keeps the wire warm:
 *  - every event goes through `send()`, which remembers the last write time;
 *  - a heartbeat timer emits an SSE COMMENT line (`: keepalive`) whenever
 *    nothing was written for `heartbeatMs` — comments are valid SSE and are
 *    ignored by every spec-compliant parser, but they reset proxy idle
 *    timers and prove the connection is alive;
 *  - enqueue failures (client navigated away / stopped reading) are
 *    contained: the writer marks itself closed and reports the disconnect
 *    through `onClosed` instead of throwing into the orchestrator, so an
 *    abandoned turn can still finish server-side and persist a complete
 *    answer (no dangling half-turn in history, no duplicate user retries).
 *
 * The protocol itself (single-line `data: {json}\n\n` frames) is UNCHANGED.
 */

export const DEFAULT_SSE_HEARTBEAT_MS = 15_000

export interface SseWriterOptions {
  /** Idle window after which a `: keepalive` comment is emitted. */
  heartbeatMs?: number
  /** Called once when the stream becomes unwritable or is closed. */
  onClosed?: (reason: 'client_gone' | 'closed') => void
  /** Test seam: inject the timer functions (defaults to the real ones). */
  timers?: {
    setInterval: (fn: () => void, ms: number) => unknown
    clearInterval: (handle: unknown) => void
  }
}

export interface SseWriter {
  /** Write one SSE data frame. Returns false when the stream is gone. */
  send(payload: unknown): boolean
  /** Write an SSE comment line (never parsed as an event by clients). */
  comment(text: string): boolean
  /** True when nothing further can be written. */
  isClosed(): boolean
  /** Close the stream idempotently. */
  close(): void
}

function defaultTimers() {
  return {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
  }
}

export function createSseWriter(
  controller: ReadableStreamDefaultController<Uint8Array>,
  options: SseWriterOptions = {},
): SseWriter {
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS
  const timers = options.timers ?? defaultTimers()
  const encoder = new TextEncoder()

  let closed = false
  let closeReason: 'client_gone' | 'closed' | null = null
  let lastWriteAt = Date.now()

  const safeEnqueue = (text: string): boolean => {
    if (closed) return false
    try {
      controller.enqueue(encoder.encode(text))
      lastWriteAt = Date.now()
      return true
    } catch {
      // The controller is already closed/errored — the consumer disconnected.
      if (closeReason === null) closeReason = 'client_gone'
      closed = true
      stopHeartbeat()
      options.onClosed?.(closeReason)
      return false
    }
  }

  const heartbeatHandle = timers.setInterval(() => {
    if (closed) return
    if (Date.now() - lastWriteAt >= heartbeatMs) safeEnqueue(`: keepalive\n\n`)
  }, heartbeatMs)

  const stopHeartbeat = () => timers.clearInterval(heartbeatHandle)

  return {
    send(payload) {
      // Single-line JSON frame; JSON.stringify escapes newlines, so a frame
      // is always exactly one `data:` line + the blank separator.
      return safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`)
    },
    comment(text) {
      return safeEnqueue(`: ${text.replace(/[\r\n]/g, ' ')}\n\n`)
    },
    isClosed() {
      return closed
    },
    close() {
      if (closed) return
      closed = true
      closeReason = 'closed'
      stopHeartbeat()
      try {
        controller.close()
      } catch {
        // Already closed by the runtime (consumer disconnected) — nothing to do.
      }
      options.onClosed?.('closed')
    },
  }
}
