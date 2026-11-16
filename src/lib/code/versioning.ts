/**
 * BEAN Intelligence — CODE GIFTZ project versioning (M22).
 *
 * Storage-efficient snapshots over the existing DB-backed project files:
 *   - file CONTENT is stored once per unique value (CodeBlob, SHA-256 deduped
 *     per project) so unchanged files are never duplicated across versions;
 *   - a CodeVersion maps paths -> blob hashes and records the real change
 *     list vs the previous version (added / modified / renamed / deleted);
 *   - rollback creates a NEW version that restores an old file set — history
 *     is never rewritten or silently deleted;
 *   - every version carries an integrity hash over its sorted (path, hash)
 *     pairs, validated before any rollback and on demand.
 *
 * SERVER-ONLY. The Prisma boundary is the only side effect; all pure helpers
 * are exported for tests.
 */
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { diffLines, diffStats } from './diff'

export const MAX_VERSIONS_PER_PROJECT = 200
export const MAX_SUMMARY_CHARS = 500
/** Total diff payload budget for a version comparison (characters). */
export const MAX_COMPARE_DIFF_CHARS = 40_000

export type VersionKind =
  | 'initial'
  | 'turn'
  | 'manual'
  | 'rollback'
  | 'file-save'
  | 'file-delete'
  // M23: chat-driven file operations and separately-approved reference repairs.
  | 'file-op'
  | 'repair'
  // M25: atomic multi-file refactoring (one coherent version per approved plan).
  | 'refactor'

export interface VersionFileEntry {
  path: string
  blobHash: string
  change: 'added' | 'modified' | 'renamed'
  previousPath?: string
}

export interface VersionChange {
  path: string
  change: 'added' | 'modified' | 'deleted' | 'renamed'
  added?: number
  removed?: number
  previousPath?: string
}

export interface SnapshotResult {
  created: boolean
  /** 'unchanged' — the file set is identical to the latest version; nothing recorded. */
  skipped?: 'unchanged'
  version: {
    id: string
    seq: number
    kind: VersionKind
    summary: string | null
    fileCount: number
    contentHash: string
    changedFiles: VersionChange[]
    createdAt: string
  } | null
}

export class VersionError extends Error {
  code: 'NOT_FOUND' | 'CORRUPT' | 'LIMIT'
  constructor(code: VersionError['code'], message: string) {
    super(message)
    this.code = code
  }
}

// ---- pure helpers ----------------------------------------------------------

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Integrity hash over the sorted (path, blobHash) pairs of a file set. */
export function computeSetHash(entries: Array<{ path: string; blobHash: string | null }>): string {
  const pairs = entries
    .filter((e) => e.blobHash !== null)
    .map((e) => [e.path, e.blobHash as string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(pairs), 'utf8').digest('hex')
}

export function clampSummary(summary: string | undefined | null): string | null {
  const s = (summary ?? '').trim()
  if (s.length === 0) return null
  return s.length > MAX_SUMMARY_CHARS ? `${s.slice(0, MAX_SUMMARY_CHARS - 1)}…` : s
}

/**
 * Real change list between two file sets. Rename detection: an entry whose
 * content hash exists in the previous set under a DIFFERENT, now-absent path
 * is a rename (the previous path is consumed by the rename, not also listed
 * as deleted). Everything else compares by path.
 */
export function computeChangedFiles(
  previous: Array<{ path: string; blobHash: string }>,
  current: Array<{ path: string; blobHash: string }>,
): VersionChange[] {
  const prevByPath = new Map(previous.map((e) => [e.path, e.blobHash]))
  const prevByHash = new Map<string, string[]>()
  for (const e of previous) {
    const list = prevByHash.get(e.blobHash) ?? []
    list.push(e.path)
    prevByHash.set(e.blobHash, list)
  }
  const curPaths = new Set(current.map((e) => e.path))
  const curByHash = new Map<string, string[]>()
  for (const e of current) {
    const list = curByHash.get(e.blobHash) ?? []
    list.push(e.path)
    curByHash.set(e.blobHash, list)
  }

  const consumedPrevPaths = new Set<string>()
  const changes: VersionChange[] = []

  for (const e of current) {
    const prevHash = prevByPath.get(e.path)
    if (prevHash === e.blobHash) continue // unchanged — never listed
    if (prevHash !== undefined) {
      changes.push({ path: e.path, change: 'modified' })
      continue
    }
    // New path. Rename if this exact content existed before under an absent path.
    const candidates = (prevByHash.get(e.blobHash) ?? []).filter(
      (p) => !curPaths.has(p) && !consumedPrevPaths.has(p),
    )
    if (candidates.length > 0) {
      const from = candidates.sort()[0]
      consumedPrevPaths.add(from)
      changes.push({ path: e.path, change: 'renamed', previousPath: from })
    } else {
      changes.push({ path: e.path, change: 'added' })
    }
  }
  for (const e of previous) {
    if (curPaths.has(e.path) || consumedPrevPaths.has(e.path)) continue
    changes.push({ path: e.path, change: 'deleted' })
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Bounded line-diff payload for modified files (honest truncation flag). */
export function buildChangeDiffs(
  changes: VersionChange[],
  previousContent: (path: string) => string | null,
  currentContent: (path: string) => string | null,
  budget = MAX_COMPARE_DIFF_CHARS,
): { diffs: Record<string, Array<{ type: 'add' | 'del' | 'ctx'; text: string }>>; stats: Record<string, { added: number; removed: number }>; truncated: boolean } {
  const diffs: Record<string, Array<{ type: 'add' | 'del' | 'ctx'; text: string }>> = {}
  const stats: Record<string, { added: number; removed: number }> = {}
  let used = 0
  let truncated = false
  for (const c of changes) {
    if (c.change !== 'modified') continue
    const before = previousContent(c.path) ?? ''
    const after = currentContent(c.path) ?? ''
    stats[c.path] = diffStats(before, after)
    if (used >= budget) {
      truncated = true
      continue
    }
    const rows = diffLines(before, after).map((r) => ({
      type: r.type === 'add' ? ('add' as const) : r.type === 'del' ? ('del' as const) : ('ctx' as const),
      text: r.text,
    }))
    // Estimate this file's payload cost; keep a bounded prefix when it would
    // blow the remaining budget (the full stats stay available either way).
    const perLine = rows.reduce((acc, r) => acc + r.text.length + 8, 0)
    if (used + perLine > budget) {
      const remaining = budget - used
      let acc = 0
      let keep = 0
      for (const r of rows) {
        const cost = r.text.length + 8
        if (acc + cost > remaining) break
        acc += cost
        keep += 1
      }
      diffs[c.path] = rows.slice(0, keep)
      truncated = true
      used = budget
      continue
    }
    diffs[c.path] = rows
    used += perLine
  }
  return { diffs, stats, truncated }
}

// ---- snapshot --------------------------------------------------------------

interface SnapshotInput {
  projectId: string
  kind: VersionKind
  summary?: string | null
  /**
   * File set to record. When omitted the CURRENT persisted CodeFiles are
   * snapshotted. Rollback passes the historical set explicitly.
   */
  files?: Array<{ path: string; content: string }>
}

/**
 * Record a version for the current (or given) file set.
 * A no-op when the set is identical to the latest version (duplicate-version
 * protection) or when the project has no files yet.
 */
/**
 * M26 (audit R-6): the snapshot can run INSIDE a caller's transaction —
 * pass `tx` to bind every read/write to the caller's transactional client.
 * Without `tx` the behavior is byte-identical to before (global db client).
 */
export async function snapshotProjectVersion(
  input: SnapshotInput,
  tx?: Prisma.TransactionClient,
): Promise<SnapshotResult> {
  const dbc = tx ?? db
  const { projectId } = input
  const rows =
    input.files ??
    (await dbc.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } }))
  const entries = rows
    .map((f) => ({ path: f.path, content: f.content }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  if (entries.length === 0) {
    return { created: false, skipped: 'unchanged', version: null }
  }

  const hashes = entries.map((e) => ({ path: e.path, blobHash: hashContent(e.content) }))
  const setHash = computeSetHash(hashes)

  const latest = await dbc.codeVersion.findFirst({
    where: { projectId },
    orderBy: { seq: 'desc' },
    include: { files: { orderBy: { path: 'asc' } } },
  })
  if (latest && latest.contentHash === setHash) {
    return { created: false, skipped: 'unchanged', version: null }
  }
  if (latest && latest.seq >= MAX_VERSIONS_PER_PROJECT) {
    throw new VersionError('LIMIT', `This project reached its ${MAX_VERSIONS_PER_PROJECT}-version history limit. Delete old versions or export the project to start fresh.`)
  }

  const previousEntries = (latest?.files ?? []).map((f) => ({ path: f.path, blobHash: f.blobHash ?? '' }))
  // seq 1 compares against an EMPTY previous set — every file is honestly
  // recorded as added (a diff from nothing).
  const changedFiles = computeChangedFiles(previousEntries, hashes)
  const seq = (latest?.seq ?? 0) + 1
  const kind: VersionKind = seq === 1 ? 'initial' : input.kind
  const summary = clampSummary(input.summary)

  // M26 (audit R-6): when a caller's transaction is supplied, the writes run
  // ON that client directly (no nested $transaction — SQLite has no
  // savepoints); the caller's own transaction provides the atomicity.
  const writeSnapshot = async (txn: Prisma.TransactionClient) => {
    for (const e of entries) {
      const hash = hashContent(e.content)
      await txn.codeBlob.upsert({
        where: { projectId_hash: { projectId, hash } },
        create: { projectId, hash, content: e.content, size: e.content.length },
        update: {}, // content is immutable once stored — never rewritten
      })
    }
    const version = await txn.codeVersion.create({
      data: {
        projectId,
        seq,
        kind,
        summary,
        changedFilesJson: JSON.stringify(changedFiles),
        contentHash: setHash,
        fileCount: entries.length,
        files: {
          create: hashes.map((h) => ({
            path: h.path,
            blobHash: h.blobHash,
            change: changedFiles.find((c) => c.path === h.path)?.change === 'renamed'
              ? 'renamed'
              : changedFiles.find((c) => c.path === h.path)?.change === 'modified'
                ? 'modified'
                : 'added',
            previousPath: changedFiles.find((c) => c.path === h.path)?.previousPath ?? null,
          })),
        },
      },
    })
    await txn.codeProject.update({
      where: { id: projectId },
      data: { currentVersion: seq },
    })
    return version
  }
  const created = tx ? await writeSnapshot(tx) : await db.$transaction(writeSnapshot)

  return {
    created: true,
    version: {
      id: created.id,
      seq: created.seq,
      kind: created.kind as VersionKind,
      summary: created.summary,
      fileCount: created.fileCount,
      contentHash: created.contentHash,
      changedFiles,
      createdAt: created.createdAt.toISOString(),
    },
  }
}

// ---- read / integrity ------------------------------------------------------

export interface VersionSummary {
  id: string
  seq: number
  kind: VersionKind
  summary: string | null
  fileCount: number
  contentHash: string
  changedFiles: VersionChange[]
  createdAt: string
}

export async function listVersions(projectId: string, take = 100): Promise<VersionSummary[]> {
  const rows = await db.codeVersion.findMany({
    where: { projectId },
    orderBy: { seq: 'desc' },
    take,
  })
  return rows.map((v) => ({
    id: v.id,
    seq: v.seq,
    kind: v.kind as VersionKind,
    summary: v.summary,
    fileCount: v.fileCount,
    contentHash: v.contentHash,
    changedFiles: safeParseChanges(v.changedFilesJson),
    createdAt: v.createdAt.toISOString(),
  }))
}

function safeParseChanges(json: string | null): VersionChange[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as VersionChange[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export interface VersionIntegrity {
  seq: number
  ok: boolean
  /** Paths whose blob row is missing (a corrupt/partial snapshot). */
  missingBlobs: string[]
  recomputedHash: string | null
  expectedHash: string
  detail: string
}

/**
 * Integrity validation: every file entry must resolve to an existing blob and
 * the recomputed set hash must equal the stored contentHash. A partial
 * snapshot (missing blob rows) or a tampered/incoherent version is reported,
 * never repaired silently.
 */
export async function validateVersionIntegrity(projectId: string, seq: number): Promise<VersionIntegrity> {
  const version = await db.codeVersion.findUnique({
    where: { projectId_seq: { projectId, seq } },
    include: { files: true },
  })
  if (!version) throw new VersionError('NOT_FOUND', `Version ${seq} was not found.`)
  const expectedHash = version.contentHash
  const hashes = version.files.map((f) => ({ path: f.path, blobHash: f.blobHash }))
  const blobs = await db.codeBlob.findMany({
    where: { projectId, hash: { in: hashes.map((h) => h.blobHash ?? '') } },
    select: { hash: true },
  })
  const blobSet = new Set(blobs.map((b) => b.hash))
  const missingBlobs = hashes.filter((h) => !blobSet.has(h.blobHash ?? '')).map((h) => h.path)
  const recomputed = computeSetHash(hashes)
  const ok = missingBlobs.length === 0 && recomputed === expectedHash && version.fileCount === hashes.length
  return {
    seq,
    ok,
    missingBlobs,
    recomputedHash: recomputed,
    expectedHash,
    detail: ok
      ? 'All file entries resolve to stored content and the integrity hash matches.'
      : missingBlobs.length > 0
        ? `Missing stored content for ${missingBlobs.length} file(s) — the snapshot is incomplete.`
        : 'The integrity hash does not match the recorded file set.',
  }
}

export interface VersionDetail extends VersionSummary {
  files: Array<{ path: string; blobHash: string; change: string; previousPath: string | null }>
  integrity: { ok: boolean; detail: string }
}

export async function getVersionDetail(projectId: string, seq: number): Promise<VersionDetail> {
  const version = await db.codeVersion.findUnique({
    where: { projectId_seq: { projectId, seq } },
    include: { files: { orderBy: { path: 'asc' } } },
  })
  if (!version) throw new VersionError('NOT_FOUND', `Version ${seq} was not found.`)
  const integrity = await validateVersionIntegrity(projectId, seq)
  return {
    id: version.id,
    seq: version.seq,
    kind: version.kind as VersionKind,
    summary: version.summary,
    fileCount: version.fileCount,
    contentHash: version.contentHash,
    changedFiles: safeParseChanges(version.changedFilesJson),
    createdAt: version.createdAt.toISOString(),
    files: version.files.map((f) => ({
      path: f.path,
      blobHash: f.blobHash ?? '',
      change: f.change,
      previousPath: f.previousPath,
    })),
    integrity: { ok: integrity.ok, detail: integrity.detail },
  }
}

/** One historical file's content (owner-checked by the caller). */
export async function getVersionFileContent(
  projectId: string,
  seq: number,
  path: string,
): Promise<string> {
  const version = await db.codeVersion.findUnique({
    where: { projectId_seq: { projectId, seq } },
    include: { files: true },
  })
  if (!version) throw new VersionError('NOT_FOUND', `Version ${seq} was not found.`)
  const entry = version.files.find((f) => f.path === path)
  if (!entry || !entry.blobHash) throw new VersionError('NOT_FOUND', `File ${path} is not part of version ${seq}.`)
  const blob = await db.codeBlob.findUnique({
    where: { projectId_hash: { projectId, hash: entry.blobHash } },
  })
  if (!blob) throw new VersionError('CORRUPT', `The stored content for ${path} is missing — snapshot integrity failure.`)
  return blob.content
}

// ---- comparison ------------------------------------------------------------

export type CompareTarget = { seq: number } | 'current'

export interface CompareResult {
  from: { seq: number | null; label: string }
  to: { seq: number | null; label: string }
  added: string[]
  deleted: string[]
  renamed: Array<{ path: string; previousPath: string }>
  modified: Array<{ path: string; added: number; removed: number }>
  diffs: Record<string, Array<{ type: 'add' | 'del' | 'ctx'; text: string }>>
  truncated: boolean
}

async function fileSetFor(projectId: string, target: CompareTarget): Promise<{ seq: number | null; entries: Array<{ path: string; blobHash: string }>; content: (path: string) => Promise<string | null> }> {
  if (target === 'current') {
    const rows = await db.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
    const map = new Map(rows.map((r) => [r.path, r.content]))
    return {
      seq: null,
      entries: rows.map((r) => ({ path: r.path, blobHash: hashContent(r.content) })),
      content: async (p) => map.get(p) ?? null,
    }
  }
  const version = await db.codeVersion.findUnique({
    where: { projectId_seq: { projectId, seq: target.seq } },
    include: { files: { orderBy: { path: 'asc' } } },
  })
  if (!version) throw new VersionError('NOT_FOUND', `Version ${target.seq} was not found.`)
  const blobs = await db.codeBlob.findMany({
    where: { projectId, hash: { in: version.files.map((f) => f.blobHash ?? '') } },
    select: { hash: true, content: true },
  })
  const byHash = new Map(blobs.map((b) => [b.hash, b.content]))
  return {
    seq: version.seq,
    entries: version.files.map((f) => ({ path: f.path, blobHash: f.blobHash ?? '' })),
    content: async (p) => {
      const entry = version.files.find((f) => f.path === p)
      return entry?.blobHash ? byHash.get(entry.blobHash) ?? null : null
    },
  }
}

/**
 * Compare two file sets (versions or the live workspace). Line diffs ride on
 * the existing LCS diff (`src/lib/code/diff.ts`) under a hard payload budget.
 */
export async function compareVersions(projectId: string, from: CompareTarget, to: CompareTarget = 'current'): Promise<CompareResult> {
  const a = await fileSetFor(projectId, from)
  const b = await fileSetFor(projectId, to)

  const changes = computeChangedFiles(a.entries, b.entries)
  const added = changes.filter((c) => c.change === 'added').map((c) => c.path)
  const deleted = changes.filter((c) => c.change === 'deleted').map((c) => c.path)
  const renamed = changes
    .filter((c): c is VersionChange & { previousPath: string } => c.change === 'renamed')
    .map((c) => ({ path: c.path, previousPath: c.previousPath }))

  // Materialize both sides' contents once (bounded by the per-file caps) so
  // the diff builder works on plain maps.
  const aContents = new Map<string, string | null>()
  for (const e of a.entries) aContents.set(e.path, await a.content(e.path))
  const bContents = new Map<string, string | null>()
  for (const e of b.entries) bContents.set(e.path, await b.content(e.path))

  const { diffs, stats, truncated } = buildChangeDiffs(
    changes,
    (p) => aContents.get(p) ?? null,
    (p) => bContents.get(p) ?? null,
  )
  const modified = changes
    .filter((c) => c.change === 'modified')
    .map((c) => ({ path: c.path, added: stats[c.path]?.added ?? 0, removed: stats[c.path]?.removed ?? 0 }))

  return {
    from: { seq: a.seq, label: a.seq === null ? 'current workspace' : `version ${a.seq}` },
    to: { seq: b.seq, label: b.seq === null ? 'current workspace' : `version ${b.seq}` },
    added,
    deleted,
    renamed,
    modified,
    diffs,
    truncated,
  }
}

// ---- rollback --------------------------------------------------------------

export interface RollbackResult {
  restoredVersion: number
  newVersion: SnapshotResult['version']
  changes: VersionChange[]
}

/**
 * Roll the workspace back to a recorded version BY CREATING A NEW VERSION
 * (history is append-only). The target version's integrity is validated
 * first; a corrupt snapshot is refused, never partially applied.
 */
export async function rollbackToVersion(projectId: string, seq: number): Promise<RollbackResult> {
  const integrity = await validateVersionIntegrity(projectId, seq)
  if (!integrity.ok) {
    throw new VersionError('CORRUPT', `Version ${seq} failed its integrity check (${integrity.detail}) — rollback refused.`)
  }
  const version = await db.codeVersion.findUnique({
    where: { projectId_seq: { projectId, seq } },
    include: { files: { orderBy: { path: 'asc' } } },
  })
  if (!version) throw new VersionError('NOT_FOUND', `Version ${seq} was not found.`)
  const blobs = await db.codeBlob.findMany({
    where: { projectId, hash: { in: version.files.map((f) => f.blobHash ?? '') } },
    select: { hash: true, content: true },
  })
  const byHash = new Map(blobs.map((b) => [b.hash, b.content]))
  const restored = version.files.map((f) => ({ path: f.path, content: byHash.get(f.blobHash ?? '') ?? '' }))

  // Current set for the real change list.
  const currentRows = await db.codeFile.findMany({ where: { projectId } })
  const changes = computeChangedFiles(
    currentRows.map((r) => ({ path: r.path, blobHash: hashContent(r.content) })),
    restored.map((r) => ({ path: r.path, blobHash: hashContent(r.content) })),
  )

  // Apply the restored set through the same file-write semantics as every
  // other writer: upsert what exists in the version, delete what does not.
  // M26 (audit R-5): the rollback is now ONE transaction — a crash midway
  // previously left a half-restored workspace (the undo path was weaker than
  // the refactor path it undoes). The post-rollback version snapshot is part
  // of the same transaction, so the workspace and its history move together.
  const restoredPaths = new Set(restored.map((r) => r.path))
  const snapshot = await db.$transaction(async (tx) => {
    for (const r of restored) {
      const existing = await tx.codeFile.findUnique({
        where: { projectId_path: { projectId, path: r.path } },
      })
      if (existing) {
        if (existing.content !== r.content) {
          await tx.codeFile.update({ where: { id: existing.id }, data: { content: r.content } })
        }
      } else {
        await tx.codeFile.create({ data: { projectId, path: r.path, content: r.content, origin: 'generated' } })
      }
    }
    for (const row of currentRows) {
      if (!restoredPaths.has(row.path)) {
        await tx.codeFile.delete({ where: { id: row.id } })
      }
    }
    return snapshotProjectVersion(
      {
        projectId,
        kind: 'rollback',
        summary: `Rolled back to version ${seq}`,
        files: restored,
      },
      tx,
    )
  })
  return {
    restoredVersion: seq,
    newVersion: snapshot.version,
    changes,
  }
}
