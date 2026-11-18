import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import {
  allLocalModelStates,
  localModelState,
  installLocalModel,
  cancelLocalModelInstall,
  LOCAL_MODELS,
} from '@/lib/media/local-models'

/**
 * Local inference model management (M26.2) — honest install states for the
 * server-side ONNX models (matting / inpainting / frame interpolation).
 * GET lists real on-disk states; POST installs EXPLICITLY (download +
 * SHA-256 verify); DELETE cancels an in-flight download. No model is ever
 * reported installed unless the verified artifact is on disk.
 */
export async function GET() {
  return handle(async () => {
    await requireUser()
    return ok({ models: allLocalModelStates() })
  })
}

const installSchema = z.object({ id: z.enum(['modnet', 'lama', 'rife', 'u2netp']) })

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    if (user.role !== 'admin') {
      // Model installation changes host state — admin-gated, like the
      // provider registry. Users see states; operators install.
      throw new BeanApiError('FORBIDDEN', 'Model installation requires an operator (admin) account.')
    }
    const body = await parseBody(request, installSchema)
    const state = await installLocalModel(body.id)
    return ok({ model: state })
  })
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    if (user.role !== 'admin') throw new BeanApiError('FORBIDDEN', 'Model management requires an operator (admin) account.')
    const url = new URL(request.url)
    const id = url.searchParams.get('id') ?? ''
    if (!(id in LOCAL_MODELS)) throw new BeanApiError('VALIDATION_ERROR', 'Unknown model id.')
    const cancelled = cancelLocalModelInstall(id)
    return ok({ cancelled, state: localModelState(id) })
  })
}

export const dynamic = 'force-dynamic'
