/**
 * BEAN Intelligence — CODE GIFTZ dependency & build management analysis (M22).
 *
 * PURE static analysis over the project's persisted file set:
 *   - package-manager detection from lockfiles (npm / bun / pnpm / yarn);
 *   - package.json + lockfile presence inspection;
 *   - missing imports (bare specifiers not declared, relative specifiers with
 *     no resolvable target file);
 *   - declared-but-unused dependencies (honest heuristic, caveats recorded);
 *   - version sanity (duplicate declarations across dep sections, wildcard
 *     / non-pinned ranges recorded as notes, never "resolved" fake versions);
 *   - build-script validation (referenced local files must exist).
 *
 * No execution happens here. Any real install/build attempt goes through the
 * EXISTING sandbox runner with explicit approval (see the build route), and
 * its result — including an honest failure caused by the sandbox's network
 * isolation — is recorded verbatim, never papered over.
 */

export interface DependencyReport {
  packageManager: { name: 'npm' | 'bun' | 'pnpm' | 'yarn' | 'none'; lockfile: string | null }
  hasPackageJson: boolean
  hasLockfile: boolean
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scriptCount: number
  analyzedFiles: number
  missingImports: Array<{ path: string; module: string; kind: 'bare' | 'relative' }>
  unusedDependencies: string[]
  duplicateDeclarations: Array<{ dependency: string; dependencies: string; devDependencies: string }>
  unpinnedRanges: Array<{ dependency: string; range: string }>
  buildScripts: Array<{ name: string; command: string; valid: boolean; issue: string | null }>
  notes: string[]
}

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
])
const NODE_PREFIX = 'node:'

const LOCKFILES: Array<{ file: string; manager: DependencyReport['packageManager']['name'] }> = [
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
]

/** Import/require specifiers found in a JS/TS source text (static regex scan). */
export function extractModuleSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  const patterns = [
    /import\s+[^;'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /export\s+[^;'"]*?from\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) {
      if (m[1]) specifiers.add(m[1])
    }
  }
  return [...specifiers]
}

const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']

/** Normalize a relative base dir + specifier to a project path (pure). */
export function resolveRelativePath(baseDir: string, spec: string): string {
  const segments = [...baseDir.split('/').filter(Boolean), ...spec.split('/')]
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** Possible file-set hits for a relative specifier (pure). */
export function relativeCandidates(spec: string): string[] {
  const ext = spec.match(/\.(js|jsx|ts|tsx|mjs|cjs|css|json|svg|png|jpg|jpeg|gif|webp|md|html)$/i)?.[0] ?? null
  const base = ext ? spec.slice(0, spec.length - ext.length) : spec
  const candidates = [spec]
  if (ext) {
    // exact extension given — also allow source-extension resolution from JS
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      candidates.push(`${base}.ts`, `${base}.tsx`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`)
    }
  } else {
    for (const e of CODE_EXTENSIONS) candidates.push(`${base}${e}`)
    for (const e of CODE_EXTENSIONS) candidates.push(`${base}/index${e}`)
  }
  return candidates
}

interface ParsedPackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

export function analyzeDependencies(files: Array<{ path: string; content: string }>): DependencyReport {
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  const codeFiles = files.filter((f) => CODE_EXTENSIONS.some((e) => f.path.endsWith(e)) && !f.path.includes('node_modules/'))
  const lockfile = LOCKFILES.find((l) => byPath.has(l.file)) ?? null
  const pkgRaw = byPath.get('package.json') ?? null

  let pkg: ParsedPackageJson | null = null
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw) as ParsedPackageJson
    } catch {
      pkg = null
    }
  }
  const dependencies = pkg?.dependencies ?? {}
  const devDependencies = pkg?.devDependencies ?? {}
  const scripts = pkg?.scripts ?? {}
  const declared = new Set([...Object.keys(dependencies), ...Object.keys(devDependencies)])

  const notes: string[] = []
  if (pkgRaw && !pkg) notes.push('package.json exists but is not valid JSON — dependency inspection is limited to static import checks.')
  if (files.some((f) => f.path.includes('node_modules/'))) notes.push('node_modules entries are part of the file set and are ignored by this analysis.')

  // ---- import scan ---------------------------------------------------------
  const missingImports: DependencyReport['missingImports'] = []
  const usedSpecifiers = new Set<string>()
  for (const f of codeFiles) {
    const baseDir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    for (const spec of extractModuleSpecifiers(f.content)) {
      usedSpecifiers.add(spec)
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
        const specPath = spec.startsWith('/') ? spec.slice(1) : resolveRelativePath(baseDir, spec)
        const candidates = relativeCandidates(specPath)
        if (!candidates.some((c) => byPath.has(c))) {
          missingImports.push({ path: f.path, module: spec, kind: 'relative' })
        }
        continue
      }
      if (spec.startsWith(NODE_PREFIX) || NODE_BUILTINS.has(spec.split('/')[0])) continue
      const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (!declared.has(root)) {
        missingImports.push({ path: f.path, module: spec, kind: 'bare' })
      }
    }
  }

  // ---- unused dependencies (honest heuristic) ------------------------------
  const unusedDependencies: string[] = []
  for (const dep of declared) {
    const used = [...usedSpecifiers].some((s) => {
      const root = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]
      return root === dep
    })
    if (!used) unusedDependencies.push(dep)
  }
  if (unusedDependencies.length > 0) {
    notes.push(
      'Unused-dependency detection is a heuristic over static import/require statements: runtime-only usage ' +
        '(config files, plugin registries, generated CSS references) can false-positive. Verify before removing anything.',
    )
  }

  // ---- version sanity ------------------------------------------------------
  const duplicateDeclarations: DependencyReport['duplicateDeclarations'] = []
  const unpinnedRanges: DependencyReport['unpinnedRanges'] = []
  for (const dep of Object.keys(dependencies)) {
    if (dep in devDependencies) {
      duplicateDeclarations.push({ dependency: dep, dependencies: dependencies[dep], devDependencies: devDependencies[dep] })
    }
  }
  for (const [dep, range] of [...Object.entries(dependencies), ...Object.entries(devDependencies)]) {
    if (range === '*' || range === 'latest' || /^[xX]$/.test(range)) {
      unpinnedRanges.push({ dependency: dep, range })
    }
  }
  if (unpinnedRanges.length > 0) {
    notes.push('Unpinned version ranges (*) cannot be resolved without an install — they are recorded, never guessed.')
  }
  notes.push(
    'This is static analysis only. Actual installation/builds run exclusively inside the existing isolated sandbox ' +
      '(explicit approval required); the sandbox has no network, so dependency DOWNLOADS inside it fail honestly rather than silently succeeding.',
  )

  // ---- build-script validation --------------------------------------------
  const buildScripts: DependencyReport['buildScripts'] = []
  for (const [name, command] of Object.entries(scripts)) {
    let issue: string | null = null
    // Local file references in the script (e.g. "node server.js", "tsc -p tsconfig.json").
    const tokens = command.split(/\s+/)
    for (const token of tokens) {
      const clean = token.replace(/["']/g, '')
      if (!/^[a-zA-Z0-9._\-/]+\.[a-zA-Z0-9]+$/.test(clean)) continue
      if (clean.includes('/') && clean.startsWith('/')) continue
      // Heuristic: tokens that look like config/entry files must exist.
      if (/\.(json|js|ts|tsx|jsx|mjs|cjs|html|css)$/.test(clean) && !clean.startsWith('-')) {
        const candidates = clean.includes('/')
          ? [clean]
          : [clean, ...CODE_EXTENSIONS.map((e) => clean.replace(/\.[a-z]+$/, e))]
        if (!candidates.some((c) => byPath.has(c))) {
          issue = `referenced file "${clean}" is not part of the project`
          break
        }
      }
    }
    buildScripts.push({ name, command, valid: issue === null, issue })
  }

  return {
    packageManager: lockfile ? { name: lockfile.manager, lockfile: lockfile.file } : { name: pkgRaw ? 'npm (default — no lockfile)' as 'npm' : 'none', lockfile: null },
    hasPackageJson: pkgRaw !== null,
    hasLockfile: lockfile !== null,
    dependencies,
    devDependencies,
    scriptCount: Object.keys(scripts).length,
    analyzedFiles: codeFiles.length,
    missingImports,
    unusedDependencies,
    duplicateDeclarations,
    unpinnedRanges,
    buildScripts,
    notes,
  }
}
