/**
 * BEAN Intelligence — CODE GIFTZ file-operation plan building (M23).
 *
 * Turns a detected RawIntent into a fully validated FileOpPlan against the
 * REAL current project file set: exact per-file mutations, destination
 * conflict detection (case-aware), protected-path enforcement, reference
 * impact, and a truthful consequence text the user sees BEFORE execution.
 *
 * The plan is the confirmation unit: its canonical JSON hash (planHash) binds
 * the user's confirmation to the EXACT plan they saw. A changed plan means a
 * new confirmation.
 *
 * PURE — the only inputs are the intent and the real file list.
 */
import { createHash } from 'crypto'
import {
  expandFolder,
  isFolderPath,
  convertBasename,
  normalizeProjectPath,
  type NamingConvention,
  type RawIntent,
} from './detect'
import { scanReferences } from './references'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'
import {
  FileOpError,
  type FileOpPlan,
  type PlannedMove,
  type ReferenceImpact,
} from './types'

/** Hard cap on mutations in ONE operation (matches the session file budget). */
export const MAX_BATCH_MUTATIONS = 25

/**
 * Protected system/configuration paths: deleting them would break the
 * project's build or violate an attribution contract. Rename/move stay
 * allowed (non-destructive, versioned); deletion is refused with an honest
 * message and version history remains the recovery path for everything else.
 */
const PROTECTED_DELETE = [
  'package.json',
  'notices.md',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
]

export function isProtectedFromDelete(path: string): boolean {
  const lower = path.toLowerCase()
  return PROTECTED_DELETE.some((p) => lower === p || lower.endsWith(`/${p}`))
}

/** Canonical JSON (stable key order) so the plan hash is deterministic. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** planHash = sha-256 over the canonical plan JSON — the confirmation binding. */
export function planHashOf(plan: FileOpPlan): string {
  return createHash('sha256').update(canonicalJson(plan), 'utf8').digest('hex')
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function referenceImpactOf(
  files: Array<{ path: string; content: string }>,
  affectedPaths: string[],
): ReferenceImpact[] {
  return scanReferences(files, affectedPaths).map((r) => ({
    path: r.path,
    lines: r.lines,
    sample: r.sample,
  }))
}

function consequenceFor(
  kind: FileOpPlan['kind'],
  moves: PlannedMove[],
  deletes: string[] | undefined,
  creates: Array<{ path: string }> | undefined,
  impact: ReferenceImpact[],
  caseOnly: boolean,
): string {
  const parts: string[] = []
  if (kind === 'delete') {
    parts.push(
      deletes && deletes.length > 1
        ? `Deletes ${deletes.length} file(s) (recursive folder deletion).`
        : `Deletes ${deletes?.[0] ?? 'the target'}.`,
    )
    parts.push('This is destructive — it needs your explicit confirmation. Version history keeps a full rollback path (restore from the Versions panel afterwards).')
  } else if (creates && creates.length > 0) {
    parts.push(`Creates ${creates.map((c) => c.path).join(', ')}.`)
    if (creates.some((c) => c.path.endsWith('/.gitkeep'))) {
      parts.push('Folders materialize as a conventional empty-folder marker (.gitkeep); files you add inside replace it.')
    }
  } else {
    const m = moves[0]
    parts.push(
      moves.length === 1 && m
        ? `${caseOnly ? 'Case-only rename' : 'Renames/moves'} ${m.from} → ${m.to}.`
        : `Performs ${moves.length} file move(s)/rename(s).`,
    )
    parts.push('File contents are preserved byte-for-byte.')
  }
  if (impact.length > 0) {
    parts.push(
      `${impact.length} file(s) reference the affected path(s) and their imports/references may break — a separate reviewable repair is offered after the operation.`,
    )
  }
  return parts.join(' ')
}

/** A destination is free when no file exists there (case-insensitively) except `except`. */
function destinationTaken(
  to: string,
  byPath: Map<string, { path: string; content: string }>,
  except?: string,
): string | null {
  const lower = to.toLowerCase()
  for (const row of byPath.values()) {
    if (except && row.path === except) continue
    if (row.path.toLowerCase() === lower) return row.path
  }
  return null
}

function folderMoves(prefix: string, newPath: string, files: Array<{ path: string }>): PlannedMove[] {
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`
  const newWithSlash = newPath.endsWith('/') ? newPath : `${newPath}/`
  return expandFolder(prefix, files).map((p) => ({ from: p, to: newWithSlash + p.slice(withSlash.length), isFolder: true }))
}

function anyFolderCollision(moves: PlannedMove[], byPath: Map<string, { path: string; content: string }>, except?: string): string[] {
  const conflicts: string[] = []
  // The operation's own sources are excluded from destination collisions —
  // a case-only rename (Button.tsx → button.tsx) collides with ITSELF, which
  // is exactly the rename being performed, not a real conflict.
  const excluded = new Set(moves.map((m) => m.from.toLowerCase()))
  if (except) excluded.add(except.toLowerCase())
  const taken = new Map<string, string>() // lowercased path → real path
  for (const row of byPath.values()) taken.set(row.path.toLowerCase(), row.path)
  for (const m of moves) {
    const existing = taken.get(m.to.toLowerCase())
    if (existing && !excluded.has(existing.toLowerCase())) {
      conflicts.push(m.to)
    }
  }
  // Duplicate destinations WITHIN the batch are conflicts too.
  const seen = new Set<string>()
  for (const m of moves) {
    const key = m.to.toLowerCase()
    if (seen.has(key)) conflicts.push(m.to)
    seen.add(key)
  }
  return [...new Set(conflicts)]
}

/**
 * Build a validated FileOpPlan (or throw FileOpError for invalid requests).
 * `files` is the REAL current project file set (paths + contents).
 */
export function buildFileOpPlan(intent: RawIntent, files: Array<{ path: string; content: string }>): FileOpPlan {
  const byPath = new Map(files.map((f) => [f.path, f]))

  const validatePath = (p: string): string => {
    const normalized = normalizeProjectPath(p)
    assertSafeProjectPath(normalized)
    return normalized
  }

  const checkRoot = (p: string) => {
    if (!p || p === '.' ) {
      throw new FileOpError('INVALID', 'The project root itself cannot be renamed, moved or deleted.')
    }
  }

  // ---- create ---------------------------------------------------------------
  if (intent.kind === 'create') {
    const path = validatePath(intent.destination ?? '')
    checkRoot(path)
    const isFolderEarly = intent.createIsFolder === true
    // A folder "exists" when its marker exists (folders materialize as
    // .gitkeep markers); a file exists by its own path.
    if (byPath.has(path) || (isFolderEarly && byPath.has(`${path}/.gitkeep`))) {
      throw new FileOpError('CONFLICT', `${path} already exists in this project.`)
    }
    // A folder create inside an existing FILE path is invalid (e.g. src/App.tsx/x).
    for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
      const parent = path.slice(0, i)
      if (byPath.has(parent)) {
        throw new FileOpError('CONFLICT', `${parent} is an existing file — cannot create a folder inside it.`)
      }
    }
    const isFolder = intent.createIsFolder === true
    const creates = isFolder ? [{ path: `${path}/.gitkeep`, withContent: false }] : [{ path, withContent: intent.createContent !== undefined && intent.createContent.length > 0 }]
    const plan: FileOpPlan = {
      kind: 'create',
      targets: [{ path, isFolder }],
      destination: path,
      moves: [],
      creates,
      ...(intent.createContent ? { createContent: intent.createContent } : {}),
      deletes: undefined,
      conflicts: [],
      referenceImpact: [],
      requiresConfirmation: false,
      consequence: consequenceFor('create', [], undefined, creates, [], false),
    }
    return plan
  }

  // ---- delete ---------------------------------------------------------------
  if (intent.kind === 'delete') {
    const target = intent.sources[0]
    if (!target) throw new FileOpError('INVALID', 'No deletion target was resolved.')
    checkRoot(target.path)
    validatePath(target.path) // defense in depth: sources are server-resolved, still re-validated
    if (isProtectedFromDelete(target.path)) {
      throw new FileOpError(
        'PROTECTED',
        `${target.path} is a protected project/system file and cannot be deleted through file operations. It can be edited instead, and the project itself can be deleted with its confirmation flow.`,
      )
    }
    const deletes = target.isFolder ? expandFolder(target.path, files) : [target.path]
    if (deletes.length === 0) {
      throw new FileOpError('NOT_FOUND', `${target.path} does not contain any project files.`)
    }
    if (deletes.length > MAX_BATCH_MUTATIONS) {
      throw new FileOpError('LIMIT', `This deletion would remove ${deletes.length} files — the per-operation limit is ${MAX_BATCH_MUTATIONS}. Split it into smaller deletions.`)
    }
    const plan: FileOpPlan = {
      kind: 'delete',
      targets: [target],
      moves: [],
      deletes,
      conflicts: [],
      referenceImpact: [],
      requiresConfirmation: true,
      consequence: consequenceFor('delete', [], deletes, undefined, [], false),
    }
    return plan
  }

  // ---- rename / move --------------------------------------------------------
  if (intent.kind === 'rename' || intent.kind === 'move') {
    const source = intent.sources[0]
    if (!source) throw new FileOpError('INVALID', 'No source path was resolved.')
    checkRoot(source.path)
    validatePath(source.path) // defense in depth
    const destToken = validatePath(intent.destination ?? '')
    let moves: PlannedMove[]
    let caseOnly = false

    if (source.isFolder) {
      // FOLDER rename (new name, same parent) or FOLDER move (into a directory).
      const parent = dirOf(source.path)
      let newPath: string
      if (intent.kind === 'move') {
        // "move X into Y" — Y is ALWAYS the destination directory (existing
        // or implicitly created); the folder keeps its basename.
        newPath = `${destToken}/${basenameOf(source.path)}`
      } else if (!destToken.includes('/') || (dirnameOf(destToken) === parent && !isFolderPath(destToken, files))) {
        // Bare new name (or a full path in the same parent without an existing
        // folder there) → rename in place.
        newPath = parent ? `${parent}/${basenameOf(destToken)}` : basenameOf(destToken)
      } else if (isFolderPath(destToken, files)) {
        // Existing destination folder → move the folder inside it.
        newPath = `${destToken}/${basenameOf(source.path)}`
      } else {
        // Full destination path → move/rename to that exact prefix.
        newPath = destToken
      }
      if (newPath === source.path) {
        throw new FileOpError('INVALID', 'The source and destination are identical.')
      }
      if (newPath.startsWith(`${source.path}/`)) {
        throw new FileOpError('INVALID', `Cannot move a folder into itself or into one of its own subfolders (${source.path} → ${newPath}).`)
      }
      moves = folderMoves(source.path, newPath, files)
      if (moves.length === 0) {
        throw new FileOpError('NOT_FOUND', `${source.path} does not contain any project files.`)
      }
      if (moves.length > MAX_BATCH_MUTATIONS) {
        throw new FileOpError('LIMIT', `This folder operation would move ${moves.length} files — the per-operation limit is ${MAX_BATCH_MUTATIONS}.`)
      }
      caseOnly = newPath.toLowerCase() === source.path.toLowerCase()
      const conflicts = anyFolderCollision(moves, byPath, source.path)
      const impact = referenceImpactOf(files, [source.path])
      const plan: FileOpPlan = {
        kind: intent.kind,
        targets: [source],
        destination: newPath,
        moves,
        conflicts,
        referenceImpact: impact,
        requiresConfirmation: false,
        consequence: consequenceFor(intent.kind, moves, undefined, undefined, impact, caseOnly),
      }
      return plan
    }

    // Single FILE rename/move.
    const src = source.path
    let to: string
    const destIsFolder = isFolderPath(destToken, files)
    if (destIsFolder) {
      to = `${destToken}/${basenameOf(src)}` // move into an existing folder
    } else if (/\.\w{1,8}$/.test(destToken)) {
      to = destToken // full destination path supplied
    } else if (intent.kind === 'rename') {
      // Bare new name → keep the current extension (shown in the plan, never hidden).
      const dot = src.lastIndexOf('.')
      const ext = dot > 0 ? src.slice(dot) : ''
      to = destToken.endsWith(ext) ? destToken : destToken + ext
    } else {
      to = `${destToken}/${basenameOf(src)}` // bare token → treat as directory
    }
    to = validatePath(to)
    if (to === src) {
      throw new FileOpError('INVALID', 'The source and destination are identical.')
    }
    caseOnly = to.toLowerCase() === src.toLowerCase()
    // Case-insensitive conflict check, excluding the source row itself.
    const taken = destinationTaken(to, byPath, src)
    if (taken) {
      throw new FileOpError('CONFLICT', `${to} already exists (${taken}) — choose a different name or move the existing file first.`)
    }
    // Rename/move INTO a path that is inside a file (e.g. src/App.tsx/x).
    for (let i = to.indexOf('/'); i !== -1; i = to.indexOf('/', i + 1)) {
      if (byPath.has(to.slice(0, i))) {
        throw new FileOpError('CONFLICT', `${to.slice(0, i)} is an existing file — cannot place ${to} inside it.`)
      }
    }
    const moves1: PlannedMove[] = [{ from: src, to, isFolder: false }]
    const impact = referenceImpactOf(files, [src])
    const plan: FileOpPlan = {
      kind: intent.kind,
      targets: [source],
      destination: to,
      moves: moves1,
      conflicts: [],
      referenceImpact: impact,
      requiresConfirmation: false,
      consequence: consequenceFor(intent.kind, moves1, undefined, undefined, impact, caseOnly),
    }
    return plan
  }

  // ---- batch-move -----------------------------------------------------------
  if (intent.kind === 'batch-move') {
    const destToken = validatePath(intent.destination ?? '')
    if (byPath.has(destToken)) {
      throw new FileOpError('CONFLICT', `${destToken} is an existing file — cannot move files into it.`)
    }
    const moves: PlannedMove[] = []
    for (const source of intent.sources) {
      checkRoot(source.path)
      validatePath(source.path) // defense in depth
      if (source.isFolder) {
        const into = `${destToken}/${basenameOf(source.path)}`
        if (into.startsWith(`${source.path}/`)) {
          throw new FileOpError('INVALID', `Cannot move ${source.path} into its own subfolder (${into}).`)
        }
        moves.push(...folderMoves(source.path, into, files))
      } else {
        moves.push({ from: source.path, to: `${destToken}/${basenameOf(source.path)}`, isFolder: false })
      }
    }
    if (moves.length === 0) throw new FileOpError('INVALID', 'No source paths were resolved.')
    if (moves.length > MAX_BATCH_MUTATIONS) {
      throw new FileOpError('LIMIT', `This batch would move ${moves.length} files — the per-operation limit is ${MAX_BATCH_MUTATIONS}.`)
    }
    const conflicts = anyFolderCollision(moves, byPath)
    const impact = referenceImpactOf(files, moves.map((m) => m.from))
    const plan: FileOpPlan = {
      kind: 'batch-move',
      targets: intent.sources,
      destination: destToken,
      moves,
      conflicts,
      referenceImpact: impact,
      requiresConfirmation: false,
      consequence: consequenceFor('batch-move', moves, undefined, undefined, impact, false),
    }
    return plan
  }

  // ---- batch-rename ---------------------------------------------------------
  const scope = intent.sources[0]
  if (!scope || !scope.isFolder || !intent.convention) {
    throw new FileOpError('INVALID', 'A batch rename needs a folder scope and a naming convention.')
  }
  const convention = intent.convention as NamingConvention
  const scoped = expandFolder(scope.path, files).filter((p) => {
    if (p.endsWith('/.gitkeep')) return false
    if (intent.extensionFilter) return p.endsWith(intent.extensionFilter)
    return true
  })
  if (scoped.length === 0) {
    throw new FileOpError(
      'NOT_FOUND',
      `No files${intent.extensionFilter ? ` matching ${intent.extensionFilter}` : ''} were found under ${scope.path}.`,
    )
  }
  if (scoped.length > MAX_BATCH_MUTATIONS) {
    throw new FileOpError('LIMIT', `This batch would rename ${scoped.length} files — the per-operation limit is ${MAX_BATCH_MUTATIONS}.`)
  }
  const moves: PlannedMove[] = scoped
    .map((p) => {
      const parent = dirOf(p)
      const next = convertBasename(basenameOf(p), convention)
      return { from: p, to: parent ? `${parent}/${next}` : next, isFolder: false }
    })
    .filter((m) => m.to !== m.from) // files already following the convention are no-ops
  if (moves.length === 0) {
    throw new FileOpError('NOT_FOUND', `All files under ${scope.path} already follow ${convention} — nothing to rename.`)
  }
  const conflicts = anyFolderCollision(moves, byPath)
  const impact = referenceImpactOf(files, moves.map((m) => m.from))
  const plan: FileOpPlan = {
    kind: 'batch-rename',
    targets: [scope],
    convention,
    moves,
    conflicts,
    referenceImpact: impact,
    requiresConfirmation: false,
    consequence: consequenceFor('batch-rename', moves, undefined, undefined, impact, false),
  }
  return plan
}

function dirnameOf(path: string): string {
  return dirOf(path)
}
