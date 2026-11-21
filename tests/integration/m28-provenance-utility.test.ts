/**
 * M28 — owner provenance utility, offline success-path test.
 *
 * The canonical verification path cannot be exercised against huggingface.co
 * from this sandbox (HTTP 429 egress throttling — that is exactly why the
 * utility exists), so this test proves the FULL utility behavior against a
 * local fixture that speaks the same API shape:
 *   1. revision → exact commit resolution;
 *   2. tree listing at that commit (LFS OID = sha256 for LFS objects);
 *   3. small non-LFS files downloaded from the exact commit and hashed;
 *   4. comparison verdicts + canonical reference written on success;
 *   5. refusal on revision drift; honest failure (no reference) on mismatch;
 *   6. bounded requests — no endpoint hammering (request log asserted).
 *
 * The server binding runs on 127.0.0.1 with an ephemeral port.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'

const REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const COMMIT = 'm28fixturecommit0000000000000000000001'
const CONFIG_BODY = '{"model_type":"style_text_to_speech_2"}'
const ONNX_BODY = Buffer.from('fixture-onnx-weights-for-the-m28-success-path')
const TOKENIZER_BODY = '{"tokenizer_class":"kokoro"}'

let serverUrl = ''
let serverPort = 0
let requests: string[] = []
let server: { stop: (closeActiveConnections: boolean) => void } | null = null

function sha256(b: Buffer | string): string {
  return createHash('sha256').update(b).digest('hex')
}

function makeModelDir(manifestRevision: string, tamper: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bean-m28-prov-'))
  fs.mkdirSync(path.join(dir, 'onnx'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), CONFIG_BODY)
  fs.writeFileSync(path.join(dir, 'onnx/model_quantized.onnx'), tamper ? Buffer.from('TAMPERED-WEIGHTS') : ONNX_BODY)
  fs.writeFileSync(path.join(dir, 'tokenizer.json'), TOKENIZER_BODY)
  fs.writeFileSync(
    path.join(dir, 'bean-install-manifest.json'),
    JSON.stringify({
      installedAt: new Date().toISOString(),
      repo: REPO,
      revision: manifestRevision,
      dtype: 'q8',
      files: [
        { file: 'config.json', bytes: Buffer.byteLength(CONFIG_BODY), sha256: sha256(CONFIG_BODY) },
        { file: 'onnx/model_quantized.onnx', bytes: ONNX_BODY.length, sha256: sha256(tamper ? Buffer.from('TAMPERED-WEIGHTS') : ONNX_BODY) },
        { file: 'tokenizer.json', bytes: Buffer.byteLength(TOKENIZER_BODY), sha256: sha256(TOKENIZER_BODY) },
      ],
      installMs: 1500,
      engineVersion: 'kokoro-js@1.2.1',
      checksumSource: 'modelscope-mirror',
    }),
  )
  return dir
}

beforeAll(() => {
  requests = []
  const s = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      requests.push(url.pathname + url.search)
      if (url.pathname === `/api/models/${REPO}/revision/main`) {
        return Response.json({ sha: COMMIT })
      }
      if (url.pathname === `/api/models/${REPO}/tree/${COMMIT}` && url.searchParams.get('recursive') === 'true') {
        return Response.json([
          { path: 'onnx', type: 'directory' },
          { path: 'config.json', type: 'file', size: Buffer.byteLength(CONFIG_BODY) },
          { path: 'onnx/model_quantized.onnx', type: 'file', size: ONNX_BODY.length, lfs: { oid: sha256(ONNX_BODY), size: ONNX_BODY.length } },
          { path: 'tokenizer.json', type: 'file', size: Buffer.byteLength(TOKENIZER_BODY), lfs: { oid: sha256(TOKENIZER_BODY), size: Buffer.byteLength(TOKENIZER_BODY) } },
        ])
      }
      if (url.pathname === `/${REPO}/resolve/${COMMIT}/config.json`) {
        return new Response(CONFIG_BODY, { status: 200 })
      }
      return new Response('fixture 404', { status: 404 })
    },
  })
  server = s
  serverPort = (s as unknown as { port: number }).port
  serverUrl = `http://127.0.0.1:${serverPort}`
})

afterAll(() => {
  server?.stop(true)
})

/** Run the utility as a real child process (Bun.spawn — spawnSync hangs under bun test). */
async function runUtility(modelDir: string, extraArgs: string[] = []): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', 'scripts/m28-verify-kokoro-provenance.ts', '--dir', modelDir, ...extraArgs], {
    cwd: process.cwd(),
    env: { ...process.env, BEAN_HF_API_BASE: serverUrl },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), 45_000)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  return { code, stdout, stderr }
}

describe('m28-verify-kokoro-provenance (offline fixture)', () => {
  test('success path: verdicts, reference file, bounded requests', async () => {
    const dir = makeModelDir('main', false)
    const res = await runUtility(dir)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('STATE: CANONICALLY-VERIFIED')

    const ref = JSON.parse(fs.readFileSync(path.join(dir, 'bean-canonical-reference.json'), 'utf8'))
    expect(ref.commitSha).toBe(COMMIT)
    expect(ref.files).toHaveLength(3) // config.json + onnx + tokenizer.json
    const onnxRef = ref.files.find((f: { path: string }) => f.path === 'onnx/model_quantized.onnx')
    expect(onnxRef.sha256).toBe(sha256(ONNX_BODY))
    const cfgRef = ref.files.find((f: { path: string }) => f.path === 'config.json')
    expect(cfgRef.sha256).toBe(sha256(CONFIG_BODY))

    // The server-side verifier must now report canonical-verified.
    const { verifyKokoroModelIntegrity } = await import('@/lib/gangzii/model-integrity')
    const report = verifyKokoroModelIntegrity({ modelDir: dir, noCache: true })
    expect(report.state).toBe('canonical-verified')
    expect(report.canonicalCommitSha).toBe(COMMIT)

    // Bounded: exactly one revision call and one tree call (no hammering).
    const revCalls = requests.filter((r) => r.includes('/revision/main')).length
    const treeCalls = requests.filter((r) => r.includes(`/tree/${COMMIT}`)).length
    expect(revCalls).toBe(1)
    expect(treeCalls).toBe(1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('tampered weights: exit 1, honest mismatch, NO reference written', async () => {
    const dir = makeModelDir('main', true)
    const res = await runUtility(dir)
    expect(res.code).toBe(1)
    expect(res.stdout).toContain('MODIFIED')
    expect(fs.existsSync(path.join(dir, 'bean-canonical-reference.json'))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('revision drift is refused — no silent comparison across revisions', async () => {
    const dir = makeModelDir('v9.9.9', false)
    const res = await runUtility(dir)
    expect(res.code).toBe(1)
    expect(res.stdout).toContain('Comparing different revisions is REFUSED')
    expect(fs.existsSync(path.join(dir, 'bean-canonical-reference.json'))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('missing artifacts: NOT-INSTALLED state, exit 2, nothing modified', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bean-m28-empty-'))
    const res = await runUtility(dir)
    expect(res.code).toBe(2)
    expect(res.stdout).toContain('NOT-INSTALLED')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
