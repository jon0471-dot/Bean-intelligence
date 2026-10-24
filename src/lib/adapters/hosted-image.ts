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

export const hostedImageAdapter: TaskAdapter = {
  backendId: BACKEND_ID,

  async health(): Promise<HealthReport> {
    // A real generation would cost ~60s on every health check; instead we
    // verify the gateway client initializes and report that honestly.
    const t0 = Date.now()
    try {
      await ZAI.create()
      return {
        healthy: true,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail:
          'Gateway client initialized. Full generation path verified at deployment probe (scripts/stage0-report.json).',
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
