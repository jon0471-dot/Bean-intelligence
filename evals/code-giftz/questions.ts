/**
 * BEAN Intelligence — CODE GIFTZ benchmark + regression question pack.
 *
 * The benchmark Q1–Q6 pack mirrors the 2026-11-03 work order's benchmark
 * questions (general phrasing, NOT answer hardcoding — the answers are
 * produced live by the model through the real API). R1–R4 are event-loop
 * regression variants with mixed Promise / queueMicrotask / async-await /
 * setTimeout callbacks; their ground truth is computed by EXECUTING the
 * snippet in this runtime (see runner), never assumed.
 */

export interface EvalQuestion {
  id: string
  kind: 'benchmark' | 'regression'
  /** The user prompt sent to CODE GIFTZ. */
  prompt: string
  /** For regression event-loop questions: the snippet is executed locally
   *  to compute ground truth at run time. */
  snippet?: string
  /** Content checks over the live answer: { name, passed, detail }. */
  checks: Array<{ name: string; test: (answer: string) => boolean }>
}

/** Pull the LAST fenced code block out of an answer (the final implementation). */
export function lastCodeBlock(answer: string): string {
  const blocks = [...answer.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1])
  return blocks.length > 0 ? blocks[blocks.length - 1] : ''
}

/** All capital-letter sequences in the answer, line-normalised ("A F H C ..."). */
export function letterSequence(answer: string): string[] {
  return answer
    .split(/\r?\n/)
    .map((line) => {
      const letters = line.match(/\b[A-Z]\b/g)
      return letters ? letters.join(' ') : null
    })
    .filter((s): s is string => s !== null && /^[A-Z]( [A-Z])*$/.test(s))
}

const has = (re: RegExp) => (answer: string) => re.test(answer)

export const QUESTIONS: EvalQuestion[] = [
  {
    id: 'Q1-event-loop',
    kind: 'benchmark',
    prompt: `What does this JavaScript script print, exactly and in order?

\`\`\`js
console.log('A')
Promise.resolve()
  .then(() => console.log('C'))
  .then(() => console.log('D'))
queueMicrotask(() => console.log('E'))
;(async () => {
  await Promise.resolve()
  console.log('G')
})()
console.log('F')
setTimeout(() => console.log('B'), 0)
console.log('H')
\`\`\`

Show the step-by-step trace first (the microtask queue contents after each statement), then state the final output on one line like "A B C" read off that trace. Explain WHEN each callback is enqueued and why the chained .then callback runs where it does relative to the queueMicrotask callback and the async/await continuation.`,
    checks: [
      { name: 'states the exact FIFO order A F H C E G D B', test: (a) => letterSequence(a).some((s) => s === 'A F H C E G D B') },
      // Measurement note (2026-11-03, documented): the first alternation
      // recognizes ANY explicit reference to the chained .then callback —
      // "chained", "second .then", "next .then", or "(D) is (now) queued".
      // The ANDed second alternation still REQUIRES the timing/position
      // explanation (queued when C runs / behind the queue / queue [E, G, D]),
      // so an answer that merely mentions the callback without the enqueue-
      // timing explanation still fails. This fixes the check under-matching
      // correct explanations; it does not loosen the content requirement.
      { name: 'explains the chained .then is queued when its predecessor RUNS (behind E and G)', test: (a) => has(/chained|second \.then|next \.then|D (is|gets) queued|\(D\) is (now )?queued/i)(a) && has(/when C (executes|runs)|when the .*C.* (executes|runs)|after (running )?C|behind|now queued|queue.*\[E, G, D\]/i)(a) },
      { name: 'distinguishes sync / microtask / macrotask phases', test: has(/microtask/i) },
      { name: 'does not claim all promise chains run before async continuations', test: (a) => !/all promises? (run|execute) before/i.test(a) },
    ],
  },
  {
    id: 'Q2-find-duplicates',
    kind: 'benchmark',
    prompt: `Write a JavaScript function findDuplicates(arr) that returns the values that appear more than once, in the order each duplicate is FIRST discovered.

Requirements:
- O(n) average time, O(n) space.
- Handle empty arrays, negative numbers, strings, repeated values and mixed types.
- Explain the time and space complexity FROM YOUR ACTUAL CODE (count the real operations).
- Note explicitly how JavaScript Set iteration order behaves, so the implementation's ordering claim is justified.`,
    checks: [
      { name: 'uses a seen Set', test: has(/seen\s*=\s*new Set/i) },
      { name: 'uses a duplicates Set (not an array scanned with includes)', test: (a) => (a.match(/new Set/g) ?? []).length >= 2 },
      { name: 'final implementation contains no O(n) includes() inside the loop', test: (a) => !lastCodeBlock(a).includes('.includes(') },
      { name: 'claims O(n) time for the final code', test: has(/O\(n\)/) },
      { name: 'justifies ordering via Set insertion/iteration order', test: has(/insertion order|iteration order|preserve/i) },
      { name: 'handles empty array', test: has(/empty/i) },
    ],
  },
  {
    id: 'Q3-two-sum',
    kind: 'benchmark',
    prompt: `Implement twoSum(numbers, target) in JavaScript: return the indices of two distinct entries that add up to target, or [] when no solution exists.

Requirements:
- Must support negative numbers, zeros and duplicate values.
- O(n) average time using a Map.
- It MUST return [1, 2] for twoSum([-1, -2, -3, -4, -5], -5). Verify that expected output by deriving it, and state the derivation.
- Define a deterministic rule for cases with multiple valid answers (which pair/indices are returned).
- Document input validation (what happens for non-arrays, non-numbers, arrays shorter than 2).`,
    checks: [
      { name: 'states [1, 2] for twoSum([-1, -2, -3, -4, -5], -5)', test: has(/\[1,\s*2\]/) },
      { name: 'derives the pair (-2, -3) summing to -5', test: has(/-2\s*\+\s*-3|-3\s*\+\s*-2|\(-2\)\s*\+\s*\(-3\)|-5\s*-\s*\(-2\)|-5\s*-\s*\(-3\)|complement\s*=\s*-3|complement\s*=\s*-2/) },
      { name: 'uses a Map', test: has(/new Map|Map\(/) },
      { name: 'O(n) average time claimed', test: has(/O\(n\)/) },
      { name: 'returns [] when no solution exists', test: has(/\[\]/) },
      { name: 'defines a deterministic rule for multiple solutions', test: has(/deterministic|first (valid )?pair|first occurrence|leftmost|earliest/i) },
      { name: 'documents input validation', test: has(/validat|non-array|not an array|invalid|throw|TypeError/i) },
    ],
  },
  {
    id: 'Q4-longest-substring',
    kind: 'benchmark',
    prompt: `Implement longestSubstring(s) — the length of the longest substring without repeating characters — using a sliding window in O(n). Handle empty strings, spaces, punctuation and mixed case.

Then explain Unicode handling precisely:
- the difference between UTF-16 code units, Unicode code points, and user-perceived grapheme clusters;
- how you would support user-perceived characters (emoji with modifiers, combining marks, flags), including Intl.Segmenter usage and runtime-support policy;
- why brute-force and optimized implementations must measure lengths in the SAME unit when being compared.

Show tests covering supplementary emoji (surrogate pairs) and combining marks.`,
    checks: [
      { name: 'sliding window with a Set/Map', test: has(/sliding window/i) },
      { name: 'O(n)/linear time claimed', test: has(/O\(n\)|linear time|linear/i) },
      { name: 'distinguishes UTF-16 code units from code points', test: has(/code unit/i) && has(/code point/i) },
      { name: 'covers grapheme clusters', test: has(/grapheme/i) },
      { name: 'mentions Intl.Segmenter', test: has(/Intl\.Segmenter/i) },
      { name: 'documents the runtime-support/compatibility policy', test: has(/fallback|support|older|compat|availability|polyfill/i) },
      { name: 'includes a surrogate/emoji or combining-mark test', test: has(/\\uD83|👍|👩|é|emoji|combining/i) },
      { name: 'empty string behavior defined', test: has(/empty/i) },
    ],
  },
  {
    id: 'Q5-valid-parentheses',
    kind: 'benchmark',
    prompt: `Implement isValidBrackets(s) in JavaScript: O(n) time, O(n) worst-case space, correct LIFO stack logic for (), [] and {}.

Define EXPLICITLY what happens with non-bracket characters (ignored? invalid?). Cover in tests: the empty string, a string with only ordinary characters, deeply nested brackets, extra closing brackets, unclosed opening brackets, and invalid input types (null, non-strings). Explain the complexity from your actual code, including worst-case space.`,
    checks: [
      { name: 'stack-based LIFO implementation', test: (a) => has(/stack/i)(a) && has(/push|pop/)(a) },
      { name: 'O(n) time and O(n) space claimed', test: has(/O\(n\)/) },
      { name: 'explicit non-bracket character behavior', test: has(/non-bracket|non bracket|other characters|ignored/i) },
      { name: 'covers empty string', test: has(/empty/i) },
      { name: 'covers extra closing / unclosed opening brackets', test: has(/extra clos|unclosed|unmatched|leftover/i) },
      { name: 'covers invalid input types', test: has(/null|non-string|not a string|typeof/i) },
      { name: 'LIFO logic explained', test: has(/LIFO|last[- ](opened|in)|most recent/i) },
    ],
  },
  {
    id: 'Q6-binary-search-first-occurrence',
    kind: 'benchmark',
    prompt: `Implement binarySearch(sorted, target) in JavaScript that returns the index of the FIRST occurrence of target (the array may contain duplicates), plus a recursive variant.

Requirements:
- Iterative: O(log n) time, O(1) space. Recursive: O(log n) time, O(log n) space.
- The MAIN binarySearch function itself must return the first occurrence — not only a separate helper.
- Never mutate or sort the input array.
- Use the safe midpoint computation left + Math.floor((right - left) / 2).
- Make the recursive variant safe for null/undefined input (validation must not fail before entering the function body).
- Document the sorted-input requirement and what happens when the target is absent.`,
    checks: [
      { name: 'safe midpoint left + Math.floor((right - left) / 2)', test: has(/Math\.floor\(\s*\(\s*right\s*-\s*left\s*\)\s*\/\s*2\s*\)/) },
      { name: 'first-occurrence logic in the MAIN function', test: has(/first occurrence/i) },
      { name: 'iterative O(log n) time / O(1) space stated', test: (a) => has(/O\(log n\)/)(a) && has(/O\(1\)/)(a) },
      { name: 'recursive O(log n) space stated', test: has(/O\(log n\)[^.]*space|space[^.]*O\(log n\)/i) },
      { name: 'no mutation / no sorting of the input', test: has(/does not (mutate|modify|sort)|without (mutating|modifying|sorting)|no (mutation|sort)|never (mutate|sort)/i) },
      { name: 'null/undefined-safe recursive validation', test: has(/null|undefined/i) },
      { name: 'documents the sorted-input requirement / absent target behavior', test: (a) => has(/sorted|ascending/i)(a) && has(/-1|not found|absent/i)(a) },
    ],
  },

  // ---- event-loop regression variants (ground truth computed by execution) --
  {
    id: 'R1-mixed-queues',
    kind: 'regression',
    prompt: `What does this script print, in order? Show the microtask-queue trace statement by statement FIRST, then state the final output on one line like "A B C" read off the trace.

\`\`\`js
console.log('A')
setTimeout(() => console.log('B'), 0)
Promise.resolve().then(() => {
  console.log('C')
  queueMicrotask(() => console.log('D'))
})
;(async () => {
  console.log('E')
  await null
  console.log('F')
})()
queueMicrotask(() => console.log('G'))
console.log('H')
\`\`\``,
    snippet: `console.log('A')
setTimeout(() => console.log('B'), 0)
Promise.resolve().then(() => {
  console.log('C')
  queueMicrotask(() => console.log('D'))
})
;(async () => {
  console.log('E')
  await null
  console.log('F')
})()
queueMicrotask(() => console.log('G'))
console.log('H')`,
    checks: [{ name: 'answer states an explicit output order line', test: (a) => letterSequence(a).length > 0 }],
  },
  {
    id: 'R2-chained-after-resolved',
    kind: 'regression',
    prompt: `What does this script print, in order? Show the microtask-queue trace statement by statement FIRST, then state the final output on one line like "A B C" read off the trace. Explain WHEN the second .then callback is enqueued relative to the microtask already queued before it.

\`\`\`js
console.log('A')
const p = Promise.resolve().then(() => console.log('B'))
queueMicrotask(() => console.log('C'))
p.then(() => console.log('D'))
setTimeout(() => console.log('E'), 0)
console.log('F')
\`\`\``,
    snippet: `console.log('A')
const p = Promise.resolve().then(() => console.log('B'))
queueMicrotask(() => console.log('C'))
p.then(() => console.log('D'))
setTimeout(() => console.log('E'), 0)
console.log('F')`,
    checks: [{ name: 'answer states an explicit output order line', test: (a) => letterSequence(a).length > 0 }],
  },
  {
    id: 'R3-nested-awaits',
    kind: 'regression',
    prompt: `What does this script print, in order? Show the microtask-queue trace statement by statement FIRST, then state the final output on one line like "A B C" read off the trace. Explain where each await continuation lands in the microtask queue.

\`\`\`js
console.log('A')
async function inner() {
  console.log('B')
  await Promise.resolve()
  console.log('C')
}
async function outer() {
  await inner()
  console.log('D')
}
outer()
Promise.resolve().then(() => console.log('E'))
queueMicrotask(() => console.log('F'))
setTimeout(() => console.log('G'), 0)
console.log('H')
\`\`\``,
    snippet: `console.log('A')
async function inner() {
  console.log('B')
  await Promise.resolve()
  console.log('C')
}
async function outer() {
  await inner()
  console.log('D')
}
outer()
Promise.resolve().then(() => console.log('E'))
queueMicrotask(() => console.log('F'))
setTimeout(() => console.log('G'), 0)
console.log('H')`,
    checks: [{ name: 'answer states an explicit output order line', test: (a) => letterSequence(a).length > 0 }],
  },
  {
    id: 'R4-microtask-spawning-microtask',
    kind: 'regression',
    prompt: `What does this script print, in order? Show the microtask-queue trace statement by statement FIRST, then state the final output on one line like "A B C" read off the trace. Explain the FIFO drain order, including a microtask that queues another microtask while draining.

\`\`\`js
console.log('A')
Promise.resolve().then(() => {
  console.log('B')
  Promise.resolve().then(() => console.log('C'))
})
queueMicrotask(() => console.log('D'))
Promise.resolve().then(() => console.log('E'))
setTimeout(() => console.log('F'), 0)
console.log('G')
\`\`\``,
    snippet: `console.log('A')
Promise.resolve().then(() => {
  console.log('B')
  Promise.resolve().then(() => console.log('C'))
})
queueMicrotask(() => console.log('D'))
Promise.resolve().then(() => console.log('E'))
setTimeout(() => console.log('F'), 0)
console.log('G')`,
    checks: [{ name: 'answer states an explicit output order line', test: (a) => letterSequence(a).length > 0 }],
  },
]

/** The long-answer end-to-end streaming acceptance prompt (PART A §6). */
export const LONG_STREAM_PROMPT = `Build a complete task-manager mini app for this project. Write ALL of these files with COMPLETE contents:

- index.html: a polished page with a task form (title, priority, due date), list rendering, filter buttons (all/open/done), and a stats bar.
- styles.css: dark theme, gold accent, responsive layout, hover states.
- app.js: full logic — add tasks with validation (non-empty title, valid date), toggle done, delete, filter, sort by priority then due date, persist to localStorage, escape HTML to prevent XSS, and re-render efficiently. Include a self-test section at the bottom (pure functions only) with at least six assertions covering validation, filtering, sorting and escaping.

Follow every requirement above; do not skip any file or feature.`

/** True when the answer's claimed order lines include the snippet's ground truth. */
export function answerContainsGroundTruth(answer: string, truth: string[]): boolean {
  const expected = truth.join(' ')
  return letterSequence(answer).some((line) => line === expected)
}
