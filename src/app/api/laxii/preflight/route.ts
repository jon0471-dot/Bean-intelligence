import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { localPreflight } from '@/lib/laxii/models'
import { providerSetting } from '@/lib/laxii/provider'

/**
 * LAXII — local hardware preflight (mission §9).
 *
 * Runs the REAL local checks and returns exactly what it measures:
 *  - localEngine: a real Sharp round-trip on this host;
 *  - generativeWorker.preflight: the Python worker's own measured report
 *    (missing packages, CUDA/VRAM, disk, checkpoints) — or the reason the
 *    worker could not start;
 *  - canRun: what is genuinely executable right now.
 * No result here is cached as success; a fresh preflight measures fresh.
 */
export async function GET() {
  return handle(async () => {
    await requireUser()
    const report = await localPreflight()
    return ok({
      preflight: report,
      providerSetting: providerSetting(),
      notes: [
        'canRun.generativeEditing requires the registry flag to be enabled in code after a recorded real inference test — a passing preflight alone never enables it.',
        'Do not download checkpoints on hosts that have not passed their own disk/VRAM preflight.',
      ],
    })
  })
}
