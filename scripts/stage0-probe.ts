/**
 * BEAN Intelligence — Stage 0 feasibility probe.
 * Verifies REAL inference capability of the authorized hosted gateway:
 *   1. Chat completion (RIISHE backend candidate)
 *   2. Streaming chat completion support (SSE feasibility)
 *   3. Image generation (LAXII backend candidate)
 * It records PASS/FAIL truthfully. Nothing is mocked.
 */
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
import path from 'path'

const REPORT: Record<string, unknown> = { startedAt: new Date().toISOString() }

async function probeChat(): Promise<boolean> {
  try {
    const zai = await ZAI.create()
    const t0 = Date.now()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'You are a connectivity probe. Answer with the exact token requested and nothing else.' },
        { role: 'user', content: 'Reply with exactly: BEAN_RIISHE_PROBE_OK' },
      ],
      thinking: { type: 'disabled' },
    })
    const content = completion.choices[0]?.message?.content ?? ''
    const ms = Date.now() - t0
    const ok = content.includes('BEAN_RIISHE_PROBE_OK')
    REPORT.chat = { ok, latencyMs: ms, responseSample: content.slice(0, 200) }
    console.log(`[chat] ${ok ? 'PASS' : 'FAIL'} (${ms}ms) -> ${content.slice(0, 120)}`)
    return ok
  } catch (e) {
    REPORT.chat = { ok: false, error: (e as Error).message }
    console.log(`[chat] FAIL: ${(e as Error).message}`)
    return false
  }
}

async function probeStream(): Promise<boolean> {
  try {
    const zai = await ZAI.create()
    const stream = (await zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
      stream: true,
      thinking: { type: 'disabled' },
    })) as unknown
    const isIterable =
      !!stream && typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
    if (!isIterable) {
      REPORT.stream = { ok: false, note: 'SDK did not return an async iterable for stream:true' }
      console.log('[stream] FAIL: not an async iterable')
      return false
    }
    let chunks = 0
    let sample = ''
    const t0 = Date.now()
    for await (const part of stream as AsyncIterable<Record<string, unknown>>) {
      chunks++
      const choices = (part as { choices?: Array<{ delta?: { content?: string } }> }).choices
      const delta = choices?.[0]?.delta?.content ?? ''
      if (sample.length < 120) sample += delta
      if (chunks > 200) break
    }
    REPORT.stream = { ok: chunks > 0, chunks, latencyMs: Date.now() - t0, sample }
    console.log(`[stream] ${chunks > 0 ? 'PASS' : 'FAIL'} (${chunks} chunks, ${Date.now() - t0}ms) sample: ${sample.slice(0, 80)}`)
    return chunks > 0
  } catch (e) {
    REPORT.stream = { ok: false, error: (e as Error).message }
    console.log(`[stream] FAIL: ${(e as Error).message}`)
    return false
  }
}

async function probeImage(): Promise<boolean> {
  try {
    const zai = await ZAI.create()
    const t0 = Date.now()
    const res = await zai.images.generations.create({
      prompt: 'Minimalist golden bean-shaped emblem floating on a near-black background, soft gold rim light, premium brand mark, high quality',
      size: '1024x1024',
    })
    const b64 = res.data?.[0]?.base64
    const ms = Date.now() - t0
    if (!b64) {
      REPORT.image = { ok: false, note: 'No base64 payload returned' }
      console.log('[image] FAIL: empty payload')
      return false
    }
    const buf = Buffer.from(b64, 'base64')
    const out = '/home/z/my-project/scripts/probe-image.png'
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, buf)
    const isPng = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
    REPORT.image = { ok: isPng, bytes: buf.length, latencyMs: ms, savedTo: out }
    console.log(`[image] ${isPng ? 'PASS' : 'FAIL'} (${buf.length} bytes, ${ms}ms) -> ${out}`)
    return isPng
  } catch (e) {
    REPORT.image = { ok: false, error: (e as Error).message }
    console.log(`[image] FAIL: ${(e as Error).message}`)
    return false
  }
}

const results = await Promise.all([probeChat(), probeImage()])
const streamOk = await probeStream()
REPORT.finishedAt = new Date().toISOString()
REPORT.summary = {
  chat: results[0],
  image: results[1],
  stream: streamOk,
  verdict:
    results[0] && results[1]
      ? 'RIISHE + LAXII real inference CONFIRMED. JAZMII: no video backend exists in this environment (will be reported BLOCKED). CODE GIFTZ: LLM + local sandbox feasible.'
      : 'One or more core backends FAILED — do not claim capability.',
}
fs.writeFileSync('/home/z/my-project/scripts/stage0-report.json', JSON.stringify(REPORT, null, 2))
console.log('\nVerdict:', REPORT.summary.verdict)
