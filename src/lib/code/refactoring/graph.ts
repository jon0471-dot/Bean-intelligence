/**
 * BEAN Intelligence — CODE GIFTZ project dependency graph (M25).
 *
 * A PURE, STATIC, file-level project model built on the EXISTING analysis
 * primitives (`extractModuleSpecifiers`/resolution from dependency-analysis,
 * specifier resolution semantics from file-ops/references). It adds what those
 * modules never tracked:
 *   - per-file classification (component / page / service / util / style /
 *     config / test / asset / doc / entry) from path + content shape;
 *   - per-file EXPORTED and DECLARED symbol index (static regex parsing — the
 *     same honest tier as every other analyzer in this codebase);
 *   - import EDGES with resolution status: a verified edge points at a file
 *     that actually exists in the project; unresolved specifiers are recorded,
 *     never guessed into edges;
 *   - incremental re-analysis: only changed files are re-parsed, the rest of
 *     the graph is reused (edges re-pointed when a target path moved).
 *
 * HONESTY CONTRACT: dynamic imports are followed only when statically
 * resolvable; an arbitrary string match is never promoted to an import; the
 * graph never claims complete dependency coverage — `notes` carries the
 * recorded caveats.
 *
 * SERVER-ONLY semantics, PURE functions (no I/O, no DB).
 */
import { extractModuleSpecifiers, resolveRelativePath, relativeCandidates } from '@/lib/code/dependency-analysis'

// ---- types ------------------------------------------------------------------

export type FileKind =
  | 'entry' // index.html / main.<ext> style entry points
  | 'page' // page/route-shaped source files
  | 'component' // .tsx/.jsx UI components (or exported React-shaped symbols)
  | 'service' // api/fetch/data-access shaped modules
  | 'util' // shared helpers/lib
  | 'style' // css/scss
  | 'config' // json/js/ts configuration
  | 'test' // *.test.* / *.spec.*
  | 'asset' // images/fonts/etc
  | 'doc' // markdown/text
  | 'other'

export interface SymbolInfo {
  name: string
  kind: 'function' | 'const' | 'class' | 'type' | 'interface' | 'enum' | 'default' | 'reexport'
  /** Exported from this file (vs declared local-only). */
  exported: boolean
}

export interface ImportEdge {
  /** Raw specifier text as written. */
  specifier: string
  /** Project path the specifier resolves to — null when unresolved. */
  resolvedPath: string | null
  /** True only when resolvedPath exists in the project file set. */
  verified: boolean
  kind: 'static' | 'dynamic'
  /** Named bindings imported from the module (`[]` for side-effect/default-only). */
  bindingNames: string[]
  /** True when the import is a default import binding. */
  defaultBinding: boolean
  /** `import * as NS` binding name, when present. */
  namespaceBinding?: string
  /** 1-based line of the import statement (first occurrence). */
  line: number
}

export interface GraphNode {
  path: string
  kind: FileKind
  language: 'ts' | 'tsx' | 'js' | 'jsx' | 'css' | 'html' | 'json' | 'md' | 'other'
  symbols: SymbolInfo[]
  imports: ImportEdge[]
  /** Importer count (in-degree over verified edges). */
  importedByCount: number
}

export interface ProjectGraph {
  nodes: Map<string, GraphNode>
  /** Specifiers that could not be resolved to a project file (per file). */
  unresolved: Array<{ path: string; specifier: string; kind: 'static' | 'dynamic' }>
  /** Recorded caveats — the graph never claims complete coverage. */
  notes: string[]
  /** True when built from a full file set (vs partially updated). */
  complete: boolean
}

// ---- classification ----------------------------------------------------------

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i

function languageOf(path: string): GraphNode['language'] {
  if (/\.tsx$/i.test(path)) return 'tsx'
  if (/\.ts$/i.test(path)) return 'ts'
  if (/\.jsx$/i.test(path)) return 'jsx'
  if (/\.mjs$/.test(path) || /\.cjs$/.test(path) || /\.js$/i.test(path)) return 'js'
  if (/\.(css|scss|sass)$/i.test(path)) return 'css'
  if (/\.html?$/i.test(path)) return 'html'
  if (/\.json$/i.test(path)) return 'json'
  if (/\.(md|txt)$/i.test(path)) return 'md'
  return 'other'
}

/** File-kind classification: path shape first, content shape second (honest, cheap). */
export function classifyFile(path: string, content: string): FileKind {
  const lower = path.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|mp3|mp4|wav|ogg)$/i.test(lower)) return 'asset'
  if (/\.(css|scss|sass)$/i.test(lower)) return 'style'
  if (/\.(md|txt)$/i.test(lower)) return 'doc'
  if (/(^|\/)(\.[\w.-]+|tsconfig[^/]*|package\.json|\.env[^/]*|vite\.config|next\.config|tailwind\.config|postcss\.config)(\.|$)/i.test(lower) || /\.json$/i.test(lower)) return 'config'
  if (/\.(test|spec)\.[a-z]+$/i.test(lower) || /(^|\/)(__tests__|tests?|spec)(\/|$)/i.test(lower)) return 'test'
  if (/(^|\/)(index\.html|main\.(js|ts|tsx|jsx|py|html)|app\.(js|ts|html))$/i.test(lower)) return 'entry'
  if (/(^|\/)(pages?|views?|routes?|screens?)\//i.test(lower) || /(^|\/)(page|route|layout)\.(tsx|jsx|js|ts)$/i.test(lower)) return 'page'
  if (/(^|\/)(services?|api|data|store|stores|hooks?)\//i.test(lower) || /(^|\/)(api|service|fetch|client|store)\.[a-z]+$/i.test(lower)) return 'service'
  if (/(^|\/)(lib|utils?|helpers?|shared|common)\//i.test(lower) || /(^|\/)(utils?|helpers?)\.[a-z]+$/i.test(lower)) return 'util'
  if (CODE_EXT.test(lower)) {
    // Content shape: a default-exported PascalCase function or a named-export
    // file in a components folder is a component.
    if (/(^|\/)(components?|ui|elements|widgets)\//i.test(lower)) return 'component'
    if (/export\s+default\s+(?:async\s+)?function\s+[A-Z]/.test(content) || /export\s+(?:async\s+)?function\s+[A-Z]\w*\s*\(/.test(content)) return 'component'
    return 'other'
  }
  return 'other'
}

// ---- symbol extraction (static, honest tier) --------------------------------

const EXPORT_PATTERNS: Array<{ re: RegExp; kind: SymbolInfo['kind'] }> = [
  { re: /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'default' },
  { re: /export\s+default\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'default' },
  { re: /export\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|\n|$)/g, kind: 'default' },
  { re: /export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g, kind: 'function' },
  { re: /export\s+const\s+([A-Za-z_$][\w$]*)/g, kind: 'const' },
  { re: /export\s+let\s+([A-Za-z_$][\w$]*)/g, kind: 'const' },
  { re: /export\s+var\s+([A-Za-z_$][\w$]*)/g, kind: 'const' },
  { re: /export\s+class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { re: /export\s+type\s+([A-Za-z_$][\w$]*)/g, kind: 'type' },
  { re: /export\s+interface\s+([A-Za-z_$][\w$]*)/g, kind: 'interface' },
  { re: /export\s+enum\s+([A-Za-z_$][\w$]*)/g, kind: 'enum' },
]

const DECLARATION_PATTERNS: Array<{ re: RegExp; kind: SymbolInfo['kind'] }> = [
  { re: /(?:^|\n)\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g, kind: 'function' },
  { re: /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { re: /(?:^|\n)\s*(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g, kind: 'type' },
]

/** Extract exported + top-level declared symbols of a JS/TS source (pure). */
export function extractSymbols(source: string): SymbolInfo[] {
  const byName = new Map<string, SymbolInfo>()
  const add = (name: string, kind: SymbolInfo['kind'], exported: boolean) => {
    const existing = byName.get(name)
    if (existing) {
      if (exported) existing.exported = true
      return
    }
    byName.set(name, { name, kind, exported })
  }
  for (const { re, kind } of EXPORT_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) add(m[1], kind, true)
  }
  // Named export lists: export { A, B as C } (not `export ... from`).
  const namedListRe = /export\s*\{([^}]*)\}(?!\s*from)/g
  let m: RegExpExecArray | null
  while ((m = namedListRe.exec(source)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) add(name, 'const', true)
    }
  }
  for (const { re, kind } of DECLARATION_PATTERNS) {
    re.lastIndex = 0
    let d: RegExpExecArray | null
    while ((d = re.exec(source)) !== null) add(d[1], kind, byName.get(d[1])?.exported ?? false)
  }
  return [...byName.values()]
}

// ---- import edge extraction ---------------------------------------------------

interface ParsedImport {
  specifier: string
  kind: 'static' | 'dynamic'
  bindingNames: string[]
  defaultBinding: boolean
  namespaceBinding?: string
  line: number
}

const IMPORT_RE =
  /import\s+(?:type\s+)?([A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"\n]+)['"]|import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"\n]+)['"]|import\s*['"]([^'"\n]+)['"]/g
const NAMESPACE_RE = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"\n]+)['"]/g
const DYNAMIC_RE = /import\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g
const EXPORT_FROM_RE = /export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"\n]+)['"]/g
const REQUIRE_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g

function lineAt(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < content.length; i += 1) if (content.charCodeAt(i) === 10) line += 1
  return line
}

/** Parse the import statements of one source file (pure, line-attributed). */
export function parseImports(source: string): ParsedImport[] {
  const out: ParsedImport[] = []
  const push = (specifier: string, kind: ParsedImport['kind'], bindings: string[], hasDefault: boolean, index: number, namespaceBinding?: string) =>
    out.push({ specifier, kind, bindingNames: bindings, defaultBinding: hasDefault, ...(namespaceBinding ? { namespaceBinding } : {}), line: lineAt(source, index) })

  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(source)) !== null) {
    if (m[3] !== undefined) {
      // import Default, { A, B } from 'x'
      const named = (m[2] ?? '')
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim().replace(/^type\s+/, ''))
        .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
      push(m[3], 'static', named, Boolean(m[1]?.trim()), m.index)
    } else if (m[5] !== undefined) {
      push(m[5], 'static', [], true, m.index)
    } else if (m[6] !== undefined) {
      push(m[6], 'static', [], false, m.index)
    }
  }
  EXPORT_FROM_RE.lastIndex = 0
  while ((m = EXPORT_FROM_RE.exec(source)) !== null) {
    const named = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
    push(m[2], 'static', named, false, m.index)
  }
  NAMESPACE_RE.lastIndex = 0
  while ((m = NAMESPACE_RE.exec(source)) !== null) push(m[2], 'static', [], false, m.index, m[1])
  DYNAMIC_RE.lastIndex = 0
  while ((m = DYNAMIC_RE.exec(source)) !== null) push(m[1], 'dynamic', [], false, m.index)
  REQUIRE_RE.lastIndex = 0
  while ((m = REQUIRE_RE.exec(source)) !== null) push(m[2], 'static', [], true, m.index)
  return out
}

/** M26 (audit R-1): typed scope refusal for oversized projects (chat flows map it honestly). */
export class RefactorScopeError extends Error {}

/** Resolve a specifier against the project file set (same semantics as the reference scanner). */
export function resolveSpecifier(fromPath: string, spec: string, paths: Set<string>): string | null {
  let resolved: string | null
  if (spec.startsWith('@/')) resolved = spec.slice(2)
  // M26 (audit R-4): root-relative '/…' specifiers were neither edges nor
  // unresolved entries — rename-symbol's importer coverage could miss them
  // while move-module (via the M23 scanner) caught them. They now resolve
  // exactly like '@/…' (same root-relative semantics).
  else if (spec.startsWith('/')) resolved = spec.slice(1)
  else if (spec.startsWith('.')) resolved = resolveRelativePath(fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '', spec)
  else return null // bare specifiers are packages — never project edges here
  if (paths.has(resolved)) return resolved
  for (const c of relativeCandidates(resolved)) if (paths.has(c)) return c
  return null
}

// ---- graph build / incremental update -----------------------------------------

function parseNode(path: string, content: string, paths: Set<string>): { node: GraphNode; unresolved: ProjectGraph['unresolved'] } {
  const language = languageOf(path)
  const kind = classifyFile(path, content)
  const symbols = language === 'ts' || language === 'tsx' || language === 'js' || language === 'jsx' ? extractSymbols(content) : []
  const imports: ImportEdge[] = []
  const unresolved: ProjectGraph['unresolved'] = []
  if (language === 'ts' || language === 'tsx' || language === 'js' || language === 'jsx' || language === 'css' || language === 'html') {
    for (const imp of parseImports(content)) {
      const resolvedPath = resolveSpecifier(path, imp.specifier, paths)
      imports.push({
        specifier: imp.specifier,
        resolvedPath,
        verified: resolvedPath !== null,
        kind: imp.kind,
        bindingNames: imp.bindingNames,
        defaultBinding: imp.defaultBinding,
        ...(imp.namespaceBinding ? { namespaceBinding: imp.namespaceBinding } : {}),
        line: imp.line,
      })
      if (resolvedPath === null && imp.specifier.startsWith('.')) {
        unresolved.push({ path, specifier: imp.specifier, kind: imp.kind })
      }
    }
  }
  return { node: { path, kind, language, symbols, imports, importedByCount: 0 }, unresolved }
}

function recountInDegrees(nodes: Map<string, GraphNode>): void {
  for (const node of nodes.values()) node.importedByCount = 0
  for (const node of nodes.values()) {
    for (const edge of node.imports) {
      if (edge.verified && edge.resolvedPath) {
        const target = nodes.get(edge.resolvedPath)
        if (target) target.importedByCount += 1
      }
    }
  }
}

// M26 (audit R-1): the graph build is now BOUNDED — generated/dependency
// directories are excluded and the file set is capped with an honest typed
// refusal. Previously every refactoring turn re-parsed the ENTIRE file set
// (up to 4x per turn across detect/plan/validate/execute) with no cap: a
// 5,000-file project paid linear multi-second parse cost with no metric and
// no refusal.
export const GRAPH_EXCLUDED_DIR_PARTS = ['node_modules', '.next', 'dist', 'build', 'coverage', '.git'] as const
export const GRAPH_MAX_FILES = 2_000

export function graphFileExcluded(path: string): boolean {
  const parts = path.split('/')
  return parts.some((part) => (GRAPH_EXCLUDED_DIR_PARTS as readonly string[]).includes(part))
}

export function buildProjectGraph(files: Array<{ path: string; content: string }>): ProjectGraph {
  const usable = files.filter((f) => !graphFileExcluded(f.path))
  if (usable.length > GRAPH_MAX_FILES) {
    throw new RefactorScopeError(
      `This project has ${usable.length} analyzable files — multi-file refactoring analyzes at most ${GRAPH_MAX_FILES} per turn. ` +
        `Scope the request to a specific folder (e.g. "move utils.js into lib" for one folder) or export the project and refactor locally.`,
    )
  }
  const paths = new Set(usable.map((f) => f.path))
  const nodes = new Map<string, GraphNode>()
  const unresolved: ProjectGraph['unresolved'] = []
  for (const f of usable) {
    const { node, unresolved: u } = parseNode(f.path, f.content, paths)
    nodes.set(f.path, node)
    unresolved.push(...u)
  }
  recountInDegrees(nodes)
  const dynamicCount = [...nodes.values()].flatMap((n) => n.imports).filter((i) => i.kind === 'dynamic').length
  const notes = [
    'Static-analysis graph: relationships are verified only when a specifier resolves to an existing project file; unresolved relative specifiers are listed, not guessed.',
    dynamicCount > 0
      ? `${dynamicCount} dynamic import(s) present — dynamic specifiers are followed only when statically resolvable; coverage is NOT claimed to be complete.`
      : 'No dynamic imports detected in this file set.',
  ]
  return { nodes, unresolved, notes, complete: true }
}

/**
 * Incremental update: re-analyze ONLY the changed paths (content edits, added
 * or removed files); every other node is reused as-is. Edge targets that moved
 * are re-pointed when the old path vanished.
 */
export function updateGraph(
  graph: ProjectGraph,
  files: Array<{ path: string; content: string }>,
  changedPaths: string[],
): ProjectGraph {
  const changed = new Set(changedPaths)
  const paths = new Set(files.map((f) => f.path))
  const nodes = new Map<string, GraphNode>()
  const unresolved: ProjectGraph['unresolved'] = []

  for (const f of files) {
    const existing = graph.nodes.get(f.path)
    if (existing && !changed.has(f.path)) {
      // Reuse the previously parsed node; re-point edges whose target moved
      // under the same stem, drop edges whose target vanished entirely.
      const imports = existing.imports
        .map((e) => {
          if (e.resolvedPath && !paths.has(e.resolvedPath)) {
            const stem = e.resolvedPath.replace(/\.[a-z]+$/i, '')
            for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.css', '.json']) {
              if (paths.has(`${stem}${ext}`)) return { ...e, resolvedPath: `${stem}${ext}`, verified: true }
            }
            return { ...e, resolvedPath: null, verified: false }
          }
          return e
        })
        .filter((e) => e.verified || e.resolvedPath === null)
      nodes.set(f.path, { ...existing, imports })
      continue
    }
    const { node, unresolved: u } = parseNode(f.path, f.content, paths)
    nodes.set(f.path, node)
    unresolved.push(...u)
  }
  recountInDegrees(nodes)
  return { nodes, unresolved, notes: graph.notes, complete: graph.complete && changed.size === 0 }
}

// ---- graph queries --------------------------------------------------------------

/** Files whose verified edges point at `targetPath` (the importers). */
export function verifiedImportersOf(graph: ProjectGraph, targetPath: string): Array<{ path: string; edge: ImportEdge }> {
  const out: Array<{ path: string; edge: ImportEdge }> = []
  for (const node of graph.nodes.values()) {
    for (const edge of node.imports) {
      if (edge.verified && edge.resolvedPath === targetPath) out.push({ path: node.path, edge })
    }
  }
  return out
}

/**
 * Detect import cycles over VERIFIED edges only (DFS). Returns each cycle as a
 * path list (first element repeated at the end). Pure — used as a refactoring
 * RISK signal, never a hard refusal (cycles can pre-exist the refactor).
 */
export function detectCircularDependencies(graph: ProjectGraph): string[][] {
  const cycles: string[][] = []
  const state = new Map<string, 1 | 2>() // 1 = in stack, 2 = done
  const stack: string[] = []
  const visit = (path: string) => {
    state.set(path, 1)
    stack.push(path)
    const node = graph.nodes.get(path)
    for (const edge of node?.imports ?? []) {
      if (!edge.verified || !edge.resolvedPath) continue
      const s = state.get(edge.resolvedPath)
      if (s === 1) {
        const at = stack.indexOf(edge.resolvedPath)
        cycles.push([...stack.slice(at), edge.resolvedPath])
      } else if (s === undefined) {
        visit(edge.resolvedPath)
      }
    }
    stack.pop()
    state.set(path, 2)
  }
  for (const path of [...graph.nodes.keys()].sort()) if (!state.has(path)) visit(path)
  return cycles
}

/**
 * Files in the TRANSITIVE verified dependency cone of `roots` (direction 'up':
 * what these files import, transitively; 'down': what imports them). Used to
 * bound an assisted refactoring's context to the actually-affected scope.
 */
export function dependencyCone(graph: ProjectGraph, roots: string[], direction: 'up' | 'down' = 'up', limit = 60): string[] {
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0 && seen.size < limit) {
    const current = queue.shift() as string
    if (seen.has(current)) continue
    seen.add(current)
    const node = graph.nodes.get(current)
    if (!node) continue
    if (direction === 'up') {
      for (const edge of node.imports) if (edge.verified && edge.resolvedPath) queue.push(edge.resolvedPath)
    } else {
      for (const importer of verifiedImportersOf(graph, current)) queue.push(importer.path)
    }
  }
  return [...seen].sort()
}
