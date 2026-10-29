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

export function middleware(req: NextRequest) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return NextResponse.next()

  const originHeader = req.headers.get('origin')
  const secFetchSite = req.headers.get('sec-fetch-site')
  const decision = checkApiMutationOrigin(originHeader, secFetchSite)
  if (decision.allowed) return NextResponse.next()

  console.warn(
    `[bean:csrf] rejected ${req.method} ${req.nextUrl.pathname} reason=${decision.rejection} origin=${
      originHeader ?? '<none>'
    } sec-fetch-site=${secFetchSite ?? '<none>'}`,
  )
  return NextResponse.json(
    {
      ok: false as const,
      error: {
        code: 'FORBIDDEN',
        message: 'Cross-site request rejected. Use the BEAN application directly.',
      },
    },
    { status: 403 },
  )
}

export const config = {
  matcher: ['/api/:path*'],
}
