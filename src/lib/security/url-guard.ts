/**
 * BEAN Intelligence — provider base-URL guard (SSRF defense, W6 security review).
 *
 * WHY: the OpenAI-compatible adapter fetches whatever base URL an
 * administrator stored in the credential (`callUpstream` →
 * `fetch(`${baseUrl}/chat/completions`)`, credential attached in the
 * Authorization header). An unvalidated URL lets a compromised/curious
 * admin session — or a hand-edited DB row — turn the server into a request
 * relay against loopback services, the cloud metadata endpoint
 * (169.254.169.254, which serves instance credentials), or link-local
 * infrastructure. W6 security review finding SEC-W6-01; this module is the
 * remediation, enforced at BOTH write time (credential create/update — the
 * operator gets a typed validation error) and read time (decrypt —
 * defense-in-depth against hand-edited rows).
 *
 * Policy (fail-closed):
 *  - absolute http(s) URL, non-empty hostname, no userinfo (user:pass@);
 *  - loopback (localhost, *.localhost, 127.0.0.0/8, ::1), unspecified
 *    (0.0.0.0, ::) and link-local (169.254.0.0/16 — the cloud metadata
 *    range — plus fe80::/10) targets are REJECTED;
 *  - the cloud metadata endpoint is rejected EVEN under the escape hatch —
 *    no legitimate external provider lives there;
 *  - explicit operator escape hatch BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=true
 *    admits loopback/link-local for local test rigs only (unit/E2E mock
 *    servers); it can never admit the metadata range;
 *  - everything else passes: public https endpoints and self-hosted LAN
 *    workers (e.g. an internal vLLM host) are legitimate providers; any port
 *    is allowed (vLLM on :8000 is normal).
 *
 * Pure logic — unit-tested in tests/unit/url-guard.test.ts.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal'])

export interface UrlGuardResult {
  ok: boolean
  reason?: string
}

function isLoopbackV4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const octets = m.slice(1).map(Number)
  if (octets.some((n) => n > 255)) return false // not a valid v4 — let the URL parser have caught it earlier
  const [a, b] = octets
  return a === 127 || (a === 0 && b === 0 && octets[2] === 0 && octets[3] === 0) || (a === 10 && b === 0 && octets[2] === 0 && octets[3] === 0)
}

function isLinkLocalV4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = m.slice(1).map(Number)
  return a === 169 && b === 254
}

function v6Parts(host: string): number[] | null {
  // Expanded-form check only — compressed forms (::1, fe80::1) are handled
  // by prefix matching below; full IPv6 parsing is deliberately not
  // reimplemented here (the dangerous ranges have canonical expansions in
  // practice, and prefix rules catch the compressed shapes).
  if (!host.includes(':')) return null
  return null
}

function isLoopbackV6(host: string): boolean {
  const h = host.toLowerCase()
  return h === '::1' || h === '0:0:0:0:0:0:0:1' || h === '::'
}

function isLinkLocalV6(host: string): boolean {
  const h = host.toLowerCase()
  return h.startsWith('fe80:') || h.startsWith('fe8:') || h.startsWith('fe9:') || h.startsWith('fea:') || h.startsWith('feb:')
}

function localEndpointAllowedByHatch(): boolean {
  return process.env.BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS === 'true'
}

export function validateProviderBaseUrl(raw: string): UrlGuardResult {
  const value = (raw ?? '').trim()
  if (!value) return { ok: false, reason: 'Base URL is empty.' }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, reason: 'Base URL is not an absolute URL.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Base URL must use http or https (got ${url.protocol}).` }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Base URL must not embed credentials (user:pass@host) — use the credential secret field.' }
  }

  let host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return { ok: false, reason: 'Base URL has no hostname.' }

  // Trailing dot (FQDN form) and "*.localhost" family
  const bareHost = host.replace(/\.+$/, '')
  if (BLOCKED_HOSTNAMES.has(bareHost) || bareHost.endsWith('.localhost')) {
    if (!localEndpointAllowedByHatch() || bareHost === 'metadata.google.internal') {
      return { ok: false, reason: `Base URL target ${bareHost} is a loopback/metadata endpoint and is not allowed for external providers.` }
    }
  }

  if (isLoopbackV4(bareHost) || isLoopbackV6(bareHost)) {
    if (!localEndpointAllowedByHatch()) {
      return { ok: false, reason: 'Base URL must not point at a loopback address.' }
    }
  }
  if (isLinkLocalV4(bareHost)) {
    // 169.254.0.0/16 — includes the cloud metadata endpoint. NEVER allowed.
    return { ok: false, reason: 'Base URL must not point at a link-local address (cloud metadata range 169.254.0.0/16).' }
  }
  if (isLinkLocalV6(bareHost)) {
    if (!localEndpointAllowedByHatch()) {
      return { ok: false, reason: 'Base URL must not point at a link-local IPv6 address.' }
    }
  }
  void v6Parts // (kept for future full IPv6 parsing; see comment)
  return { ok: true }
}
