/**
 * BEAN Intelligence — CODE GIFTZ project versioning tests (M22).
 *
 * Pins the storage-efficient snapshot contract:
 *  - content-addressed blobs (unchanged files stored ONCE per project);
 *  - honest change lists vs the previous version (added/modified/deleted/
 *    renamed, unchanged entries never listed);
 *  - duplicate-version protection (an unchanged workspace snapshots nothing);
 *  - integrity validation (missing blobs / hash mismatch = corrupt, reported);
 *  - rollback creates a NEW version (history is append-only) and restores
 *    the exact file set (including deletions);
 *  - comparisons ride the bounded line-diff budget with honest truncation.
 *
 * The database boundary is a SELF-CONTAINED in-memory fake (mock.module) —
 * no test writes anywhere near the real DB.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- in-memory fake of the Prisma boundary (the ONLY mocked boundary) ------

interface FileRow {
  id: string
  projectId: string
  path: string
  content: string
  origin: string
  updatedAt: Date
}
interface BlobRow {
  projectId: string
  hash: string
  content: string
  size: number
}
interface VersionFileRow {
  path: string
  blobHash: string
  change: string
  previousPath: string | null
}
interface VersionRow {
  id: string
  projectId: string
  seq: number
  kind: string
  summary: string | null
  changedFilesJson: string | null
  contentHash: string
  fileCount: number
  createdAt: Date
  files: VersionFileRow[]
}
interface ProjectRow {
  id: string
  currentVersion: number
}

let files = new Map<string, FileRow>()
let blobs: BlobRow[] = []
let versions: VersionRow[] = []
let projects = new Map<string, ProjectRow>()
let idCounter = 0
let failBlobLookups = false

function reset() {
  files = new Map()
  blobs = []
  versions = []
  projects = new Map()
  idCounter = 0
  failBlobLookups = false
}

function seedProject(id: string): ProjectRow {
  const row = { id, currentVersion: 0 }
  projects.set(id, row)
  return row
}

const fakeDb = {
  codeFile: {
    async findMany({ where }: { where: { projectId: string } }) {
      return [...files.values()]
        .filter((f) => f.projectId === where.projectId)
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    },
    async findUnique({ where }: { where: { projectId_path: { projectId: string; path: string } } }) {
      const key = `${where.projectId_path.projectId}|${where.projectId_path.path}`
      return files.get(key) ?? null
    },
    async create({ data }: { data: { projectId: string; path: string; content: string; origin?: string } }) {
      const row: FileRow = {
        id: `file-${++idCounter}`,
        projectId: data.projectId,
        path: data.path,
        content: data.content,
        origin: data.origin ?? 'generated',
        updatedAt: new Date(),
      }
      files.set(`${row.projectId}|${row.path}`, row)
      return row
    },
    async update({ where, data }: { where: { id: string }; data: { content: string } }) {
      for (const row of files.values()) {
        if (row.id === where.id) {
          row.content = data.content
          row.updatedAt = new Date()
          return row
        }
      }
      throw new Error('file not found')
    },
    async delete({ where }: { where: { id: string } }) {
      for (const [key, row] of files) {
        if (row.id === where.id) {
          files.delete(key)
          return row
        }
      }
      throw new Error('file not found')
    },
  },
  codeBlob: {
    async upsert({ where, create }: { where: { projectId_hash: { projectId: string; hash: string } }; create: BlobRow; update: Record<string, never> }) {
      const key = `${where.projectId_hash.projectId}|${where.projectId_hash.hash}`
      const existing = blobs.find((b) => `${b.projectId}|${b.hash}` === key)
      if (existing) return existing
      const row: BlobRow = { ...create }
      blobs.push(row)
      return row
    },
    async findMany({ where }: { where: { projectId: string; hash: { in: string[] } } }) {
      if (failBlobLookups) return []
      return blobs.filter((b) => b.projectId === where.projectId && where.hash.in.includes(b.hash))
    },
    async findUnique({ where }: { where: { projectId_hash: { projectId: string; hash: string } } }) {
      if (failBlobLookups) return null
      return blobs.find((b) => b.projectId === where.projectId_hash.projectId && b.hash === where.projectId_hash.hash) ?? null
    },
  },
  codeVersion: {
    async findFirst({ where }: { where: { projectId: string } }) {
      const rows = versions
        .filter((v) => v.projectId === where.projectId)
        .sort((a, b) => b.seq - a.seq)
      return rows[0] ?? null
    },
    async findUnique({ where }: { where: { projectId_seq: { projectId: string; seq: number } } }) {
      return (
        versions.find((v) => v.projectId === where.projectId_seq.projectId && v.seq === where.projectId_seq.seq) ?? null
      )
    },
    async findMany({ where, orderBy, take }: { where: { projectId: string }; orderBy?: { seq?: string }; take?: number }) {
      let rows = versions.filter((v) => v.projectId === where.projectId)
      if (orderBy?.seq === 'desc') rows = [...rows].sort((a, b) => b.seq - a.seq)
      return take ? rows.slice(0, take) : rows
    },
    async count({ where }: { where: { projectId: string } }) {
      return versions.filter((v) => v.projectId === where.projectId).length
    },
    async create({ data }: { data: Omit<VersionRow, 'id' | 'createdAt' | 'files'> & { files: { create: VersionFileRow[] } } }) {
      // Prisma nested-create contract: the caller passes files:{create:[...]}.
      const fileCreates = [...data.files.create]
      const { files: _nested, ...rest } = data as Record<string, unknown>
      const row: VersionRow = {
        ...rest,
        id: `version-${++idCounter}`,
        createdAt: new Date(),
        files: fileCreates,
      } as unknown as VersionRow
      versions.push(row)
      return row
    },
  },
  codeProject: {
    async update({ where, data }: { where: { id: string }; data: { currentVersion: number } }) {
      const row = projects.get(where.id)
      if (!row) throw new Error('project not found')
      row.currentVersion = data.currentVersion
      return row
    },
  },
  async $transaction<T>(fn: (tx: typeof fakeDb) => Promise<T>): Promise<T> {
    return await fn(fakeDb)
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

const {
  hashContent,
  computeSetHash,
  computeChangedFiles,
  snapshotProjectVersion,
  listVersions,
  validateVersionIntegrity,
  getVersionFileContent,
  compareVersions,
  rollbackToVersion,
  buildChangeDiffs,
  VersionError,
} = await import('../../src/lib/code/versioning')

const PID = 'proj-1'

async function seedWorkspace(entries: Array<[string, string]>) {
  for (const [path, content] of entries) {
    await fakeDb.codeFile.create({ data: { projectId: PID, path, content } })
  }
}

beforeEach(reset)

describe('pure helpers', () => {
  test('hashContent is deterministic; computeSetHash is path-order insensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'))
    expect(hashContent('abc')).not.toBe(hashContent('abd'))
    const a = computeSetHash([
      { path: 'a.js', blobHash: 'h1' },
      { path: 'b.js', blobHash: 'h2' },
    ])
    const b = computeSetHash([
      { path: 'b.js', blobHash: 'h2' },
      { path: 'a.js', blobHash: 'h1' },
    ])
    expect(a).toBe(b)
    // a content change changes the set hash
    expect(computeSetHash([{ path: 'a.js', blobHash: 'h9' }])).not.toBe(a)
  })

  test('computeChangedFiles: added / modified / deleted / renamed / unchanged silence', () => {
    const prev = [
      { path: 'index.html', blobHash: 'h-html' },
      { path: 'app.js', blobHash: 'h-app-1' },
      { path: 'old.css', blobHash: 'h-css' },
      { path: 'gone.js', blobHash: 'h-gone' },
    ]
    const cur = [
      { path: 'index.html', blobHash: 'h-html' }, // unchanged
      { path: 'app.js', blobHash: 'h-app-2' }, // modified
      { path: 'styles.css', blobHash: 'h-css' }, // renamed from old.css
      { path: 'new.js', blobHash: 'h-new' }, // added
      // gone.js -> deleted
    ]
    const changes = computeChangedFiles(prev, cur)
    const byPath = new Map(changes.map((c) => [c.path, c]))
    expect(byPath.has('index.html')).toBe(false) // unchanged: never listed
    expect(byPath.get('app.js')).toMatchObject({ change: 'modified' })
    expect(byPath.get('styles.css')).toMatchObject({ change: 'renamed', previousPath: 'old.css' })
    expect(byPath.get('new.js')).toMatchObject({ change: 'added' })
    expect(byPath.get('gone.js')).toMatchObject({ change: 'deleted' })
    // old.css is consumed by the rename — NOT also listed as deleted
    expect(byPath.has('old.css')).toBe(false)
  })
})

describe('snapshotProjectVersion', () => {
  test('first snapshot = initial version with all files added', async () => {
    seedProject(PID)
    await seedWorkspace([
      ['index.html', '<p>hi</p>'],
      ['app.js', 'console.log(1)'],
    ])
    const result = await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'build a page' })
    expect(result.created).toBe(true)
    expect(result.version?.seq).toBe(1)
    expect(result.version?.kind).toBe('initial')
    expect(result.version?.fileCount).toBe(2)
    const changed = result.version?.changedFiles ?? []
    expect(changed).toHaveLength(2)
    expect(changed.every((c) => c.change === 'added')).toBe(true)
    expect(projects.get(PID)?.currentVersion).toBe(1)
  })

  test('unchanged workspace is an honest no-op (duplicate-version protection)', async () => {
    seedProject(PID)
    await seedWorkspace([['app.js', 'console.log(1)']])
    const first = await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'first' })
    const second = await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'same' })
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.skipped).toBe('unchanged')
    expect(second.version).toBeNull()
    expect(versions).toHaveLength(1)
  })

  test('changed workspace records only the real change list; unchanged file stored once (blob dedup)', async () => {
    seedProject(PID)
    await seedWorkspace([
      ['index.html', '<p>hi</p>'],
      ['app.js', 'const a = 1'],
    ])
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'init' })
    const blobsAfterFirst = blobs.length
    expect(blobsAfterFirst).toBe(2)

    // change only app.js
    const appRow = [...files.values()].find((f) => f.path === 'app.js')!
    await fakeDb.codeFile.update({ where: { id: appRow.id }, data: { content: 'const a = 2' } })
    const second = await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'tweak app.js' })
    expect(second.created).toBe(true)
    expect(second.version?.seq).toBe(2)
    const changed = second.version?.changedFiles ?? []
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ path: 'app.js', change: 'modified' })
    // the unchanged index.html blob was NOT duplicated
    expect(blobs).toHaveLength(blobsAfterFirst + 1)
    expect(blobs.filter((b) => b.content === '<p>hi</p>')).toHaveLength(1)
  })

  test('empty workspace snapshots nothing', async () => {
    seedProject(PID)
    const result = await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'nothing' })
    expect(result.created).toBe(false)
    expect(result.version).toBeNull()
  })
})

describe('integrity validation', () => {
  test('a healthy version validates; a missing blob is reported as corrupt', async () => {
    seedProject(PID)
    await seedWorkspace([['app.js', 'console.log(1)']])
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'init' })
    const ok = await validateVersionIntegrity(PID, 1)
    expect(ok.ok).toBe(true)

    failBlobLookups = true // simulate lost content store
    const bad = await validateVersionIntegrity(PID, 1)
    expect(bad.ok).toBe(false)
    expect(bad.missingBlobs).toEqual(['app.js'])
    expect(bad.detail).toMatch(/incomplete/)
    failBlobLookups = false
  })

  test('unknown version -> VersionError NOT_FOUND', async () => {
    seedProject(PID)
    await expect(validateVersionIntegrity(PID, 99)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(validateVersionIntegrity(PID, 99)).rejects.toBeInstanceOf(VersionError)
  })

  test('getVersionFileContent returns historical content', async () => {
    seedProject(PID)
    await seedWorkspace([['app.js', 'const a = 1']])
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'init' })
    const content = await getVersionFileContent(PID, 1, 'app.js')
    expect(content).toBe('const a = 1')
    await expect(getVersionFileContent(PID, 1, 'nope.js')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('rollbackToVersion', () => {
  test('rollback restores the exact file set and creates a NEW version (history intact)', async () => {
    seedProject(PID)
    await seedWorkspace([
      ['index.html', '<html>v1</html>'],
      ['app.js', 'v1'],
    ])
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'v1' })

    // turn 2: modify app.js AND add extra.js
    const appRow = [...files.values()].find((f) => f.path === 'app.js')!
    await fakeDb.codeFile.update({ where: { id: appRow.id }, data: { content: 'v2' } })
    await fakeDb.codeFile.create({ data: { projectId: PID, path: 'extra.js', content: 'added later' } })
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'v2 changes' })
    expect(versions).toHaveLength(2)

    const rollback = await rollbackToVersion(PID, 1)
    expect(rollback.restoredVersion).toBe(1)
    expect(rollback.newVersion?.seq).toBe(3)
    expect(rollback.newVersion?.kind).toBe('rollback')

    // workspace restored: app.js back to v1, extra.js GONE, index.html untouched
    const restored = new Map([...files.values()].map((f) => [f.path, f.content]))
    expect(restored.get('app.js')).toBe('v1')
    expect(restored.has('extra.js')).toBe(false)
    expect(restored.get('index.html')).toBe('<html>v1</html>')

    // history is append-only: v1 and v2 both still exist and validate
    const list = await listVersions(PID)
    expect(list.map((v) => v.seq).sort((a, b) => a - b)).toEqual([1, 2, 3])
    for (const seq of [1, 2, 3]) {
      expect((await validateVersionIntegrity(PID, seq)).ok).toBe(true)
    }
    // the rollback version's change list is the real one
    const v3 = versions.find((v) => v.seq === 3)!
    const changed = JSON.parse(v3.changedFilesJson ?? '[]') as Array<{ path: string; change: string }>
    expect(changed.some((c) => c.path === 'app.js' && c.change === 'modified')).toBe(true)
    expect(changed.some((c) => c.path === 'extra.js' && c.change === 'deleted')).toBe(true)
  })

  test('rollback refuses a corrupt version (integrity gate)', async () => {
    seedProject(PID)
    await seedWorkspace([['app.js', 'v1']])
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'init' })
    failBlobLookups = true
    await expect(rollbackToVersion(PID, 1)).rejects.toMatchObject({ code: 'CORRUPT' })
    failBlobLookups = false
    // workspace untouched by the refused rollback
    expect([...files.values()]).toHaveLength(1)
  })
})

describe('compareVersions', () => {
  test('version vs current: real diffs, stats and rename detection', async () => {
    seedProject(PID)
    await seedWorkspace([
      ['app.js', 'line1\nline2\nline3'],
      ['old.css', 'body {}'],
    ])
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'init' })

    const app = [...files.values()].find((f) => f.path === 'app.js')!
    await fakeDb.codeFile.update({ where: { id: app.id }, data: { content: 'line1\nCHANGED\nline3\nline4' } })
    await fakeDb.codeFile.create({ data: { projectId: PID, path: 'styles.css', content: 'body {}' } })
    const oldRow = [...files.values()].find((f) => f.path === 'old.css')!
    await fakeDb.codeFile.delete({ where: { id: oldRow.id } })

    const cmp = await compareVersions(PID, { seq: 1 }, 'current')
    expect(cmp.from.label).toBe('version 1')
    expect(cmp.to.label).toBe('current workspace')
    expect(cmp.modified).toEqual([{ path: 'app.js', added: 2, removed: 1 }])
    // styles.css is a RENAME of old.css (same content) — it is consumed by
    // the rename, not double-listed as added, and old.css is not deleted.
    expect(cmp.added).toEqual([])
    expect(cmp.renamed).toContainEqual({ path: 'styles.css', previousPath: 'old.css' })
    expect(cmp.deleted).toEqual([])
    const rows = cmp.diffs['app.js'] ?? []
    expect(rows.some((r) => r.type === 'add' && r.text === 'CHANGED')).toBe(true)
    expect(rows.some((r) => r.type === 'add' && r.text === 'line4')).toBe(true)
    expect(rows.some((r) => r.type === 'del' && r.text === 'line2')).toBe(true)
    expect(cmp.truncated).toBe(false)
  })

  test('identical sets compare empty', async () => {
    seedProject(PID)
    await seedWorkspace([['app.js', 'same']])
    await snapshotProjectVersion({ projectId: PID, kind: 'turn', summary: 'init' })
    const cmp = await compareVersions(PID, { seq: 1 }, 'current')
    expect(cmp.modified).toHaveLength(0)
    expect(cmp.added).toHaveLength(0)
    expect(cmp.deleted).toHaveLength(0)
  })
})

describe('buildChangeDiffs budget', () => {
  test('payload budget truncates honestly and keeps stats real', () => {
    const before = Array.from({ length: 500 }, (_, i) => `old line ${i} padding padding padding`).join('\n')
    const after = Array.from({ length: 500 }, (_, i) => `new line ${i} padding padding padding`).join('\n')
    const changes = [{ path: 'big.js', change: 'modified' as const }]
    const { stats, truncated, diffs } = buildChangeDiffs(changes, () => before, () => after, 2000)
    expect(stats['big.js']).toEqual({ added: 500, removed: 500 })
    expect(truncated).toBe(true)
    expect((diffs['big.js'] ?? []).length).toBeLessThan(500)
  })
})
