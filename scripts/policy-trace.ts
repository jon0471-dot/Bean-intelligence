/**
 * Diagnostic trace: what does the deterministic search policy decide for the
 * exact prompts from the work orders? Run: bun scripts/policy-trace.ts
 */
import { shouldSearch } from '../src/lib/research/policy'

const prompts = [
  'who is the cm of tamilnadu',
  'Who is the Chief Minister of Tamil Nadu right now?',
  'Research a current topic: Gingee girl missing',
  'What is the latest stable version of Next.js right now?',
  'Hello!',
  'Who is the Chief Minister of Tamil Nadu?', // no freshness adverb at all
]

for (const p of prompts) {
  const d = shouldSearch(p)
  console.log(
    JSON.stringify({
      prompt: p,
      search: d.search,
      risk: d.risk,
      recencyDays: d.recencyDays ?? null,
      reason: d.reason,
    }),
  )
}
