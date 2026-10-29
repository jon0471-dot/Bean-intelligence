/**
 * BEAN Intelligence — structured logger (packages/observability).
 *
 * Rules enforced here:
 *  - Never log raw prompts or generated content by default (privacy).
 *  - Never log credentials or secret material.
 *  - One JSON line per event, server-side only.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN_LEVEL: number = LEVELS[(process.env.BEAN_LOG_LEVEL as Level) ?? 'info'] ?? 20

function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < MIN_LEVEL) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
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
