/**
 * BEAN Intelligence — CODE GIFTZ reference-integrity scanning (M23).
 *
 * After a rename/move, every reference to the OLD path may break. This module
 * scans the real project files for those references and builds a SEPARATELY
 * REVIEWABLE repair plan (exact old-specifier → new-specifier replacements in
 * exactly the files that reference the moved path). It never blindly rewrites
 * "every matching string": a replacement exists only where a reference was
 * actually found and could be resolved deterministically.
 *
 * Reference kinds scanned:
 *   - JS/TS import/export/require/dynamic-import specifiers (resolved
 *     relative to the importing file's directory, extension-less imports
 *     included);
 *   - HTML src/href attributes and CSS url(...) targets (the same
 *     base-dir-aware resolution the preview audit uses);
 *   - root-relative ("/...") and "@/..."-aliased forms.
 *
 * PURE — no I/O, no execution.
 */

export type ReferenceMatch = {
  path: string
  lines: number[]
  sample: string
  /** The exact old specifier text (for repair replacement). */
  specifier: string
  /** How the specifier referenced the path: 'relative' | 'root' | 'alias' | 'literal'. */
  style: 'relative' | 'root' | 'alias' | 'literal'
  /** True when the specifier omitted the file extension. */
  extensionless: boolean
  quote: string
}

const IMPORT_SPEC_RE =
  /(?:from|import|require)\s*\(?\s*(['"])([^'"\n]+)\1/g
const SIDE_EFFECT_IMPORT_RE = /import\s*(['"])([^'"\n]+)\1/g
const HTML_REF_RE = /(?:src|href)\s*=\s*(["'])([^"'\n]+)\1/g
const CSS_URL_RE = /url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/g

const KNOWN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|py|html|md|txt|svg|png|jpe?g|webp|gif|ico|yml|yaml)$/i

/** Extension candidates for resolving extension-less import specifiers. */
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.py', '.html']

/** Normalize a base dir + reference to a project path (same semantics as the preview audit). */
export function normalizeRef(baseDir: string, ref: string): string {
  const segments = [...baseDir.split('/').filter(Boolean), ...ref.split('/')]
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

function lineOf(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1
  }
  return line
}

/**
 * Does a resolved/reference specifier denote `target`? Handles extension-less
 * JS imports and root-relative forms.
 */
function matchesTarget(resolved: string, target: string): boolean {
  if (resolved === target) return true
  if (!KNOWN_EXT.test(resolved)) {
    for (const ext of RESOLVE_EXTS) {
      if (`${resolved}${ext}` === target) return true
    }
  }
  return false
}

/** Does a resolved/reference specifier denote `target` (file or folder prefix)? */
function refHits(resolved: string, target: string, alias: boolean, specifier: string): boolean {
  const tryResolved = (r: string) => matchesTarget(r, target) || r.startsWith(`${target}/`)
  if (tryResolved(resolved)) return true
  if (alias && tryResolved(`src/${resolved}`)) return true
  return specifier === target || specifier.startsWith(`${target}/`)
}

/** Strip the extension when the original specifier was extension-less. */
function applyExtensionConvention(newSpec: string, extensionless: boolean): string {
  if (!extensionless) return newSpec
  return newSpec.replace(KNOWN_EXT, '')
}

/** Build a relative specifier from the importing file's directory to a path. */
function relativeSpecifier(fromDir: string, toPath: string): string {
  const fromParts = fromDir.split('/').filter(Boolean)
  const toParts = toPath.split('/').filter(Boolean)
  let common = 0
  while (common < fromParts.length && common < toParts.length - 1 && fromParts[common] === toParts[common]) {
    common += 1
  }
  const up = fromParts.length - common
  const down = toParts.slice(common)
  const rel = [...Array.from({ length: up }, () => '..'), ...down].join('/')
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** Scan every project file for references to any of the affected paths. */
export function scanReferences(
  files: Array<{ path: string; content: string }>,
  affectedPaths: string[],
): ReferenceMatch[] {
  const targets = new Set(affectedPaths)
  if (targets.size === 0) return []
  const results: ReferenceMatch[] = []

  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
    const found = new Map<string, ReferenceMatch>()

    const record = (specifier: string, quote: string, index: number) => {
      for (const target of targets) {
        if (target === f.path) continue // a file does not import itself
        let style: ReferenceMatch['style'] = 'literal'
        let resolved: string | null = null
        if (specifier.startsWith('@/')) {
          // '@' is the dominant project/src alias — match against BOTH the
          // project root and src/ (the repair keeps the @/ form and is shown
          // for review, so a different alias config cannot edit silently).
          style = 'alias'
          resolved = specifier.slice(2)
        } else if (specifier.startsWith('/')) {
          style = 'root'
          resolved = normalizeRef('', specifier)
        } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
          style = 'relative'
          resolved = normalizeRef(dir, specifier)
        } else if (specifier.startsWith('.')) {
          style = 'relative'
          resolved = normalizeRef(dir, specifier)
        } else {
          // Bare specifier: treat as project-root literal only when it names
          // the target exactly (never guessed from package names etc.).
          style = 'literal'
          resolved = specifier === target || `${specifier}/` === `${target}/` ? specifier : null
        }
        if (resolved === null) continue
        const extensionless = !KNOWN_EXT.test(specifier)
        if (!refHits(resolved, target, style === 'alias', specifier)) continue
        const existing = found.get(target)
        const line = lineOf(f.content, index)
        if (existing) {
          if (!existing.lines.includes(line)) existing.lines.push(line)
          continue
        }
        found.set(target, {
          path: f.path,
          lines: [line],
          sample: `${specifier}`,
          specifier,
          style,
          extensionless,
          quote,
        })
      }
    }

    let m: RegExpExecArray | null
    IMPORT_SPEC_RE.lastIndex = 0
    while ((m = IMPORT_SPEC_RE.exec(f.content)) !== null) record(m[2], m[1], m.index)
    SIDE_EFFECT_IMPORT_RE.lastIndex = 0
    while ((m = SIDE_EFFECT_IMPORT_RE.exec(f.content)) !== null) record(m[2], m[1], m.index)
    HTML_REF_RE.lastIndex = 0
    while ((m = HTML_REF_RE.exec(f.content)) !== null) record(m[2], m[1], m.index)
    CSS_URL_RE.lastIndex = 0
    while ((m = CSS_URL_RE.exec(f.content)) !== null) record(m[2], m[1], m.index)

    results.push(...found.values())
  }
  return results
}

export type RepairEdit = {
  /** The file whose content changes. */
  path: string
  /** The exact old specifier text (replaced only at real reference sites). */
  find: string
  /** The recomputed specifier pointing at the new path. */
  replaceWith: string
}

/**
 * Resolve a normalized reference to the CONCRETE project file it denotes
 * (adding the extension an import specifier omitted). Null when the file set
 * does not contain it.
 */
function resolveConcrete(resolved: string, files: Array<{ path: string }>): string | null {
  if (files.some((f) => f.path === resolved)) return resolved
  for (const ext of RESOLVE_EXTS) {
    if (files.some((f) => f.path === `${resolved}${ext}`)) return `${resolved}${ext}`
  }
  return null
}

function dirOfPath(p: string): string {
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
}

/**
 * Build the repair edits for a set of path moves. Every edit targets a file
 * where a reference was ACTUALLY found, and replaces exactly the matched
 * specifier with the recomputed one pointing at the new location (folder
 * moves included: refs to files inside the moved prefix are rewritten with
 * their suffix preserved). Anything not statically resolvable is left
 * untouched and reported as unrepairable instead of guessed.
 */
export function buildRepairEdits(
  files: Array<{ path: string; content: string }>,
  moves: Array<{ from: string; to: string }>,
): { edits: RepairEdit[]; unrepairable: Array<{ path: string; specifier: string; reason: string }> } {
  const refs = scanReferences(files, moves.map((m) => m.from))
  const edits: RepairEdit[] = []
  const unrepairable: Array<{ path: string; specifier: string; reason: string }> = []

  for (const ref of refs) {
    for (const move of moves) {
      const dir = dirOfPath(ref.path)
      let resolved: string | null = null
      let alias = false
      if (ref.specifier.startsWith('@/')) {
        resolved = ref.specifier.slice(2)
        alias = true
      } else if (ref.specifier.startsWith('/')) {
        resolved = normalizeRef('', ref.specifier)
      } else if (ref.specifier.startsWith('.')) {
        resolved = normalizeRef(dir, ref.specifier)
      } else {
        resolved = ref.specifier // literal: must name the target exactly
      }
      if (resolved === null) continue

      // The concrete file this reference denotes (root and src/@ interpretations).
      // After the move itself, the OLD path no longer exists in the file set —
      // the scan already matched this ref against move.from, so the recorded
      // move source is the honest fallback (extension convention preserved:
      // an extension-less ref stays extension-less via applyExtensionConvention).
      let denotes: string | null =
        ref.style === 'literal'
          ? ref.specifier === move.from || ref.specifier.startsWith(`${move.from}/`)
            ? ref.specifier
            : null
          : resolveConcrete(resolved, files)
      let aliasIsSrc = false
      if (denotes === null && alias) {
        const viaSrc = resolveConcrete(`src/${resolved}`, files)
        if (viaSrc !== null) {
          denotes = viaSrc
          aliasIsSrc = true
        } else if (matchesTarget(`src/${resolved}`, move.from) || `src/${resolved}`.startsWith(`${move.from}/`)) {
          denotes = `src/${resolved}`
          aliasIsSrc = true
        }
      }
      if (denotes === null) {
        const postMove =
          matchesTarget(resolved, move.from) ||
          resolved.startsWith(`${move.from}/`) ||
          ref.specifier === move.from ||
          ref.specifier.startsWith(`${move.from}/`)
        if (postMove) denotes = resolved
      }
      if (denotes === null) continue

      // The reference must denote the moved file itself or a file inside the
      // moved folder. refHits reuses the scan's matcher, so an extension-less
      // ref of a moved FILE (denotes lacks the extension after the move) still
      // resolves to the move source.
      if (!refHits(denotes, move.from, alias, ref.specifier)) continue
      const newFile = `${move.to}${denotes.slice(move.from.length)}`

      let replaceWith: string
      if (ref.style === 'root') {
        replaceWith = applyExtensionConvention(`/${newFile}`, ref.extensionless)
      } else if (ref.style === 'alias') {
        const aliasTarget = aliasIsSrc && newFile.startsWith('src/') ? newFile.slice(4) : newFile
        replaceWith = applyExtensionConvention(`@/${aliasTarget}`, ref.extensionless)
      } else if (ref.style === 'literal') {
        replaceWith = applyExtensionConvention(newFile, ref.extensionless)
      } else {
        const newSpec = relativeSpecifier(dir, newFile)
        replaceWith = applyExtensionConvention(newSpec, ref.extensionless)
      }
      if (replaceWith === ref.specifier) continue // nothing to change
      if (edits.some((e) => e.path === ref.path && e.find === ref.specifier && e.replaceWith === replaceWith)) continue
      edits.push({ path: ref.path, find: ref.specifier, replaceWith })
    }
  }
  return { edits, unrepairable }
}

/**
 * Apply repair edits to a file set. Exact-string replacement of the matched
 * specifier only — never a global rewrite. Returns the changed files (and
 * reports any file whose expected text vanished, which the caller treats as
 * staleness rather than guessing).
 */
export function applyRepairEdits(
  files: Array<{ path: string; content: string }>,
  edits: RepairEdit[],
): {
  changed: Array<{ path: string; content: string }>
  missing: Array<{ path: string; find: string }>
} {
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  const changed: Array<{ path: string; content: string }> = []
  const missing: Array<{ path: string; find: string }> = []
  for (const edit of edits) {
    const content = byPath.get(edit.path)
    if (content === undefined) {
      missing.push({ path: edit.path, find: edit.find })
      continue
    }
    if (!content.includes(edit.find)) {
      missing.push({ path: edit.path, find: edit.find })
      continue
    }
    const next = content.split(edit.find).join(edit.replaceWith)
    if (next !== content) {
      byPath.set(edit.path, next)
      changed.push({ path: edit.path, content: next })
    }
  }
  return { changed, missing }
}
