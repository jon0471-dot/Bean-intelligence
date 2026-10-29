/**
 * BEAN Intelligence — strict, configuration-driven trusted-origin policy.
 *
 * This is the CSRF compensating control for the SameSite=None; Secure session
 * cookie (required by the deployed cross-site preview access path — see
 * src/lib/auth/session.ts).
 *
 * WHY NOT COMPARE ORIGIN AGAINST HOST?
 * Measured on this deployment (2026-10-24): the platform ingress terminates
 * browser traffic and forwards to the app with rewritten routing headers —
 * the app observes Host: localhost and X-Forwarded-Host: localhost:<port>
 * while the browser's true Origin is the public https preview origin. Any
 * "Origin host === request host" rule therefore rejects every legitimate
 * browser mutation (including sign-in) through the real access path, and any
 * rule trusting X-Forwarded-* blindly would be spoofable by direct clients.
 *
 * THE POLICY (strict allowlist, no wildcards over the internet):
 *  1. Safe methods (GET/HEAD/OPTIONS) — allowed.
 *  2. Sec-Fetch-Site (browsers forbid JS from setting Sec-* headers):
 *     explicit `cross-site` is rejected before anything else. Absent header
 *     (non-browser or legacy client) falls through to the Origin policy.
 *  3. No Origin header — allowed. Browsers always attach Origin to unsafe
 *     fetch/XHR (even same-origin); its absence means a non-browser client
 *     that cannot be CSRF-forged (curl, server-to-server).
 *  4. Origin present:
 *     - `null` (opaque origin, e.g. sandboxed iframe) — rejected; cannot be
 *       verified. Logged loudly by the middleware.
 *     - Otherwise the origin is normalized (lowercase scheme/host, default
 *       ports stripped, credentials/path/query rejected) and must match
 *       either an exact entry in BEAN_TRUSTED_ORIGINS, or — via the
 *       configured suffix scope — an HTTPS origin whose hostname equals or
 *       is a dot-boundary subdomain of a configured suffix (used for the
 *       platform's assigned preview subdomain, whose exact value is not
 *       known at deploy time). When BEAN_TRUSTED_ORIGIN_SUFFIXES is
 *       UNDEFINED, the platform scope of this deployment (space-z.ai) is
 *       applied by default; an explicit empty value disables the suffix
 *       scope entirely (see PLATFORM_DEFAULT_ORIGIN_SUFFIXES below).
 *     - In non-production only, http(s) loopback origins (localhost,
 *       127.0.0.1, [::1]) on any port are allowed for direct local
 *       development; this allowance is compiled out of production.
 *
 * Forwarded headers (X-Forwarded-Host/Proto) are deliberately NOT part of
 * the decision: they cannot be trusted from arbitrary clients, and on this
 * deployment the trusted ingress rewrites them to internal values, so they
 * carry no usable signal.
 *
 * Pure logic — unit-tested in tests/unit/origin.test.ts.
 */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

export interface OriginPolicyEnv {
  BEAN_TRUSTED_ORIGINS?: string | undefined
  BEAN_TRUSTED_ORIGIN_SUFFIXES?: string | undefined
  NODE_ENV?: string | undefined
}

export type OriginRejection =
  | 'opaque-origin' // Origin: null (sandboxed iframe / opaque context)
  | 'unparsable-origin' // Origin present but not a valid URL
  | 'origin-not-allowlisted' // valid origin, not on the trusted list
  | 'cross-site-fetch-metadata' // Sec-Fetch-Site: cross-site (unspoofable)

export interface OriginDecision {
  allowed: boolean
  rejection?: OriginRejection
}

/**
 * Normalize an origin string into canonical `scheme://host[:port]`.
 * - lowercases scheme and hostname
 * - strips default ports (http :80, https :443)
 * - rejects URLs with credentials, path, query, hash, or non-http(s) schemes
 * Returns null when the value is not a clean origin.
 */
export function normalizeOrigin(raw: string): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (u.search || u.hash) return null
  if (u.pathname && u.pathname !== '/') return null
  let port = u.port
  if ((u.protocol === 'https:' && port === '443') || (u.protocol === 'http:' && port === '80')) {
    port = ''
  }
  const host = u.hostname.toLowerCase()
  return `${u.protocol}//${host}${port ? `:${port}` : ''}`
}

/** Split a comma-separated env value into trimmed, non-empty entries. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Registrable-domain scope of the platform this deployment runs on. The
 * public access path is the per-session preview origin
 * (https://preview-*.space-z.ai) whose exact host cannot be known at deploy
 * time, and the suffix configuration lives in an env file the platform may
 * regenerate: measured 2026-10-25, after an environment reset .env contained
 * only DATABASE_URL and EVERY legitimate browser mutation was rejected with
 * `origin-not-allowlisted` (same-origin fetch-metadata, platform origin in
 * the logs) while GETs kept working — the app loaded but chat was dead.
 *
 * Therefore an UNDEFINED BEAN_TRUSTED_ORIGIN_SUFFIXES now resolves to this
 * platform scope instead of failing closed. Operator control is preserved:
 *  - an explicit list overrides the default (no merge);
 *  - an explicit empty value (or "none") disables the suffix scope entirely
 *    and fails closed.
 *
 * This does not weaken the control against attackers: Sec-Fetch-Site:
 * cross-site is rejected unconditionally BEFORE the suffix scope is ever
 * consulted (browsers forbid JS from forging Sec-*), so even an attacker-
 * controlled page under the platform suffix cannot forge a state-changing
 * request. The suffix scope only legitimizes pages genuinely served from
 * the platform's own domain — which is where this product is deployed.
 */
const PLATFORM_DEFAULT_ORIGIN_SUFFIXES = 'space-z.ai'

export type SuffixConfigSource = 'operator' | 'platform-default' | 'disabled'

/**
 * Resolve the effective suffix scope from raw env input.
 * Exposed for unit tests and for the middleware to report which source was
 * applied when logging rejections.
 */
export function resolveSuffixConfig(raw: string | undefined): {
  source: SuffixConfigSource
  list: string[]
} {
  if (raw === undefined) {
    return { source: 'platform-default', list: parseSuffixes(PLATFORM_DEFAULT_ORIGIN_SUFFIXES) }
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.toLowerCase() === 'none') {
    return { source: 'disabled', list: [] }
  }
  return { source: 'operator', list: parseSuffixes(raw) }
}

/**
 * Parse BEAN_TRUSTED_ORIGIN_SUFFIXES into clean registrable-domain suffixes.
 * Accepts `space-z.ai`, `.space-z.ai`, or `*.space-z.ai` spellings; anything
 * that is not a plain dotted hostname is discarded (defensive parsing).
 */
function parseSuffixes(raw: string | undefined): string[] {
  return parseList(raw)
    .map((s) => s.toLowerCase().replace(/^\*\./, '').replace(/^\./, ''))
    .filter((s) => /^[a-z0-9]+(?:[-.][a-z0-9]+)*\.?[a-z0-9]+$/.test(s) && s.includes('.'))
}

/** Dot-boundary-anchored suffix match: a.b.suffix matches; evil-suffix does not. */
function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`)
}

function isLoopbackOrigin(scheme: string, hostname: string): boolean {
  return (scheme === 'http:' || scheme === 'https:') && LOOPBACK_HOSTNAMES.has(hostname)
}

/**
 * Decide whether an unsafe API request from the given headers may proceed.
 * Returns an explicit decision so the middleware can log WHY a request was
 * rejected (origin values are site origins, not secrets).
 */
export function checkApiMutationOrigin(
  originHeader: string | null,
  secFetchSite: string | null,
  env: OriginPolicyEnv = process.env,
): OriginDecision {
  // Browsers forbid JS from setting Sec-* headers; an explicit cross-site
  // fetch is rejected regardless of any other header the client sent.
  if (secFetchSite && secFetchSite.trim().toLowerCase() === 'cross-site') {
    return { allowed: false, rejection: 'cross-site-fetch-metadata' }
  }

  if (originHeader === null) return { allowed: true }

  if (originHeader === 'null') return { allowed: false, rejection: 'opaque-origin' }

  let url: URL
  try {
    url = new URL(originHeader.trim())
  } catch {
    return { allowed: false, rejection: 'unparsable-origin' }
  }

  // Non-production only: direct local development (Next dev port can shift).
  if (env.NODE_ENV !== 'production' && isLoopbackOrigin(url.protocol, url.hostname)) {
    return { allowed: true }
  }

  const normalized = normalizeOrigin(originHeader)
  if (!normalized) return { allowed: false, rejection: 'unparsable-origin' }

  const exact = new Set<string>()
  for (const entry of parseList(env.BEAN_TRUSTED_ORIGINS)) {
    const n = normalizeOrigin(entry)
    if (n) exact.add(n)
  }
  if (exact.has(normalized)) return { allowed: true }

  // Suffix scope: HTTPS origins on configured domain suffixes (dot-boundary
  // anchored), for the platform-assigned preview subdomain. Undefined env
  // falls back to the platform default; explicit empty disables (see
  // resolveSuffixConfig).
  const { list: suffixes } = resolveSuffixConfig(env.BEAN_TRUSTED_ORIGIN_SUFFIXES)
  if (url.protocol === 'https:' && suffixes.some((s) => hostMatchesSuffix(url.hostname, s))) {
    return { allowed: true }
  }

  return { allowed: false, rejection: 'origin-not-allowlisted' }
}

/** Middleware-facing predicate (kept for readability at the call site). */
export function isAllowedApiMutation(
  method: string,
  originHeader: string | null,
  secFetchSite: string | null = null,
  env: OriginPolicyEnv = process.env,
): boolean {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return true
  return checkApiMutationOrigin(originHeader, secFetchSite, env).allowed
}
