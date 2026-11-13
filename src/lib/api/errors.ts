/**
 * BEAN Intelligence — BEAN-owned API error contract.
 * Stable, customer-safe error codes. Internal details never leak here.
 */

export type BeanErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_CONTENT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'COST_LIMIT'
  | 'PRODUCT_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'NO_BACKEND'
  | 'BACKEND_TIMEOUT'
  | 'BACKEND_FAILURE'
  | 'CAPABILITY_UNSUPPORTED'
  | 'CONCURRENCY_LIMIT'
  | 'SANDBOX_DENIED'
  | 'INTERNAL_ERROR'

const HTTP_STATUS: Record<BeanErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  UNSUPPORTED_FORMAT: 415,
  UNSUPPORTED_CONTENT: 422,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  // Operator-set provider request budget exhausted (provider-spend guard).
  COST_LIMIT: 429,
  PRODUCT_UNAVAILABLE: 503,
  PROVIDER_UNAVAILABLE: 503,
  NO_BACKEND: 503,
  BACKEND_TIMEOUT: 504,
  BACKEND_FAILURE: 502,
  CAPABILITY_UNSUPPORTED: 422,
  CONCURRENCY_LIMIT: 429,
  SANDBOX_DENIED: 403,
  INTERNAL_ERROR: 500,
}

export class BeanApiError extends Error {
  code: BeanErrorCode
  detail?: string
  /** Optional HTTP headers for the error response (e.g. truthful rate-limit
   *  headers on 429s). Never carries secrets or internal identifiers; values
   *  are built by rateLimitHeaders() from real limiter/breaker state. */
  headers?: Record<string, string>

  constructor(code: BeanErrorCode, message: string, detail?: string, options?: { headers?: Record<string, string> }) {
    super(message)
    this.code = code
    this.detail = detail
    this.headers = options?.headers
  }

  toResponse() {
    return Response.json(
      {
        ok: false as const,
        error: { code: this.code, message: this.message, detail: this.detail },
      },
      { status: HTTP_STATUS[this.code], headers: this.headers },
    )
  }
}

export interface RateLimitHeaderInput {
  /** Total units the window allows (requests or quota units). */
  limit?: number | null
  /** Units remaining in the current window. */
  remaining?: number | null
  /** Epoch milliseconds at which the window resets (real, calculated). */
  resetAtMs?: number | null
  /** Known retry delay in seconds (from the limiter/breaker, never guessed). */
  retryAfterSec?: number | null
}

/**
 * Build truthful rate-limit response headers. Values come verbatim from the
 * actual limiter/quota/breaker state; any value that is absent or not a real
 * non-negative number is OMITTED rather than fabricated. X-RateLimit-Reset is
 * emitted only when a genuine reset timestamp was calculated (epoch seconds).
 * Returns undefined when no header has a truthful value, so callers can pass
 * the result straight into BeanApiError options without changing behavior.
 */
export function rateLimitHeaders(input: RateLimitHeaderInput): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  if (typeof input.retryAfterSec === 'number' && Number.isFinite(input.retryAfterSec) && input.retryAfterSec >= 0) {
    headers['Retry-After'] = String(Math.ceil(input.retryAfterSec))
  }
  if (typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit >= 0) {
    headers['X-RateLimit-Limit'] = String(Math.floor(input.limit))
  }
  if (typeof input.remaining === 'number' && Number.isFinite(input.remaining) && input.remaining >= 0) {
    headers['X-RateLimit-Remaining'] = String(Math.floor(input.remaining))
  }
  if (typeof input.resetAtMs === 'number' && Number.isFinite(input.resetAtMs) && input.resetAtMs > 0) {
    headers['X-RateLimit-Reset'] = String(Math.floor(input.resetAtMs / 1000))
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

/** Uniform success envelope. */
export function ok<T extends Record<string, unknown>>(payload: T, init?: ResponseInit) {
  return Response.json({ ok: true as const, ...payload }, init)
}

/** Wrap a route handler so thrown BeanApiErrors become clean responses and
 *  unexpected errors never leak stack traces or internals. A missing
 *  BEAN_CREDENTIALS_MASTER_KEY is a CONFIGURATION state, not a crash — it is
 *  reported as the typed fail-closed error the credential features promise
 *  (PRODUCT_UNAVAILABLE + the operator-actionable message), never an opaque
 *  500. Structural name check: importing the error class here creates a
 *  chunk-ordering TDZ in the standalone bundle, so the mapping keys on the
 *  stable error name instead (set by the class itself). */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof BeanApiError) return err.toResponse()
    if (err instanceof Error && err.name === 'CredentialsNotConfiguredError') {
      return new BeanApiError('PRODUCT_UNAVAILABLE', err.message).toResponse()
    }
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'api.unexpected_error',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 6).join(' | ') : undefined,
      }),
    )
    return new BeanApiError('INTERNAL_ERROR', 'Something went wrong handling your request.').toResponse()
  })
}
