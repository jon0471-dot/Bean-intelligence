/**
 * BEAN Intelligence — M33 execution-intent detection tests (pure).
 *
 * Pins the deterministic contract: clear execution requests authorize a real
 * sandbox run; ordinary writing/explanation requests and questions ABOUT
 * running never execute anything.
 */
import { describe, test, expect } from 'bun:test'
import { detectExecutionIntent } from '../../src/lib/giftz/execution-intent'

describe('M33 execution intent — requests that MUST execute', () => {
  test('the reproduced product issue phrasing', () => {
    expect(detectExecutionIntent('Write a JavaScript function and run it in the sandbox.').execute).toBe(true)
  })

  test('explicit run/execute/test imperatives (M33 brief examples)', () => {
    for (const msg of [
      'Run this code.',
      'Run it in the sandbox.',
      'Write a function and execute it.',
      'Test this JavaScript in the sandbox.',
      'Generate the code and run it.',
      'Run this program and show the output',
      'execute this in the sandbox',
      'Debug this and run it again.',
      'Run it again.',
      'please run the script',
      'Test this in the sandbox.',
      'Write a factorial function and run it',
      'Run my code now',
    ]) {
      const intent = detectExecutionIntent(msg)
      expect(intent.execute).toBe(true)
      expect(intent.rule).not.toBeNull()
    }
  })

  test('the factorial/prime acceptance demo phrasing', () => {
    expect(
      detectExecutionIntent(
        'Write a JavaScript function for factorial and a prime checker and run it in the sandbox.',
      ).execute,
    ).toBe(true)
  })
})

describe('M33 execution intent — requests that MUST NOT execute', () => {
  test('ordinary writing/explanation requests (M33 brief examples)', () => {
    for (const msg of [
      'Write a JavaScript function.',
      'Explain this function.',
      'Show me an example.',
      'Review this code.',
      'What does this code do?',
      'Write a debounce function with tests',
      'Explain how promises work',
      'Refactor this module for readability',
      'Fix the CSS layout on mobile',
    ]) {
      const intent = detectExecutionIntent(msg)
      expect(intent.execute).toBe(false)
      expect(intent.rule).toBeNull()
    }
  })

  test('questions ABOUT running never execute', () => {
    for (const msg of [
      'How do I run this code locally?',
      'How can I run it in the sandbox?',
      'How to run the program on Windows?',
      'What does the sandbox do when I run this?',
      'Why does my script fail when I run it?',
      'Can you explain how the sandbox executes files?',
      'Where can I run JavaScript?',
      'Is there a way to run this without the sandbox?',
    ]) {
      expect(detectExecutionIntent(msg).execute).toBe(false)
    }
  })

  test('degenerate inputs never execute', () => {
    expect(detectExecutionIntent('').execute).toBe(false)
    expect(detectExecutionIntent('   ').execute).toBe(false)
    expect(detectExecutionIntent('a'.repeat(601)).execute).toBe(false)
  })
})
