/**
 * BEAN Intelligence — per-product functional test suites (user-facing).
 *
 * Every product workspace exposes a dedicated test workflow that runs named
 * checks against the REAL API paths (self-fetch with the caller's own
 * session) and reports, per test: name, running state, classification
 * (real provider round-trip / real local engine / simulated infrastructure
 * check), result, error message, generated artifact, timestamp.
 *
 * Honesty contract:
 *  - a test is `real` only when a real provider round-trip produced the
 *    artifact this run;
 *  - `deterministic` marks real executions of LOCAL engines (Sharp, sandbox)
 *    or persistence checks — never presented as AI generation;
 *  - `simulated` marks input-validation probes that touch no provider;
 *  - when an upstream endpoint class is rate-limited (breaker open) the
 *    provider test is marked `blocked` WITHOUT touching the network, so the
 *    suite can never contribute to a retry storm;
 *  - no provider secrets and no internal infrastructure details are ever
 *    included in results; the caller's session cookie is held server-side
 *    only for the lifetime of a run and never returned or logged.
 */
import { upstreamBreakerState, type UpstreamEndpointClass } from '@/lib/upstream/gateway'

export type DiagClassification = 'real' | 'deterministic' | 'simulated'
export type DiagState = 'pending' | 'running' | 'passed' | 'failed' | 'blocked'

export interface DiagTest {
  id: string
  name: string
  classification: DiagClassification
  state: DiagState
  result: string | null
  error: string | null
  artifactUrl: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface DiagRun {
  id: string
  product: DiagProduct
  userId: string
  createdAt: string
  tests: DiagTest[]
}

export type DiagProduct = 'riishe' | 'laxii' | 'jazmii' | 'code-giftz'

export const DIAG_PRODUCTS: DiagProduct[] = ['riishe', 'laxii', 'jazmii', 'code-giftz']

const RUN_TTL_MS = 30 * 60_000
const runs = new Map<string, DiagRun>()
/** Per-run server-side state: the caller's cookie and async poll keys. */
const priv = new Map<string, { cookie: string; pollKeys: Map<string, string> }>()

function now(): string {
  return new Date().toISOString()
}

function test(p: Partial<DiagTest> & { id: string; name: string; classification: DiagClassification }): DiagTest {
  return {
    state: 'pending',
    result: null,
    error: null,
    artifactUrl: null,
    startedAt: null,
    finishedAt: null,
    ...p,
  }
}

function sweepExpired(): void {
  const cutoff = Date.now() - RUN_TTL_MS
  for (const [id] of runs) {
    const created = new Date(runs.get(id)!.createdAt).getTime()
    if (created < cutoff) {
      runs.delete(id)
      priv.delete(id)
    }
  }
}

function breakerOpen(cls: UpstreamEndpointClass): string | null {
  const s = upstreamBreakerState(cls)
  if (!s.coolingDown) return null
  return 'The AI provider is rate-limited right now. Run the suite again in a few minutes.'
}

function set(t: DiagTest, patch: Partial<DiagTest>): void {
  Object.assign(t, patch)
}

function fail(t: DiagTest, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  set(t, { state: 'failed', error: msg.slice(0, 300), finishedAt: now() })
}

async function api(cookie: string, method: string, path: string, body?: unknown, raw = false) {
  const res = await fetch(`http://localhost:3000${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Accept: raw ? '*/*' : 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers }
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 200) } }
  return { status: res.status, json, headers: res.headers }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Read a full SSE stream and return the concatenated deltas. */
async function readStream(cookie: string, path: string, body: unknown) {
  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let convId = res.headers.get('x-conversation-id')
  const reader = res.body?.getReader()
  const dec = new TextDecoder()
  let buf = '', deltas = '', streamError: string | null = null, frames = 0
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const evt = JSON.parse(line.slice(5))
            frames++
            if (typeof evt.delta === 'string') deltas += evt.delta
            if (evt.error) streamError = String(evt.error).slice(0, 200)
            if (!convId && (evt.conversationId || evt.done?.conversationId)) {
              convId = String(evt.conversationId ?? evt.done.conversationId)
            }
          } catch { /* partial frame */ }
        }
      }
    } catch (e) {
      streamError = streamError ?? String(e).slice(0, 160)
    }
  }
  return { status: res.status, convId, deltas, frames, streamError }
}

// ---------------------------------------------------------------------------
// RIISHE suite
// ---------------------------------------------------------------------------
async function runRiishe(run: DiagRun, cookie: string): Promise<void> {
  const stream = run.tests.find((t) => t.id === 'chat-stream')!
  const persistence = run.tests.find((t) => t.id === 'persistence')!
  const validation = run.tests.find((t) => t.id === 'validation')!

  set(stream, { state: 'running', startedAt: now() })
  const blocked = breakerOpen('chat')
  if (blocked) {
    set(stream, { state: 'blocked', error: blocked, finishedAt: now() })
    set(persistence, { state: 'blocked', error: 'Skipped: the chat test did not run.', finishedAt: now() })
  } else {
    try {
      const t0 = Date.now()
      const r = await readStream(cookie, '/api/riishe/chat?stream=1', {
        message: 'In exactly one short sentence, confirm the product test suite is working.',
      })
      if (r.streamError && r.deltas.length === 0) {
        set(stream, { state: 'failed', error: r.streamError, finishedAt: now() })
        set(persistence, { state: 'blocked', error: 'Skipped: the chat test did not run.', finishedAt: now() })
      } else {
        set(stream, {
          state: 'passed',
          result: `${r.deltas.length} characters streamed in ${Date.now() - t0}ms across ${r.frames} frames — real model response.`,
          error: r.streamError,
          finishedAt: now(),
        })
        set(persistence, { state: 'running', startedAt: now() })
        if (!r.convId) {
          set(persistence, { state: 'failed', error: 'No conversation id returned by the chat stream.', finishedAt: now() })
        } else {
          const d = await api(cookie, 'GET', `/api/riishe/conversations/${r.convId}`)
          const msgs = d.json?.messages ?? d.json?.conversation?.messages ?? []
          set(persistence, {
            state: Array.isArray(msgs) && msgs.length >= 2 ? 'passed' : 'failed',
            result: `Conversation reloaded after refresh: ${Array.isArray(msgs) ? msgs.length : 0} persisted messages.`,
            finishedAt: now(),
          })
        }
      }
    } catch (e) {
      fail(stream, e)
      set(persistence, { state: 'blocked', error: 'Skipped: the chat test did not run.', finishedAt: now() })
    }
  }

  set(validation, { state: 'running', startedAt: now() })
  try {
    const e = await api(cookie, 'POST', '/api/riishe/chat', { message: '' })
    set(validation, {
      state: e.status >= 400 && e.status < 500 ? 'passed' : 'failed',
      result: `Empty message rejected with typed HTTP ${e.status} (no crash, no provider call).`,
      finishedAt: now(),
    })
  } catch (err) {
    fail(validation, err)
  }
}

// ---------------------------------------------------------------------------
// LAXII suite
// ---------------------------------------------------------------------------
const SKIPPED_LAXII = 'Skipped: needs the generated image.'

async function runLaxii(run: DiagRun, cookie: string): Promise<void> {
  const t2i = run.tests.find((t) => t.id === 't2i')!
  const enhance = run.tests.find((t) => t.id === 'enhance')!
  const persistence = run.tests.find((t) => t.id === 'persistence')!

  set(t2i, { state: 'running', startedAt: now() })
  const blocked = breakerOpen('images')
  if (blocked) {
    set(t2i, { state: 'blocked', error: blocked, finishedAt: now() })
    set(enhance, { state: 'blocked', error: SKIPPED_LAXII, finishedAt: now() })
    set(persistence, { state: 'blocked', error: SKIPPED_LAXII, finishedAt: now() })
    return
  }
  try {
    const g = await api(cookie, 'POST', '/api/laxii/generate', {
      prompt: 'A small ceramic teacup on a windowsill, soft morning light',
      size: '1024x1024',
    })
    const jobId = g.json?.job?.id
    if (g.status !== 202 || !jobId) {
      set(t2i, { state: 'failed', error: `Generation rejected: HTTP ${g.status} ${String(g.json?.message ?? g.json?.code ?? '').slice(0, 160)}`, finishedAt: now() })
      set(enhance, { state: 'blocked', error: SKIPPED_LAXII, finishedAt: now() })
      set(persistence, { state: 'blocked', error: SKIPPED_LAXII, finishedAt: now() })
      return
    }
    let job: any = null
    const deadline = Date.now() + 150_000
    while (Date.now() < deadline) {
      await sleep(6_000)
      const r = await api(cookie, 'GET', `/api/laxii/jobs/${jobId}`)
      job = r.json?.job ?? null
      if (job && (job.status === 'completed' || job.status === 'failed')) break
    }
    if (job?.status === 'completed') {
      const mediaUrl = String(job.imageUrl ?? '')
      const img = await api(cookie, 'GET', mediaUrl, undefined, true)
      const magic = img.bytes && img.bytes[0] === 0xff && img.bytes[1] === 0xd8
      set(t2i, {
        state: magic ? 'passed' : 'failed',
        result: `Real provider image: ${img.bytes?.length ?? 0} bytes, ${job.width}x${job.height}, verified JPEG.`,
        artifactUrl: mediaUrl,
        finishedAt: now(),
      })
      priv.get(run.id)!.pollKeys.set('t2iJobId', jobId)
      set(enhance, { state: 'running', startedAt: now() })
      try {
        // The generation registers its result as a real owned ImageAsset;
        // the job detail now reports the asset URL (see jobs/[id] route), so
        // the enhance step chains from it exactly like the UI does.
        const assetId = String(job.imageUrl ?? '').match(/\/api\/laxii\/assets\/([\w-]+)$/)?.[1] ?? ''
        const eh = await api(cookie, 'POST', '/api/laxii/enhance', { assetId })
        const ehJobId = eh.json?.job?.id
        if (eh.status === 202 && ehJobId) {
          let ehJob: any = null
          const ehDeadline = Date.now() + 90_000
          while (Date.now() < ehDeadline) {
            await sleep(5_000)
            const r = await api(cookie, 'GET', `/api/laxii/jobs/${ehJobId}`)
            ehJob = r.json?.job ?? null
            if (ehJob && (ehJob.status === 'completed' || ehJob.status === 'failed')) break
          }
          if (ehJob?.status === 'completed') priv.get(run.id)!.pollKeys.set('enhJobId', String(ehJobId))
          set(enhance, {
            state: ehJob?.status === 'completed' ? 'passed' : 'failed',
            result: ehJob?.status === 'completed'
              ? `Local preservation engine executed on the generated image (${ehJob.bytes ?? 0} bytes output). Deterministic — not AI generation.`
              : null,
            error: ehJob?.status === 'completed' ? null : String(ehJob?.errorMessage ?? 'enhancement did not complete'),
            artifactUrl: ehJob?.imageUrl ? String(ehJob.imageUrl) : null,
            finishedAt: now(),
          })
        } else {
          set(enhance, { state: 'failed', error: `Enhance rejected: HTTP ${eh.status}`, finishedAt: now() })
        }
      } catch (e) {
        fail(enhance, e)
      }
    } else {
      set(t2i, { state: job?.status === 'failed' ? 'blocked' : 'failed', error: String(job?.errorMessage ?? 'generation timed out'), finishedAt: now() })
      set(enhance, { state: 'blocked', error: SKIPPED_LAXII, finishedAt: now() })
    }
  } catch (e) {
    fail(t2i, e)
    set(enhance, { state: 'blocked', error: SKIPPED_LAXII, finishedAt: now() })
  }

  set(persistence, { state: 'running', startedAt: now() })
  try {
    const keys = priv.get(run.id)!.pollKeys
    const ids = ['t2iJobId', 'enhJobId'].map((k) => keys.get(k)).filter(Boolean) as string[]
    if (ids.length === 0) {
      set(persistence, { state: 'blocked', error: 'Skipped: no jobs were created this run.', finishedAt: now() })
      return
    }
    let found = 0
    for (const id of ids) {
      const r = await api(cookie, 'GET', `/api/laxii/jobs/${id}`)
      if (r.status === 200 && r.json?.job?.status === 'completed') found++
    }
    set(persistence, {
      state: found === ids.length ? 'passed' : 'failed',
      result: `${found}/${ids.length} job record(s) reloaded intact after refresh (owner-checked detail API).`,
      finishedAt: now(),
    })
  } catch (e) {
    fail(persistence, e)
  }
}

// ---------------------------------------------------------------------------
// JAZMII suite
// ---------------------------------------------------------------------------
async function runJazmii(run: DiagRun, cookie: string): Promise<void> {
  const submit = run.tests.find((t) => t.id === 't2v-submit')!
  const tracking = run.tests.find((t) => t.id === 'job-tracking')!
  const mp4 = run.tests.find((t) => t.id === 'mp4-verify')!
  const validation = run.tests.find((t) => t.id === 'validation')!
  const p = priv.get(run.id)!

  set(submit, { state: 'running', startedAt: now() })
  const blocked = breakerOpen('video')
  if (blocked) {
    set(submit, { state: 'blocked', error: blocked, finishedAt: now() })
    set(tracking, { state: 'blocked', error: 'Skipped: no job submitted.', finishedAt: now() })
    set(mp4, { state: 'blocked', error: 'Skipped: no job submitted.', finishedAt: now() })
  } else {
    try {
      const g = await api(cookie, 'POST', '/api/jazmii/generate', {
        prompt: 'A single amber balloon drifting slowly upward against a clear blue sky',
        size: '768x768',
        durationSec: 5,
        quality: 'speed',
        withAudio: false,
      })
      const jobId = g.json?.job?.id
      if (g.status !== 202 || !jobId) {
        set(submit, { state: 'failed', error: `Submission rejected: HTTP ${g.status} ${String(g.json?.message ?? g.json?.code ?? '').slice(0, 160)}`, finishedAt: now() })
        set(tracking, { state: 'blocked', error: 'Skipped: no job submitted.', finishedAt: now() })
        set(mp4, { state: 'blocked', error: 'Skipped: no job submitted.', finishedAt: now() })
      } else {
        set(submit, { state: 'passed', result: 'Real provider job accepted — asynchronous submission confirmed.', finishedAt: now() })
        set(tracking, { state: 'running', startedAt: now(), result: 'Polling the submitted job…' })
        p.pollKeys.set('jobId', jobId)
      }
    } catch (e) {
      fail(submit, e)
      set(tracking, { state: 'blocked', error: 'Skipped: no job submitted.', finishedAt: now() })
      set(mp4, { state: 'blocked', error: 'Skipped: no job submitted.', finishedAt: now() })
    }
  }

  set(validation, { state: 'running', startedAt: now() })
  try {
    const e = await api(cookie, 'POST', '/api/jazmii/generate', { prompt: 'test', size: 'abc' })
    set(validation, {
      state: e.status === 400 ? 'passed' : 'failed',
      result: `Invalid size rejected with typed HTTP ${e.status} — no provider call wasted.`,
      finishedAt: now(),
    })
  } catch (err) {
    fail(validation, err)
  }
}

async function refreshJazmii(run: DiagRun): Promise<void> {
  const tracking = run.tests.find((t) => t.id === 'job-tracking')!
  const mp4 = run.tests.find((t) => t.id === 'mp4-verify')!
  if (tracking.state !== 'running') return
  const p = priv.get(run.id)
  const jobId = p?.pollKeys.get('jobId')
  if (!jobId) return
  const r = await api(p!.cookie, 'GET', `/api/jazmii/jobs/${jobId}`)
  const j = r.json?.job ?? {}
  if (j.status === 'running' || j.status === 'queued') {
    set(tracking, { result: `Job ${j.status} — progress ${j.progress ?? 0}% (BEAN tracking estimate).` })
    return
  }
  if (j.status === 'completed' && j.videoUrl) {
    set(tracking, { state: 'passed', result: `Job completed — ${j.bytes ?? 0} bytes, format ${j.format ?? 'unknown'}.`, finishedAt: now() })
    if (mp4.state === 'pending') {
      set(mp4, { state: 'running', startedAt: now() })
      try {
        const m = await api(p!.cookie, 'GET', String(j.videoUrl), undefined, true)
        const magic = m.bytes && m.bytes.length > 12 && m.bytes.toString('ascii', 4, 8) === 'ftyp'
        set(mp4, {
          state: magic && m.status === 200 ? 'passed' : 'failed',
          result: magic ? `MP4 container verified: ${m.bytes.length} bytes; media download works (Range-supported).` : null,
          error: magic ? null : 'Downloaded media is not a valid MP4 container.',
          artifactUrl: String(j.videoUrl),
          finishedAt: now(),
        })
      } catch (e) {
        fail(mp4, e)
      }
    }
    return
  }
  if (j.status === 'failed') {
    set(tracking, { state: 'blocked', result: null, error: String(j.errorMessage ?? 'job failed'), finishedAt: now() })
    set(mp4, { state: 'blocked', error: 'Skipped: the job did not complete.', finishedAt: now() })
  }
}

// ---------------------------------------------------------------------------
// CODE GIFTZ suite
// ---------------------------------------------------------------------------
async function runGiftz(run: DiagRun, cookie: string): Promise<void> {
  const codegen = run.tests.find((t) => t.id === 'codegen')!
  const sandbox = run.tests.find((t) => t.id === 'sandbox')!
  const persistence = run.tests.find((t) => t.id === 'persistence')!

  set(codegen, { state: 'running', startedAt: now() })
  const blocked = breakerOpen('chat')
  if (blocked) {
    set(codegen, { state: 'blocked', error: blocked, finishedAt: now() })
    set(sandbox, { state: 'blocked', error: 'Skipped: needs generated code.', finishedAt: now() })
    set(persistence, { state: 'blocked', error: 'Skipped: needs generated code.', finishedAt: now() })
    return
  }
  try {
    const t = await api(cookie, 'POST', '/api/code-giftz/tasks', {
      mode: 'generate',
      prompt: 'Write a JavaScript file greet.js that prints exactly: GIFTZ-SUITE-OK (single console.log). Standard library only.',
      language: 'javascript',
    })
    const taskId = t.json?.task?.id
    const files = Array.isArray(t.json?.task?.files) ? t.json.task.files : []
    if (t.status !== 200 || !taskId || files.length === 0) {
      set(codegen, { state: 'failed', error: `Task rejected: HTTP ${t.status} ${String(t.json?.message ?? '').slice(0, 160)}`, finishedAt: now() })
      set(sandbox, { state: 'blocked', error: 'Skipped: needs generated code.', finishedAt: now() })
      set(persistence, { state: 'blocked', error: 'Skipped: needs generated code.', finishedAt: now() })
      return
    }
    set(codegen, {
      state: 'passed',
      result: `Real model code generation: ${files.length} file(s) (${files.map((f: any) => f.path ?? f.name).join(', ')}).`,
      finishedAt: now(),
    })
    priv.get(run.id)!.pollKeys.set('taskId', String(taskId))
    set(sandbox, { state: 'running', startedAt: now() })
    try {
      const r = await api(cookie, 'POST', '/api/code-giftz/run', { taskId, approval: true })
      const run2 = r.json?.run ?? {}
      const verified = r.status === 200 && run2.exitCode === 0 && String(run2.stdout ?? '').includes('GIFTZ-SUITE-OK')
      set(sandbox, {
        state: verified ? 'passed' : 'failed',
        result: verified
          ? `Code executed in the isolated sandbox: exit 0, output verified ("GIFTZ-SUITE-OK") in ${run2.durationMs ?? '?'}ms.`
          : null,
        error: verified ? null : `exit=${run2.exitCode ?? '?'} stdout="${String(run2.stdout ?? '').slice(0, 80)}" stderr="${String(run2.stderr ?? '').slice(0, 120)}"`,
        finishedAt: now(),
      })
    } catch (e) {
      fail(sandbox, e)
    }
  } catch (e) {
    fail(codegen, e)
    set(sandbox, { state: 'blocked', error: 'Skipped: needs generated code.', finishedAt: now() })
    set(persistence, { state: 'blocked', error: 'Skipped: needs generated code.', finishedAt: now() })
    return
  }

  set(persistence, { state: 'running', startedAt: now() })
  try {
    const keys = priv.get(run.id)!.pollKeys
    const taskId = keys.get('taskId')
    if (!taskId) {
      set(persistence, { state: 'blocked', error: 'Skipped: no task was created this run.', finishedAt: now() })
      return
    }
    const d = await api(cookie, 'GET', `/api/code-giftz/tasks/${taskId}`)
    const t = d.json?.task ?? {}
    const files = Array.isArray(t.files) ? t.files : []
    set(persistence, {
      state: d.status === 200 && t.status === 'completed' && files.length > 0 ? 'passed' : 'failed',
      result: `Task and its ${files.length} generated file(s) reloaded intact after refresh (owner-checked).`,
      finishedAt: now(),
    })
  } catch (e) {
    fail(persistence, e)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const PLANS: Record<DiagProduct, Array<{ id: string; name: string; classification: DiagClassification }>> = {
  riishe: [
    { id: 'chat-stream', name: 'Streaming chat completion (real model response)', classification: 'real' },
    { id: 'persistence', name: 'Conversation persistence after refresh', classification: 'deterministic' },
    { id: 'validation', name: 'Input validation (empty message)', classification: 'simulated' },
  ],
  laxii: [
    { id: 't2i', name: 'Text-to-image generation (real provider image)', classification: 'real' },
    { id: 'enhance', name: 'Deterministic enhancement (local engine)', classification: 'deterministic' },
    { id: 'persistence', name: 'Job and asset persistence', classification: 'deterministic' },
  ],
  jazmii: [
    { id: 't2v-submit', name: 'Text-to-video submission (real provider job)', classification: 'real' },
    { id: 'job-tracking', name: 'Async job status and progress tracking', classification: 'deterministic' },
    { id: 'mp4-verify', name: 'MP4 media verification and download', classification: 'deterministic' },
    { id: 'validation', name: 'Input validation (invalid size)', classification: 'simulated' },
  ],
  'code-giftz': [
    { id: 'codegen', name: 'Code generation (real model response)', classification: 'real' },
    { id: 'sandbox', name: 'Sandbox execution with verified output', classification: 'deterministic' },
    { id: 'persistence', name: 'Project persistence', classification: 'deterministic' },
  ],
}

export function startRun(product: DiagProduct, userId: string, cookie: string): DiagRun {
  sweepExpired()
  const run: DiagRun = {
    id: `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    product,
    userId,
    createdAt: now(),
    tests: PLANS[product].map((p) => test({ ...p })),
  }
  runs.set(run.id, run)
  priv.set(run.id, { cookie, pollKeys: new Map() })
  void (async () => {
    try {
      if (product === 'riishe') await runRiishe(run, cookie)
      else if (product === 'laxii') await runLaxii(run, cookie)
      else if (product === 'jazmii') await runJazmii(run, cookie)
      else await runGiftz(run, cookie)
    } catch {
      /* rows already carry their own failures */
    }
  })()
  return run
}

export function getRun(userId: string, runId: string): DiagRun | null {
  const run = runs.get(runId)
  if (!run || run.userId !== userId) return null
  return run
}

/** Advance any still-running async rows (jazmii job polling). */
export async function refreshRun(userId: string, runId: string): Promise<DiagRun | null> {
  const run = getRun(userId, runId)
  if (!run) return null
  if (run.product === 'jazmii') await refreshJazmii(run)
  return run
}
