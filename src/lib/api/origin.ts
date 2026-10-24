/**
 * BEAN Intelligence — cross-site request defense (CSRF compensating control).
 *
 * The session cookie is SameSite=None; Secure (required for the embedded
 * cross-site preview context). SameSite=None removes the implicit CSRF
 * protection Lax provided, so every unsafe API method is explicitly checked
 * against its Origin header: when a browser sends a state-changing request,
 * the Origin host must match the request host. Non-browser clients (curl,
 * server-to-server) send no Origin and are unaffected. Pure logic, shared
 * by src/middleware.ts and unit-tested in tests/unit/origin.test.ts.
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Extract host[:port] from an Origin header value, or null if unparsable. */
export function originHost(origin: string): string | null {
  if (!origin || origin === 'null') return null
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

/**
 * Decide whether an API request may proceed.
 *  - Safe methods (GET/HEAD/OPTIONS) always allowed.
 *  - No Origin header: allowed (browsers always send it on cross-site
 *    fetch/XHR; its absence means a non-browser client that cannot be
 *    CSRF-forged).
 *  - Unparsable Origin (e.g. sandboxed `null`): rejected — cannot be verified.
 *  - Origin host must equal the request host (x-forwarded-host when the
 *    platform proxy provides it, otherwise Host).
 */
export function isAllowedApiMutation(
  method: string,
  originHeader: string | null,
  requestHost: string | null,
): boolean {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return true
  if (originHeader === null) return true
  const host = originHost(originHeader)
  if (!host || !requestHost) return false
  return host === requestHost
}
