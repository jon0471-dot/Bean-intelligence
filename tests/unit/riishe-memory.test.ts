/**
 * BEAN Intelligence — unit tests for RIISHE user-approved memory (Phase 6).
 * Run: bun test tests/unit/riishe-memory.test.ts
 *
 * Under test (src/lib/riishe/memory.ts):
 *   - command detection: save / forget / forget-everything / list, and
 *     conversational look-alikes that must NOT be treated as commands
 *   - the sensitive-data guard (never silently store secrets)
 *   - de-duplication + injection bounds (count and per-item size)
 *   - system-authored receipt wording stays honest (refusals are refusals)
 *   - M33: deterministic POTENTIAL-conflict detection (scoped templates,
 *     false-positive guards, ambiguous-vs-likely) and the conflict-aware
 *     save receipt; explainable-recall composition (truthful policy).
 */
import { describe, test, expect } from 'bun:test'
import {
  detectMemoryCommand,
  sensitiveMemoryReason,
  isDuplicateMemory,
  memoryKey,
  buildMemoryBlock,
  saveConfirmation,
  saveConfirmationWithConflicts,
  forgetConfirmation,
  listConfirmation,
  detectPotentialMemoryConflicts,
  composeMemoryContextView,
  MEMORY_LIMITS,
  MEMORY_SELECTION_POLICY,
  MEMORY_POLICY_DESCRIPTION,
} from '../../src/lib/riishe/memory'

describe('memory command detection', () => {
  test('saves: "remember that ...", "remember: ...", "please remember my ..."', () => {
    expect(detectMemoryCommand('remember that my timezone is IST')).toEqual({
      action: 'save',
      content: 'my timezone is IST',
    })
    expect(detectMemoryCommand('remember: I prefer bullet points in reports')).toEqual({
      action: 'save',
      content: 'I prefer bullet points in reports',
    })
    expect(detectMemoryCommand('please remember that deploys happen Sunday 02:00 UTC')).toEqual({
      action: 'save',
      content: 'deploys happen Sunday 02:00 UTC',
    })
  })

  test('non-commands are ignored (conservative detection)', () => {
    expect(detectMemoryCommand('Remember the Titans is a good movie')).toBe(null)
    expect(detectMemoryCommand('I will remember this conversation')).toBe(null)
    expect(detectMemoryCommand('Do you remember me?')).toBe(null)
    expect(detectMemoryCommand('forget what you just said')).toBe(null)
    expect(detectMemoryCommand('')).toBe(null)
    expect(detectMemoryCommand('hi')).toBe(null)
  })

  test('forget targets and forget-everything', () => {
    expect(detectMemoryCommand('forget my timezone')).toEqual({ action: 'forget', target: 'my timezone', all: false })
    expect(detectMemoryCommand('forget about the deploy window')).toEqual({
      action: 'forget',
      target: 'the deploy window',
      all: false,
    })
    expect(detectMemoryCommand('forget everything')).toEqual({ action: 'forget', target: '', all: true })
    expect(detectMemoryCommand('please forget all of it')).toEqual({ action: 'forget', target: '', all: true })
  })

  test('listing', () => {
    expect(detectMemoryCommand('what do you remember about me?')).toEqual({ action: 'list' })
    expect(detectMemoryCommand('show my memory')).toEqual({ action: 'list' })
  })
})

describe('sensitive-data guard', () => {
  test('refuses secrets before storage', () => {
    expect(sensitiveMemoryReason('my password is hunter2')).toContain('password')
    expect(sensitiveMemoryReason('api key sk-abcdef1234567890')).not.toBe(null)
    expect(sensitiveMemoryReason('my card is 4111 1111 1111 1111')).not.toBe(null)
    expect(sensitiveMemoryReason('my token is ghp_abc123')).not.toBe(null)
  })

  test('ordinary facts pass', () => {
    expect(sensitiveMemoryReason('my timezone is IST')).toBe(null)
    expect(sensitiveMemoryReason('deploys happen Sunday 02:00 UTC')).toBe(null)
  })

  test('the save receipt wording refuses storage explicitly', () => {
    const receipt = saveConfirmation('my password is hunter2', 'passwords')
    expect(receipt).toContain('did **not** save')
    expect(receipt).toContain('passwords')
  })
})

describe('de-duplication and bounds', () => {
  test('case/whitespace-insensitive duplicates', () => {
    expect(isDuplicateMemory('My  TIMEZONE is IST', ['my timezone is ist'])).toBe(true)
    expect(isDuplicateMemory('my timezone is UTC', ['my timezone is ist'])).toBe(false)
    expect(memoryKey('  A   b ')).toBe('a b')
  })

  test('injection block is bounded and empty-safe', () => {
    expect(buildMemoryBlock([])).toBe('')
    const many = Array.from({ length: 30 }, (_, i) => `fact ${i} ` + 'x'.repeat(300))
    const block = buildMemoryBlock(many)
    expect(block).toContain('USER-APPROVED MEMORY')
    // only the most recent MEMORY_LIMITS.injectionCount entries appear
    const numbered = block.match(/^\d+\. /gm)?.length ?? 0
    expect(numbered).toBe(MEMORY_LIMITS.injectionCount)
    // long entries are clipped
    expect(block.length).toBeLessThan(20 * (MEMORY_LIMITS.injectionChars + 40))
  })
})

describe('honest receipts', () => {
  test('forget receipts never claim success without deletions', () => {
    expect(forgetConfirmation(0, 'nothing', false)).toContain("couldn't find")
    expect(forgetConfirmation(2, 'deploy window', false)).toContain('Removed 2')
    expect(forgetConfirmation(0, '', true)).toContain('already empty')
    expect(forgetConfirmation(3, '', true)).toContain('deleted all 3')
  })

  test('list receipts admit an empty memory plainly', () => {
    expect(listConfirmation([])).toContain('keep nothing')
    expect(listConfirmation(['a'])).toContain('(1):')
  })
})

describe('M33 potential-conflict detection (deterministic, conservative)', () => {
  const row = (id: string, content: string) => ({ id, content })

  test('clear same-topic different-value conflicts are detected as likely', () => {
    const conflicts = detectPotentialMemoryConflicts('my timezone is UTC', [row('m1', 'My timezone is IST.')])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].id).toBe('m1')
    expect(conflicts[0].confidence).toBe('likely')
    expect(conflicts[0].topicKey).toContain('timezone')
  })

  test('deployment-window conflict (spec example)', () => {
    const conflicts = detectPotentialMemoryConflicts('my deployment window is Wednesday', [
      row('m2', 'My deployment window is Sunday'),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].confidence).toBe('likely')
  })

  test('preference conflict with same head noun (spec example)', () => {
    const conflicts = detectPotentialMemoryConflicts('I prefer detailed answers', [
      row('m3', 'I prefer concise answers.'),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].confidence).toBe('likely')
  })

  test('different topics never conflict (false-positive guards)', () => {
    expect(detectPotentialMemoryConflicts('my timezone is UTC', [row('m4', 'I prefer concise answers')])).toEqual([])
    expect(detectPotentialMemoryConflicts('my timezone is UTC', [row('m5', 'My name is Priya')])).toEqual([])
    // Same preference verb, different head noun → different topic.
    expect(detectPotentialMemoryConflicts('I prefer tea', [row('m6', 'I prefer concise answers')])).toEqual([])
    // Unparseable memories produce no claims at all.
    expect(detectPotentialMemoryConflicts('I like long walks on the beach', [row('m7', 'call me at 5pm')])).toEqual([])
  })

  test('exact duplicates are NOT conflicts', () => {
    expect(detectPotentialMemoryConflicts('My  timezone  is IST.', [row('m8', 'my timezone is IST')])).toEqual([])
  })

  test('value refinements are flagged ambiguous, not likely', () => {
    const conflicts = detectPotentialMemoryConflicts('my deployment window is Sunday 02:00 UTC', [
      row('m9', 'my deployment window is sunday'),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].confidence).toBe('ambiguous')
  })

  test('conflicts against several rows surface each candidate with its id', () => {
    const conflicts = detectPotentialMemoryConflicts('my timezone is UTC', [
      row('a', 'my timezone is IST'),
      row('b', 'my timezone is PST'),
      row('c', 'my name is Sam'),
    ])
    expect(conflicts.map((c) => c.id).sort()).toEqual(['a', 'b'])
  })

  test('the detector never mutates or claims certainty it lacks', () => {
    // Output is a plain candidate list — the caller decides; nothing here
    // can replace or delete anything (pure function over read-only input).
    const existing = [row('a', 'my timezone is IST')]
    const snapshot = JSON.stringify(existing)
    detectPotentialMemoryConflicts('my timezone is UTC', existing)
    expect(JSON.stringify(existing)).toBe(snapshot)
  })
})

describe('M33 conflict-aware save receipt', () => {
  test('no conflicts → identical to the plain save receipt', () => {
    expect(saveConfirmationWithConflicts('my timezone is IST', [])).toBe(saveConfirmation('my timezone is IST', null))
  })

  test('conflicts are surfaced with keep-both honesty and a path to replace', () => {
    const receipt = saveConfirmationWithConflicts('my timezone is UTC', [
      { content: 'My timezone is IST', confidence: 'likely' },
    ])
    expect(receipt).toContain('Saved to memory')
    expect(receipt).toContain('My timezone is IST')
    expect(receipt).toContain('I kept both')
    expect(receipt).toContain('forget')
  })
})

describe('M33 explainable recall composition (truthful policy)', () => {
  test('records the exact included IDs and the real injected count', () => {
    const view = composeMemoryContextView({
      records: [
        { id: 'r1', content: 'my timezone is IST' },
        { id: 'r2', content: 'I prefer concise answers' },
      ],
      totalMemoriesAtSelection: 5,
      selectedAt: '2026-11-23T10:00:00.000Z',
    })
    expect(view.includedMemoryIds).toEqual(['r1', 'r2'])
    expect(view.injectedCount).toBe(2)
    expect(view.totalMemoriesAtSelection).toBe(5)
    expect(view.selectedAt).toBe('2026-11-23T10:00:00.000Z')
    expect(view.policy).toBe(MEMORY_SELECTION_POLICY)
  })

  test('bounded: more records than the per-turn cap are cut to the bound', () => {
    const records = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, content: `fact ${i}` }))
    const view = composeMemoryContextView({ records, totalMemoriesAtSelection: 20, selectedAt: '2026-11-23T10:00:00.000Z' })
    expect(view.includedMemoryIds).toHaveLength(MEMORY_LIMITS.injectionCount)
    expect(view.injectedCount).toBe(MEMORY_LIMITS.injectionCount)
    expect(view.includedMemoryIds[0]).toBe('m0') // most recent first, order preserved
  })

  test('empty store composes an honest nothing-included record', () => {
    const view = composeMemoryContextView({ records: [], totalMemoriesAtSelection: 0, selectedAt: '2026-11-23T10:00:00.000Z' })
    expect(view.includedMemoryIds).toEqual([])
    expect(view.injectedCount).toBe(0)
    expect(view.totalMemoriesAtSelection).toBe(0)
  })

  test('the policy description NEVER claims semantic relevance ranking', () => {
    const lower = MEMORY_POLICY_DESCRIPTION.toLowerCase()
    expect(lower).toContain('recent')
    expect(lower).not.toContain('relevant')
    expect(lower).not.toContain('relevance ranking was applied')
    expect(MEMORY_POLICY_DESCRIPTION).toContain('recency is the only selection criterion')
  })
})
