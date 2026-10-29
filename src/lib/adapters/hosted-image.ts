/**
 * BEAN Intelligence — authorized hosted image adapter (LAXII).
 *
 * Real integration confirmed by probe (scripts/stage0-report.json):
 * the gateway returns JPEG bytes (~60s latency observed). Both facts are
 * recorded here and surfaced truthfully to customers.
 */
import ZAI from 'z-ai-web-dev-sdk'
import type { HealthReport, ImageRequest, ImageResult, TaskAdapter } from './types'

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
 * design, and reports exactly one of four MEASURED states:
 *   - reachable            -> any HTTP response from the configured host
 *   - credentials-rejected -> HTTP 401/403 (reachable but misconfigured)
 *   - rate-limited         -> HTTP 429  (reachable but throttled)
 *   - unreachable          -> network error / timeout
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
  timeoutMs = 5_000,
): Promise<{ reachable: boolean; status: number | null; latencyMs: number; error: string | null }> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    // Drain the tiny body so the socket is released; never logged.
    await res.arrayBuffer().catch(() => undefined)
    return { reachable: true, status: res.status, latencyMs: Date.now() - t0, error: null }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      reachable: false,
      status: null,
      latencyMs: Date.now() - t0,
      error: aborted ? `no response within ${timeoutMs}ms` : e instanceof Error ? e.message : String(e),
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
          detail: `Image backend UNREACHABLE: the configured gateway host answered no request (${reach.error}). Client config is present, so this is a network/upstream problem, not a configuration gap.`,
        }
      }
      if (reach.status === 401 || reach.status === 403) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          detail: `Image backend misconfigured: gateway reachable (HTTP ${reach.status} in ${reach.latencyMs}ms) but it rejected the configured credentials. This needs an operator to fix the gateway configuration — retrying will not change it.`,
        }
      }
      if (reach.status === 429) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          detail: `Image backend rate-limited: gateway reachable (HTTP 429 in ${reach.latencyMs}ms) and currently throttling requests. This usually clears within a few minutes.`,
        }
      }
      return {
        healthy: true,
        checkedAt,
        latencyMs: reach.latencyMs,
        detail: `Gateway reachable (HTTP ${reach.status} in ${reach.latencyMs}ms) and client configured with ${SUPPORTED_SIZES.length} sizes. This health check does NOT run a generation; the full generation path was verified once at the deployment probe (scripts/stage0-report.json).`,
      }
    } catch (e) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: `Gateway init failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  },

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    if (!SUPPORTED_SIZE_SET.has(req.size)) {
      throw new Error(`Unsupported size ${req.size} for configured backend`)
    }
    // Runtime-validated above; the cast only mirrors the SDK's literal union.
    const size = req.size as SupportedSize
    const t0 = Date.now()
    const zai = await ZAI.create()
    const res = await zai.images.generations.create({
      prompt: req.prompt.slice(0, 4000),
      size,
    })
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
