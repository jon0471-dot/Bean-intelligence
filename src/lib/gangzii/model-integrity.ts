/**
 * BEAN Intelligence — GANGZII MODEL-ARTIFACT INTEGRITY VERIFICATION (M28).
 *
 * Priority A of M28: a repeatable, honest integrity verifier for the local
 * Kokoro-82M installation. M27 recorded per-file sha256 values at install
 * time, but the sandbox install downloaded from the ModelScope mirror while
 * the canonical Hugging Face source was rate-limited — so cross-verification
 * against the canonical artifact hashes was explicitly left PENDING.
 *
 * What this module does:
 *  - verifies every installed artifact byte-for-byte (SHA-256) against the
 *    install manifest AND, when present, against a canonical reference file
 *    written by the owner-side utility (scripts/m28-verify-kokoro-provenance.ts);
 *  - detects MISSING files (manifest lists them, disk does not have them),
 *    MODIFIED files (hash mismatch), and UNEXPECTED files (on disk but not
 *    in the manifest — e.g. a partial download or a dropped-in artifact);
 *  - reports provenance as a precise state machine, never a generic "ok":
 *      canonical-verified    → hashes match a pinned canonical HF revision;
 *      mirror-hash-verified  → hashes match the install manifest, but those
 *                              hashes came from the ModelScope mirror (the
 *                              canonical comparison has not happened yet);
 *      pending-verification  → installed and functional, provenance unknown;
 *      not-installed         → nothing to verify.
 *  - is strictly READ-ONLY over the installed model: no destructive
 *    replacement, no silent revision updates, no re-download, no inference
 *    from configuration similarity alone (hashes are computed from bytes).
 *
 * What this module does NOT do:
 *  - it does NOT claim canonical verification from mirror hashes (a matching
 *    mirror hash proves the install matches the mirror, not Hugging Face);
 *  - it does NOT print secrets (there are none in this path) or absolute
 *    host paths in reports destined for receipts/UI (relative paths only);
 *  - it does NOT verify the voice packs: in kokoro-js 1.2.1 on Node the
 *    voice data is read from the npm package directory
 *    (node_modules/kokoro-js/voices/*.bin), whose integrity is governed by
 *    the npm lockfile — recorded here as an honest boundary note.
 *
 * SERVER-ONLY (node:fs/crypto), no network access in this module.
 */

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

// ---- provenance states (the vocabulary used in receipts/UI) -----------------

/**
 * Top-level artifact provenance state.
 * - `canonical-verified`   : every artifact matches a canonical Hugging Face
 *                            revision pinned by exact commit (owner utility).
 * - `mirror-hash-verified` : every artifact matches the install manifest and
 *                            the manifest hashes were published by the source
 *                            the artifacts were downloaded from (mirror).
 *                            Functional integrity YES, canonical provenance NO.
 * - `pending-verification` : installed; no checksum comparison information is
 *                            available at all (e.g. manifest without hashes).
 * - `not-installed`        : nothing on disk.
 */
export type ArtifactProvenance =
  | 'canonical-verified'
  | 'mirror-hash-verified'
  | 'pending-verification'
  | 'not-installed'

export type IntegrityIssueKind = 'missing' | 'modified' | 'unexpected' | 'size-mismatch' | 'unreadable-json'

export interface IntegrityIssue {
  kind: IntegrityIssueKind
  /** Repo-relative path (never an absolute host path). */
  file: string
  /** Expected sha256 when one is known (manifest or canonical reference). */
  expectedSha256?: string
  /** sha256 actually measured from disk bytes. */
  actualSha256?: string
  expectedBytes?: number
  actualBytes?: number
}

export interface CanonicalReference {
  repo: string
  /** The exact pinned reference requested by the owner (branch or tag). */
  revision: string
  /** The resolved immutable commit SHA of that revision on Hugging Face. */
  commitSha: string | null
  files: Array<{ path: string; sha256: string; bytes: number | null }>
  verifiedAt: string
  tool: string
  notes?: string[]
}

export interface ModelIntegrityReport {
  state: ArtifactProvenance
  installed: boolean
  manifestPresent: boolean
  /** Revision as recorded in the install manifest (branch ref, may be 'main'). */
  revision: string | null
  /** Immutable canonical commit when a canonical reference exists. */
  canonicalCommitSha: string | null
  /** Where the manifest hashes came from (mirror ≠ canonical). */
  checksumSource: 'huggingface-canonical' | 'modelscope-mirror' | 'owner-canonical-reference' | null
  filesTotal: number
  filesVerified: number
  /** Manifest entries with NO published hash — size-checked only, never counted as verified. */
  entriesWithoutHash: string[]
  missing: string[]
  unexpected: string[]
  modified: IntegrityIssue[]
  /** Measured bytes hashed (audit trail of what the check actually covered). */
  bytesHashed: number
  durationMs: number
  verifiedAt: string
  notes: string[]
}

// ---- file sets (mirrors the engine's install list) ---------------------------

export const INTEGRITY_REQUIRED_FILES = ['config.json', 'onnx/model_quantized.onnx']
export const INTEGRITY_OPTIONAL_FILES = ['tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json']
/** Canonical reference file written by scripts/m28-verify-kokoro-provenance.ts */
export const CANONICAL_REFERENCE_FILE = 'bean-canonical-reference.json'

// ---- helpers ------------------------------------------------------------------

export function sha256FileSync(file: string): string {
  // Streamed hashing — the q8 ONNX file is ~92 MB; readFileSync would hold it
  // all in memory while the worker may also be synthesizing.
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(1024 * 1024)
    let read = 0
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return hash.digest('hex')
}

export function readCanonicalReference(modelDir: string): CanonicalReference | null {
  try {
    const p = path.join(modelDir, CANONICAL_REFERENCE_FILE)
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as CanonicalReference
    if (!raw || raw.repo === undefined || !Array.isArray(raw.files)) return null
    return raw
  } catch {
    return null
  }
}

// ---- cache (hashing 92 MB on every health poll would be wasteful) -------------

interface CacheEntry {
  report: ModelIntegrityReport
  /** Invalidation key: manifest mtime+size and artifact file identity. */
  key: string
}
const CACHE_KEY = '__bean_gangzii_model_integrity__'
function cacheStore(): Record<string, CacheEntry> {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[CACHE_KEY]) g[CACHE_KEY] = {}
  return g[CACHE_KEY] as Record<string, CacheEntry>
}
function invalidationKey(modelDir: string, manifestPath: string): string {
  const parts: string[] = [modelDir]
  try {
    const st = fs.statSync(manifestPath)
    parts.push(`m${st.mtimeMs}:${st.size}`)
  } catch {
    parts.push('m-')
  }
  for (const rel of [...INTEGRITY_REQUIRED_FILES, ...INTEGRITY_OPTIONAL_FILES]) {
    try {
      const st = fs.statSync(path.join(modelDir, rel))
      parts.push(`${rel}:${st.mtimeMs}:${st.size}`)
    } catch {
      parts.push(`${rel}:-`)
    }
  }
  try {
    const ref = path.join(modelDir, CANONICAL_REFERENCE_FILE)
    if (fs.existsSync(ref)) {
      const st = fs.statSync(ref)
      parts.push(`ref${st.mtimeMs}:${st.size}`)
    }
  } catch {
    /* absent canonical reference is a valid cache state */
  }
  return parts.join('|')
}

export function invalidateKokoroIntegrityCache(): void {
  delete cacheStore()[CACHE_KEY]
}

// ---- the verifier ---------------------------------------------------------------

export interface VerifyOptions {
  /** Model directory (defaults to the engine's KOKORO_LOCAL_DIR layout). */
  modelDir?: string
  /** Install manifest path (defaults to bean-install-manifest.json in modelDir). */
  manifestPath?: string
  /**
   * Minimal manifest contract — structural subset of KokoroManifest so the
   * verifier does not import the engine (which pulls heavy dynamic deps).
   */
  manifest?: { repo?: string; revision?: string; files?: Array<{ file: string; bytes?: number; sha256?: string | null }>; checksumSource?: string | null } | null
  /** Bypass the process-wide cache (tests). */
  noCache?: boolean
}

/**
 * Verify the installed Kokoro model directory. Read-only; never modifies,
 * replaces or downloads anything. The report distinguishes exactly what was
 * checked: manifest comparison, canonical reference comparison, or nothing.
 */
export function verifyKokoroModelIntegrity(opts: VerifyOptions = {}): ModelIntegrityReport {
  const modelDir = opts.modelDir ?? path.join(process.cwd(), 'storage', 'models', 'hf', 'onnx-community', 'Kokoro-82M-v1.0-ONNX')
  const manifestPath = opts.manifestPath ?? path.join(modelDir, 'bean-install-manifest.json')
  const notes: string[] = []
  const started = Date.now()

  const base: ModelIntegrityReport = {
    state: 'not-installed',
    installed: false,
    manifestPresent: false,
    revision: null,
    canonicalCommitSha: null,
    checksumSource: null,
    filesTotal: 0,
    filesVerified: 0,
    entriesWithoutHash: [],
    missing: [],
    unexpected: [],
    modified: [],
    bytesHashed: 0,
    durationMs: 0,
    verifiedAt: new Date().toISOString(),
    notes,
  }

  const cacheKey = opts.noCache ? undefined : invalidationKey(modelDir, manifestPath)
  if (cacheKey) {
    const hit = cacheStore()[CACHE_KEY]
    if (hit && hit.key === cacheKey) return hit.report
  }

  const manifest = opts.manifest !== undefined ? opts.manifest : readManifestFile(manifestPath)
  const canonical = readCanonicalReference(modelDir)

  // Nothing on disk at all?
  const requiredOnDisk = INTEGRITY_REQUIRED_FILES.map((rel) => ({ rel, abs: path.join(modelDir, rel) }))
  const anyRequiredPresent = requiredOnDisk.some((f) => fs.existsSync(f.abs))
  if (!anyRequiredPresent && !manifest) {
    base.durationMs = Date.now() - started
    if (cacheKey) cacheStore()[CACHE_KEY] = { report: base, key: cacheKey }
    return base
  }

  base.installed = anyRequiredPresent
  base.manifestPresent = Boolean(manifest)
  base.revision = manifest?.revision ?? null
  base.canonicalCommitSha = canonical?.commitSha ?? null

  if (canonical) {
    notes.push(`Canonical reference present: HF ${canonical.repo}@${canonical.commitSha ?? canonical.revision} (written ${canonical.verifiedAt} by ${canonical.tool}).`)
  } else if (base.installed) {
    notes.push('Canonical Hugging Face cross-verification has NOT been performed on this host; provenance stays pending until scripts/m28-verify-kokoro-provenance.ts runs with canonical access.')
  }
  notes.push('Voice packs ship inside the kokoro-js npm package (node_modules/kokoro-js/voices/*.bin) and are governed by npm lockfile integrity, not by this manifest.')

  if (!manifest) {
    // Artifacts exist but no manifest: we can still compare against a
    // canonical reference if one exists; otherwise state stays pending.
    if (canonical) {
      const cmp = compareAgainstReference(modelDir, canonical, base, notes)
      base.state = cmp.allMatched ? 'canonical-verified' : base.state
    } else {
      base.state = 'pending-verification'
      notes.push('Install manifest is missing — sizes and hashes cannot be cross-checked against the recorded install.')
    }
    base.durationMs = Date.now() - started
    if (cacheKey) cacheStore()[CACHE_KEY] = { report: base, key: cacheKey }
    return base
  }

  // Manifest-driven verification: file-by-file sha256 over manifest entries.
  const manifestFiles = manifest.files ?? []
  const issues: IntegrityIssue[] = []
  let verified = 0
  let hashedBytes = 0
  let mismatch = false
  const noHashEntries: string[] = []
  let requiredWithoutHash = false

  for (const entry of manifestFiles) {
    const abs = path.join(modelDir, entry.file)
    if (!fs.existsSync(abs)) {
      issues.push({ kind: 'missing', file: entry.file, expectedSha256: entry.sha256 ?? undefined })
      if (INTEGRITY_REQUIRED_FILES.includes(entry.file)) mismatch = true
      continue
    }
    const stat = fs.statSync(abs)
    if (entry.bytes !== undefined && entry.bytes !== null && stat.size !== entry.bytes) {
      issues.push({ kind: 'size-mismatch', file: entry.file, expectedBytes: entry.bytes, actualBytes: stat.size })
      mismatch = true
      continue
    }
    hashedBytes += stat.size
    if (!entry.sha256) {
      // Existence + size only — this entry is NOT hash-verified.
      noHashEntries.push(entry.file)
      if (INTEGRITY_REQUIRED_FILES.includes(entry.file)) requiredWithoutHash = true
      continue
    }
    const actual = sha256FileSync(abs)
    if (actual !== entry.sha256) {
      issues.push({ kind: 'modified', file: entry.file, expectedSha256: entry.sha256, actualSha256: actual })
      mismatch = true
      continue
    }
    // Defense-in-depth for .json artifacts: a body whose recorded hash
    // matches but which does not parse (e.g. a download proxy once served an
    // error page with a stable body) would break inference at load time —
    // catch it here, explicitly.
    if (entry.file.endsWith('.json') && stat.size <= 1_048_576) {
      try {
        JSON.parse(fs.readFileSync(abs, 'utf8'))
      } catch {
        issues.push({ kind: 'unreadable-json', file: entry.file, expectedSha256: entry.sha256, actualSha256: actual })
        mismatch = true
        continue
      }
    }
    verified += 1
  }

  // Unexpected files: on disk inside the model dir but not in the manifest
  // (relative to the required+optional set and manifest entries). Bean's own
  // metadata files (install manifest, canonical reference) are bookkeeping,
  // not artifacts — they are never "unexpected".
  const known = new Set([...manifestFiles.map((f) => f.file), ...INTEGRITY_REQUIRED_FILES, ...INTEGRITY_OPTIONAL_FILES])
  const beanMeta = new Set([path.basename(manifestPath), CANONICAL_REFERENCE_FILE])
  const unexpected = listModelDirFiles(modelDir).filter((rel) => !known.has(rel) && !beanMeta.has(path.basename(rel)))

  base.filesTotal = manifestFiles.length
  base.filesVerified = verified
  base.bytesHashed = hashedBytes
  base.entriesWithoutHash = noHashEntries
  base.missing = issues.filter((i) => i.kind === 'missing').map((i) => i.file)
  base.unexpected = unexpected
  base.modified = issues.filter((i) => i.kind === 'modified' || i.kind === 'size-mismatch' || i.kind === 'unreadable-json')

  const source = manifest.checksumSource
  base.checksumSource =
    source === 'huggingface-canonical' || source === 'modelscope-mirror' ? source : source === 'owner-canonical-reference' ? source : null

  if (noHashEntries.length > 0) {
    notes.push(`${noHashEntries.length} manifest entr${noHashEntries.length === 1 ? 'y has' : 'ies have'} no published hash — checked for existence and size only: ${noHashEntries.join(', ')}.`)
  }

  if (mismatch || base.missing.length > 0) {
    // Artifact damage wins over provenance claims — never report a higher
    // state when a manifest-listed file failed verification.
    base.state = 'pending-verification'
    notes.push('Artifact verification FAILED for one or more files; the install is NOT trusted until re-installed. Inference keeps working only if the required bytes are intact — treat any missing/modified required file as a hard failure.')
  } else if (canonical) {
    // Both manifest and canonical reference exist: compare disk bytes to the
    // canonical reference directly (hashes are computed here, not trusted).
    const cmp = compareAgainstReference(modelDir, canonical, base, notes)
    base.state = cmp.allMatched ? 'canonical-verified' : 'pending-verification'
  } else if (requiredWithoutHash) {
    base.state = 'pending-verification'
    notes.push('At least one REQUIRED artifact has no recorded hash (the upstream source did not publish one for it at install time); provenance cannot be established for the full install. The owner utility closes this gap by hashing those files from the canonical commit.')
  } else if (base.checksumSource === 'huggingface-canonical') {
    base.state = 'canonical-verified'
    notes.push('Manifest hashes were published by the canonical Hugging Face repository at install time (LFS OIDs).')
  } else if (base.checksumSource === 'modelscope-mirror') {
    base.state = 'mirror-hash-verified'
    notes.push('Manifest hashes came from the ModelScope mirror — this proves the install matches the mirror, NOT the canonical HF revision. Cross-verification is still pending.')
  } else {
    base.state = 'pending-verification'
    notes.push('The install manifest records no checksum source; provenance cannot be established from this manifest.')
  }

  if (unexpected.length > 0) {
    notes.push(`${unexpected.length} unexpected file(s) inside the model directory are not part of the recorded install; they are NOT used by the engine but are listed for review.`)
  }

  base.durationMs = Date.now() - started
  if (cacheKey) cacheStore()[CACHE_KEY] = { report: base, key: cacheKey }
  return base
}

function compareAgainstReference(
  modelDir: string,
  canonical: CanonicalReference,
  base: ModelIntegrityReport,
  notes: string[],
): { allMatched: boolean } {
  let allMatched = true
  let matched = 0
  let hashed = 0
  for (const ref of canonical.files) {
    const abs = path.join(modelDir, ref.path)
    if (!fs.existsSync(abs)) {
      base.missing.push(ref.path)
      allMatched = false
      continue
    }
    const stat = fs.statSync(abs)
    if (ref.bytes !== null && ref.bytes !== undefined && stat.size !== ref.bytes) {
      base.modified.push({ kind: 'size-mismatch', file: ref.path, expectedBytes: ref.bytes, actualBytes: stat.size })
      allMatched = false
      continue
    }
    const actual = sha256FileSync(abs)
    hashed += stat.size
    if (actual !== ref.sha256) {
      base.modified.push({ kind: 'modified', file: ref.path, expectedSha256: ref.sha256, actualSha256: actual })
      allMatched = false
      continue
    }
    matched += 1
  }
  base.filesTotal = Math.max(base.filesTotal, canonical.files.length)
  base.filesVerified = Math.max(base.filesVerified, matched)
  base.bytesHashed = Math.max(base.bytesHashed, hashed)
  if (allMatched) notes.push('Every canonical-referenced artifact hash was recomputed from disk bytes and MATCHED the pinned canonical revision.')
  else notes.push('Canonical comparison found differences — the install does NOT match the pinned canonical revision.')
  return { allMatched }
}

function readManifestFile(manifestPath: string): VerifyOptions['manifest'] {
  try {
    if (!fs.existsSync(manifestPath)) return null
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

/** Recursive listing of the model dir (relative paths, deterministic order). */
function listModelDirFiles(modelDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(path.join(dir, e.name), rel)
      else if (e.isFile()) out.push(rel)
    }
  }
  walk(modelDir, '')
  return out
}
