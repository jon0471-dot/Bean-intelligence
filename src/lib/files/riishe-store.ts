/**
 * BEAN Intelligence — server-side storage for RIISHE document originals.
 *
 * Only IMAGE uploads are persisted (bounded by the 10 MB image capability
 * cap): re-consulting pixels at question time needs the original bytes, and
 * the upload-time vision description alone cannot answer follow-up
 * questions. Text-family documents keep the existing contract — their
 * extraction IS the content, so no original bytes are kept for them.
 *
 * Layout mirrors the LAXII asset convention: storage/<product>/<userId>/.
 * Every read resolves the path and verifies it stays inside the user's
 * directory (defense in depth — the path component is server-written, but
 * it is still never trusted blindly).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(process.cwd(), 'storage', 'riishe', 'documents')

function userDir(userId: string): string {
  // userId is a Prisma cuid (server-generated); enforce the shape anyway.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error('Invalid storage user segment')
  return path.join(ROOT, userId)
}

/** Persist one document's original bytes. Returns the absolute path. */
export async function storeDocumentBytes(userId: string, documentId: string, bytes: Buffer): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(documentId)) throw new Error('Invalid storage document segment')
  const dir = userDir(userId)
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, documentId)
  await fs.writeFile(target, bytes)
  return target
}

/** Read stored bytes back. Returns null when nothing is stored. */
export async function readDocumentBytes(userId: string, documentId: string): Promise<Buffer | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(documentId)) return null
  const target = path.join(userDir(userId), documentId)
  // Path-containment check (the doc id is already shape-validated; this
  // guards against any future caller passing a crafted segment).
  if (!target.startsWith(userDir(userId) + path.sep)) return null
  try {
    return await fs.readFile(target)
  } catch {
    return null
  }
}

/**
 * Read stored bytes by the server-recorded path (analyze_image tool path).
 * The path was written by the upload route, never by a client — but it is
 * STILL validated to live inside this store before any read.
 */
export async function readStoredDocumentByPath(storagePath: string): Promise<Buffer | null> {
  const resolved = path.resolve(storagePath)
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null
  try {
    return await fs.readFile(resolved)
  } catch {
    return null
  }
}

/** Remove stored bytes (document delete). Idempotent. */
export async function deleteDocumentBytes(userId: string, documentId: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(documentId)) return
  await fs.rm(path.join(userDir(userId), documentId), { force: true })
}
