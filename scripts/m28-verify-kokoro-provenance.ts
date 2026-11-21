/**
 * BEAN Intelligence — M28 OWNER UTILITY: canonical Kokoro model-artifact
 * cross-verification against the Hugging Face repository.
 *
 * WHY THIS EXISTS (M28 Priority A): the production install of
 * onnx-community/Kokoro-82M-v1.0-ONNX was downloaded from the ModelScope
 * mirror because the sandbox egress IP was HTTP-429 rate-limited by Hugging
 * Face. Matching the mirror proves nothing about the canonical revision.
 * This utility performs the authoritative comparison from ANY machine that
 * CAN reach Hugging Face (the owner's own machine included) and records the
 * result as a canonical reference file the server-side integrity verifier
 * picks up automatically.
 *
 * WHAT IT DOES
 *  1. Resolves the pinned revision to an exact immutable commit SHA
 *     (GET /api/models/<repo>/revision/<ref> → "sha").
 *  2. Lists the repo tree AT THAT COMMIT (GET /api/models/<repo>/tree/<sha>)
 *     and takes the LFS OIDs — for LFS objects the sha256 OID IS the content
 *     hash. Small non-LFS files (config.json, tokenizer.json, ...) are
 *     downloaded from the exact commit and hashed locally.
 *  3. Hashes every installed artifact (streamed SHA-256) under the model
 *     directory and compares file-by-file: identical / modified / missing /
 *     unexpected.
 *  4. Writes bean-canonical-reference.json next to the install manifest
 *     (repo, revision, commit SHA, per-file hashes) — the server-side
 *     verifier (src/lib/gangzii/model-integrity.ts) reads it to upgrade the
 *     provenance state to canonical-verified. Model artifacts themselves are
 *     NEVER modified, replaced or re-downloaded by this script.
 *
 * HONESTY RULES ENFORCED HERE
 *  - Rate limits are respected: at most 3 metadata attempts with 30/60 s
 *    backoff; then the script exits with state PENDING (exit code 2) and
 *    prints exactly what must be re-run later. It never downgrades a
 *    throttle failure into a "verified" result.
 *  - Comparing different revisions is refused unless the caller explicitly
 *    passes --allow-different-revision (silent revision drift is forbidden).
 *  - No inference from filenames alone: identity is established by bytes.
 *  - Nothing is printed except model metadata, hashes and paths — no secrets
 *    are read or emitted (this script needs no credentials at all).
 *
 * USAGE (from the repo root, or anywhere if you pass --dir):
 *   bun scripts/m28-verify-kokoro-provenance.ts
 *   npx tsx scripts/m28-verify-kokoro-provenance.ts [--dir <model dir>]
 *                                              [--revision main]
 *                                              [--write-tokenizer-hashes]
 *                                              [--allow-different-revision]
 *                                              [--no-write-reference]
 *
 * EXIT CODES: 0 = canonically verified · 1 = mismatch/failure · 2 = pending
 * (HF unreachable/rate-limited — re-run later on an unthrottled network).
 */

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

const DEFAULT_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const DEFAULT_REVISION = 'main'
/** Files the BEAN engine requires/optionally uses (same set as the engine). */
const REQUIRED_FILES = ['config.json', 'onnx/model_quantized.onnx']
const OPTIONAL_FILES = ['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']
const REFERENCE_FILE = 'bean-canonical-reference.json'
const MANIFEST_FILE = 'bean-install-manifest.json'
const USER_AGENT = 'BEAN-Intelligence/1.0 (+M28 canonical provenance verification)'
/**
 * Canonical API base — ALWAYS the Hugging Face endpoints unless explicitly
 * overridden by the operator (BEAN_HF_API_BASE) for proxied networks or
 * offline fixture tests. The override never changes WHICH host is treated
 * as canonical in reports: a non-HF base is recorded in the reference notes.
 */
const HF_API_BASE = (process.env.BEAN_HF_API_BASE ?? 'https://huggingface.co').replace(/\/$/, '')

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') out.dir = argv[++i]
    else if (a === '--repo') out.repo = argv[++i]
    else if (a === '--revision') out.revision = argv[++i]
    else if (a === '--allow-different-revision') out.allowDifferentRevision = true
    else if (a === '--no-write-reference') out.noWriteReference = true
  }
  return out
}

function defaultModelDir(): string {
  // Repo root default: <cwd>/storage/models/hf/<repo> — the engine layout.
  return path.join(process.cwd(), 'storage', 'models', 'hf', DEFAULT_REPO)
}

function sha256FileSync(file: string): string {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1024 * 1024)
    let read = 0
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, read))
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

interface FetchResult {
  ok: boolean
  status: number
  body: unknown
}
/** Bounded, backoff-respecting metadata fetch. NEVER hammers the endpoint. */
async function fetchWithRespect(url: string, attempts = 3): Promise<FetchResult> {
  const backoffs = [0, 30_000, 60_000]
  let lastStatus = 0
  for (let i = 0; i < attempts; i++) {
    if (backoffs[i] > 0) {
      console.log(`  … rate-limit backoff: waiting ${backoffs[i] / 1000}s before retry ${i + 1}/${attempts}`)
      await new Promise((r) => setTimeout(r, backoffs[i]))
    }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(45_000) })
      lastStatus = res.status
      if (res.status === 200) return { ok: true, status: 200, body: await res.json() }
      if (res.status === 429) {
        console.log(`  … Hugging Face answered HTTP 429 (rate limited) for: ${url}`)
        continue
      }
      // Non-throttle HTTP error: do not retry blindly.
      return { ok: false, status: res.status, body: null }
    } catch (e) {
      lastStatus = -1
      console.log(`  … network error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { ok: false, status: lastStatus, body: null }
}

interface TreeEntry {
  path: string
  type: string
  size?: number
  lfs?: { oid?: string; size?: number }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const repo = (args.repo as string) ?? DEFAULT_REPO
  const revision = (args.revision as string) ?? DEFAULT_REVISION
  const modelDir = (args.dir as string) ?? defaultModelDir()

  console.log('=== BEAN Intelligence — M28 canonical Kokoro provenance verification ===')
  console.log(`repo:      ${repo}`)
  console.log(`revision:  ${revision}`)
  console.log(`model dir: ${modelDir}`)
  console.log('')

  // ---- 0. installed manifest (read-only) -------------------------------------
  const manifestPath = path.join(modelDir, MANIFEST_FILE)
  let installedManifest: { revision?: string; revisionCommit?: string | null; installedAt?: string; checksumSource?: string | null } | null = null
  if (fs.existsSync(manifestPath)) {
    try {
      installedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (e) {
      console.log(`!! Install manifest exists but cannot be parsed (${e instanceof Error ? e.message : String(e)}). Continuing with direct artifact comparison.`)
    }
  }

  if (!fs.existsSync(path.join(modelDir, REQUIRED_FILES[0])) || !fs.existsSync(path.join(modelDir, REQUIRED_FILES[1]))) {
    console.log('STATE: NOT-INSTALLED — required model artifacts are not present under --dir; nothing to verify.')
    console.log('Run the install from GANGZII Narration Studio first, then re-run this utility.')
    return 2
  }

  if (installedManifest && installedManifest.revision && installedManifest.revision !== revision && !args.allowDifferentRevision) {
    console.log(`!! The installed manifest records revision "${installedManifest.revision}" but this run targets "${revision}".`)
    console.log('   Comparing different revisions is REFUSED (no silent revision drift). Re-run with --revision matching the install,')
    console.log('   or pass --allow-different-revision explicitly after confirming the migration is intended.')
    return 1
  }

  // ---- 1. resolve revision → immutable commit ---------------------------------
  console.log('Step 1/3: resolving the revision to an exact commit…')
  const rev = await fetchWithRespect(`${HF_API_BASE}/api/models/${repo}/revision/${encodeURIComponent(revision)}`)
  if (!rev.ok) {
    console.log('')
    console.log(`STATE: PENDING — Hugging Face metadata unavailable (HTTP ${rev.status}).`)
    console.log('Per the M28 rules this sandbox/hosts rate-limit failure is NOT treated as verification.')
    console.log('Re-run this utility later from a network with canonical access; nothing was modified.')
    return 2
  }
  const commitSha = (rev.body as { sha?: string })?.sha ?? null
  if (!commitSha) {
    console.log('STATE: PENDING — the revision API did not expose a commit SHA; refusing to compare against an unpinned revision.')
    return 2
  }
  console.log(`  commit: ${commitSha}`)
  if (installedManifest?.revisionCommit && installedManifest.revisionCommit !== commitSha && !args.allowDifferentRevision) {
    console.log(`!! Installed manifest revisionCommit ${installedManifest.revisionCommit} differs from canonical commit ${commitSha}.`)
    console.log('   Refusing to compare different revisions (use --allow-different-revision only after a deliberate re-install).')
    return 1
  }

  // ---- 2. canonical tree AT THAT COMMIT ---------------------------------------
  console.log('Step 2/3: fetching the canonical file tree at that exact commit…')
  const tree = await fetchWithRespect(`${HF_API_BASE}/api/models/${repo}/tree/${commitSha}?recursive=true`)
  if (!tree.ok) {
    console.log(`STATE: PENDING — tree metadata unavailable (HTTP ${tree.status}). Nothing was modified.`)
    return 2
  }
  const entries = (tree.body as TreeEntry[]).filter((e) => e.type === 'file')
  const byPath = new Map(entries.map((e) => [e.path, e]))
  console.log(`  ${entries.length} files in the canonical tree.`)

  const wanted = [...REQUIRED_FILES, ...OPTIONAL_FILES].filter((p) => byPath.has(p))
  const canonicalFiles: Array<{ path: string; sha256: string; bytes: number | null }> = []
  const notes: string[] = []

  for (const p of wanted) {
    const entry = byPath.get(p)
    if (entry?.lfs?.oid) {
      canonicalFiles.push({ path: p, sha256: entry.lfs.oid, bytes: entry.lfs.size ?? entry.size ?? null })
      console.log(`  ${p}: canonical sha256 ${entry.lfs.oid} (LFS OID, authoritative metadata)`)
    } else {
      // Non-LFS file: download from the exact commit and hash the bytes here.
      const url = `${HF_API_BASE}/${repo}/resolve/${commitSha}/${p}`
      try {
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) })
        if (!res.ok) {
          notes.push(`${p}: canonical download failed (HTTP ${res.status}); excluded from this comparison.`)
          console.log(`  ${p}: DOWNLOAD FAILED (HTTP ${res.status}) — excluded from comparison`)
          continue
        }
        const buf = Buffer.from(await res.arrayBuffer())
        canonicalFiles.push({ path: p, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length })
        console.log(`  ${p}: canonical sha256 (downloaded from commit, hashed locally)`)
      } catch (e) {
        notes.push(`${p}: canonical download error (${e instanceof Error ? e.message : String(e)}).`)
      }
    }
  }

  // ---- 3. compare installed artifacts against canonical bytes ------------------
  console.log('Step 3/3: hashing the installed artifacts and comparing…')
  const results: Array<{ file: string; verdict: string; installedSha256?: string; canonicalSha256?: string }> = []
  let verified = 0
  let failed = 0
  for (const ref of canonicalFiles) {
    const abs = path.join(modelDir, ref.path)
    if (!fs.existsSync(abs)) {
      results.push({ file: ref.path, verdict: 'MISSING', canonicalSha256: ref.sha256 })
      failed += 1
      continue
    }
    const actual = sha256FileSync(abs)
    if (actual === ref.sha256) {
      results.push({ file: ref.path, verdict: 'IDENTICAL', installedSha256: actual, canonicalSha256: ref.sha256 })
      verified += 1
    } else {
      results.push({ file: ref.path, verdict: 'MODIFIED', installedSha256: actual, canonicalSha256: ref.sha256 })
      failed += 1
    }
  }
  // Unexpected files inside the install (present on disk, absent canonical set).
  const wantedSet = new Set(canonicalFiles.map((f) => f.path))
  const unexpected: string[] = []
  for (const rel of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    if (!wantedSet.has(rel) && fs.existsSync(path.join(modelDir, rel))) unexpected.push(rel)
  }

  // Required files that the canonical revision does NOT contain at all —
  // a failed comparison, not a pending one (the install contains a file the
  // pinned revision never published).
  const canonicalPaths = new Set(wanted)
  for (const rel of REQUIRED_FILES) {
    if (!canonicalPaths.has(rel)) {
      results.push({ file: rel, verdict: 'NOT-IN-CANONICAL-REVISION' })
      failed += 1
    }
  }

  for (const r of results) console.log(`  ${r.file}: ${r.verdict}`)

  const allMatched = failed === 0 && canonicalFiles.length >= REQUIRED_FILES.length
  const state = allMatched ? 'CANONICALLY-VERIFIED' : failed > 0 ? 'MISMATCH' : 'PENDING'
  console.log('')
  console.log(`STATE: ${state}`)
  console.log(`  verified ${verified}/${canonicalFiles.length} canonical-referenced files; ${failed} mismatched/missing.`)

  // ---- 4. write the canonical reference (server verifier picks it up) ---------
  if (!args.noWriteReference && allMatched) {
    const reference = {
      repo,
      revision,
      commitSha,
      files: canonicalFiles,
      verifiedAt: new Date().toISOString(),
      tool: 'scripts/m28-verify-kokoro-provenance.ts',
      notes: HF_API_BASE === 'https://huggingface.co' ? notes : [...notes, `Non-default API base used: ${HF_API_BASE} (operator override BEAN_HF_API_BASE).`],
    }
    const refPath = path.join(modelDir, REFERENCE_FILE)
    fs.writeFileSync(refPath, JSON.stringify(reference, null, 2))
    console.log(`Canonical reference written: ${refPath}`)
    console.log('The server-side integrity verifier now reports artifact state: canonical-verified.')
    console.log('(Only this reference file was written — the model artifacts themselves were never touched.)')
  } else if (!allMatched) {
    console.log('No canonical reference was written: the comparison did not fully succeed,')
    console.log('and writing a verified reference over a failed comparison would be dishonest.')
  }

  if (installedManifest?.checksumSource === 'modelscope-mirror' && allMatched) {
    console.log('')
    console.log('Note: the install manifest recorded ModelScope-mirror hashes. They are now')
    console.log('independently confirmed identical to the canonical HF revision above.')
  }

  return allMatched ? 0 : failed > 0 ? 1 : 2
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`Verification run failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
