/**
 * BEAN Intelligence — GANGZII upload validation + storage.
 *
 * Server-side truth for Audio Lab uploads:
 *  - size cap 25 MiB (matches the registry's maxUploadBytes),
 *  - container identity comes from MAGIC BYTES, never from the extension
 *    or the client-declared content type,
 *  - only containers the transcription/conversion backends actually accept
 *    are stored (WAV, WebM — verified against the live gateway 2026-10-27),
 *  - files live OUTSIDE /public under storage/gangzii/<userId>/uploads and
 *    are only ever served through the owner-checked delivery route.
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { BeanApiError } from '@/lib/api/errors'
import { sniffAudioContainer } from '@/lib/adapters/hosted-audio'

export const GANGZII_STORAGE_ROOT = path.join(process.cwd(), 'storage', 'gangzii')
export const MAX_UPLOAD_BYTES = 26_214_400

export interface SavedUpload {
  relPath: string
  container: 'wav' | 'webm'
  bytes: number
}

export function persistAudioUpload(userId: string, bytes: Buffer): SavedUpload {
  if (bytes.length === 0) {
    throw new BeanApiError('VALIDATION_ERROR', 'The uploaded file is empty.')
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new BeanApiError(
      'VALIDATION_ERROR',
      `Audio exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB upload limit.`,
    )
  }
  const container = sniffAudioContainer(bytes)
  if (!container) {
    throw new BeanApiError(
      'UNSUPPORTED_CONTENT',
      'This audio format is not supported. Accepted containers: WAV and WebM (the speech backends reject everything else — verified against the live gateway).',
    )
  }
  const relPath = path.join(userId, 'uploads', `${randomUUID()}.${container}`)
  const resolved = path.join(GANGZII_STORAGE_ROOT, relPath)
  if (!resolved.startsWith(GANGZII_STORAGE_ROOT)) {
    throw new BeanApiError('INTERNAL_ERROR', 'Invalid storage path.')
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, bytes)
  return { relPath, container, bytes: bytes.length }
}

/** Owner-checked read of any file stored under the gangzii storage root. */
export function readGangziiFile(relPath: string, userId: string): Buffer {
  const resolved = path.join(GANGZII_STORAGE_ROOT, relPath)
  if (!resolved.startsWith(GANGZII_STORAGE_ROOT) || !resolved.includes(userId)) {
    throw new BeanApiError('NOT_FOUND', 'Audio file not found.')
  }
  if (!fs.existsSync(resolved)) {
    throw new BeanApiError('NOT_FOUND', 'Audio file is no longer available.')
  }
  return fs.readFileSync(resolved)
}

/** Remove a stored file if it exists (used by the delete endpoint). */
export function removeGangziiFile(relPath: string): void {
  const resolved = path.join(GANGZII_STORAGE_ROOT, relPath)
  if (!resolved.startsWith(GANGZII_STORAGE_ROOT)) return
  try {
    if (fs.existsSync(resolved)) fs.rmSync(resolved)
  } catch {
    /* deletion is best-effort; the DB row removal is the source of truth */
  }
}

export const AUDIO_CONTENT_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  webm: 'audio/webm',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
}
