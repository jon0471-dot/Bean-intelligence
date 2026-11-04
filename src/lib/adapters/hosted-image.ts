/**
 * BEAN Intelligence — authorized hosted image adapter (LAXII).
 *
 * Real integration confirmed by probe (scripts/stage0-report.json):
 * the gateway returns JPEG bytes (~60s latency observed). Both facts are
 * recorded here and surfaced truthfully to customers.
 */
import ZAI from 'z-ai-web-dev-sdk'
import type { HealthFailureCategory, HealthReport, ImageRequest, ImageResult, TaskAdapter } from './types'
import {
  noteUpstream429,
  noteUpstreamSkip,
  noteUpstreamSuccess,
  upstreamCoolingDown,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'

const BACKEND_ID = 'bean-image-hosted-primary'
/** Exactly the size literals the gateway SDK accepts. */
const SUPPORTED_SIZES = [
  '1024x1024',
  '768x1344',
  '864x1152',
  '1344x768',
  '1152x864',
  '1440x720',
  '720x1440',
] as const
type SupportedSize = (typeof SUPPORTED_SIZES)[number]
const SUPPORTED_SIZE_SET = new Set<string>(SUPPORTED_SIZES)

/**
 * MEASURED CHANGE (2026-10-29 product-availability audit): ZAI.create() is
 * pure local work — it reads /etc/.z-ai-config (or cwd/home equivalents) and
 * constructs a client. It performs ZERO network I/O, so the previous
 * "Gateway client initialized" health report (observed live at 7ms while the
 * same gateway was rejecting chat completions with HTTP 429) proved only that
 * a config file exists — it said nothing about the image backend being
 * REACHABLE.
 *
 * This probe adds a measured, read-only reachability check: a GET on the
 * configured gateway's OpenAI-style metadata route (`GET {baseUrl}/models`)
 * with the tenant's own credentials. It never triggers a generation (GET on a
 * metadata route; the images endpoint is a POST), consumes no image quota by
 * design, and reports exactly one of five MEASURED states:
 *   - reachable            -> an HTTP answer from the configured host that
 *                             this probe treats as verified (2xx, or 404 =
 *                             metadata route absent but host answered)
 *   - credentials-rejected -> HTTP 401/403 (reachable but misconfigured)
 *   - rate-limited         -> HTTP 429  (reachable but throttled)
 *   - redirected           -> HTTP 3xx. MEASURED CHANGE (2026-11-04
 *                             connectivity audit): the probe now sets
 *                             `redirect: 'manual'` — a redirect is answered
 *                             by WHOEVER the gateway points at, so it is
 *                             never treated as a verified gateway response.
 *                             The redirect is reported deliberately (with
 *                             its status; the target URL is intentionally
 *                             NOT surfaced — it may point somewhere
 *                             internal) and the probe is NOT healthy.
 *   - unreachable          -> network error / timeout / 5xx from the host
 * Honesty boundary: reaching the gateway is NOT proof that image generation
 * works — a real generation costs ~60s and is never run here. The full
 * generation path was verified once at the deployment probe
 * (scripts/stage0-report.json) and the report below says exactly that,
 * every time, so no reader can mistake this health check for a generation
 * capability test.
 */
async function probeGatewayReachability(
  baseUrl: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<{
  reachable: boolean
  status: number | null
  latencyMs: number
  error: string | null
  redirected: boolean
}> {
  // Deadline policy (2026-11-04 connectivity audit): the reachability probe
  // ALWAYS has a connection timeout — an operator may tune it via
  // BEAN_IMAGE_PROBE_TIMEOUT_MS (bounded 100ms..15s; default 5s). A hung
  // gateway resolves into an honest TIMEOUT outcome, never a pending probe.
  const raw = timeoutMs ?? Number(process.env.BEAN_IMAGE_PROBE_TIMEOUT_MS ?? 5_000)
  const deadlineMs = Number.isFinite(raw) ? Math.min(15_000, Math.max(100, Math.round(raw))) : 5_000
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      // Deliberate redirect policy (2026-11-04 audit): redirects are NEVER
      // silently followed — a 3xx answer comes from whatever host the
      // gateway redirects to, and treating it as "gateway healthy" would
      // mistake a redirect for a successful health check.
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

export const hostedImageAdapter: TaskAdapter = {
  backendId: BACKEND_ID,

  async health(): Promise<HealthReport> {
    // Two measured facts, kept strictly separate in the report:
    //  1. CONFIGURED  — a gateway client can be constructed from real config
    //     (credentials + baseUrl present). Local file work only.
    //  2. REACHABLE   — the configured gateway host actually answered a
    //     read-only metadata request (measured status + latency below).
    // A real generation would cost ~60s per health check and is NOT run here;
    // the detail always states that generation capability comes from the
    // deployment probe, never from this health check.
    const t0 = Date.now()
    try {
      const zai = await ZAI.create()
      // The SDK keeps its loaded config private in its typings but the value
      // is a plain runtime property; this cast reads baseUrl/apiKey ONLY,
      // in memory, for the tenant's own configured endpoint. Neither value
      // is ever logged or included in the report.
      const cfg = (zai as unknown as { config?: { baseUrl?: string; apiKey?: string } }).config
      const baseUrl = cfg?.baseUrl
      const apiKey = cfg?.apiKey
      const checkedAt = new Date().toISOString()
      if (!baseUrl || !apiKey) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: Date.now() - t0,
          httpStatus: null,
          failureCategory: 'misconfigured',
          detail:
            'Misconfigured: gateway client initialized but its config is missing baseUrl/apiKey, so the image endpoint cannot be reached. Check the gateway configuration file.',
        }
      }
      const reach = await probeGatewayReachability(baseUrl, apiKey)
      if (!reach.reachable) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: null,
          // An aborted fetch (no answer within the timeout) is a TIMEOUT —
          // a different honest category from a refusal/reset (network).
          failureCategory: reach.error?.startsWith('no response within') ? 'timeout' : 'unreachable',
          detail: `Image backend UNREACHABLE: the configured gateway host answered no request (${reach.error}). Client config is present, so this is a network/upstream problem, not a configuration gap.`,
        }
      }
      if (reach.redirected) {
        // Deliberate redirect handling (2026-11-04 audit): the redirecting
        // answer did NOT come from the configured gateway's health surface.
        // Report it; never follow it silently; never count it as healthy.
        // The Location target is intentionally omitted from the report — it
        // may disclose internal infrastructure.
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'redirected',
          detail: `Image backend health NOT verified: the gateway host answered the probe with an HTTP ${reach.status} redirect. Redirects are never followed or treated as a successful health check — the configured endpoint must answer for itself.`,
        }
      }
      if (reach.status === 401 || reach.status === 403) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'auth',
          detail: `Image backend misconfigured: gateway reachable (HTTP ${reach.status} in ${reach.latencyMs}ms) but it rejected the configured credentials. This needs an operator to fix the gateway configuration — retrying will not change it.`,
        }
      }
      if (reach.status === 429) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'rate-limited',
          detail: `Image backend rate-limited: gateway reachable (HTTP 429 in ${reach.latencyMs}ms) and currently throttling requests. This usually clears within a few minutes.`,
        }
      }
      if (reach.status === null || reach.status >= 500) {
        // A 5xx answer is the gateway FAILING, not the gateway working —
        // the previous code treated any non-401/403/429 status as healthy,
        // which would have reported a 500-ing backend as operational.
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'backend-error',
          detail: `Image backend unhealthy: gateway host answered (HTTP ${reach.status} in ${reach.latencyMs}ms) but that is a server-side failure, not a verified health response.`,
        }
      }
      if (reach.status !== 404 && (reach.status < 200 || reach.status > 299)) {
        // Any other non-2xx answer (400/405/410/...): the host answered, but
        // this probe cannot verify health from it. 404 stays healthy below —
        // it is the MEASURED normal case for this gateway (the metadata
        // route is absent; the host itself is up).
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: reach.status,
          failureCategory: 'backend-error',
          detail: `Image backend health NOT verified: gateway host answered with an unexpected HTTP ${reach.status} in ${reach.latencyMs}ms. Only a 2xx (or the known-absent metadata route, HTTP 404) counts as verified.`,
        }
      }
      return {
        healthy: true,
        checkedAt,
        latencyMs: reach.latencyMs,
        httpStatus: reach.status,
        failureCategory: null,
        detail: `Gateway reachable (HTTP ${reach.status} in ${reach.latencyMs}ms) and client configured with ${SUPPORTED_SIZES.length} sizes. This health check does NOT run a generation; the full generation path was verified once at the deployment probe (scripts/stage0-report.json).`,
      }
    } catch (e) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: null,
        failureCategory: 'backend-error',
        detail: `Gateway init failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    if (!SUPPORTED_SIZE_SET.has(req.size)) {
      throw new Error(`Unsupported size ${req.size} for configured backend`)
    }
    // PHASE 1 gateway recovery (2026-11-04): image generations ride the same
    // account as chat/functions and were measured 429ing while the cheap
    // reachability probe passed. The images endpoint class now carries its
    // own 429 breaker: while it is open, generation requests fail fast with
    // the honest typed error and ZERO network traffic — one bounded probe
    // per cooldown window instead of a retry storm into an account-wide
    // throttle. The queue worker surfaces this as the rate-limited class.
    if (upstreamCoolingDown('images')) {
      noteUpstreamSkip('images')
      throw new UpstreamRateLimitError(
        'images',
        'image generation not attempted: the upstream gateway is rate-limited (HTTP 429 observed moments ago); ' +
          'request skipped to avoid worsening the throttle',
        false,
      )
    }
    // Runtime-validated above; the cast only mirrors the SDK's literal union.
    const size = req.size as SupportedSize
    const t0 = Date.now()
    const zai = await ZAI.create()
    let res
    try {
      res = await zai.images.generations.create({
        prompt: req.prompt.slice(0, 4000),
        size,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/\bstatus\s+429\b|\bHTTP\s+429\b/.test(message)) {
        noteUpstream429('images')
        throw new UpstreamRateLimitError(
          'images',
          `image generation is rate-limited upstream (HTTP 429): ${message.slice(0, 200)}`,
        )
      }
      throw e
    }
    noteUpstreamSuccess('images')
    const b64 = res.data?.[0]?.base64
    if (!b64) throw new Error('Upstream returned no image payload')
    const bytes = Buffer.from(b64, 'base64')
    // Validate the magic bytes — never accept an empty/unknown payload.
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
    if (!isJpeg) throw new Error('Upstream payload was not a valid image')
    const [w, h] = req.size.split('x').map((n) => parseInt(n, 10))
    return { bytes, width: w, height: h, format: 'jpeg', durationMs: Date.now() - t0 }
  },
}
