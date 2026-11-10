/**
 * BEAN Intelligence — RIISHE document upload.
 *
 * Real document ingestion for grounded analysis:
 *  - multipart/form-data, field "file", authenticated, ownership stored.
 *  - server-side validation: size cap (10 MB) and a strict format allowlist
 *    (.txt .md .csv .json .pdf). Rejected types get structured, actionable
 *    errors — validation is never bypassed to make an upload succeed.
 *  - text is EXTRACTED server-side and only the extraction is persisted; the
 *    extraction is what reaches the model (actual file contents as evidence).
 *  - PDF text extraction runs pdf-parse (no text layer -> honest 422, not a
 *    fake success).
 *  - extracted text is capped; the truncated flag travels with the document.
 *  - filenames are display-only: sanitized, never used for filesystem access.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { logger } from '@/lib/observability/logger'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'log'])
const PDF_EXTENSIONS = new Set(['pdf'])

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

export async function extractDocumentText(
  bytes: Buffer,
  name: string,
): Promise<{ text: string; truncated: boolean; mime: string }> {
  const ext = extensionOf(name)
  if (PDF_EXTENSIONS.has(ext)) {
    const { PDFParse } = await import('pdf-parse')
    let parser: InstanceType<typeof PDFParse> | null = null
    try {
      parser = new PDFParse({ data: new Uint8Array(bytes) })
      const result = await parser.getText()
      const text = (result.text ?? '').replace(/\n?--\s*\d+\s+of\s+\d+\s*--\n?/g, '\n').trim()
      if (!text) {
        throw new BeanApiError(
          'UNSUPPORTED_CONTENT',
          'No extractable text was found in this PDF (it may be a scan without a text layer).',
        )
      }
      return {
        text: text.slice(0, MAX_TEXT_CHARS),
        truncated: text.length > MAX_TEXT_CHARS,
        mime: 'application/pdf',
      }
    } finally {
      await parser?.destroy().catch(() => {})
    }
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    const full = bytes.toString('utf8').replace(/^\uFEFF/, '')
    if (full.trim().length === 0) {
      throw new BeanApiError('UNSUPPORTED_CONTENT', 'The file contains no text content.')
    }
    return {
      text: full.slice(0, MAX_TEXT_CHARS),
      truncated: full.length > MAX_TEXT_CHARS,
      mime: `text/${ext === 'md' ? 'markdown' : ext === 'json' ? 'json' : ext === 'csv' ? 'csv' : 'plain'}`,
    }
  }
  throw new BeanApiError(
    'UNSUPPORTED_FORMAT',
    `Unsupported file type ".${ext || '?'}". Supported: txt, md, csv, json, pdf.`,
  )
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()

    // Cheap early rejection before the body is buffered into memory.
    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (declaredLength > MAX_BYTES + 64 * 1024) {
      throw new BeanApiError('PAYLOAD_TOO_LARGE', 'Files are limited to 10 MB.')
    }

    const form = await request.formData().catch(() => null)
    if (!form) {
      throw new BeanApiError('VALIDATION_ERROR', 'Expected a multipart form upload with a "file" field.')
    }
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new BeanApiError('VALIDATION_ERROR', 'Missing "file" field.')
    }
    if (file.size === 0) {
      throw new BeanApiError('VALIDATION_ERROR', 'The uploaded file is empty.')
    }
    if (file.size > MAX_BYTES) {
      throw new BeanApiError('PAYLOAD_TOO_LARGE', 'Files are limited to 10 MB.')
    }
    const displayName = sanitizeDisplayName(file.name || 'document')
    if (!TEXT_EXTENSIONS.has(extensionOf(displayName)) && !PDF_EXTENSIONS.has(extensionOf(displayName))) {
      throw new BeanApiError(
        'UNSUPPORTED_FORMAT',
        `Unsupported file type ".${extensionOf(displayName) || '?'}". Supported: txt, md, csv, json, pdf.`,
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const { text, truncated, mime } = await extractDocumentText(bytes, displayName)

    const doc = await db.document.create({
      data: {
        userId: user.id,
        name: displayName,
        mime,
        size: file.size,
        text,
        truncated,
      },
    })
    logger.info('riishe.document_uploaded', {
      documentId: doc.id,
      kind: extensionOf(displayName),
      bytes: file.size,
      chars: text.length,
      truncated,
    })
    return ok({
      document: {
        id: doc.id,
        name: doc.name,
        mime: doc.mime,
        size: doc.size,
        characters: text.length,
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
      select: { id: true, name: true, mime: true, size: true, truncated: true, createdAt: true },
    })
    return ok({ documents: docs })
  })
}
