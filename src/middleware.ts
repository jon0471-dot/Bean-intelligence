/**
 * BEAN Intelligence — API edge middleware.
 *
 * Single choke point in front of every /api route: rejects cross-site
 * state-changing requests (CSRF compensating control for the
 * SameSite=None session cookie — see src/lib/api/origin.ts for the full
 * trusted-origin policy and why Host comparison is not used).
 *
 * Rejections are logged with the offending site origin (an origin is not a
 * secret — no cookies, tokens or credentials are ever logged here).
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkApiMutationOrigin } from '@/lib/api/origin'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const REQUEST_ID_HEADER = 'x-bean-request-id'

/**
 * M26 (audit O-1): EVERY /api request gets a correlation id — generated
 * here when absent, forwarded downstream so `handle()` can attach it to
 * every structured log line, and echoed on the response so an operator can
 * join an HTTP outcome to its server-side log evidence.
 */
function withRequestId(req: NextRequest): string {
  const existing = req.headers.get(REQUEST_ID_HEADER)
  if (existing && /^[A-Za-z0-9._-]{8,64}$/.test(existing)) return existing
  return crypto.randomUUID()
}

export function middleware(req: NextRequest) {
  const requestId = withRequestId(req)
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set(REQUEST_ID_HEADER, requestId)

  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    const res = NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set(REQUEST_ID_HEADER, requestId)
    return res
  }

  const originHeader = req.headers.get('origin')
  const secFetchSite = req.headers.get('sec-fetch-site')
  const decision = checkApiMutationOrigin(originHeader, secFetchSite)
  if (decision.allowed) {
    const res = NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set(REQUEST_ID_HEADER, requestId)
    return res
  }

  console.warn(
    `[bean:csrf] rejected ${req.method} ${req.nextUrl.pathname} reason=${decision.rejection} origin=${
      originHeader ?? '<none>'
    } sec-fetch-site=${secFetchSite ?? '<none>'}`,
  )
  const res = NextResponse.json(
    {
      ok: false as const,
      error: {
        code: 'FORBIDDEN',
        message: 'Cross-site request rejected. Use the BEAN application directly.',
      },
    },
    { status: 403 },
  )
  res.headers.set(REQUEST_ID_HEADER, requestId)
  return res
}

export const config = {
  matcher: ['/api/:path*'],
}
