/**
 * BEAN Intelligence — session management (packages/authentication).
 * Opaque session tokens in httpOnly, sameSite=lax cookies. Server-side
 * authorization helpers enforce role checks for every privileged route.
 */
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'bean_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: 'member' | 'admin'
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.session.create({ data: { userId, token, expiresAt } })
  const jar = await cookies()
  // SameSite=None + Secure is REQUIRED for the deployed access path: the
  // platform preview embeds this app in a cross-site iframe, and browsers do
  // not attach SameSite=Lax cookies to cross-site subresource/fetch requests.
  // With Lax, register/login succeeded server-side while every subsequent
  // API request arrived without a cookie (401) — observed as repeated
  // successful logins followed immediately by 401s. Browsers honor
  // SameSite=None only with Secure; http://localhost is a trustworthy origin
  // and still accepts Secure cookies for direct local development.
  // Cross-site CSRF risk reintroduced by None is compensated by the Origin
  // check in src/middleware.ts (all unsafe /api methods).
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
    expires: expiresAt,
  })
  return token
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role === 'admin' ? 'admin' : 'member',
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) {
    const { BeanApiError } = await import('@/lib/api/errors')
    throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
  }
  return user
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'admin') {
    const { BeanApiError } = await import('@/lib/api/errors')
    throw new BeanApiError('FORBIDDEN', 'This area is restricted to BEAN administrators.')
  }
  return user
}

export async function destroySession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) {
    await db.session.deleteMany({ where: { token } })
  }
  jar.delete(SESSION_COOKIE)
}
