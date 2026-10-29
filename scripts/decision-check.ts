/** One-off: verify policy + fast-path classification for the retrieval test question. */
import { shouldSearch } from '../src/lib/research/policy'
import { isStraightforwardQuestion } from '../src/lib/research/pipeline'

const msg = 'What is the latest stable version of Next.js right now?'
console.log('decision:', JSON.stringify(shouldSearch(msg)))
console.log('straightforward:', isStraightforwardQuestion(msg))
