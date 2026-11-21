/**
 * BEAN Intelligence — per-product functional test suite endpoint.
 *
 * POST { product, action: 'run' }              → starts the suite for the
 *                                                caller's product workspace
 *                                                and returns the run.
 * POST { product, action: 'status', runId }    → refreshes async rows (job
 *                                                polling) and returns the run.
 *
 * Authenticated (own session only), owner-checked per run. The response
 * carries test names, states, classifications, results, errors, artifact
 * links and timestamps — never provider secrets or internal details.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { DIAG_PRODUCTS, getRun, refreshRun, startRun, type DiagProduct } from '@/lib/diagnostics/suites'

const schema = z.object({
  product: z.enum(['riishe', 'laxii', 'jazmii', 'code-giftz']),
  action: z.enum(['run', 'status']),
  runId: z.string().min(4).max(64).optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const product = body.product as DiagProduct
    if (!DIAG_PRODUCTS.includes(product)) {
      return ok({ error: 'unknown product' }, { status: 404 })
    }
    if (body.action === 'run') {
      // M26 (audit S-12): a diagnostics run fires REAL product jobs against
      // the caller's own workspace — previously unthrottled, so repeated
      // calls spawned unbounded concurrent suites. Bounded per user.
      const rl = checkRateLimit(`diag-run:${user.id}`, 3, 5 * 60_000)
      if (!rl.allowed) {
        throw new BeanApiError('RATE_LIMITED', `Too many diagnostic runs. Try again in ${rl.retryAfterSec}s.`)
      }
      const run = startRun(product, user.id, request.headers.get('cookie') ?? '')
      return ok({ run })
    }
    if (!body.runId) {
      return ok({ error: 'runId is required for the status action' }, { status: 400 })
    }
    const run = await refreshRun(user.id, body.runId)
    if (!run) return ok({ error: 'run not found (expired?)' }, { status: 404 })
    return ok({ run })
  })
}
