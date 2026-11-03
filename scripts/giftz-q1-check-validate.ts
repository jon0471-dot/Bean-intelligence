/**
 * Offline validation of the Q1 explanation-check broadening: run the MODIFIED
 * check against the REAL saved answers from the 2026-11-03 eval runs.
 * Expected: correct answers (with the timing explanation) pass; the check must
 * still be able to fail (verified against a stripped answer with the timing
 * explanation removed).
 */
import { QUESTIONS } from '../evals/code-giftz/questions'
import { readFileSync } from 'node:fs'

const q1 = QUESTIONS.find((q) => q.id === 'Q1-event-loop')!
const explanationCheck = q1.checks.find((c) => c.name.includes('explains the chained'))!

// Real answer from benchmark-regression-1793684598851.json (05:43 run, substantively correct).
const run = JSON.parse(readFileSync(new URL('../evals/code-giftz/results/benchmark-regression-1793684598851.json', import.meta.url), 'utf8'))
const realAnswer = run.questions.find((q: { id: string }) => q.id === 'Q1-event-loop').answer as string

console.log('real 05:43 answer -> explanation check:', explanationCheck.test(realAnswer) ? 'PASS' : 'FAIL')

// Negative control: same answer with every sentence mentioning the chained
// callback's enqueue timing removed -> must FAIL.
const stripped = realAnswer
  .replace(/When C runs, it enqueues the next \.then callback \(D\)/g, 'the queue advances')
  .replace(/it enqueues the next \.then callback/g, 'the queue advances')
console.log('timing-stripped answer -> explanation check:', explanationCheck.test(stripped) ? 'PASS (BAD — check is too loose)' : 'FAIL (good — check still requires the timing)')

// Positive control from the prompt's own discipline wording.
console.log('canonical wording -> explanation check:', explanationCheck.test('C runs → its chained .then callback D is now queued behind E and G') ? 'PASS' : 'FAIL')
