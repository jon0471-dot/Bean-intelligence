/**
 * BEAN Intelligence — FREE gateway reachability probe (shared).
 *
 * CHAT-RECOVERY (2026-11-10): the LLM (chat-class) and research (functions
 * class) health probes previously burned REAL inference quota — 2 chat
 * completions + 1 web_search per fresh /api/health poll. The dashboard
 * refreshes health every 45s, so an open dashboard consumed ~3 provider
 * requests / poll ≈ 240/h against the account's 300/day budget, and the
 * 2-completions+1-search burst measurably tripped the provider's
 * authoritative 2-QPS limit (x-ratelimit-limit-qps: 2) on every refresh —
 * the observed 429 opened the chat-class breaker for 60s, so chat rendered
 * "rate-limited" while single spaced requests (measured 2026-11-10 02:19Z:
 * HTTP 200, 134/300 daily remaining) always succeeded. Health monitoring
 * was sustaining the very outage it reported.
 *
 * This module is the image/video adapters' reachability pattern extracted
 * for the LLM/research probes: a GET on the gateway's /models metadata path
 * — which the gateway answers from its router layer with HTTP 404 (measured
 * 2026-11-10) and WITHOUT rate-limit headers — proves the configured host
 * is up and answering without consuming any metered request. The probe
 * NEVER fires a completion or a search; combined with the real-attempt
 * evidence (last-attempts.ts) and the breaker state, the health payload
 * stays evidence-based while consuming ZERO inference quota.
 *
 * Redirect policy mirrors hosted-image/hosted-video: redirects are never
 * silently followed — a 3xx answer comes from whatever host the gateway
 * redirected to and must not count as "gateway healthy".
 */

export interface GatewayReachability {
  reachable: boolean
  status: number | null
  latencyMs: number
  error: string | null
  redirected: boolean
}

export async function probeGatewayReachability(
  baseUrl: string,
  apiKey: string,
  timeoutMs?: number,
  envTimeoutVar = 'BEAN_GATEWAY_PROBE_TIMEOUT_MS',
): Promise<GatewayReachability> {
  // Deadline policy (2026-11-04 connectivity audit, carried forward): the
  // reachability probe ALWAYS has a connection timeout — a hung gateway
  // resolves into an honest TIMEOUT outcome, never a pending probe.
  const raw = timeoutMs ?? Number(process.env[envTimeoutVar] ?? 5_000)
  const deadlineMs = Number.isFinite(raw) ? Math.min(15_000, Math.max(100, Math.round(raw))) : 5_000
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      redirect: 'manual',
    })
    // Drain the tiny body so the socket is released; never logged.
    await res.arrayBuffer().catch(() => undefined)
    const redirected = res.status >= 300 && res.status < 400
    return { reachable: true, status: res.status, latencyMs: Date.now() - t0, error: null, redirected }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      reachable: false,
      status: null,
      latencyMs: Date.now() - t0,
      error: aborted ? `no response within ${deadlineMs}ms` : e instanceof Error ? e.message : String(e),
      redirected: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Read the gateway client's runtime config (baseUrl/apiKey) in memory only. */
export function gatewayConfig(zai: unknown): { baseUrl: string | null; apiKey: string | null } {
  const cfg = (zai as { config?: { baseUrl?: string; apiKey?: string } }).config
  return { baseUrl: cfg?.baseUrl ?? null, apiKey: cfg?.apiKey ?? null }
}
