/**
 * Minimal gateway probe before the CODE GIFTZ live eval (read-only usage).
 * Prints the raw verdict so the eval is only started when the upstream can serve.
 */
import ZAI from 'z-ai-web-dev-sdk'

const zai = await ZAI.create()
const t0 = Date.now()
try {
  const r = await zai.chat.completions.create({
    messages: [{ role: 'user', content: 'Reply with the single word: READY' }],
    thinking: { type: 'disabled' },
  })
  console.log('GATEWAY OK', Date.now() - t0, 'ms:', JSON.stringify(r.choices[0]?.message?.content))
} catch (e) {
  console.log('GATEWAY FAIL', Date.now() - t0, 'ms:', e instanceof Error ? e.message : String(e))
}
