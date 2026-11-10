import { shouldSearch } from '../src/lib/research/policy'
import { detectSensitiveCase, coreTopic } from '../src/lib/research/sensitive'
const tests = [
  "Research a current topic: Gingee girl missing",
  "Gingee girl missing case update",
  "Who is the current CEO of NVIDIA?",
  "Calculate 17 * 23",
  "My python function is missing a semicolon, how do I fix it?",
  "Write a haiku about autumn",
  "What happened in the building collapse in Mumbai?",
  "hi there",
]
for (const t of tests) {
  const d = shouldSearch(t)
  console.log(`${d.search ? 'SEARCH ' : 'skip   '} risk=${d.risk.padEnd(8)} recency=${String(d.recencyDays ?? '-').padEnd(4)} | ${t}`)
  console.log(`         reason: ${d.reason}`)
}
console.log('--- sensitive ---')
const stests = [
  "Research a current topic: Gingee girl missing",
  "My python function is missing a semicolon",
  "The murder case probe continues",
  "Tell me about the Eiffel Tower",
  "A 7-year-old girl went missing in Gingee",
  "I miss my hometown",
]
for (const t of stests) {
  const s = detectSensitiveCase(t)
  console.log(`${s.sensitive ? 'SENSITIVE' : 'ordinary '} kind=${s.kind ?? '-'} | ${t}`)
}
console.log('--- coreTopic ---')
for (const t of ["Research a current topic: Gingee girl missing", "search for the latest news about ISRO launch", "What is the capital of France?"]) {
  console.log(JSON.stringify(coreTopic(t)), '<-', t)
}
