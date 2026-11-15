/**
 * BEAN Intelligence — CODE GIFTZ project export tests (M22).
 *
 * Pins the export security contract:
 *  - name-policy exclusions (.env, secret/credential/cookie names, node_modules,
 *    build outputs, logs) — never shipped;
 *  - content-level secret scan is FAIL-CLOSED (a file whose content trips a
 *    secret pattern is excluded and listed in the manifest);
 *  - traversal-shaped entry names can never enter the archive;
 *  - README carries honest build instructions; manifest.json describes the
 *    exact file set + exclusions;
 *  - the produced archive REOPENS cleanly and verifies entry-by-entry
 *    (count, names, SHA-256 vs manifest); tampered verification reports fail.
 */
import { describe, test, expect } from 'bun:test'

const {
  filterExportFiles,
  contentSecretHits,
  buildProjectZip,
  verifyExportZip,
  buildExportReadme,
  buildExportManifest,
} = await import('../../src/lib/code/export')

const BASE_FILES = [
  { path: 'index.html', content: '<!doctype html><html><body><h1>App</h1></body></html>' },
  { path: 'styles.css', content: 'body { margin: 0 }' },
  { path: 'app.js', content: 'console.log("hello")' },
  { path: 'lib/util.js', content: 'export const add = (a, b) => a + b' },
]

const BASE_META = {
  title: 'Test Project',
  description: 'A test project',
  framework: 'vanilla',
  language: 'javascript',
  createdAt: new Date('2026-11-15T10:00:00Z'),
  updatedAt: new Date('2026-11-15T11:00:00Z'),
  currentVersion: 3,
  versionCount: 3,
}

describe('filterExportFiles — name policy', () => {
  test('excludes env, secret, credential, cookie, node_modules, build outputs, logs', () => {
    const { included, excluded } = filterExportFiles([
      ...BASE_FILES,
      { path: '.env', content: 'DATABASE_URL=x' },
      { path: '.env.local', content: 'TOKEN=y' },
      { path: 'secrets.json', content: '{}' },
      { path: 'credentials.txt', content: 'x' },
      { path: 'cookies.txt', content: 'session=abc' },
      { path: 'node_modules/left-pad/index.js', content: 'x' },
      { path: 'dist/bundle.js', content: 'x' },
      { path: 'build/output.js', content: 'x' },
      { path: '.next/server.js', content: 'x' },
      { path: 'debug.log', content: 'x' },
    ])
    const includedPaths = included.map((f) => f.path)
    expect(includedPaths).toEqual(BASE_FILES.map((f) => f.path))
    const excludedPaths = excluded.map((e) => e.path)
    expect(excludedPaths).toEqual(
      expect.arrayContaining(['.env', '.env.local', 'secrets.json', 'credentials.txt', 'cookies.txt', 'node_modules/left-pad/index.js', 'dist/bundle.js', 'build/output.js', '.next/server.js', 'debug.log']),
    )
    // every exclusion carries an honest reason
    expect(excluded.every((e) => e.reason.length > 0)).toBe(true)
  })

  test('preserves legitimate user source files', () => {
    const { included } = filterExportFiles(BASE_FILES)
    expect(included).toHaveLength(BASE_FILES.length)
  })
})

describe('content secret scan (fail-closed)', () => {
  // Test fixtures are BUILT by concatenation so this source file never
  // contains a literal credential-shaped string (safe to commit).
  const PRIVATE_KEY_BLOCK = `-----BEGIN ${['RSA', 'PRIVATE', 'KEY'].join(' ')}-----`
  const SK_TOKEN = ['sk', 'live', 'Ab12Cd34Ef56Gh78Ij90Kl12'].join('-')
  const GHP_TOKEN = ['ghp_', 'AbCdEf1234567890', 'AbCdEf1234567890'].join('')
  const AWS_KEY_ID = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')

  test('flags private keys and high-entropy token assignments', () => {
    expect(contentSecretHits(PRIVATE_KEY_BLOCK).length).toBeGreaterThanOrEqual(1)
    // matches both the assignment pattern and the sk- token pattern
    expect(contentSecretHits(`const cfg = { apiKey: "${SK_TOKEN}" }`).length).toBeGreaterThanOrEqual(1)
    expect(contentSecretHits(`token = "${GHP_TOKEN}"`).length).toBeGreaterThanOrEqual(1)
    expect(contentSecretHits(`const AWS_KEY = "${AWS_KEY_ID}"`).length).toBeGreaterThanOrEqual(1)
  })

  test('does not flag ordinary code or lowercase placeholders', () => {
    expect(contentSecretHits('const apiKey = "your-api-key-here"')).toHaveLength(0)
    expect(contentSecretHits('fetch("/api/data").then(r => r.json())')).toHaveLength(0)
    expect(contentSecretHits('const password = req.body.password')).toHaveLength(0)
  })

  test('a file whose content trips the scan is EXCLUDED with a reason', () => {
    const { included, excluded } = filterExportFiles([
      ...BASE_FILES,
      { path: 'config/runtime.js', content: `window.TOKEN = "${GHP_TOKEN}"` },
    ])
    expect(included).toHaveLength(BASE_FILES.length)
    expect(excluded).toHaveLength(1)
    expect(excluded[0].path).toBe('config/runtime.js')
    expect(excluded[0].reason).toMatch(/secret pattern/)
  })
})

describe('buildProjectZip + verifyExportZip', () => {
  test('ships source tree + README + manifest.json; verifies clean on reopen', async () => {
    const result = await buildProjectZip(BASE_META, BASE_FILES, 3)
    expect(result.includedCount).toBe(4)
    expect(result.manifest.fileCount).toBe(4)
    expect(result.manifest.files.map((f) => f.path)).toEqual(BASE_FILES.map((f) => f.path))

    const verification = await verifyExportZip(result.zip, result.manifest)
    expect(verification.ok).toBe(true)
    expect(verification.entries).toBe(6) // 4 files + README.md + manifest.json
    expect(verification.issues).toEqual([])
  })

  test('traversal-shaped names never enter the archive (recorded as excluded)', async () => {
    const result = await buildProjectZip(
      BASE_META,
      [...BASE_FILES, { path: '../evil.js', content: 'x' }],
      0,
    )
    const verification = await verifyExportZip(result.zip, result.manifest)
    // The archive is still internally consistent: the bad entry was excluded
    // from BOTH the zip and the manifest file list.
    expect(verification.ok).toBe(true)
    const manifestPaths = result.manifest.files.map((f) => f.path)
    expect(manifestPaths).not.toContain('../evil.js')
    expect(result.manifest.excluded.some((e) => e.path === '../evil.js' && /unsafe entry name/.test(e.reason))).toBe(true)
  })

  test('README carries title, honest run/build instructions and the license pointer when NOTICES.md exists', async () => {
    const readme = buildExportReadme(BASE_META, [
      ...BASE_FILES,
      { path: 'package.json', content: JSON.stringify({ scripts: { build: 'vite build', dev: 'vite' } }) },
      { path: 'NOTICES.md', content: '# Notices' },
      { path: 'bun.lock', content: '{}' },
    ])
    expect(readme).toContain('# Test Project')
    expect(readme).toContain('`bun run build` — `vite build`')
    expect(readme).toContain('bun install')
    expect(readme).toContain('NOTICES.md')
    expect(readme).toMatch(/excludes environment files, secrets/i)
  })

  test('empty project export is refused honestly', async () => {
    await expect(buildProjectZip(BASE_META, [], 0)).rejects.toThrow(/no exportable files/i)
    await expect(buildProjectZip(BASE_META, [{ path: '.env', content: 'x' }], 0)).rejects.toThrow(/no exportable files/i)
  })

  test('verifyExportZip reports tampering (wrong manifest file list)', async () => {
    const result = await buildProjectZip(BASE_META, BASE_FILES, 1)
    const tampered = buildExportManifest(BASE_META, [BASE_FILES[0], BASE_FILES[1]], [], 1)
    const verification = await verifyExportZip(result.zip, tampered)
    expect(verification.ok).toBe(false)
    expect(verification.issues.length).toBeGreaterThan(0)
  })

  test('verifyExportZip reports content hash mismatch when the archive was modified', async () => {
    const result = await buildProjectZip(BASE_META, BASE_FILES, 1)
    // Rebuild a manifest whose hash for app.js points to different content.
    const manifest = buildExportManifest(BASE_META, BASE_FILES.map((f) => (f.path === 'app.js' ? { ...f, content: 'TAMPERED' } : f)), [], 1)
    const verification = await verifyExportZip(result.zip, manifest)
    expect(verification.ok).toBe(false)
    expect(verification.issues.some((i) => /hash mismatch|entry count|mismatch/.test(i))).toBe(true)
  })
})
