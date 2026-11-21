/**
 * GANGZII — LOCAL TTS ENGINE model lifecycle (M27).
 *
 * GET    → measured runtime status (installed? revision? bytes? installing?
 *          load health?) + the exact model metadata (repo/revision/licenses).
 * POST   → {action:'install'} | {action:'unload'}. INSTALL is an explicit
 *          user action — BEAN never downloads models automatically; the
 *          approx download size is part of the status payload so the UI can
 *          show it BEFORE the action. UNLOAD releases the in-process ONNX
 *          session (memory control).
 * DELETE → removal from disk. Refused while active jobs use the engine.
 */
import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import {
  kokoroTtsEngine,
  KOKORO_APPROX_DOWNLOAD_MB,
  KOKORO_MODEL_DTYPE,
  KOKORO_MODEL_REPO,
} from '@/lib/gangzii/tts-engine'

const actionSchema = z.object({
  action: z.enum(['install', 'unload']),
})

export async function GET() {
  return handle(async () => {
    await requireUser()
    const status = kokoroTtsEngine.getRuntimeStatus()
    const health = await kokoroTtsEngine.health()
    return ok({
      engine: {
        id: kokoroTtsEngine.engineId,
        backendId: kokoroTtsEngine.backendId,
        repo: KOKORO_MODEL_REPO,
        dtype: KOKORO_MODEL_DTYPE,
        approxDownloadMb: KOKORO_APPROX_DOWNLOAD_MB,
      },
      status: { ...status, health },
      metadata: kokoroTtsEngine.getModelMetadata(),
    })
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, actionSchema)
    if (body.action === 'unload') {
      const res = kokoroTtsEngine.unload()
      await recordAudit({ actorId: user.id, action: 'gangzii.tts_engine.unload', target: 'kokoro-82m', meta: { unloaded: res.unloaded } })
      return ok({
        action: 'unload',
        unloaded: res.unloaded,
        message: res.unloaded
          ? 'The local engine session was released from memory. The installed model stays on disk and reloads on the next synthesis.'
          : 'The engine was not loaded in this process.',
      })
    }
    const res = await kokoroTtsEngine.install()
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.tts_engine.install',
      target: 'kokoro-82m',
      meta: { ok: res.ok, bytes: res.manifest?.files.reduce((a, f) => a + f.bytes, 0) ?? 0 },
    })
    return ok(
      {
        action: 'install',
        ok: res.ok,
        manifest: res.manifest,
        message: res.message,
      },
      { status: res.ok ? 200 : 502 },
    )
  })
}

export async function DELETE() {
  return handle(async () => {
    const user = await requireUser()
    const res = await kokoroTtsEngine.remove()
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.tts_engine.remove',
      target: 'kokoro-82m',
      meta: { ok: res.ok },
    })
    return ok(
      { ok: res.ok, message: res.message },
      { status: res.ok ? 200 : 409 },
    )
  })
}
