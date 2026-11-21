/**
 * GANGZII M27 — REAL end-to-end audio execution test.
 *
 * NO MOCKS on the execution path: this test drives the REAL audio worker,
 * the REAL durable queue (inline claim protocol), the REAL local Kokoro-82M
 * ONNX engine, REAL ffprobe validation, the REAL Trust Engine receipt and
 * the REAL narration join (ffmpeg concat). It requires:
 *  - the installed Kokoro model under storage/models/hf/ (the explicit
 *    install step — run scripts/m27-kokoro-smoke.ts first if missing),
 *  - the dev database (GenerationJob/TrustTask/NarrationProject rows are
 *    created for a disposable e2e user and deleted afterwards).
 *
 * This is the milestone's "actual generated speech file in at least one
 * end-to-end test" requirement — a mock can never substitute it.
 */
import { describe, test, expect, afterAll } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { processAudioJob } from '@/lib/jobs/audio-worker'
import { hostedAudioAdapter } from '@/lib/adapters/hosted-audio'
import {
  createNarrationProject,
  generateNarrationProject,
  reconcileNarrationSegments,
  joinNarrationProject,
  getNarrationProjectForOwner,
} from '@/lib/gangzii/narration-service'
import { GANGZII_STORAGE_ROOT } from '@/lib/gangzii/audio-upload'
import type { ClaimedJob } from '@/lib/ai-engine/types'

const MODEL_INSTALLED = fs.existsSync(
  path.join(process.cwd(), 'storage', 'models', 'hf', 'onnx-community', 'Kokoro-82M-v1.0-ONNX', 'onnx', 'model_quantized.onnx'),
)

const E2E_EMAIL = `e2e-gangzii-audio-${Date.now()}@test.local`
let e2eUserId: string | null = null
const createdJobIds: string[] = []

async function waitFor<T>(
  fn: () => Promise<T | null>,
  predicate: (v: T) => boolean,
  timeoutMs = 180_000,
  intervalMs = 2_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v !== null && predicate(v)) return v
    if (Date.now() > deadline) return v
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

describe('GANGZII audio worker — real local speech end-to-end', () => {
  afterAll(async () => {
    // Full cleanup: files first, then the user row (cascades jobs, receipts,
    // narration projects). The evidence for the M27 report is the assertion
    // output, not leftover rows.
    if (e2eUserId) {
      for (const dir of ['tts', 'narration', 'masters', 'uploads', 'convert', 'assets']) {
        const p = path.join(GANGZII_STORAGE_ROOT, e2eUserId, dir)
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
      }
      await db.user.delete({ where: { id: e2eUserId } }).catch(() => undefined)
    }
  })

  test('speech-synthesis job produces a real, ffprobe-validated WAV via the local engine', async () => {
    if (!MODEL_INSTALLED) {
      console.warn('[e2e] SKIP: the Kokoro model is not installed (run the explicit install first).')
      return
    }
    const user = await db.user.create({
      data: {
        email: E2E_EMAIL,
        name: 'GANGZII audio E2E',
        role: 'user',
        passwordHash: 'e2e-only-no-login',
      },
    })
    e2eUserId = user.id

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'gangzii',
        task: 'speech-synthesis',
        status: 'running',
        backendId: 'bean-audio-tts-local-kokoro',
        paramsJson: JSON.stringify({
          text: 'GANGZII end-to-end test. This narration was synthesized locally by the Kokoro engine.',
          voice: 'af_heart',
          speed: 1.0,
          source: 'studio',
        }),
      },
    })
    createdJobIds.push(job.id)

    const claimed: ClaimedJob = {
      id: job.id,
      userId: user.id,
      productId: 'gangzii',
      product: 'gangzii',
      task: 'speech-synthesis',
      capability: null,
      status: 'starting',
      progress: 0,
      attempts: 1,
      maxAttempts: 2,
      paramsJson: job.paramsJson,
      resultJson: null,
      cancelRequested: false,
      workerId: 'wk_e2e_test',
      workerKind: 'embedded',
    }

    await processAudioJob(claimed, { signal: { aborted: false } })

    // 1. The row settled honestly (completed requires a real artifact).
    const settled = await db.generationJob.findUnique({ where: { id: job.id } })
    expect(settled).not.toBeNull()
    expect(settled!.status).toBe('completed')
    const result = JSON.parse(settled!.resultJson!) as {
      audioUrl: string
      engine: string
      model: string
      chunks: number
      durationSec: number
      sampleRateHz: number
      channels: number
      bytes: number
    }
    expect(result.engine).toContain('local Kokoro-82M')
    expect(result.model).toContain('Kokoro-82M')
    expect(result.sampleRateHz).toBe(24_000)
    expect(result.channels).toBe(1)
    expect(result.durationSec).toBeGreaterThan(1)

    // 2. The artifact EXISTS on disk and ffprobe reads it (real validation).
    const wavPath = path.join(GANGZII_STORAGE_ROOT, user.id, 'tts', `${job.id}.wav`)
    expect(fs.existsSync(wavPath)).toBe(true)
    const probe = await hostedAudioAdapter.probeAudio(wavPath)
    expect(probe.codec).toBe('pcm_s16le')
    expect(probe.sampleRateHz).toBe(24_000)
    expect(probe.channels).toBe(1)
    expect(Math.abs((probe.durationSec ?? 0) - result.durationSec)).toBeLessThan(0.5)

    // 3. The Trust receipt exists, carries ffprobe facts and an honest
    //    verification summary (never a bare "model replied").
    const receipt = await db.trustTask.findFirst({ where: { jobId: job.id } })
    expect(receipt).not.toBeNull()
    expect(receipt!.status).toBe('completed')
    expect(receipt!.verificationSummary).toContain('ffprobe')
    expect(receipt!.verificationSummary).toContain('NOT a claim')
    const evidence = await db.trustEvidence.findMany({ where: { taskId: receipt!.id } })
    expect(evidence.some((e) => e.kind === 'measurement' && e.title.includes('ffprobe'))).toBe(true)

    // 4. Honest metering recorded the real work.
    const usage = await db.usageRecord.findFirst({ where: { userId: user.id, product: 'gangzii', kind: 'speech-synthesis' } })
    expect(usage).not.toBeNull()
    expect(usage!.success).toBe(true)
  }, 240_000)

  test('narration studio: segment synthesis → measured timings → real ffmpeg join', async () => {
    if (!MODEL_INSTALLED || !e2eUserId) {
      console.warn('[e2e] SKIP: model or user unavailable.')
      return
    }
    // 1. Create a narration project with two explicit segments (as the
    //    JAZMII per-scene hand-off does).
    const project = await createNarrationProject({
      userId: e2eUserId,
      title: 'E2E narration',
      text: 'This is the first narration segment for the join test. This is the second segment, which completes the track.',
      language: 'en',
      voice: 'af_heart',
      speed: 1.0,
      segments: [
        { text: 'This is the first narration segment for the join test.' },
        { text: 'This is the second segment, which completes the track.' },
      ],
    })
    expect(project.segments.length).toBe(2)

    // 2. Generate: enqueues REAL speech-synthesis jobs; the pool-less test
    //    process executes them through the queue's inline claim protocol.
    const gen = await generateNarrationProject(project.id, e2eUserId)
    expect(gen.enqueued).toBe(2)

    const settledProject = await waitFor(
      async () => {
        await reconcileNarrationSegments(e2eUserId!, project.id)
        return getNarrationProjectForOwner(project.id, e2eUserId!)
      },
      (p) => p!.segments.every((s) => s.status === 'ready'),
      240_000,
    )
    expect(settledProject).not.toBeNull()
    for (const seg of settledProject!.segments) {
      expect(seg.status).toBe('ready')
      expect(seg.artifactRelPath).not.toBeNull()
      expect(fs.existsSync(path.join(GANGZII_STORAGE_ROOT, seg.artifactRelPath!))).toBe(true)
      // MEASURED timing — a real number, never a placeholder.
      expect(seg.durationMs).not.toBeNull()
      expect(seg.durationMs!).toBeGreaterThan(500)
    }

    // 3. Join: ONE audio-production job concatenating both segments.
    const join = await joinNarrationProject(project.id, e2eUserId)
    expect(join.inputs).toBe(2)

    const joinedRow = await waitFor(
      async () => {
        const row = await db.generationJob.findUnique({ where: { id: join.jobId } })
        return row && ['completed', 'failed'].includes(row.status) ? row : null
      },
      (row) => row!.status === 'completed',
      180_000,
    )
    expect(joinedRow).not.toBeNull()
    expect(joinedRow!.status).toBe('completed')
    const joinResult = JSON.parse(joinedRow!.resultJson!) as {
      relPath: string
      loudness: { integratedLufs: number | null; truePeakDbtp: number | null }
      durationSec: number | null
      masterLabel: string
    }
    expect(fs.existsSync(path.join(GANGZII_STORAGE_ROOT, joinResult.relPath))).toBe(true)
    // The master is ffprobe-validated with MEASURED loudness (ebur128).
    expect(joinResult.loudness.integratedLufs).not.toBeNull()
    expect(joinResult.masterLabel).toContain('processed-audio')
    // The measured duration ≈ the sum of the measured segments (±1s) —
    // the join actually concatenated, it did not fabricate a track.
    const segmentSumSec = settledProject!.segments.reduce((a, s) => a + (s.durationMs ?? 0), 0) / 1000
    expect(Math.abs((joinResult.durationSec ?? 0) - segmentSumSec)).toBeLessThan(1.0)
  }, 300_000)
})
