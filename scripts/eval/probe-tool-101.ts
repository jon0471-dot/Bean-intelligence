/**
 * Diagnostic probe — tool-101 through the upgraded pipeline (non-streaming).
 * Prints the tool plan, raw answer and tool executions for honest inspection
 * of why the sandbox run_code path did (or did not) trigger.
 */
import { hostedLlmAdapter } from '../../src/lib/adapters/hosted-llm'
import { orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import { CHAT_BACKEND_CAPABILITIES } from '../../src/lib/riishe/classify'
import { planCapabilities } from '../../src/lib/riishe/capability-plan'

const CAPS = { maxPromptChars: 12000, maxHistoryMessages: 24 }
const QUESTION = 'Run code to compute the sum of all primes below 100, and report the exact number.'

async function main() {
  console.log('plan:', JSON.stringify(planCapabilities(QUESTION, 'math', false)))
  const r = await orchestrateTurn({
    userMessage: QUESTION,
    history: [],
    caps: CAPS,
    adapter: hostedLlmAdapter,
    nonStreaming: true,
    backendCapabilities: CHAT_BACKEND_CAPABILITIES,
    toolContext: {
      permissions: new Set(['allowCodeExecution']),
      documents: new Map(),
    },
  })
  console.log('task:', r.task)
  console.log('searchRan:', r.searchRan)
  console.log('states:', r.metadata.states)
  console.log('router:', JSON.stringify(r.metadata.router))
  console.log('toolRuns:', JSON.stringify(r.metadata.toolRuns ?? []))
  console.log('--- answer (first 700 chars) ---')
  console.log(JSON.stringify(r.content.slice(0, 700)))
}

main()
