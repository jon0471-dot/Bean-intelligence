/**
 * LAXII — asset storage (Phase 4).
 *
 * User uploads (reference images, originals for enhancement/editing, brush
 * masks) are persisted under storage/laxii/assets/<userId>/ with a DB row
 * carrying ownership + geometry. Delivery routes re-check ownership on
 * every byte, exactly like the existing job-artifact route.
 */
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

const ASSET_ROOT = path.join(process.cwd(), 'storage', 'laxii', 'assets')

export type AssetKind = 'reference' | 'original' | 'mask' | 'result'

export const MAX_ASSET_BYTES = 25 * 1024 * 1024 // 25 MB
export const MAX_MASK_BYTES = 8 * 1024 * 1024

export interface StoredAsset {
  id: string
  kind: AssetKind
  width: number | null
  height: number | null
  bytes: number
  mime: string
  url: string
}

const IMAGE_MIMES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

function assetPath(userId: string, id: string, ext: string): string {
  return path.join(ASSET_ROOT, userId, `${id}.${ext}`)
}

function safeRead(userId: string, relPath: string): Buffer {
  const file = path.join(ASSET_ROOT, userId, path.basename(relPath))
  if (!file.startsWith(ASSET_ROOT)) {
    throw new BeanApiError('VALIDATION_ERROR', 'Invalid asset path.')
  }
  if (!fs.existsSync(file)) {
    throw new BeanApiError('NOT_FOUND', 'Asset file is no longer available.')
  }
  return fs.readFileSync(file)
}

/**
 * Persist an uploaded image asset. Geometry is measured with Sharp — the
 * stored width/height are facts, not client claims. Masks are validated to
 * be decodable images; geometry agreement with the target image is enforced
 * later (preservation.buildMask), never assumed here.
 */
export async function storeAsset(
  userId: string,
  kind: AssetKind,
  mime: string,
  data: Buffer,
): Promise<StoredAsset> {
  const ext = IMAGE_MIMES[mime]
  if (!ext) {
    throw new BeanApiError(
      'VALIDATION_ERROR',
      'Unsupported image type. Upload PNG, JPEG or WebP.',
    )
  }
  const limit = kind === 'mask' ? MAX_MASK_BYTES : MAX_ASSET_BYTES
  if (data.length === 0) throw new BeanApiError('VALIDATION_ERROR', 'Empty upload.')
  if (data.length > limit) {
    throw new BeanApiError(
      'VALIDATION_ERROR',
      `Asset exceeds the ${Math.round(limit / 1024 / 1024)} MB limit.`,
    )
  }
  let width: number | null = null
  let height: number | null = null
  try {
    const meta = await sharp(data).metadata()
    width = meta.width ?? null
    height = meta.height ?? null
    if (!width || !height) throw new Error('no dimensions')
  } catch {
    throw new BeanApiError('VALIDATION_ERROR', 'File is not a decodable image.')
  }

  const row = await db.imageAsset.create({
    data: {
      userId,
      kind,
      mime,
      width,
      height,
      bytes: data.length,
      metaJson: JSON.stringify({ ext }),
    },
  })
  const file = assetPath(userId, row.id, ext)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)

  return {
    id: row.id,
    kind,
    width,
    height,
    bytes: data.length,
    mime,
    url: `/api/laxii/assets/${row.id}`,
  }
}

/** Load an asset with ownership enforcement. Returns bytes + metadata. */
export async function loadAsset(
  userId: string,
  assetId: string,
): Promise<{ data: Buffer; mime: string; width: number | null; height: number | null; kind: AssetKind; url: string }> {
  if (!/^[\w-]+$/.test(assetId)) {
    throw new BeanApiError('VALIDATION_ERROR', 'Invalid asset identifier.')
  }
  const row = await db.imageAsset.findUnique({ where: { id: assetId } })
  if (!row || row.userId !== userId) {
    throw new BeanApiError('NOT_FOUND', 'Asset not found.')
  }
  let ext = 'png'
  try {
    ext = (JSON.parse(row.metaJson ?? '{}') as { ext?: string }).ext ?? 'png'
  } catch {
    ext = 'png'
  }
  const data = safeRead(userId, `${assetId}.${ext}`)
  return {
    data,
    mime: row.mime,
    width: row.width,
    height: row.height,
    kind: row.kind as AssetKind,
    url: `/api/laxii/assets/${assetId}`,
  }
}

/** Read an asset's bytes for engine processing (server-side only). */
export async function readAssetBytes(userId: string, assetId: string): Promise<Buffer> {
  const a = await loadAsset(userId, assetId)
  return a.data
}

/** Store a produced artifact (enhance/edit result, diff map) as an asset. */
export async function storeResultAsset(
  userId: string,
  kind: AssetKind,
  png: Buffer,
  width: number,
  height: number,
  meta: Record<string, unknown> = {},
): Promise<StoredAsset> {
  const row = await db.imageAsset.create({
    data: {
      userId,
      kind,
      mime: 'image/png',
      width,
      height,
      bytes: png.length,
      metaJson: JSON.stringify({ ext: 'png', ...meta }),
    },
  })
  const file = assetPath(userId, row.id, 'png')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, png)
  return {
    id: row.id,
    kind,
    width,
    height,
    bytes: png.length,
    mime: 'image/png',
    url: `/api/laxii/assets/${row.id}`,
  }
}
