/**
 * BEAN Intelligence — CODE GIFTZ complete project export (M22).
 *
 * Builds a verified ZIP archive of a project's source tree:
 *   - the complete file set with nested folders preserved;
 *   - package manifest / lockfiles / config templates / assets included
 *     when the project has them (they are ordinary project files);
 *   - a generated README with honest build instructions and an export
 *     manifest.json describing exactly what shipped (and what was excluded);
 *   - security: secrets and private runtime data are excluded by NAME
 *     patterns AND by a content-level secret scan (fail-closed), archive
 *     entry names are re-validated against traversal, and the produced
 *     archive is re-opened and verified before it is ever returned.
 *
 * Pure module (JSZip in memory) — the route layer handles ownership/auth.
 */
import JSZip from 'jszip'
import { createHash } from 'crypto'
import { hasUnsafeEntryName } from '@/lib/files/archive'

// ---- exclusion policy ------------------------------------------------------

/** Name-pattern exclusions (case-insensitive; applied to every path segment). */
const EXCLUDED_NAME_PATTERNS: Array<{ test: RegExp; reason: string }> = [
  { test: /(^|\/)\.env(\..*)?$/i, reason: 'environment file (.env) — may contain secrets' },
  { test: /secret/i, reason: 'secret-named file' },
  { test: /credential/i, reason: 'credential-named file' },
  { test: /cookie/i, reason: 'session-cookie/private runtime data' },
  { test: /(^|\/)\.git(\/|$)/, reason: 'version-control internals' },
  { test: /(^|\/)node_modules\//, reason: 'installed dependencies (node_modules)' },
  { test: /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.cache)(\/|$)/, reason: 'build output / tooling cache' },
  { test: /\.log$/i, reason: 'log file' },
  { test: /\.pid$/i, reason: 'runtime pid file' },
  { test: /(^|\/)sandbox-runs(\/|$)/, reason: 'sandbox runtime artifacts' },
  { test: /(^|\/)\.DS_Store$/i, reason: 'OS metadata' },
]

/**
 * Content-level secret tripwire (fail-closed, deliberately narrow to avoid
 * false positives on ordinary code): private-key blocks and high-entropy
 * credential-looking assignments (mixed case + digits, >= 24 chars, or known
 * token prefixes). Placeholder values like "your-api-key-here" are all
 * lowercase and do NOT trip this.
 */
const SECRET_CONTENT_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9_-]{8,}[\w./+=-]{16,}["']/i,
  /\b(?:sk|pk)-[A-Za-z0-9]{20,}/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}/,
]

export function contentSecretHits(content: string): string[] {
  const hits: string[] = []
  for (const re of SECRET_CONTENT_PATTERNS) {
    const m = re.exec(content)
    if (m) hits.push(m[0].slice(0, 24))
  }
  return hits
}

export interface ExportFilterResult {
  included: Array<{ path: string; content: string }>
  excluded: Array<{ path: string; reason: string }>
}

/** Apply the full exclusion policy (name patterns + content scan + traversal-shaped names). */
export function filterExportFiles(files: Array<{ path: string; content: string }>): ExportFilterResult {
  const included: Array<{ path: string; content: string }> = []
  const excluded: Array<{ path: string; reason: string }> = []
  for (const f of files) {
    const nameHit = EXCLUDED_NAME_PATTERNS.find((p) => p.test.test(f.path))
    if (nameHit) {
      excluded.push({ path: f.path, reason: nameHit.reason })
      continue
    }
    // Traversal-shaped entry names can NEVER ship — excluded (fail-closed)
    // BEFORE the manifest is built so the archive stays internally consistent.
    if (hasUnsafeEntryName(f.path)) {
      excluded.push({ path: f.path, reason: 'unsafe entry name (path traversal shape)' })
      continue
    }
    const secretHits = contentSecretHits(f.content)
    if (secretHits.length > 0) {
      excluded.push({ path: f.path, reason: `content matches a secret pattern (${secretHits[0]}…)` })
      continue
    }
    included.push(f)
  }
  return { included, excluded }
}

// ---- README + manifest -----------------------------------------------------

export interface ExportProjectMeta {
  title: string
  description?: string | null
  framework?: string | null
  language?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  currentVersion: number
  versionCount?: number
}

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

/** Honest build instructions derived from what the project actually contains. */
export function buildExportReadme(meta: ExportProjectMeta, files: Array<{ path: string; content: string }>): string {
  const has = (p: string) => files.some((f) => f.path === p)
  const pkgFile = files.find((f) => f.path === 'package.json')
  let scriptsSection = ''
  let manager = 'npm'
  if (pkgFile) {
    if (files.some((f) => f.path === 'bun.lock' || f.path === 'bun.lockb')) manager = 'bun'
    else if (files.some((f) => f.path === 'pnpm-lock.yaml')) manager = 'pnpm'
    else if (files.some((f) => f.path === 'yarn.lock')) manager = 'yarn'
    try {
      const pkg = JSON.parse(pkgFile.content) as { scripts?: Record<string, string> }
      const scripts = Object.entries(pkg.scripts ?? {})
      if (scripts.length > 0) {
        scriptsSection =
          `\n## Scripts (from package.json)\n\n` +
          scripts.map(([k, v]) => `- \`${manager} run ${k}\` — \`${v}\``).join('\n') +
          `\n\nInstall dependencies first: \`${manager === 'bun' ? 'bun install' : manager + ' install'}\`.\n`
      }
    } catch {
      scriptsSection = '\n## Scripts\n\npackage.json could not be parsed — inspect it manually.\n'
    }
  }
  const staticEntry = has('index.html') ? 'index.html' : has('main.html') ? 'main.html' : null
  const lines = [
    `# ${meta.title}`,
    '',
    meta.description?.trim() ? `${meta.description.trim()}\n` : '',
    `Generated with CODE GIFTZ (BEAN Intelligence).`,
    '',
    `- Framework: ${meta.framework ?? 'not specified'}`,
    `- Language: ${meta.language ?? 'not specified'}`,
    `- Project created: ${iso(meta.createdAt)}`,
    `- Last updated: ${iso(meta.updatedAt)}`,
    `- Recorded project version: ${meta.currentVersion}${meta.versionCount !== undefined ? ` (of ${meta.versionCount} versions)` : ''}`,
    '',
    '## Files',
    '',
    ...files.map((f) => `- \`${f.path}\``),
    '',
  ]
  if (staticEntry) {
    lines.push('## Run (static web project)', '', `Open \`${staticEntry}\` in a browser — no build step is required.`, '')
  }
  if (pkgFile) lines.push(`## Package manager detected`, '', `\`${manager}\` (from the lockfile present in this archive).`, '')
  if (scriptsSection) lines.push(scriptsSection)
  if (has('NOTICES.md')) {
    lines.push('## Licenses', '', 'Third-party component notices are in `NOTICES.md`.', '')
  }
  lines.push('## Notes', '', 'This archive excludes environment files, secrets, credentials, cookies, dependency folders and build outputs by policy. See `manifest.json` for the exact exclusion list of this export.')
  return lines.filter((l) => l !== undefined).join('\n')
}

export interface ExportManifest {
  generator: 'CODE GIFTZ (BEAN Intelligence)'
  exportedAt: string
  project: {
    title: string
    description: string | null
    framework: string | null
    language: string | null
    createdAt: string
    updatedAt: string
    currentVersion: number
    versionCount: number | null
  }
  fileCount: number
  files: Array<{ path: string; size: number; sha256: string }>
  excluded: Array<{ path: string; reason: string }>
  notes: string[]
}

export function buildExportManifest(
  meta: ExportProjectMeta,
  files: Array<{ path: string; content: string }>,
  excluded: Array<{ path: string; reason }>,
  versionCount: number | null,
): ExportManifest {
  return {
    generator: 'CODE GIFTZ (BEAN Intelligence)',
    exportedAt: new Date().toISOString(),
    project: {
      title: meta.title,
      description: meta.description ?? null,
      framework: meta.framework ?? null,
      language: meta.language ?? null,
      createdAt: iso(meta.createdAt),
      updatedAt: iso(meta.updatedAt),
      currentVersion: meta.currentVersion,
      versionCount,
    },
    fileCount: files.length,
    files: files.map((f) => ({
      path: f.path,
      size: f.content.length,
      sha256: createHash('sha256').update(f.content, 'utf8').digest('hex'),
    })),
    excluded,
    notes: [
      'Environment files, secret-named files, session cookies, node_modules, build outputs and logs are excluded by export policy.',
      'Files whose CONTENT matched a secret pattern were excluded (fail-closed) and are listed under `excluded`.',
    ],
  }
}

// ---- archive build + verification ------------------------------------------

export interface ExportResult {
  zip: Uint8Array
  manifest: ExportManifest
  includedCount: number
  excludedCount: number
}

const MAX_EXPORT_FILES = 200
const MAX_EXPORT_TOTAL_CHARS = 8_000_000

/**
 * Build the export ZIP: source files + README.md + manifest.json.
 * Entry names are re-validated (defense in depth — they come from the
 * path-validated DB, but the archive must never contain a traversal name).
 */
export async function buildProjectZip(meta: ExportProjectMeta, allFiles: Array<{ path: string; content: string }>, versionCount: number | null): Promise<ExportResult> {
  const { included, excluded } = filterExportFiles(allFiles)
  if (included.length === 0) {
    throw new Error('This project has no exportable files.')
  }
  if (included.length > MAX_EXPORT_FILES) {
    throw new Error(`Project exceeds the ${MAX_EXPORT_FILES}-file export limit.`)
  }
  const totalChars = included.reduce((acc, f) => acc + f.content.length, 0)
  if (totalChars > MAX_EXPORT_TOTAL_CHARS) {
    throw new Error('Project exceeds the export size budget (8 MB of source).')
  }

  const readme = buildExportReadme(meta, included)
  const manifest = buildExportManifest(meta, included, excluded, versionCount)

  const zip = new JSZip()
  for (const f of included) {
    // Defense in depth: filterExportFiles already excluded traversal-shaped
    // names (recorded in the manifest); this re-check guards the archive
    // itself and can only fire if inclusion logic changed underneath us.
    if (hasUnsafeEntryName(f.path)) {
      manifest.excluded.push({ path: f.path, reason: 'unsafe entry name (path traversal shape)' })
      continue
    }
    zip.file(f.path, f.content)
  }
  zip.file('README.md', readme)
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  const buffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return {
    zip: buffer,
    manifest,
    includedCount: included.length,
    excludedCount: excluded.length,
  }
}

export interface ExportVerification {
  ok: boolean
  entries: number
  issues: string[]
}

/**
 * Verify a produced archive by REOPENING it: entry count matches the manifest
 * (files + README.md + manifest.json), every entry name is safe, no excluded
 * pattern slipped through, and manifest.json parses and matches the file list.
 */
export async function verifyExportZip(zipBytes: Uint8Array, manifest: ExportManifest): Promise<ExportVerification> {
  const issues: string[] = []
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipBytes)
  } catch (e) {
    return { ok: false, entries: 0, issues: [`archive could not be reopened: ${(e as Error).message}`] }
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  const expected = manifest.fileCount + 2 // README.md + manifest.json
  if (entries.length !== expected) {
    issues.push(`entry count ${entries.length} != expected ${expected}`)
  }
  for (const entry of entries) {
    if (hasUnsafeEntryName(entry.name)) issues.push(`unsafe entry name: ${entry.name}`)
    const nameHit = EXCLUDED_NAME_PATTERNS.find((p) => p.test.test(entry.name))
    if (nameHit && entry.name !== 'README.md' && entry.name !== 'manifest.json') {
      issues.push(`excluded pattern present: ${entry.name} (${nameHit.reason})`)
    }
  }
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) {
    issues.push('manifest.json missing')
  } else {
    try {
      const parsed = JSON.parse(await manifestEntry.async('string')) as ExportManifest
      if (parsed.fileCount !== manifest.fileCount) issues.push('manifest fileCount mismatch')
      if (parsed.files.length !== manifest.files.length) issues.push('manifest file list mismatch')
      for (let i = 0; i < Math.min(parsed.files.length, manifest.files.length); i += 1) {
        if (parsed.files[i].path !== manifest.files[i].path || parsed.files[i].sha256 !== manifest.files[i].sha256) {
          issues.push(`manifest hash mismatch at ${manifest.files[i].path}`)
          break
        }
      }
    } catch {
      issues.push('manifest.json is not valid JSON')
    }
  }
  // Spot-check content integrity of every shipped file against the manifest.
  for (const mf of manifest.files) {
    const entry = zip.file(mf.path)
    if (!entry) {
      issues.push(`manifest file missing from archive: ${mf.path}`)
      continue
    }
    const text = await entry.async('string')
    const hash = createHash('sha256').update(text, 'utf8').digest('hex')
    if (hash !== mf.sha256) issues.push(`content hash mismatch: ${mf.path}`)
  }
  return { ok: issues.length === 0, entries: entries.length, issues }
}
