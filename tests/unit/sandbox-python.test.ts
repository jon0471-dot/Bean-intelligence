import { describe, expect, test } from 'bun:test'
import { isPythonEntry } from '@/lib/sandbox/runner'

/**
 * Python sandbox dispatch (2026-11-08 launch readiness):
 * .py entries must run under the system CPython, not the JS runtime.
 * The spawn behavior itself is verified live end-to-end (model-generated
 * prime/fizzbuzz scripts executed with real stdout through the API); these
 * unit tests pin the pure dispatch decision.
 */
describe('sandbox Python dispatch', () => {
  test('.py entries are Python entries', () => {
    expect(isPythonEntry('main.py')).toBe(true)
    expect(isPythonEntry('scripts/tool.py')).toBe(true)
    expect(isPythonEntry('a/b/c.PY'.toLowerCase())).toBe(true)
  })

  test('JS/TS entries are not Python entries', () => {
    expect(isPythonEntry('main.js')).toBe(false)
    expect(isPythonEntry('main.ts')).toBe(false)
    expect(isPythonEntry('index.jsx')).toBe(false)
    expect(isPythonEntry('main.py.js')).toBe(false)
    expect(isPythonEntry('README.md')).toBe(false)
  })
})
