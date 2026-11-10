/**
 * Health incident probe — measure gateway behavior directly (outside Next.js).
 *
 * Sequence:
 *  1. single LLM completion call
 *  2. wait 8s, single LLM completion call
 *  3. wait 8s, single LLM completion call
 *  4. single TTS call (smallest possible)
 *
 * Prints status + latency for each. Evidence for the 429 investigation.
 */
import ZAI from 'z-ai-web-dev-sdk'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function llmCall(label: string): Promise<void> {
  const t0 = Date.now()
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      thinking: { type: 'disabled' },
    })
    const content = completion.choices?.[0]?.message?.content ?? ''
    console.log(
      `${label}: PASS ${Date.now() - t0}ms content=${JSON.stringify(content.slice(0, 40))}`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`${label}: FAIL ${Date.now() - t0}ms ${msg.slice(0, 160)}`)
  }
}

async function ttsCall(label: string): Promise<void> {
  const t0 = Date.now()
  try {
    const zai = await ZAI.create()
    const res = (await zai.audio.tts.create({
      input: '测试',
      voice: 'tongtong',
      response_format: 'wav',
      speed: 1.0,
      stream: false,
    })) as Response
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(new Uint8Array(ab))
    console.log(`${label}: PASS ${Date.now() - t0}ms bytes=${buf.length} magic=${buf.subarray(0, 4).toString('ascii')}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`${label}: FAIL ${Date.now() - t0}ms ${msg.slice(0, 160)}`)
  }
}

async function main() {
  await llmCall('llm-1')
  await sleep(8_000)
  await llmCall('llm-2 (+8s)')
  await sleep(8_000)
  await llmCall('llm-3 (+16s)')
  await sleep(8_000)
  await ttsCall('tts-1 (+24s)')
}

void main()
