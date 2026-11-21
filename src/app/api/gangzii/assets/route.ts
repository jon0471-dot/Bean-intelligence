/**
 * GANGZII — Audio Library assets (M27).
 * GET    → owner's library (owner-checked audio URLs under /assets/file/[id]).
 * POST   → upload (multipart): magic-byte container check, 25 MiB cap,
 *          license + attribution metadata RECORDED per asset (never
 *          fabricated). BEAN bundles no third-party media.
 * DELETE → remove an owner asset (row + stored file).
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { GANGZII_STORAGE_ROOT, removeGangziiFile } from '@/lib/gangzii/audio-upload'

const ASSET_STORAGE_ROOT = path.join(GANGZII_STORAGE_ROOT)
const MAX_ASSET_BYTES = 26_214_400

/** Magic-byte container sniffing for library uploads (extension untrusted). */
function sniffContainer(buf: Buffer): 'wav' | 'mp3' | 'ogg' | 'flac' | 'm4a' | null {
  if (buf.length < 12) return null
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3'
  if (buf.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  if (buf.toString('ascii', 0, 4) === 'fLaC') return 'flac'
  // M4A: ISO media container — ftyp box.
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return 'm4a'
  return null
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const assets = await db.gangziiAudioAsset.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return ok({
      assets: assets.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        kind: a.kind,
        container: a.container,
        bytes: a.bytes,
        durationMs: a.durationMs,
        license: a.license,
        attribution: a.attribution,
        sourceUrl: a.sourceUrl,
        createdAt: a.createdAt,
        audioUrl: `/api/gangzii/assets/file/${a.id}`,
      })),
    })
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new BeanApiError('VALIDATION_ERROR', 'Send the asset as multipart/form-data (field "file").')
    }
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new BeanApiError('VALIDATION_ERROR', 'Attach an audio file in the "file" field.')
    }
    const kindRaw = String(form.get('kind') ?? 'music')
    const kind = ['music', 'sfx', 'voiceover-upload'].includes(kindRaw) ? kindRaw : 'music'
    const license = String(form.get('license') ?? '').slice(0, 160) || null
    const attribution = String(form.get('attribution') ?? '').slice(0, 160) || null
    const sourceUrl = String(form.get('sourceUrl') ?? '').slice(0, 300) || null
    // Rights honesty: an upload with no stated license is recorded as such —
    // the UI shows "not stated (user-provided)" and receipts carry it.
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length === 0) throw new BeanApiError('VALIDATION_ERROR', 'The uploaded file is empty.')
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new BeanApiError('VALIDATION_ERROR', `Audio exceeds the ${Math.round(MAX_ASSET_BYTES / (1024 * 1024))} MB upload limit.`)
    }
    const container = sniffContainer(bytes)
    if (!container) {
      throw new BeanApiError('UNSUPPORTED_CONTENT', 'This audio format is not supported. Accepted containers: WAV, MP3, OGG, FLAC, M4A.')
    }
    const relPath = path.join(user.id, 'assets', `${randomUUID()}.${container}`)
    const resolved = path.join(ASSET_STORAGE_ROOT, relPath)
    if (!resolved.startsWith(ASSET_STORAGE_ROOT)) {
      throw new BeanApiError('INTERNAL_ERROR', 'Invalid storage path.')
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, bytes)
    const asset = await db.gangziiAudioAsset.create({
      data: {
        userId: user.id,
        displayName: (file.name || 'audio asset').slice(0, 120),
        relPath,
        kind,
        container,
        bytes: bytes.length,
        license,
        attribution,
        sourceUrl,
      },
    })
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.asset.upload',
      target: asset.id,
      meta: { kind, container, bytes: bytes.length, license: license ? 'stated' : 'not-stated' },
    })
    return ok(
      { asset: { id: asset.id, displayName: asset.displayName, kind, container } },
      { status: 201 },
    )
  })
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!/^[\w-]+$/.test(id)) throw new BeanApiError('VALIDATION_ERROR', 'Invalid asset identifier.')
    const asset = await db.gangziiAudioAsset.findUnique({ where: { id } })
    if (!asset || asset.userId !== user.id) throw new BeanApiError('NOT_FOUND', 'Asset not found.')
    removeGangziiFile(asset.relPath)
    await db.gangziiAudioAsset.delete({ where: { id } })
    await recordAudit({ actorId: user.id, action: 'gangzii.asset.delete', target: id, meta: {} })
    return ok({ deleted: true, id })
  })
}
