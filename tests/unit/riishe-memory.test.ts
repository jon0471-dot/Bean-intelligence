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
 */
import { describe, test, expect } from 'bun:test'
import {
  detectMemoryCommand,
  sensitiveMemoryReason,
  isDuplicateMemory,
  memoryKey,
  buildMemoryBlock,
  saveConfirmation,
  forgetConfirmation,
  listConfirmation,
  MEMORY_LIMITS,
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
