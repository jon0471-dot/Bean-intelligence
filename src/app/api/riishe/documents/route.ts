/**
 * BEAN Intelligence — RIISHE file upload (capability-based processing).
 *
 * The picker accepts ANY file the OS exposes; the SERVER decides what can
 * honestly be done with it:
 *  - validate: authenticated, size caps PER CAPABILITY, magic-signature
 *    sniffing on the real bytes (a renamed .exe cannot pose as text);
 *  - extract/convert with the right parser: text/code (utf8), PDF
 *    (pdf-parse text layer), DOCX/XLSX (in-memory ZIP part readers — no
 *    macro ever runs), CSV/TSV (text), images (REAL vision analysis via the
 *    gateway vision model), audio (REAL transcription via the gateway ASR),
 *    video (ffprobe metadata + first-frame visual inspection), ZIP archives
 *    (safe listing — traversal/bomb/encryption rejected, nothing extracted);
 *  - persist the EXTRACTION (what the model will actually see), the detected
 *    capability, an honest processing status and a note; binaries that no
 *    analyzer supports are STORED with status "unsupported" and a clear
 *    explanation instead of pretending they were understood;
 *  - temporary files (video frames, media probes) live in a private tmpdir
 *    and are always deleted in `finally`.
 *
 * Filenames are display-only: sanitized, never used for filesystem access.
 * Upload limits are enforced HERE (server), not only in the browser.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { logger } from '@/lib/observability/logger'
import { detectCapability, unsupportedNote, type CapabilityPlan } from '@/lib/files/capabilities'
import {
  extractText,
  extractPdf,
  extractDocx,
  extractXlsx,
  extractPptx,
  ExtractionError,
} from '@/lib/files/extract'
import { describeImage, transcribeAudio, inspectVideo, probeMedia, describeMediaMeta, withTempFile } from '@/lib/files/media'
import { inspectArchive, UnsafeArchiveError } from '@/lib/files/archive'
import { storeDocumentBytes } from '@/lib/files/riishe-store'

/** Hard absolute ceiling for ANY upload (capability limits refine this). */
const ABSOLUTE_MAX_BYTES = 30 * 1024 * 1024
/** Per-user stored-file cap (oldest files can be deleted from the UI). */
const MAX_STORED_PER_USER = 100

/**
 * Minimal multipart/form-data parser for the single-"file"-field upload this
 * route accepts. Used instead of request.formData() because the framework
 * parser silently fails above ~10 MB, which would make the per-capability
 * limits (PDF 15 MB, video 30 MB) unreachable lies. Parsed from the RAW body
 * with the boundary from Content-Type; no temp files, no dependencies.
 */
export function parseMultipartFile(
  body: Buffer,
  contentType: string,
): { filename: string; data: Buffer } | null {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  if (!m) return null
  const boundary = Buffer.from(`--${(m[1] ?? m[2]).trim()}`)
  const first = body.indexOf(boundary)
  if (first < 0) return null
  let pos = first + boundary.length
  // skip the CRLF after the opening boundary
  if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2
  const headerEnd = body.indexOf('\r\n\r\n', pos)
  if (headerEnd < 0) return null
  const headers = body.slice(pos, headerEnd).toString('utf8')
  if (!/name="file"/i.test(headers)) return null
  const dataStart = headerEnd + 4
  const next = body.indexOf(boundary, dataStart)
  if (next < 0) return null
  // strip the CRLF that precedes the closing boundary
  let dataEnd = next
  if (body[dataEnd - 1] === 0x0a && body[dataEnd - 2] === 0x0d) dataEnd -= 2
  const data = body.slice(dataStart, dataEnd)
  if (data.length === 0) return null
  const filenameMatch = headers.match(/filename="([^"]*)"/i)
  return { filename: filenameMatch?.[1] ?? '', data }
}

/** Display-only filename: strip paths, control characters and excess length. */
export function sanitizeDisplayName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'document'
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim()
  return (cleaned.length > 0 ? cleaned : 'document').slice(0, 120)
}

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

const TEXT_FAMILY = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'text', 'xml', 'html', 'htm',
  'yaml', 'yml', 'ini', 'conf', 'env',
])
const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h',
  'cpp', 'hpp', 'cs', 'sh', 'bash', 'php', 'swift', 'css', 'scss', 'sql',
])

const TEXT_MIME: Record<string, string> = {
  md: 'text/markdown', json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values',
  html: 'text/html', htm: 'text/html', xml: 'application/xml', log: 'text/plain',
}

/**
 * Text-family extraction (kept for the route contract and unit tests):
 * txt/md/csv/json/log/code/pdf/docx/xlsx. Anything outside the text family
 * (images, audio, video, archives, binaries) is handled by the route's
 * capability pipeline, not here.
 */
export async function extractDocumentText(
  bytes: Buffer,
  name: string,
): Promise<{ text: string; truncated: boolean; mime: string }> {
  const ext = extensionOf(name)
  if (ext === 'pdf') {
    try {
      const out = await extractPdf(bytes)
      return { text: out.text, truncated: out.truncated, mime: 'application/pdf' }
    } catch (e) {
      throw new BeanApiError('UNSUPPORTED_CONTENT', (e as Error).message)
    }
  }
  if (ext === 'docx') {
    try {
      const out = await extractDocx(bytes)
      return { text: out.text, truncated: out.truncated, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    } catch (e) {
      throw new BeanApiError('UNSUPPORTED_CONTENT', (e as Error).message)
    }
  }
  if (ext === 'xlsx') {
    try {
      const out = await extractXlsx(bytes)
      return { text: out.text, truncated: out.truncated, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    } catch (e) {
      throw new BeanApiError('UNSUPPORTED_CONTENT', (e as Error).message)
    }
  }
  if (!TEXT_FAMILY.has(ext) && !CODE_EXTENSIONS.has(ext)) {
    throw new BeanApiError(
      'UNSUPPORTED_FORMAT',
      `Unsupported text type ".${ext || '?'}". Supported here: documents (txt, md, csv, json, pdf, docx, xlsx), data and code files. Images, audio, video and archives are processed by the capability pipeline.`,
    )
  }
  try {
    const out = extractText(bytes)
    return { text: out.text, truncated: out.truncated, mime: TEXT_MIME[ext] ?? 'text/plain' }
  } catch {
    throw new BeanApiError('UNSUPPORTED_CONTENT', 'The file contains no text content.')
  }
}

interface ProcessOutcome {
  status: 'ready' | 'unsupported'
  text: string
  truncated: boolean
  note: string
  metaJson: string | null
}

/** Run the capability-appropriate REAL processor for an upload. */
async function processByCapability(
  plan: CapabilityPlan,
  bytes: Buffer,
  displayName: string,
): Promise<ProcessOutcome> {
  switch (plan.capability) {
    case 'text':
    case 'code': {
      const out = extractText(bytes, plan.language)
      return { status: 'ready', text: out.text, truncated: out.truncated, note: out.note, metaJson: null }
    }
    case 'pdf': {
      const out = await extractPdf(bytes)
      return { status: 'ready', text: out.text, truncated: out.truncated, note: out.note, metaJson: null }
    }
    case 'docx': {
      const out = await extractDocx(bytes)
      return { status: 'ready', text: out.text, truncated: out.truncated, note: out.note, metaJson: null }
    }
    case 'pptx': {
      const out = await extractPptx(bytes)
      return { status: 'ready', text: out.text, truncated: out.truncated, note: out.note, metaJson: null }
    }
    case 'data': {
      const out = await extractXlsx(bytes)
      return { status: 'ready', text: out.text, truncated: out.truncated, note: out.note, metaJson: null }
    }
    case 'image': {
      const description = await describeImage(bytes, 'image/png')
      return {
        status: 'ready',
        text: `[IMAGE ANALYSIS — ${displayName}]\n${description}`,
        truncated: false,
        note: 'Image content analyzed by the vision pipeline; the original bytes are retained so follow-up questions can re-consult the actual pixels.',
        metaJson: JSON.stringify({ vision: true, stored: true }),
      }
    }
    case 'audio': {
      const { text } = await withTempFile(bytes, '.audio', async (p) => {
        const meta = await probeMedia(p)
        const transcript = await transcribeAudio(bytes)
        return {
          text:
            `[AUDIO TRANSCRIPTION — ${displayName}] (${describeMediaMeta(meta)})\n` +
            `Transcript:\n${transcript}`,
        }
      })
      return {
        status: 'ready',
        text,
        truncated: false,
        note: 'Audio transcribed by the speech pipeline.',
        metaJson: null,
      }
    }
    case 'video': {
      const { text } = await withTempFile(bytes, '.video', async (p) => {
        const { meta, frameNote } = await inspectVideo(p, bytes)
        return {
          text:
            `[VIDEO INSPECTION — ${displayName}] (${describeMediaMeta(meta)})\n` +
            `${frameNote}\n(No audio track transcription is performed for video in this deployment.)`,
        }
      })
      return {
        status: 'ready',
        text,
        truncated: false,
        note: 'Video inspected (metadata + first frame).',
        metaJson: null,
      }
    }
    case 'archive': {
      const out = await inspectArchive(bytes)
      return { status: 'ready', text: out.text, truncated: out.truncated, note: out.note, metaJson: JSON.stringify({ entries: out.entryCount }) }
    }
    case 'binary':
    default: {
      const magicNote = unsupportedNote(plan.capability, '') ?? 'No analyzer is available for this file format.'
      return { status: 'unsupported', text: '', truncated: false, note: magicNote, metaJson: null }
    }
  }
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()

    // Authoritative early rejection on the declared body length.
    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (declaredLength > ABSOLUTE_MAX_BYTES + 64 * 1024) {
      throw new BeanApiError(
        'PAYLOAD_TOO_LARGE',
        `Files are limited to ${Math.round(ABSOLUTE_MAX_BYTES / (1024 * 1024))} MB (most types 10-20 MB).`,
      )
    }

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      throw new BeanApiError('VALIDATION_ERROR', 'Expected a multipart form upload with a "file" field.')
    }
    const raw = Buffer.from(await request.arrayBuffer())
    if (raw.length > ABSOLUTE_MAX_BYTES + 64 * 1024) {
      throw new BeanApiError(
        'PAYLOAD_TOO_LARGE',
        `Files are limited to ${Math.round(ABSOLUTE_MAX_BYTES / (1024 * 1024))} MB (most types 10-20 MB).`,
      )
    }
    const part = parseMultipartFile(raw, contentType)
    if (!part) {
      throw new BeanApiError('VALIDATION_ERROR', 'Expected a multipart form upload with a "file" field.')
    }
    if (part.data.length === 0) {
      throw new BeanApiError('VALIDATION_ERROR', 'The uploaded file is empty.')
    }
    const file = { name: part.filename, size: part.data.length, type: '' }

    const stored = await db.document.count({ where: { userId: user.id } })
    if (stored >= MAX_STORED_PER_USER) {
      throw new BeanApiError(
        'QUOTA_EXCEEDED',
        `You already have ${MAX_STORED_PER_USER} stored files — delete a few before uploading more.`,
      )
    }

    const displayName = sanitizeDisplayName(file.name || 'document')
    const bytes = part.data

    // REAL bytes decide the capability (server-side validation, not the browser).
    const plan = detectCapability(displayName, file.type, new Uint8Array(bytes))
    if (file.size > plan.maxBytes) {
      throw new BeanApiError(
        'PAYLOAD_TOO_LARGE',
        `${plan.capability} files are limited to ${Math.round(plan.maxBytes / (1024 * 1024))} MB.`,
      )
    }

    let outcome: ProcessOutcome
    try {
      outcome = await processByCapability(plan, bytes, displayName)
    } catch (e) {
      if (e instanceof UnsafeArchiveError) {
        throw new BeanApiError('VALIDATION_ERROR', e.message)
      }
      if (e instanceof ExtractionError) {
        throw new BeanApiError('UNSUPPORTED_CONTENT', e.message)
      }
      logger.warn('riishe.document_processing_failed', {
        name: displayName,
        capability: plan.capability,
        error: e instanceof Error ? e.message : String(e),
      })
      throw new BeanApiError(
        'UNSUPPORTED_CONTENT',
        `This ${plan.capability} file could not be processed — it may be corrupted or use an unsupported variant.`,
      )
    }

    const mime = TEXT_MIME[extensionOf(displayName)] ?? (file.type || 'application/octet-stream')
    const doc = await db.document.create({
      data: {
        userId: user.id,
        name: displayName,
        mime,
        size: file.size,
        text: outcome.text,
        truncated: outcome.truncated,
        kind: plan.capability,
        status: outcome.status,
        note: outcome.note || null,
        metaJson: outcome.metaJson,
      },
    })

    // Image originals are persisted (server-side only) so the analyze_image
    // tool can re-consult the actual pixels for follow-up questions. Text-
    // family extractions ARE the content, so their bytes are not retained.
    let storagePath: string | null = null
    if (plan.capability === 'image') {
      try {
        storagePath = await storeDocumentBytes(user.id, doc.id, bytes)
        await db.document.update({ where: { id: doc.id }, data: { metaJson: JSON.stringify({ vision: true, stored: true, storagePath }) } })
      } catch (e) {
        // Non-fatal: the upload-time description still grounds the turn; the
        // analyze_image tool reports the missing pixels honestly.
        logger.warn('riishe.document_image_store_failed', {
          documentId: doc.id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    logger.info('riishe.document_uploaded', {
      documentId: doc.id,
      kind: plan.capability,
      status: outcome.status,
      bytes: file.size,
      chars: outcome.text.length,
      truncated: outcome.truncated,
      mimeMismatch: plan.mimeMismatch,
    })
    return ok({
      document: {
        id: doc.id,
        name: doc.name,
        kind: doc.kind,
        status: doc.status,
        note: doc.note,
        mime: doc.mime,
        size: doc.size,
        characters: outcome.text.length,
        truncated: doc.truncated,
        createdAt: doc.createdAt,
      },
    })
  })
}

/** Recent documents for the attach UI (metadata only — never the text). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const docs = await db.document.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, name: true, kind: true, status: true, note: true, mime: true, size: true, truncated: true, createdAt: true },
    })
    return ok({ documents: docs })
  })
}
