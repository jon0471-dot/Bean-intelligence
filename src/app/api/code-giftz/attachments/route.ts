import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { logger } from '@/lib/observability/logger'

export const dynamic = 'force-dynamic'

/** Max accepted attachment size (bytes). */
const MAX_BYTES = 200_000
/** Max attachments per request. */
const MAX_FILES = 5

/** Extensions treated as safe UTF-8 text/code. Everything else is rejected
 *  with an explicit reason (binary formats are NOT parsed or guessed). */
const TEXT_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'html', 'htm', 'css', 'scss', 'json', 'xml', 'yml',
  'yaml', 'toml', 'md', 'markdown', 'txt', 'csv', 'tsv', 'log', 'ini', 'cfg', 'conf', 'env',
  'gitignore', 'dockerfile', 'makefile', 'svg',
])

const MIME_TEXT_PREFIXES = ['text/', 'application/json', 'application/xml', 'application/javascript', 'application/typescript', 'application/x-yaml', 'application/toml']

interface AttachmentResult {
  name: string
  ok: boolean
  /** Extracted UTF-8 text when ok. */
  text?: string
  chars?: number
  truncated?: boolean
  /** Why a format cannot be processed (customer-safe). */
  reason?: string
}

function extOf(name: string): string {
  const base = name.toLowerCase().split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot === -1 ? base : base.slice(dot + 1)
}

function looksLikeUtf8Text(buf: Buffer): boolean {
  // Reject obvious binaries: NUL bytes or a invalid UTF-8 replacement surge.
  if (buf.includes(0)) return false
  const sample = buf.subarray(0, 4_000).toString('utf8')
  const replacementRatio = (sample.match(/\uFFFD/g) ?? []).length / Math.max(1, sample.length)
  return replacementRatio < 0.02
}

/**
 * CODE GIFTZ — attachment inspection. Parses text-like files safely (size
 * cap, UTF-8 sanity check) and explains plainly when a format cannot be
 * processed. Parsed text is returned to the caller; the CLIENT decides what
 * to attach to the next chat turn. Contents are treated as untrusted input
 * downstream (untrusted-data framing in the model prompt).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const form = await request.formData()
    const entries = form.getAll('files').filter((f): f is File => f instanceof File)
    if (entries.length === 0) {
      entries.push(...(form.getAll('file').filter((f): f is File => f instanceof File)))
    }
    if (entries.length === 0) {
      return ok({ attachments: [] as AttachmentResult[] })
    }
    const picked = entries.slice(0, MAX_FILES)
    const results: AttachmentResult[] = []

    for (const file of picked) {
      const name = file.name.slice(0, 200)
      try {
        const buf = Buffer.from(await file.arrayBuffer())
        if (buf.length > MAX_BYTES) {
          results.push({
            name,
            ok: false,
            reason: `File is ${Math.round(buf.length / 1024)} KB — attachments are limited to ${Math.round(MAX_BYTES / 1024)} KB.`,
          })
          continue
        }
        const ext = extOf(name)
        const mimeText = MIME_TEXT_PREFIXES.some((p) => file.type.startsWith(p))
        const knownText = TEXT_EXTENSIONS.has(ext)
        if (!knownText && !mimeText) {
          results.push({
            name,
            ok: false,
            reason: `"${ext || 'this format'}" files cannot be processed. Attach plain-text or code files (js, ts, py, html, css, json, csv, md, txt, …).`,
          })
          continue
        }
        if (!looksLikeUtf8Text(buf)) {
          results.push({
            name,
            ok: false,
            reason: 'This file appears to be binary data and cannot be attached.',
          })
          continue
        }
        const text = buf.toString('utf8')
        results.push({
          name,
          ok: true,
          text,
          chars: text.length,
          truncated: false,
        })
      } catch (e) {
        logger.warn('codegiftz.attachment_parse_failed', { name, message: e instanceof Error ? e.message : String(e) })
        results.push({ name, ok: false, reason: 'The file could not be read.' })
      }
    }

    return ok({
      attachments: results,
      ...(entries.length > MAX_FILES ? { note: `Only the first ${MAX_FILES} attachments were processed.` } : {}),
    })
  })
}
