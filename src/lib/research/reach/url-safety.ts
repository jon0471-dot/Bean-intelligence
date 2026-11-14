/**
 * BEAN Intelligence — shared research gateway: URL safety (SSRF guard).
 *
 * Every external URL fetched by the research gateway (Agent Reach targets,
 * Obscura navigations, direct-lane page fetches) passes this guard first:
 *   - http/https only, no userinfo, no whitespace/control characters;
 *   - literal IPs must be PUBLIC (IPv4 + IPv6, including IPv4-mapped,
 *     6to4/Teredo conservative handling);
 *   - metadata / localhost / internal-suffix hostnames are always blocked;
 *   - non-literal hostnames are resolved and EVERY resolved address must be
 *     public (DNS-rebinding safe at request time) unless DNS checks are
 *     disabled for hermetic unit tests (literal checks stay enforced);
 *   - redirects are followed MANUALLY and every hop is revalidated.
 *
 * Fail-closed: any validation error blocks the fetch. Reasons are safe for
 * client display (no internal paths, no stack traces).
 */

import { promises as dnsPromises } from 'node:dns'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'instance-data',
  'metadata',
])

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.localdomain']

export interface PublicUrlGuardOptions {
  /** Resolve non-literal hostnames (default true; tests may disable). */
  resolveDns?: boolean
}

export type UrlGuardResult =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: string }

// ---------------------------------------------------------------------------
// IP classification
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return true // unparseable → treat as private (fail-closed)
  const [a, b] = [Number(m[1]), Number(m[2])]
  if ([a, b, Number(m[3]), Number(m[4])].some((x) => x > 255)) return true
  if (a === 0 || a === 10 || a === 127) return true // unspecified, private, loopback
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (incl. metadata alias)
  if (a === 192 && b === 0) return true // 192.0.0.0/24 + 192.0.2.0/24 (doc)
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true // benchmark + doc
  if (a === 203 && b === 0) return true // doc
  if (a === 224 || a === 255 || a >= 240) return true // multicast / reserved
  return false
}

/** Expand an IPv6 address (incl. '::' and an embedded IPv4 tail) to 8 hextets, or null. */
function expandIPv6(raw: string): number[] | null {
  let addr = raw.toLowerCase()
  // Embedded IPv4 tail (::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::1.2.3.4).
  const v4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr)
  let v4Hextets: number[] | null = null
  if (v4) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4[1])
    if (!m) return null
    const parts = m.slice(1).map(Number)
    if (parts.some((x) => x > 255)) return null
    v4Hextets = [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]]
    addr = addr.slice(0, addr.length - v4[1].length)
    if (!addr.endsWith(':')) return null
    addr = addr.slice(0, -1)
  }
  const doubleColon = addr.split('::')
  if (doubleColon.length > 2) return null
  let head = doubleColon[0] === '' ? [] : doubleColon[0].split(':').filter(Boolean)
  let tail = doubleColon.length === 2 ? (doubleColon[1] === '' ? [] : doubleColon[1].split(':').filter(Boolean)) : []
  const parseHextet = (h: string): number | null => /^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : null
  const headNums = head.map(parseHextet)
  const tailNums = tail.map(parseHextet)
  if (headNums.some((n) => n === null) || tailNums.some((n) => n === null)) return null
  const missing = 8 - headNums.length - tailNums.length - (v4Hextets?.length ?? 0)
  if (doubleColon.length === 2) {
    if (missing < 0) return null
  } else if (missing !== 0) return null
  const zeros = doubleColon.length === 2 ? new Array<number>(Math.max(0, missing)).fill(0) : []
  const hextets = [...headNums, ...zeros, ...tailNums, ...(v4Hextets ?? [])] as number[]
  return hextets.length === 8 ? hextets : null
}

function isPrivateIPv6(raw: string): boolean {
  const hextets = expandIPv6(raw)
  if (!hextets) return true // unparseable → treat as private (fail-closed)
  const [h0, h1] = [hextets[0], hextets[1]]
  if (hextets.every((h) => h === 0)) return true // unspecified '::'
  if (hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0 && hextets[6] === 0 && hextets[7] === 1) return true // '::1'
  if (h0 === 0 && h1 === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0xffff) {
    // IPv4-mapped ::ffff:a.b.c.d → check the embedded IPv4.
    const v4 = `${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.${hextets[7] & 0xff}`
    return isPrivateIPv4(v4)
  }
  if ((h0 & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((h0 & 0xfe00) === 0xfc00) return true // unique-local fc00::/7
  if ((h0 & 0xff00) === 0xff00) return true // multicast ff00::/8
  if (h0 === 0x2001 && h1 === 0x0db8) return true // documentation
  if (h0 === 0x0100) return true // discard-only 100::/64
  if (h0 === 0x2002) return true // 6to4 — conservative block
  if (h0 === 0x2001 && h1 === 0x0000) return true // Teredo — conservative block
  if (h0 === 0x0064 && h1 === 0xff9b) return true // local-use NAT64 64:ff9b::/96
  if (h0 === 0x3fff) return true // documentation 3fff::/20
  return false
}

/** Best-effort global-IP check for literal addresses; false → block. */
function isPublicLiteralIp(host: string): boolean {
  if (host.includes(':')) return !isPrivateIPv6(host)
  return !isPrivateIPv4(host)
}

function looksLikeLiteralIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

// ---------------------------------------------------------------------------
// DNS resolution guard
// ---------------------------------------------------------------------------

interface ResolvedAddress {
  address: string
  family: number
}

type DnsResolver = (host: string) => Promise<ResolvedAddress[]> | ResolvedAddress[]

let testResolver: DnsResolver | null = null
/** Test seam — inject a resolver (null restores the default). */
export function setReachDnsResolverForTests(fn: DnsResolver | null): void {
  testResolver = fn
}

interface DnsCacheEntry {
  addresses: Array<{ address: string; family: number }>
  at: number
}

const DNS_CACHE = new Map<string, DnsCacheEntry>()
const DNS_CACHE_TTL_MS = 30_000
const DNS_CACHE_MAX = 256

function dnsChecksEnabled(): boolean {
  // Hermetic unit tests: bun sets NODE_ENV=test. Literal-address checks stay
  // enforced in every mode; only hostname RESOLUTION is skipped there.
  if (process.env.NODE_ENV === 'test' || process.env.BEAN_RESEARCH_URL_GUARD_DNS === '0') return false
  return true
}

async function resolveHost(host: string): Promise<Array<{ address: string; family: number }>> {
  if (!dnsChecksEnabled()) return []
  if (testResolver) return testResolver(host)
  const cached = DNS_CACHE.get(host)
  const now = Date.now()
  if (cached && now - cached.at < DNS_CACHE_TTL_MS) return cached.addresses
  const addresses = await dnsPromises.lookup(host, { all: true, verbatim: true })
  if (DNS_CACHE.size >= DNS_CACHE_MAX) DNS_CACHE.clear()
  DNS_CACHE.set(host, { addresses, at: now })
  return addresses
}

// ---------------------------------------------------------------------------
// Public guard
// ---------------------------------------------------------------------------

/**
 * Validate that a URL is a public http(s) URL. Synchronous literal checks
 * always run; hostname DNS validation runs unless disabled. Never throws.
 */
export async function assertPublicHttpUrl(
  raw: string,
  options: PublicUrlGuardOptions = {},
): Promise<UrlGuardResult> {
  const candidate = String(raw ?? '').trim()
  if (!candidate || candidate.length > 2048) return { ok: false, reason: 'invalid URL' }
  if (/[\s\u0000-\u001f\u007f]/.test(candidate) || candidate.includes('\\')) {
    return { ok: false, reason: 'invalid URL' }
  }
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  const scheme = parsed.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:') return { ok: false, reason: 'only http(s) URLs are allowed' }
  if (parsed.username || parsed.password) return { ok: false, reason: 'URL credentials are not allowed' }
  const host = (parsed.hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (!host) return { ok: false, reason: 'invalid URL' }
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'internal addresses are not allowed' }
  }
  if (looksLikeLiteralIp(host)) {
    if (!isPublicLiteralIp(host)) return { ok: false, reason: 'private or internal addresses are not allowed' }
    return { ok: true, url: parsed.toString(), host }
  }
  if (options.resolveDns !== false) {
    try {
      const addresses = await resolveHost(host)
      if (addresses.length === 0) return { ok: true, url: parsed.toString(), host }
      const bad = addresses.find((a) => (a.family === 6 ? isPrivateIPv6(a.address) : isPrivateIPv4(a.address)))
      if (bad) return { ok: false, reason: 'host resolves to a private or internal address' }
    } catch {
      // Fail-closed: an unresolvable host cannot be fetch-validated here.
      return { ok: false, reason: 'host could not be resolved' }
    }
  }
  return { ok: true, url: parsed.toString(), host }
}

/**
 * Synchronous variant (literal + hostname checks only, no DNS resolution).
 * Used where async validation is impossible (argv construction, evidence
 * normalization); any actual network I/O still goes through the async guard
 * or the manual-redirect fetch, which revalidates fully.
 */
export function assertPublicHttpUrlSync(raw: string): UrlGuardResult {
  const candidate = String(raw ?? '').trim()
  if (!candidate || candidate.length > 2048) return { ok: false, reason: 'invalid URL' }
  if (/[\s\u0000-\u001f\u007f]/.test(candidate) || candidate.includes('\\')) {
    return { ok: false, reason: 'invalid URL' }
  }
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  const scheme = parsed.protocol.toLowerCase()
  if (scheme !== 'http:' && scheme !== 'https:') return { ok: false, reason: 'only http(s) URLs are allowed' }
  if (parsed.username || parsed.password) return { ok: false, reason: 'URL credentials are not allowed' }
  const host = (parsed.hostname || '').toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (!host) return { ok: false, reason: 'invalid URL' }
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'internal addresses are not allowed' }
  }
  if (looksLikeLiteralIp(host) && !isPublicLiteralIp(host)) {
    return { ok: false, reason: 'private or internal addresses are not allowed' }
  }
  return { ok: true, url: parsed.toString(), host }
}

export interface GuardedFetchResult {
  res: Response
  finalUrl: string
  hops: number
}

const MAX_REDIRECT_HOPS = 3

/**
 * Fetch a public URL with MANUAL redirect handling — every redirect hop is
 * revalidated by the guard before the next request (redirect-SSRF safe).
 * Throws an Error with a client-safe message on any guard or network failure.
 */
export async function guardedFetch(
  rawUrl: string,
  init: { timeoutMs: number; headers?: Record<string, string>; method?: 'GET' },
): Promise<GuardedFetchResult> {
  let current = await assertPublicHttpUrl(rawUrl)
  if (!current.ok) throw new Error(current.reason)
  let hops = 0
  for (;;) {
    let res: Response
    try {
      res = await fetch(current.url, {
        method: init.method ?? 'GET',
        headers: init.headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(init.timeoutMs),
      })
    } catch (e) {
      throw new Error(`fetch failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`)
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      // Drain the body so the socket is released before the next hop.
      void res.body?.cancel().catch(() => {})
      if (!location) throw new Error('redirect without a destination')
      if (hops >= MAX_REDIRECT_HOPS) throw new Error('too many redirects')
      let next: URL
      try {
        next = new URL(location, current.url)
      } catch {
        throw new Error('invalid redirect destination')
      }
      const validated = await assertPublicHttpUrl(next.toString())
      if (!validated.ok) throw new Error(`redirect blocked: ${validated.reason}`)
      current = { ok: true, url: validated.url, host: validated.host }
      hops += 1
      continue
    }
    return { res, finalUrl: current.url, hops }
  }
}

/** Test seam — clear the DNS cache between tests. */
export function clearReachDnsCacheForTests(): void {
  DNS_CACHE.clear()
}
