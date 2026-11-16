/**
 * BEAN Intelligence — structured logger (packages/observability).
 *
 * Rules enforced here:
 *  - Never log raw prompts or generated content by default (privacy).
 *  - Never log credentials or secret material.
 *  - One JSON line per event, server-side only.
 */

import { AsyncLocalStorage } from 'async_hooks'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN_LEVEL: number = LEVELS[(process.env.BEAN_LOG_LEVEL as Level) ?? 'info'] ?? 20

// ---------------------------------------------------------------------------
// M26 (audit O-1): request/correlation IDs.
// The audit found ZERO correlation ids anywhere — a 500 could not be joined
// to its job/provider log lines without timestamp hand-matching. The
// middleware now issues `x-bean-request-id` on every /api request and
// `handle()` enters this ALS context with it, so EVERY structured log line
// emitted inside a request carries `requestId`. Background jobs log with
// jobId fields (unchanged) — a job started by a request inherits the id only
// inside the request's async scope.
// ---------------------------------------------------------------------------
const requestStore = new AsyncLocalStorage<{ requestId?: string }>()

/** Run fn with a request id attached to every log line in its async scope. */
export function withRequestContext<T>(ctx: { requestId?: string }, fn: () => Promise<T>): Promise<T> {
  return requestStore.run(ctx, fn)
}

/** The current request id (null outside a request scope / in workers). */
export function currentRequestId(): string | null {
  return requestStore.getStore()?.requestId ?? null
}

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < MIN_LEVEL) return
  const requestId = currentRequestId()
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(requestId ? { requestId } : {}),
    ...fields,
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit('error', event, fields),
}

/** Best-effort redaction of anything that looks like a credential. */
export function redact(value: string): string {
  if (!value) return value
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}
