/**
 * BEAN Intelligence — API edge middleware.
 *
 * Single choke point in front of every /api route: rejects cross-site
 * state-changing requests (CSRF compensating control for the
 * SameSite=None session cookie — see src/lib/api/origin.ts).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAllowedApiMutation } from '@/lib/api/origin'

export function middleware(req: NextRequest) {
  const host =
    req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!isAllowedApiMutation(req.method, req.headers.get('origin'), host)) {
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
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
