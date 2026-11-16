/**
 * BEAN Intelligence — CODE GIFTZ refactoring plan building (M25).
 *
 * A refactoring is a STRUCTURED, SERVER-VALIDATED plan — never a free-form
 * model instruction and never an auto-executed edit. Every plan carries:
 *   - exact per-file edits (full before/after content — the reviewable diff IS
 *     the contract; nothing is applied that the user did not see);
 *   - path moves with import-specifier repairs computed from the REAL files;
 *   - the SHA-256 of every file it touches at plan time (content-level
 *     staleness binding — stronger than M23's path-level structural binding,
 *     because refactors rewrite content);
 *   - risks (export-surface changes, property-access ambiguity, cycles),
 *     unresolved references (listed, never silently rewritten), and an
 *     affected-file scope.
 *
 * Deterministic operations (rename-symbol, move-module) are built ENTIRELY
 * from the real file set — zero provider involvement. Provider-assisted
 * operations (extraction / consolidation / service layer / restructuring) are
 * assembled from a provider DRAFT by `assembleAssistedPlan` (assisted.ts),
 * which runs the same validation below before anything is stored.
 *
 * PURE — no I/O. The only crypto is the plan hash (confirmation binding,
 * reusing the M23 canonical-JSON hasher so ONE hash contract governs both
 * ledgers).
 */
import { createHash } from 'crypto'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'
import { FileOpError } from '@/lib/code/file-ops/types'
import { canonicalJson, planHashOf } from '@/lib/code/file-ops/plan'
import { buildRepairEdits } from '@/lib/code/file-ops/references'
import {
  buildProjectGraph,
  detectCircularDependencies,
  extractSymbols,
  parseImports,
  resolveSpecifier,
  verifiedImportersOf,
  type ImportEdge,
  type ProjectGraph,
} from './graph'

export type RefactorKind =
  | 'rename-symbol'
  | 'move-module'
  | 'extract-component'
  | 'extract-module'
  | 'service-layer'
  | 'consolidate'
  | 'restructure'
  | 'repair'

export const REFACTOR_ENGINE: Record<RefactorKind, 'deterministic' | 'provider-assisted'> = {
  'rename-symbol': 'deterministic',
  'move-module': 'deterministic',
  'extract-component': 'provider-assisted',
  'extract-module': 'provider-assisted',
  'service-layer': 'provider-assisted',
  consolidate: 'provider-assisted',
  restructure: 'provider-assisted',
  repair: 'provider-assisted',
}

export type RefactorEdit = {
  path: string
  /** Full content before the edit (null for created files). */
  before: string | null
  /** Full content after the edit. */
  after: string
  changeType: 'modify' | 'create' | 'move-content'
  /** For move-content edits: the path the content currently lives at. */
  fromPath?: string
}

export interface RefactorPlan {
  planVersion: 1
  kind: RefactorKind
  title: string
  reason: string
  engine: 'deterministic' | 'provider-assisted'
  /** Human-readable execution steps (shown before approval). */
  steps: string[]
  /** Exact per-file mutations — one entry per touched path. */
  edits: RefactorEdit[]
  /** Path-only moves (files whose content is unchanged but relocated). */
  moves: Array<{ from: string; to: string }>
  createdPaths: string[]
  /** Every project file considered in-scope (the affected dependency scope). */
  scopeFiles: string[]
  risks: string[]
  /** References that could NOT be safely rewritten (shown, never guessed). */
  unresolved: Array<{ path: string; specifier: string; note: string }>
  notes: string[]
  /** sha-256 of every touched EXISTING file at plan time (staleness binding). */
  sourceHashes: Record<string, string>
  affectedTests: string[]
  requiresConfirmation: true
}

export type RefactorTurnPayload = {
  status: 'awaiting_confirmation' | 'executed' | 'rejected' | 'clarification' | 'failed'
  kind?: RefactorKind
  opId?: string
  planHash?: string
  title?: string
  engine?: 'deterministic' | 'provider-assisted'
  reason?: string
  steps?: string[]
  affectedFiles?: string[]
  createdPaths?: string[]
  editsPreview?: Array<{ path: string; changeType: string; addedLines: number; removedLines: number }>
  risks?: string[]
  unresolved?: Array<{ path: string; specifier: string; note: string }>
  conflicts?: string[]
  question?: string
  consequence?: string
  versionSeq?: number | null
  result?: import('./execute').RefactorResult
}

// ---- small pure helpers --------------------------------------------------------

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** The confirmation binding for refactor plans (same canonical-JSON hasher as M23). */
export function refactorPlanHashOf(plan: RefactorPlan): string {
  return planHashOf(plan as unknown as Parameters<typeof planHashOf>[0])
}

export function canonicalPlanJson(plan: RefactorPlan): string {
  return canonicalJson(plan as unknown as Record<string, unknown>)
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/

/**
 * Is the character offset inside a simple single-line string/template literal?
 * Cheap honest heuristic: an odd number of quote characters of the same kind
 * precede the offset on the same line. Multi-line strings are NOT detected —
 * the plan's risk text covers that residual honestly.
 */
function insideQuotedString(line: string, offset: number): boolean {
  let dq = 0
  let sq = 0
  let bt = 0
  for (let i = 0; i < offset && i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"' && sq === 0 && bt === 0) dq += 1
    else if (ch === "'" && dq === 0 && bt === 0) sq += 1
    else if (ch === '`' && dq === 0 && sq === 0) bt += 1
  }
  return dq % 2 === 1 || sq % 2 === 1 || bt % 2 === 1
}

/** Line-by-line token-boundary identifier replacement. Comment lines (pure
 *  `//`, `*`, `/*`-block and `<!--` lines) and string/template content are
 *  skipped — a rename must not silently rewrite prose or literals. Returns
 *  the new content, the replacement count, and the honest skip counts. */
export function replaceIdentifierInContent(
  content: string,
  from: string,
  to: string,
  opts: { skipDotPrefixed?: boolean } = {},
): { content: string; count: number; skippedDot: number; skippedString: number } {
  const lines = content.split('\n')
  let count = 0
  let skippedDot = 0
  let skippedString = 0
  const tokenRe = new RegExp(`\\b${from.replace(/\$/g, '\\$')}\\b`, 'g')
  const isCommentLine = (line: string): boolean => {
    const t = line.trim()
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--') || t.startsWith('#')
  }
  const out = lines.map((line) => {
    tokenRe.lastIndex = 0
    if (isCommentLine(line) || !tokenRe.test(line)) {
      tokenRe.lastIndex = 0
      return line
    }
    tokenRe.lastIndex = 0
    let lineCount = 0
    let lineSkippedDot = 0
    let lineSkippedString = 0
    const replaced = line.replace(tokenRe, (match: string, offset: number, full: string) => {
      if (insideQuotedString(line, offset)) {
        lineSkippedString += 1
        return match
      }
      // `.symbol` occurrences are property accesses — rewritten ONLY when the
      // caller opts in (namespace-import case); otherwise left and counted.
      if (offset > 0 && full[offset - 1] === '.' && opts.skipDotPrefixed) {
        lineSkippedDot += 1
        return match
      }
      lineCount += 1
      return to
    })
    count += lineCount
    skippedDot += lineSkippedDot
    skippedString += lineSkippedString
    return replaced
  })
  return { content: out.join('\n'), count, skippedDot, skippedString }
}

/** Rewrite a relative/alias specifier of a moved file for its new directory. */
function rewriteOwnSpecifier(content: string, oldSpecifier: string, nextSpecifier: string): string {
  if (oldSpecifier === nextSpecifier) return content
  // Replace only inside import/require/export-from statements that reference
  // the exact specifier — never a blind content-wide replace. Each pattern
  // rebuilds the statement from ITS OWN capture groups (a shared callback
  // would misread group indices — the classic replace-callback trap).
  const escaped = oldSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns: Array<{ re: RegExp; build: (m: RegExpExecArray) => string }> = [
    { re: new RegExp(`(from\\s*)(['"])${escaped}(['"])`, 'g'), build: (m) => `${m[1]}${m[2]}${nextSpecifier}${m[3]}` },
    { re: new RegExp(`(import\\s*\\(\\s*)(['"])${escaped}(['"])(\\s*\\))`, 'g'), build: (m) => `${m[1]}${m[2]}${nextSpecifier}${m[3]}${m[4]}` },
    { re: new RegExp(`(require\\s*\\(\\s*)(['"])${escaped}(['"])(\\s*\\))`, 'g'), build: (m) => `${m[1]}${m[2]}${nextSpecifier}${m[3]}${m[4]}` },
    { re: new RegExp(`(import\\s*)(['"])${escaped}(['"])`, 'g'), build: (m) => `${m[1]}${m[2]}${nextSpecifier}${m[3]}` },
  ]
  let next = content
  for (const { re, build } of patterns) {
    next = next.replace(re, (...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[]
      return build(groups as unknown as RegExpExecArray)
    })
  }
  return next
}

/** Recompute a moved file's relative specifier for one of its own imports.
 *  Exported for the assisted engine's deterministic importer completion
 *  (measured s4 failure class) — the SAME relative-math, no second copy. */
export function specifierForTarget(fromDir: string, targetPath: string, extensionless: boolean): string {
  const fromParts = fromDir.split('/').filter(Boolean)
  const toParts = targetPath.split('/').filter(Boolean)
  let common = 0
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) common += 1
  const up = fromParts.length - common
  const down = toParts.slice(common)
  const rel = [...Array.from({ length: up }, () => '..'), ...down].join('/')
  const spec = rel.startsWith('.') ? rel : `./${rel}`
  return extensionless ? spec.replace(/\.[a-z]+$/i, '') : spec
}

// ---- deterministic operation A: rename symbol -----------------------------------

export type RenameSymbolArgs = {
  symbol: string
  newName: string
  /** Optional hint narrowing the defining file (from the user's message). */
  definingPath?: string
}

/**
 * Rename a symbol across VERIFIED references. The definition site and every
 * file that imports the symbol through a resolved specifier are rewritten
 * with token-boundary replacements; files that merely contain the token
 * WITHOUT importing it are listed as inferred matches and left untouched.
 * Throws FileOpError INVALID/CONFLICT/NOT_FOUND for honest failures.
 */
export function planRenameSymbol(files: Array<{ path: string; content: string }>, args: RenameSymbolArgs): RefactorPlan {
  const { symbol, newName } = args
  if (!IDENTIFIER_RE.test(symbol)) {
    throw new FileOpError('INVALID', `"${symbol.slice(0, 40)}" is not a code identifier — a rename applies to symbols, not to prose.`)
  }
  if (!IDENTIFIER_RE.test(newName)) {
    throw new FileOpError('INVALID', `"${newName.slice(0, 40)}" is not a valid identifier.`)
  }
  if (symbol === newName) {
    throw new FileOpError('INVALID', 'The new name is identical to the current name — nothing to rename.')
  }

  const paths = new Set(files.map((f) => f.path))
  const graph = buildProjectGraph(files)

  // 1. Locate the definition (unique).
  const definitions: Array<{ path: string; exported: boolean }> = []
  for (const node of graph.nodes.values()) {
    const sym = node.symbols.find((s) => s.name === symbol)
    if (sym) definitions.push({ path: node.path, exported: sym.exported })
  }
  if (definitions.length === 0) {
    throw new FileOpError('NOT_FOUND', `No declaration of "${symbol}" was found in this project. A rename applies to declared symbols.`)
  }
  const narrowed = args.definingPath ? definitions.filter((d) => d.path === args.definingPath) : definitions
  if (narrowed.length !== 1) {
    throw new FileOpError(
      'CONFLICT',
      narrowed.length === 0
        ? `"${symbol}" is not declared in ${args.definingPath}.`
        : `"${symbol}" is declared in ${narrowed.map((d) => d.path).join(', ')} — specify which one to rename.`,
    )
  }
  const definingPath = narrowed[0].path

  // 2. Collision check: the new name must not already exist anywhere.
  const collisions: string[] = []
  for (const node of graph.nodes.values()) {
    if (node.symbols.some((s) => s.name === newName)) collisions.push(node.path)
  }
  if (collisions.length > 0) {
    throw new FileOpError('CONFLICT', `"${newName}" is already declared in ${collisions.join(', ')} — renaming would create a symbol collision. Choose a different name.`)
  }

  // 3. Rewrites: definition file + every VERIFIED importer that binds the
  //    symbol (named binding, aliased binding, or namespace import whose
  //    `.symbol` accesses are rewritten). Aliased bindings ({ X as Y }) are
  //    handled naturally: the specifier name is rewritten, the alias is not.
  const importers = verifiedImportersOf(graph, definingPath).filter(
    ({ edge }) => edge.bindingNames.includes(symbol) || Boolean(edge.namespaceBinding),
  )
  const touched = new Set<string>([definingPath, ...importers.map((i) => i.path)])
  const edits: RefactorEdit[] = []
  const unresolved: RefactorPlan['unresolved'] = []
  const risks: string[] = []
  let totalReplacements = 0

  for (const path of [...touched].sort()) {
    const file = files.find((f) => f.path === path)
    if (!file) continue
    const isDefining = path === definingPath
    const node = graph.nodes.get(path)
    const hasNamespaceAccess =
      !isDefining && (node?.imports ?? []).some((e) => e.resolvedPath === definingPath && Boolean(e.namespaceBinding))
    const { content, count, skippedDot, skippedString } = replaceIdentifierInContent(file.content, symbol, newName, {
      // In an importer WITHOUT a namespace binding, `.symbol` property
      // accesses are left untouched (they may belong to other objects).
      skipDotPrefixed: !isDefining && !hasNamespaceAccess,
    })
    if (skippedDot > 0) {
      unresolved.push({
        path,
        specifier: `.${symbol}`,
        note: `${skippedDot} property access(es) written ".${symbol}" were NOT renamed (they may belong to other objects). Review the diff.`,
      })
      risks.push(`${path}: property-access occurrences of "${symbol}" were left unchanged.`)
    }
    if (skippedString > 0) {
      unresolved.push({
        path,
        specifier: symbol,
        note: `${skippedString} occurrence(s) inside string/template content were NOT renamed (a rename never rewrites literals).`,
      })
    }
    if (count === 0 && !isDefining) continue
    totalReplacements += count
    edits.push({ path, before: file.content, after: content, changeType: 'modify' })
  }

  // 4. Inferred-only matches: token appears in files that do NOT import it.
  for (const file of files) {
    if (touched.has(file.path)) continue
    if (!CODE_FILE_RE.test(file.path)) continue
    const re = new RegExp(`\\b${symbol.replace(/\$/g, '\\$')}\\b`)
    if (re.test(file.content)) {
      unresolved.push({
        path: file.path,
        specifier: symbol,
        note: `Contains "${symbol}" but does not import it from ${definingPath} — left untouched (possible same-name local symbol, string, or dynamic reference).`,
      })
    }
  }

  if (edits.length === 0) {
    throw new FileOpError('NOT_FOUND', `"${symbol}" is declared but never imported anywhere — only the declaration itself would change. Use a normal targeted edit for that.`)
  }
  risks.push(
    'Identifier-boundary replacement cannot see type information: review the diff, especially string/template content inside touched files, before approving.',
  )
  if (narrowed[0].exported) {
    risks.push(`"${symbol}" is exported from ${definingPath} — its public name changes to "${newName}" for every importer (updated in this plan).`)
  }

  const sourceHashes: Record<string, string> = {}
  for (const e of edits) {
    if (e.before !== null) sourceHashes[e.path] = sha256(e.before)
  }
  const affectedTests = [...touched].filter((p) => /(^|\/)(tests?|__tests__)(\/|\.|\b)|\.(test|spec)\.[a-z]+$/i.test(p))

  return {
    planVersion: 1,
    kind: 'rename-symbol',
    title: `Rename ${symbol} → ${newName}`,
    reason: `Rename the symbol "${symbol}" to "${newName}" across ${edits.length} file(s) and ${totalReplacements} occurrence(s), following verified import relationships only.`,
    engine: 'deterministic',
    steps: [
      `Locate the unique declaration of "${symbol}" (${definingPath}).`,
      `Verify no existing symbol collides with "${newName}".`,
      `Rewrite the declaration and every verified import binding with token-boundary replacements (${totalReplacements} occurrence(s) across ${edits.length} file(s)).`,
      `Report — but never rewrite — inferred matches in files that do not import the symbol (${unresolved.length} listed).`,
      'Execute as one atomic mutation and record a single version.',
    ],
    edits,
    moves: [],
    createdPaths: [],
    scopeFiles: [...touched].sort(),
    risks,
    unresolved,
    notes: [
      'Rename scope = definition file + files whose imports resolve to it. Dynamic or string-built references are outside verified scope and listed as unresolved.',
    ],
    sourceHashes,
    affectedTests,
    requiresConfirmation: true,
  }
}

const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i

// ---- deterministic operation B: move module(s) + update imports ------------------

export type MoveModuleArgs = {
  /** Project path(s) to move (file or folder). */
  sources: string[]
  /** Destination directory (existing or implicit) or full destination path for a single file. */
  destination: string
}

/**
 * Move one or more modules and update BOTH directions of the import graph in
 * ONE coherent plan:
 *   - outgoing imports of each moved file (relative specifiers recomputed for
 *     the new directory — the gap M23's two-step move leaves open);
 *   - incoming references from every importer (reusing the M23 reference
 *     scanner's exact-specifier repairs, alias/root/literal aware).
 * M23's own move flow remains available and unchanged; this builder exists so
 * a refactoring turn can present move + import updates as ONE reviewable,
 * atomically executed plan with ONE version.
 */
export function planMoveModule(files: Array<{ path: string; content: string }>, args: MoveModuleArgs): RefactorPlan {
  if (args.sources.length === 0) throw new FileOpError('INVALID', 'No module path was resolved for the move.')
  if (!args.destination) throw new FileOpError('INVALID', 'No destination was resolved for the move.')
  const destination = args.destination.replace(/\/+$/, '')
  assertSafeProjectPath(destination)

  const byPath = new Map(files.map((f) => [f.path, f.content]))
  const lowerIndex = new Map(files.map((f) => [f.path.toLowerCase(), f.path]))

  // Resolve each source against the real file set (exact > folder).
  const resolvedMoves: Array<{ from: string; to: string }> = []
  const sourcesExpanded: string[] = []
  for (const source of args.sources) {
    const src = source.replace(/\/+$/, '')
    assertSafeProjectPath(src)
    // A folder destination INSIDE the source folder would nest it into itself.
    const srcIsFolderEarly = files.some((f) => f.path.startsWith(`${src}/`))
    if (srcIsFolderEarly && (destination === src || destination.startsWith(`${src}/`))) {
      throw new FileOpError('INVALID', `Cannot move ${src} into its own subfolder (${destination}).`)
    }
    const isFolder = srcIsFolderEarly
    if (!byPath.has(src) && !isFolder) {
      // unique-basename fallback (the chat usually names bare names)
      const base = basenameOf(src)
      const byBase = files.filter((f) => basenameOf(f.path) === base)
      if (byBase.length === 1) {
        resolvedMoves.push({ from: byBase[0].path, to: `${destination}/${base}` })
        sourcesExpanded.push(byBase[0].path)
        continue
      }
      throw new FileOpError('NOT_FOUND', `${src} does not exist in this project.`)
    }
    if (isFolder) {
      const withSlash = src.endsWith('/') ? src : `${src}/`
      for (const f of files) {
        if (f.path.startsWith(withSlash)) {
          resolvedMoves.push({ from: f.path, to: `${destination}/${f.path.slice(withSlash.length)}` })
          sourcesExpanded.push(f.path)
        }
      }
    } else {
      // Single file: destination may be a directory or a full target path.
      const destIsDir = files.some((f) => f.path.startsWith(`${destination}/`))
      const to = destIsDir || !/\.\w{1,8}$/.test(destination) ? `${destination}/${basenameOf(src)}` : destination
      resolvedMoves.push({ from: src, to })
      sourcesExpanded.push(src)
    }
  }
  if (resolvedMoves.length === 0) throw new FileOpError('NOT_FOUND', 'The move resolved to zero project files.')
  if (resolvedMoves.length > 25) {
    throw new FileOpError('LIMIT', `This move affects ${resolvedMoves.length} files — the per-operation limit is 25. Split it into smaller moves.`)
  }

  // Conflict checks (case-insensitive; the move's own sources excluded).
  const conflicts: string[] = []
  const excluded = new Set(resolvedMoves.map((m) => m.from.toLowerCase()))
  for (const m of resolvedMoves) {
    const taken = lowerIndex.get(m.to.toLowerCase())
    if (taken && !excluded.has(taken.toLowerCase())) conflicts.push(m.to)
    if (m.to.startsWith(`${m.from}/`)) throw new FileOpError('INVALID', `Cannot move ${m.from} into its own subfolder (${m.to}).`)
  }
  const seenDest = new Set<string>()
  for (const m of resolvedMoves) {
    const key = m.to.toLowerCase()
    if (seenDest.has(key)) conflicts.push(m.to)
    seenDest.add(key)
  }
  if (conflicts.length > 0) {
    throw new FileOpError('CONFLICT', `Destination conflict: ${[...new Set(conflicts)].join(', ')} already exist(s).`)
  }

  const moves = resolvedMoves
  const moveFromSet = new Set(moves.map((m) => m.from))
  const moveMap = new Map(moves.map((m) => [m.from, m.to] as const))

  // Final content of every moved file (after outgoing-import rewrite).
  const finalContent = new Map<string, string>()
  const unresolved: RefactorPlan['unresolved'] = []
  for (const m of moves) {
    let content = byPath.get(m.from) ?? ''
    if (CODE_FILE_RE.test(m.from)) {
      const newDir = dirOf(m.to)
      const parsed = parseImports(content)
      for (const imp of parsed) {
        if (!imp.specifier.startsWith('.')) continue
        // Resolve against the OLD location, mapping moved targets to their new paths.
        const oldResolved = resolveSpecifier(m.from, imp.specifier, new Set(files.map((f) => f.path)))
        if (oldResolved === null) {
          unresolved.push({ path: m.to, specifier: imp.specifier, note: 'Unresolved relative import in the moved file — left untouched.' })
          continue
        }
        const targetAfterMove = moveMap.get(oldResolved) ?? oldResolved
        const nextSpec = specifierForTarget(newDir, targetAfterMove, !/\.[a-z]+$/i.test(imp.specifier))
        content = rewriteOwnSpecifier(content, imp.specifier, nextSpec)
      }
    }
    finalContent.set(m.from, content)
  }

  // Incoming references from NON-moved files (and moved files referencing
  // other moved files) — reuse the M23 scanner for exact-specifier repairs.
  const workingFiles = files.map((f) => {
    const moved = moveMap.get(f.path)
    return moved ? { path: f.path, content: finalContent.get(f.path) ?? f.content } : f
  })
  const { edits: repairEdits, unrepairable } = buildRepairEdits(workingFiles, moves)

  // Compose per-file edits: moved files carry their rewritten content; files
  // with incoming-reference repairs carry before/after with the repairs applied.
  const edits: RefactorEdit[] = []
  const repairedPaths = new Set<string>()
  for (const edit of repairEdits) {
    repairedPaths.add(edit.path)
    const content = workingFiles.find((f) => f.path === edit.path)?.content
    if (content === undefined) continue
    const after = content.split(edit.find).join(edit.replaceWith)
    const isMoved = moveMap.has(edit.path)
    edits.push({
      path: isMoved ? moveMap.get(edit.path) as string : edit.path,
      before: byPath.get(edit.path) ?? null,
      after,
      changeType: isMoved ? 'move-content' : 'modify',
      ...(isMoved ? { fromPath: edit.path } : {}),
    })
  }
  for (const m of moves) {
    const content = finalContent.get(m.from) ?? ''
    const repairForSameSource = repairEdits.some((e) => e.path === m.from)
    if (repairForSameSource) continue // already emitted as move-content above
    if (content === byPath.get(m.from)) {
      // Pure move: content unchanged after outgoing rewrite.
      edits.push({ path: m.to, before: byPath.get(m.from) ?? null, after: content, changeType: 'move-content', fromPath: m.from })
    } else {
      edits.push({ path: m.to, before: byPath.get(m.from) ?? null, after: content, changeType: 'move-content', fromPath: m.from })
    }
  }
  for (const u of unrepairable) {
    unresolved.push({ path: u.path, specifier: u.specifier, note: `Could not be repaired automatically: ${u.reason}` })
  }

  const sourceHashes: Record<string, string> = {}
  for (const m of moves) sourceHashes[m.from] = sha256(byPath.get(m.from) ?? '')
  for (const e of repairEdits) {
    const content = byPath.get(e.path)
    if (content !== undefined && sourceHashes[e.path] === undefined) sourceHashes[e.path] = sha256(content)
  }

  const touchedFiles = [...new Set([...moves.map((m) => m.from), ...repairEdits.map((e) => e.path)])].sort()
  const risks: string[] = []
  if (moves.length > 1) risks.push(`${moves.length} files move in one operation; the plan applies all-or-nothing.`)
  if (unresolved.length > 0) risks.push(`${unresolved.length} reference(s) could not be rewritten automatically — listed below, never guessed.`)
  const affectedTests = touchedFiles.filter((p) => /(^|\/)(tests?|__tests__)(\/|\.|\b)|\.(test|spec)\.[a-z]+$/i.test(p))
  const graph = buildProjectGraph(files)

  return {
    planVersion: 1,
    kind: 'move-module',
    title: moves.length === 1 ? `Move ${moves[0].from} → ${moves[0].to}` : `Move ${moves.length} modules → ${destination}/`,
    reason: `Move the module(s) and update verified imports in both directions (files importing the moved path, and the moved files' own relative imports) as one atomic change.`,
    engine: 'deterministic',
    steps: [
      `Resolve ${args.sources.length} source path(s) against the real file set (${moves.length} file(s) move).`,
      'Recompute the moved files\' own relative specifiers for the new location.',
      `Rewrite incoming references in ${repairEdits.length > 0 ? `${new Set(repairEdits.map((e) => e.path)).size} file(s)` : 'no other files'} using exact-specifier repairs.`,
      'Execute as one atomic mutation and record a single version.',
    ],
    edits,
    moves,
    createdPaths: [],
    scopeFiles: touchedFiles,
    risks,
    unresolved,
    notes: [
      'Import updates cover relative, root-relative and @/ alias forms resolved against the current file set; dynamic imports are followed only when statically resolvable.',
    ],
    sourceHashes,
    affectedTests,
    requiresConfirmation: true,
    ...(() => {
      // A moved FILE whose graph node had verified importers the repair could
      // not cover becomes an explicit risk (honest scope statement).
      const risky: string[] = []
      for (const m of moves) {
        for (const importer of verifiedImportersOf(graph, m.from)) {
          if (!repairEdits.some((e) => e.path === importer.path) && importer.path !== m.from) {
            risky.push(`${importer.path} imports ${m.from} but no automatic specifier repair was produced for it.`)
          }
        }
      }
      return risky.length > 0 ? { notes: [...[], ...[
        'Import updates cover relative, root-relative and @/ alias forms resolved against the current file set; dynamic imports are followed only when statically resolvable.',
      ]], risks: [...risks, ...risky] } : {}
    })(),
  }
}

// ---- semantic safety validation --------------------------------------------------

export type PlanSafetyReport = {
  ok: boolean
  stale: string[]
  conflicts: string[]
  symbolCollisions: string[]
  exportChanges: Array<{ path: string; lost: string[]; gained: string[] }>
  cycles: string[][]
  errors: string[]
}

/**
 * Validate a plan against the CURRENT file set (used when the plan is created
 * AND re-checked at execution time):
 *   - every modify/move-content edit's `before` must equal the live content;
 *   - one edit per path (no conflicting duplicate targets);
 *   - created paths must not exist; move targets must be free;
 *   - symbol collisions across files are REPORTED as plan risks (cross-file
 *     duplicate exports are legal ES modules — typically relocation residue —
 *     so they surface for review instead of hard-blocking; same-file
 *     duplicates and created-path conflicts stay blocking);
 *   - export-surface changes per modified file (lost/gained exports);
 *   - import cycles over verified edges AFTER the plan (risk signal).
 */
export function validateRefactorPlan(plan: RefactorPlan, files: Array<{ path: string; content: string }>): PlanSafetyReport {
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  const lowerIndex = new Map(files.map((f) => [f.path.toLowerCase(), f.path]))
  const report: PlanSafetyReport = { ok: true, stale: [], conflicts: [], symbolCollisions: [], exportChanges: [], cycles: [], errors: [] }

  const editTargets = new Set<string>()
  for (const edit of plan.edits) {
    if (editTargets.has(edit.path.toLowerCase())) {
      report.conflicts.push(`Two edits target ${edit.path} — the plan is malformed.`)
    }
    editTargets.add(edit.path.toLowerCase())

    try {
      assertSafeProjectPath(edit.path)
      if (edit.fromPath) assertSafeProjectPath(edit.fromPath)
    } catch (e) {
      report.errors.push(e instanceof Error ? e.message : `unsafe path in plan: ${edit.path}`)
    }

    if (edit.changeType === 'create') {
      if (byPath.has(edit.path) || lowerIndex.has(edit.path.toLowerCase())) {
        report.conflicts.push(`${edit.path} already exists — a create edit would overwrite it.`)
      }
      continue
    }
    const sourcePath = edit.fromPath ?? edit.path
    const current = byPath.get(sourcePath)
    if (current === undefined) {
      report.stale.push(`${sourcePath} no longer exists.`)
      continue
    }
    if (edit.before !== null && edit.before !== current) {
      report.stale.push(`${sourcePath} changed since the plan was built (content hash mismatch).`)
    }
  }
  for (const move of plan.moves) {
    const taken = lowerIndex.get(move.to.toLowerCase())
    if (taken && taken !== move.from) report.conflicts.push(`${move.to} already exists (${taken}).`)
    if (!byPath.has(move.from) && !plan.edits.some((e) => e.fromPath === move.from)) {
      report.stale.push(`${move.from} no longer exists.`)
    }
  }

  // Symbol collisions introduced by CREATED files (same exported name as an
  // existing export elsewhere — a real hazard for barrel-style imports).
  const existingExports = new Map<string, string[]>()
  for (const f of files) {
    if (!CODE_FILE_RE.test(f.path)) continue
    for (const sym of extractSymbols(f.content)) {
      if (!sym.exported) continue
      const list = existingExports.get(sym.name) ?? []
      list.push(f.path)
      existingExports.set(sym.name, list)
    }
  }
  for (const edit of plan.edits) {
    if (edit.changeType !== 'create' || !CODE_FILE_RE.test(edit.path)) continue
    for (const sym of extractSymbols(edit.after)) {
      if (!sym.exported) continue
      const holders = (existingExports.get(sym.name) ?? []).filter((p) => p !== edit.path)
      if (holders.length > 0) {
        report.symbolCollisions.push(`${edit.path} exports "${sym.name}" which is already exported by ${holders.join(', ')}.`)
      }
    }
  }

  // Export-surface changes per modified file.
  for (const edit of plan.edits) {
    if (edit.changeType === 'create' || edit.before === null || !CODE_FILE_RE.test(edit.path)) continue
    const beforeExports = extractSymbols(edit.before).filter((s) => s.exported).map((s) => s.name).sort()
    const afterExports = extractSymbols(edit.after).filter((s) => s.exported).map((s) => s.name).sort()
    const lost = beforeExports.filter((n) => !afterExports.includes(n))
    const gained = afterExports.filter((n) => !beforeExports.includes(n))
    if (lost.length > 0 || gained.length > 0) report.exportChanges.push({ path: edit.path, lost, gained })
  }

  // Cycles after the plan (verified edges only).
  const plannedFiles = files.map((f) => {
    const edit = plan.edits.find((e) => e.path === f.path || e.fromPath === f.path)
    return edit ? { path: edit.path, content: edit.after } : f
  })
  for (const move of plan.moves) {
    const idx = plannedFiles.findIndex((f) => f.path === move.from)
    if (idx >= 0) plannedFiles[idx] = { ...plannedFiles[idx], path: move.to }
  }
  const postGraph: ProjectGraph = buildProjectGraph(plannedFiles)
  report.cycles = detectCircularDependencies(postGraph)

  report.ok = report.stale.length === 0 && report.conflicts.length === 0 && report.errors.length === 0
  return report
}

/** Build a bounded, honest preview of the plan's edits (line counts via the shared diff). */
export function planEditsPreview(plan: RefactorPlan): Array<{ path: string; changeType: string; addedLines: number; removedLines: number }> {
  return plan.edits.map((e) => {
    const beforeLines = (e.before ?? '').split('\n').length
    const afterLines = e.after.split('\n').length
    return {
      path: e.path,
      changeType: e.changeType,
      addedLines: Math.max(0, afterLines - (e.before === null ? 0 : countCommon(e.before, e.after))),
      removedLines: Math.max(0, beforeLines - (e.before === null ? 0 : countCommon(e.before, e.after))),
    }
  })
}

function countCommon(a: string, b: string): number {
  const al = a.split('\n')
  const bl = b.split('\n')
  const set = new Map<string, number>()
  for (const l of al) set.set(l, (set.get(l) ?? 0) + 1)
  let common = 0
  for (const l of bl) {
    const n = set.get(l) ?? 0
    if (n > 0) {
      set.set(l, n - 1)
      common += 1
    }
  }
  return common
}

/** Human-readable consequence shown before approval (mirrors M23's honesty). */
export function refactorConsequence(plan: RefactorPlan): string {
  const modify = plan.edits.filter((e) => e.changeType === 'modify').length
  const create = plan.createdPaths.length
  const move = plan.moves.length
  const parts: string[] = []
  if (modify > 0) parts.push(`modifies ${modify} file(s)`)
  if (create > 0) parts.push(`creates ${create} file(s)`)
  if (move > 0) parts.push(`moves ${move} file(s)`)
  const head = parts.length > 0 ? `This refactoring (${plan.kind}) applies ${parts.join(', ')} as ONE atomic change.` : 'This refactoring applies no file changes.'
  const tail = plan.unresolved.length > 0 ? ` ${plan.unresolved.length} reference(s) could not be rewritten automatically — they are listed for manual review.` : ''
  const risk = plan.risks.length > 0 ? ` Risks: ${plan.risks[0]}` : ''
  return `${head}${tail}${risk} Nothing is applied until you approve the exact plan shown.`
}
