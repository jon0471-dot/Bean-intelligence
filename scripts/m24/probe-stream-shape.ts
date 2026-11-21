/**
 * M24 probe — does the real hosted gateway terminate streams with a
 * finish_reason chunk / [DONE] sentinel? Measured on the LIVE provider with
 * a tiny metered call (max_tokens bounded). Read-only; prints chunk SHAPE
 * only, never credentials.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ZAI = require('z-ai-web-dev-sdk').default ?? require('z-ai-web-dev-sdk')

async function main() {
  const zai = await ZAI.create()
  const stream = await zai.chat.completions.create({
    messages: [{ role: 'user', content: 'Count from 1 to 5, digits only.' }],
    stream: true,
    max_tokens: 40,
  })
  let chunks = 0
  let sawFinish = false
  let finishReason: string | null = null
  for await (const chunk of stream as AsyncIterable<Record<string, unknown>>) {
    chunks += 1
    const choice = (chunk as { choices?: Array<{ finish_reason?: string | null }> }).choices?.[0]
    if (choice && choice.finish_reason) {
      sawFinish = true
      finishReason = String(choice.finish_reason)
    }
  }
  console.log(JSON.stringify({ chunks, sawFinishReason: sawFinish, finishReason }, null, 2))
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
