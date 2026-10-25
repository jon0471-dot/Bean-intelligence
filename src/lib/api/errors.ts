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
  | 'PRODUCT_UNAVAILABLE'
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
  PRODUCT_UNAVAILABLE: 503,
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

  constructor(code: BeanErrorCode, message: string, detail?: string) {
    super(message)
    this.code = code
    this.detail = detail
  }

  toResponse() {
    return Response.json(
      {
        ok: false as const,
        error: { code: this.code, message: this.message, detail: this.detail },
      },
      { status: HTTP_STATUS[this.code] },
    )
  }
}

/** Uniform success envelope. */
export function ok<T extends Record<string, unknown>>(payload: T, init?: ResponseInit) {
  return Response.json({ ok: true as const, ...payload }, init)
}

/** Wrap a route handler so thrown BeanApiErrors become clean responses and
 *  unexpected errors never leak stack traces or internals. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => {
    if (err instanceof BeanApiError) return err.toResponse()
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'api.unexpected_error',
        message: err instanceof Error ? err.message : String(err),
      }),
    )
    return new BeanApiError('INTERNAL_ERROR', 'Something went wrong handling your request.').toResponse()
  })
}
