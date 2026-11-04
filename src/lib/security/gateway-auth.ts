/**
 * BEAN Intelligence — /api/v1 authentication resolution.
 *
 * Two principals may call the unified gateway:
 *  1. a BEAN session (cookie) — the product UI and signed-in users;
 *  2. an application API key (`Authorization: Bearer bgk_…`) — BEAN/BEAN
 *     product integrations, without ever touching provider credentials.
 *
 * Precedence: a valid Bearer header wins (machine clients do not carry
 * cookies); otherwise the session is consulted. Requests with neither
 * principal are UNAUTHENTICATED. API-key permission scopes are enforced by
 * the caller via assertScope with the returned grants.
 *
 * CSRF note: /api/v1 sits behind the same Origin-check middleware as every
 * /api route. Bearer-token callers send no Origin (non-browser clients) and
 * pass; browsers always attach Origin to unsafe methods and are subject to
 * the standard allowlist — a malicious page cannot abuse a leaked key from
 * its own origin, and the session cookie keeps its CSRF compensating control.
 */
import { BeanApiError } from '@/lib/api/errors'
import { getSessionUser } from '@/lib/auth/session'
import { verifyApiKey, assertScope, type ApiKeyAuth, type ApiKeyScope } from './api-keys'

export type GatewayPrincipal =
  | { kind: 'session'; userId: string; role: 'member' | 'admin'; admin: boolean }
  | ({ kind: 'api-key' } & Extract<ApiKeyAuth, { kind: 'api-key' }>)

const BEARER_RE = /^Bearer\s+(.+)$/i

export async function resolveGatewayPrincipal(request: Request): Promise<GatewayPrincipal | null> {
  const authHeader = request.headers.get('authorization')
  if (authHeader) {
    const m = BEARER_RE.exec(authHeader.trim())
    if (m) {
      // verifyApiKey returns the api-key variant already — no re-shaping.
      return await verifyApiKey(m[1])
    }
  }
  const user = await getSessionUser()
  if (!user) return null
  return { kind: 'session', userId: user.id, role: user.role, admin: user.role === 'admin' }
}

/**
 * Resolve + enforce: throws UNAUTHENTICATED when no principal is present.
 * `scope` applies to API-key principals only (sessions carry full user
 * rights; admin-gated endpoints use requireAdminPrincipal instead).
 */
export async function requireGatewayPrincipal(
  request: Request,
  scope?: ApiKeyScope,
): Promise<GatewayPrincipal> {
  const principal = await resolveGatewayPrincipal(request)
  if (!principal) {
    throw new BeanApiError('UNAUTHENTICATED', 'Sign in or present a valid application API key (Authorization: Bearer bgk_…).')
  }
  if (principal.kind === 'api-key' && scope) {
    assertScope(principal, scope)
  }
  return principal
}

/**
 * Admin-session gate for key and credential management: API keys can NEVER
 * manage keys or credentials (no scope grants that), only an authenticated
 * admin session may.
 */
export async function requireAdminPrincipal(request: Request): Promise<GatewayPrincipal & { kind: 'session' }> {
  const principal = await requireGatewayPrincipal(request)
  if (principal.kind !== 'session' || !principal.admin) {
    throw new BeanApiError('FORBIDDEN', 'This area is restricted to BEAN administrators using an authenticated session.')
  }
  return principal
}

/** Attribute gateway usage to the principal's user id (key owner or user). */
export function principalUserId(principal: GatewayPrincipal): string {
  return principal.userId
}
