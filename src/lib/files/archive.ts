/**
 * BEAN Intelligence — archive safety inspection.
 *
 * ZIP archives (and ZIP-based office documents) are INSPECTED, never
 * executed and never extracted to the filesystem. The inspection rejects:
 *  - path-traversal entry names (../, absolute paths, drive letters),
 *  - zip bombs (compression ratio or uncompressed total beyond budget),
 *  - encrypted archives (cannot be inspected honestly),
 *  - absurd entry counts.
 * The produced summary is a factual listing — it becomes the file's
 * "extracted text" so the model can reason about what the archive holds.
 */
import JSZip from 'jszip'

export interface ArchiveInspection {
  /** Factual, model-readable summary of the archive contents. */
  text: string
  truncated: boolean
  note: string
  entryCount: number
}

const MAX_ENTRIES = 2_000
const MAX_UNCOMPRESSED_TOTAL = 256 * 1024 * 1024 // 256 MiB aggregate budget
const MAX_RATIO = 400 // a single entry compressing beyond this is bomb-shaped
const MAX_LISTED = 40

export class UnsafeArchiveError extends Error {}

function isUnsafeName(name: string): boolean {
  if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) return true
  if (/^[a-zA-Z]:/.test(name)) return true // windows drive letters
  if (/[\u0000-\u001f]/.test(name)) return true
  return false
}

/** Directly testable entry-name validator (the loader normalizes some names). */
export function hasUnsafeEntryName(name: string): boolean {
  return isUnsafeName(name)
}

export async function inspectArchive(bytes: Buffer): Promise<ArchiveInspection> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false })
  } catch {
    throw new UnsafeArchiveError('This archive could not be read — it may be corrupted or in an unsupported format.')
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir)
  if (entries.length === 0) throw new UnsafeArchiveError('The archive contains no files.')
  if (entries.length > MAX_ENTRIES) {
    throw new UnsafeArchiveError(`Archive holds ${entries.length} entries — over the ${MAX_ENTRIES} safety limit.`)
  }

  let totalUncompressed = 0
  const lines: string[] = []
  const extCounts = new Map<string, number>()

  for (const entry of entries) {
    const name = entry.name
    if (isUnsafeName(name)) {
      throw new UnsafeArchiveError(`Blocked: archive entry "${name.slice(0, 60)}" uses an unsafe path (possible path traversal).`)
    }
    const meta = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number; crc32?: number } })._data
    const uncompressed = Number(meta?.uncompressedSize ?? 0)
    const compressed = Number(meta?.compressedSize ?? 0)
    totalUncompressed += uncompressed
    if (totalUncompressed > MAX_UNCOMPRESSED_TOTAL) {
      throw new UnsafeArchiveError('Blocked: archive expands beyond the safety budget (possible zip bomb).')
    }
    if (compressed > 0 && uncompressed / compressed > MAX_RATIO) {
      throw new UnsafeArchiveError(`Blocked: entry "${name.slice(0, 60)}" has an extreme compression ratio (possible zip bomb).`)
    }
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '(none)'
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1)
    if (lines.length < MAX_LISTED) lines.push(`- ${name} (${uncompressed} bytes)`)
    void entry
  }

  // Encrypted detection: JSZip flags entries it cannot decode metadata for.
  const encrypted = entries.some(
    (e) => (e as unknown as { _data?: { encrypted?: boolean } })._data?.encrypted === true,
  )
  if (encrypted) {
    throw new UnsafeArchiveError('Blocked: the archive is password-protected, so its contents cannot be inspected.')
  }

  const typesSummary = [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ext, n]) => `${ext} x${n}`)
    .join(', ')

  const header = `ZIP archive with ${entries.length} file ${entries.length === 1 ? 'entry' : 'entries'} (${bytes.length} bytes compressed, ${totalUncompressed} bytes uncompressed). Contents by type: ${typesSummary}.`
  const listing = lines.join('\n')
  const truncated = entries.length > MAX_LISTED
  const text = `${header}\n${listing}${truncated ? `\n(+ ${entries.length - MAX_LISTED} more entries)` : ''}\n(Archives are inspected, never executed; entries were not extracted.)`

  return { text, truncated: false, note: 'Archive inspected safely (no extraction, no execution).', entryCount: entries.length }
}
