/**
 * Diagnostic probe — math-004 through the upgraded pipeline (non-streaming).
 * Prints the raw answer, states and verification checks for honest inspection.
 */
import { hostedLlmAdapter } from '../../src/lib/adapters/hosted-llm'
import { orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import { CHAT_BACKEND_CAPABILITIES } from '../../src/lib/riishe/classify'

const CAPS = { maxPromptChars: 12000, maxHistoryMessages: 24 }
const QUESTION = 'How many trailing zeros does 100! (100 factorial) have? Give the exact number.'

async function main() {
  const r = await orchestrateTurn({
    userMessage: QUESTION,
    history: [],
    caps: CAPS,
    adapter: hostedLlmAdapter,
    nonStreaming: true,
    backendCapabilities: CHAT_BACKEND_CAPABILITIES,
  })
  console.log('=== RAW ANSWER ===')
  console.log(r.content)
  console.log('=== states:', JSON.stringify(r.metadata.states))
  console.log('=== verification:', JSON.stringify(r.metadata.verification, null, 1))
  const normalized = r.content.replace(/,/g, '')
  console.log(
    '=== scorer hit for 24:',
    new RegExp(`(^|[^\\d.])24([^\\d.]|$)`, 'm').test(normalized),
  )
}

main().catch((e) => {
  console.error('PROBE FAILED:', e)
  process.exit(1)
})
