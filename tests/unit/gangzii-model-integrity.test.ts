/**
 * GANGZII M28 — model-artifact integrity verifier unit tests.
 *
 * Priority A acceptance: a repeatable verifier that detects missing,
 * unexpected and modified artifacts, distinguishes mirror-hash from
 * canonical provenance, never counts a hash-less entry as verified, and is
 * strictly read-only over the model directory.
 *
 * All fixtures are temporary directories built inside the test — the real
 * model installation is never touched.
 */
import { describe, test, expect } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import {
  verifyKokoroModelIntegrity,
  sha256FileSync,
  readCanonicalReference,
  type CanonicalReference,
} from '@/lib/gangzii/model-integrity'

const H = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')

function makeTempModelDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bean-m28-integrity-'))
}

function writeFixture(dir: string, rel: string, content: string | Buffer): string {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

interface FixtureManifest {
  installedAt: string
  repo: string
  revision: string
  dtype: string
  files: Array<{ file: string; bytes: number; sha256: string | null }>
  installMs: number
  engineVersion: string
  checksumSource?: 'huggingface-canonical' | 'modelscope-mirror' | null
}

function writeManifest(dir: string, m: FixtureManifest): void {
  writeFixture(dir, 'bean-install-manifest.json', JSON.stringify(m, null, 2))
}

function manifestFromDisk(dir: string, checksumSource: FixtureManifest['checksumSource'], extra?: Partial<FixtureManifest>): FixtureManifest {
  const files: FixtureManifest['files'] = []
  for (const rel of ['config.json', 'onnx/model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json']) {
    const abs = path.join(dir, rel)
    if (!fs.existsSync(abs)) continue
    files.push({ file: rel, bytes: fs.statSync(abs).size, sha256: sha256FileSync(abs) })
  }
  return {
    installedAt: new Date().toISOString(),
    repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    revision: 'main',
    dtype: 'q8',
    files,
    installMs: 1500,
    engineVersion: 'kokoro-js@1.2.1',
    checksumSource,
    ...extra,
  }
}

describe('verifyKokoroModelIntegrity — state machine', () => {
  test('not-installed when the directory is empty', () => {
    const dir = makeTempModelDir()
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('not-installed')
    expect(r.installed).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('pending-verification when artifacts exist but no manifest and no canonical reference', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('pending-verification')
    expect(r.manifestPresent).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('mirror-hash-verified when all manifest hashes match and source is the mirror — never canonical', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    writeManifest(dir, manifestFromDisk(dir, 'modelscope-mirror'))
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('mirror-hash-verified')
    expect(r.filesVerified).toBe(2)
    expect(r.checksumSource).toBe('modelscope-mirror')
    expect(r.notes.join(' ')).toContain('NOT the canonical HF revision')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('canonical-verified when the source is huggingface-canonical and hashes match', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    writeManifest(dir, manifestFromDisk(dir, 'huggingface-canonical'))
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('canonical-verified')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('canonical-verified via a written canonical reference (owner utility path)', () => {
    const dir = makeTempModelDir()
    const cfg = writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    const onnx = writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    writeManifest(dir, manifestFromDisk(dir, 'modelscope-mirror'))
    const reference: CanonicalReference = {
      repo: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      revision: 'main',
      commitSha: 'abc123commit',
      files: [
        { path: 'config.json', sha256: sha256FileSync(cfg), bytes: fs.statSync(cfg).size },
        { path: 'onnx/model_quantized.onnx', sha256: sha256FileSync(onnx), bytes: fs.statSync(onnx).size },
      ],
      verifiedAt: new Date().toISOString(),
      tool: 'scripts/m28-verify-kokoro-provenance.ts',
    }
    writeFixture(dir, 'bean-canonical-reference.json', JSON.stringify(reference))
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('canonical-verified')
    expect(r.canonicalCommitSha).toBe('abc123commit')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('modified artifact (same size, different bytes) downgrades the state even when the checksum source is canonical', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    const m = manifestFromDisk(dir, 'huggingface-canonical')
    // Same-length tamper: the byte content changes without a size change —
    // only the recomputed sha256 can catch this.
    fs.writeFileSync(path.join(dir, 'onnx/model_quantized.onnx'), Buffer.from('TAMPERED-WEIGHT'))
    writeManifest(dir, m)
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('pending-verification')
    expect(r.modified).toHaveLength(1)
    expect(r.modified[0].kind).toBe('modified')
    expect(r.modified[0].file).toBe('onnx/model_quantized.onnx')
    expect(r.modified[0].actualSha256).toBe(H('TAMPERED-WEIGHT'))
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('size-mismatch is caught before hashing when bytes change length', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    const m = manifestFromDisk(dir, 'modelscope-mirror')
    fs.writeFileSync(path.join(dir, 'onnx/model_quantized.onnx'), Buffer.from('TRUNCATED'))
    writeManifest(dir, m)
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('pending-verification')
    expect(r.modified[0].kind).toBe('size-mismatch')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('missing required artifact is detected and fails verification', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    const m = manifestFromDisk(dir, 'modelscope-mirror')
    fs.rmSync(path.join(dir, 'onnx/model_quantized.onnx'))
    writeManifest(dir, m)
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('pending-verification')
    expect(r.missing).toContain('onnx/model_quantized.onnx')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('hash-less required entry is size-checked but never upgrades the state', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    const m = manifestFromDisk(dir, 'huggingface-canonical')
    // config.json recorded WITHOUT a hash (HF non-LFS case at install time).
    m.files = m.files.map((f) => (f.file === 'config.json' ? { ...f, sha256: null } : f))
    writeManifest(dir, m)
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('pending-verification')
    expect(r.entriesWithoutHash).toContain('config.json')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('unexpected files are listed for review and bean metadata is never flagged', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    writeManifest(dir, manifestFromDisk(dir, 'modelscope-mirror'))
    writeFixture(dir, 'dropped-in.bin', Buffer.from('unexpected'))
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.unexpected).toContain('dropped-in.bin')
    expect(r.unexpected).not.toContain('bean-install-manifest.json')
    expect(r.unexpected).not.toContain('bean-canonical-reference.json')
    expect(r.state).toBe('mirror-hash-verified') // unexpected ≠ damage
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('verifyKokoroModelIntegrity — read-only contract', () => {
  test('verification does not modify any file under the model dir', () => {
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    writeManifest(dir, manifestFromDisk(dir, 'modelscope-mirror'))
    const before = fs.readdirSync(dir).sort().map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join('|')
    verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    const after = fs.readdirSync(dir).sort().map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`).join('|')
    expect(after).toBe(before)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('canonical reference reader', () => {
  test('returns null for absent or malformed references', () => {
    const dir = makeTempModelDir()
    expect(readCanonicalReference(dir)).toBeNull()
    writeFixture(dir, 'bean-canonical-reference.json', 'not json at all')
    expect(readCanonicalReference(dir)).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('install-path regression (M28 bug found in review)', () => {
  test('a poisoned "Entry not found" json artifact is flagged as unreadable even when its recorded hash matches', () => {
    // Measured 2026-11-21: ModelScope answers HTTP 200 with "Entry not found"
    // for absent files; the M27 download loop wrote that body to disk. The
    // verifier must flag such a file (a json artifact that does not parse is
    // unusable regardless of what the manifest recorded) — the engine's
    // listing fix prevents this class at download time; this check catches it
    // if it ever reaches disk anyway.
    const dir = makeTempModelDir()
    writeFixture(dir, 'config.json', '{"model_type":"style_text_to_speech_2"}')
    writeFixture(dir, 'onnx/model_quantized.onnx', Buffer.from('fake-onnx-bytes'))
    const m = manifestFromDisk(dir, 'modelscope-mirror')
    m.files.push({ file: 'special_tokens_map.json', bytes: 15, sha256: sha256FileSync(writeFixture(dir, 'special_tokens_map.json', 'Entry not found')) })
    writeManifest(dir, m)
    const r = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(r.state).toBe('pending-verification')
    expect(r.modified).toHaveLength(1)
    expect(r.modified[0].kind).toBe('unreadable-json')
    expect(r.modified[0].file).toBe('special_tokens_map.json')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
