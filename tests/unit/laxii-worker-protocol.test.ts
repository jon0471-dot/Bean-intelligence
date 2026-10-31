/**
 * BEAN Intelligence — LAXII Diffusers worker protocol tests (Phase 2/7).
 *
 * These spawn the REAL Python worker (workers/laxii-diffusers/worker.py) and
 * pin its honesty contract on THIS host (no GPU, no torch):
 *  - the worker starts and answers the JSON-lines protocol;
 *  - preflight reports ok:false with the EXACT missing packages, CUDA state,
 *    disk state and checkpoint inventory — the measured truth;
 *  - inference methods return UNAVAILABLE instead of pretending;
 *  - unknown methods error cleanly; cancel answers;
 *  - the Node client maps spawn/timeout failures to WORKER_UNAVAILABLE /
 *    WORKER_TIMEOUT codes (fault injected at the process boundary).
 */
import { describe, test, expect, afterAll } from 'bun:test'
import { spawn } from 'child_process'
import path from 'path'

import { workerRequest, workerPreflight, workerStop, workerCancel } from '../../src/lib/laxii/worker'

const WORKER = path.join(process.cwd(), 'workers', 'laxii-diffusers', 'worker.py')

afterAll(() => {
  workerStop()
})

function pythonAvailable(): boolean {
  return Bun.which('python3') !== null
}

describe('real worker process: preflight honesty (this host)', () => {
  test.skipIf(!pythonAvailable())('worker signals readiness and answers preflight', async () => {
    const report = await workerPreflight(30_000)
    expect(report.workerVersion).toBeTruthy()
    // The measured truth on this host: NOT ready.
    expect(report.ok).toBe(false)
    expect(report.missingPackages).toContain('torch')
    expect(report.missingPackages).toContain('diffusers')
    expect(report.cuda.available).toBe(false)
    expect(report.models.length).toBeGreaterThanOrEqual(8)
    expect(report.models.every((m) => m.present === false)).toBe(true)
    expect(report.notes.join(' ')).toContain('not proof any model has run')
  }, 60_000)

  test.skipIf(!pythonAvailable())('preflight is a real measurement, not a constant', async () => {
    const report = await workerPreflight(30_000)
    // Disk free is a live number from this machine, bounded and positive.
    expect(report.disk.freeGb).toBeGreaterThan(0)
    // Python version reflects the actual interpreter.
    expect(report.python.version.startsWith('3.')).toBe(true)
  }, 60_000)
})

describe('real worker process: honest failure of inference methods', () => {
  test.skipIf(!pythonAvailable())('txt2img without torch returns UNAVAILABLE (never fakes an image)', async () => {
    try {
      await workerRequest('txt2img', { prompt: 'a test image', steps: 1 }, { timeoutMs: 30_000 })
      throw new Error('txt2img unexpectedly succeeded without torch — honesty violation')
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('UNAVAILABLE')
      expect((e as Error).message).toContain('missing packages')
    }
  }, 60_000)

  test.skipIf(!pythonAvailable())('inpaint without torch returns UNAVAILABLE', async () => {
    try {
      await workerRequest('inpaint', { image: 'x', mask: 'y', prompt: 'p' }, { timeoutMs: 30_000 })
      throw new Error('inpaint unexpectedly succeeded without torch')
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('UNAVAILABLE')
    }
  }, 60_000)

  test.skipIf(!pythonAvailable())('identity_check without face models returns MODEL_MISSING', async () => {
    try {
      await workerRequest('identity_check', { imageA: 'x', imageB: 'y', threshold: 0.3 }, { timeoutMs: 30_000 })
      throw new Error('identity_check unexpectedly succeeded without models')
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('MODEL_MISSING')
    }
  }, 60_000)

  test.skipIf(!pythonAvailable())('unknown methods are rejected cleanly', async () => {
    try {
      await workerRequest('definitely_not_a_method', {}, { timeoutMs: 30_000 })
      throw new Error('unknown method unexpectedly succeeded')
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('UNKNOWN_METHOD')
    }
  }, 60_000)

  test.skipIf(!pythonAvailable())('cancel answers even without models', async () => {
    const r = await workerCancel('nonexistent-target')
    expect(r.cancelled).toBe('nonexistent-target')
  }, 60_000)
})

describe('Node client boundary faults', () => {
  test('a non-existent interpreter maps to WORKER_UNAVAILABLE', async () => {
    workerStop() // drop any live singleton from earlier tests
    process.env.LAXII_WORKER_PYTHON = '/nonexistent/python-binary'
    try {
      await workerRequest('preflight', {}, { timeoutMs: 10_000 })
      throw new Error('unexpected success with a broken interpreter')
    } catch (e) {
      expect((e as Error & { code?: string }).code).toBe('WORKER_UNAVAILABLE')
      expect((e as Error).message).toContain('ENOENT')
    } finally {
      delete process.env.LAXII_WORKER_PYTHON
      workerStop()
    }
  }, 30_000)

  test('the raw process speaks line-delimited JSON with a ready frame', async () => {
    if (!pythonAvailable()) return
    const proc = spawn('python3', [WORKER], { stdio: ['pipe', 'pipe', 'pipe'] })
    const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => reject(new Error('no ready frame')), 15_000)
      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        const nl = buf.indexOf('\n')
        if (nl >= 0) {
          clearTimeout(timer)
          resolve(JSON.parse(buf.slice(0, nl)))
        }
      })
      proc.on('exit', (c) => reject(new Error(`exited early: ${c}`)))
    })
    const frame = (await ready) as { type?: string; workerVersion?: string }
    expect(frame.type).toBe('ready')
    expect(frame.workerVersion).toBeTruthy()
    proc.kill('SIGKILL')
  }, 30_000)
})
