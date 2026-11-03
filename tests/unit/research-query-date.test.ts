/**
 * BEAN Intelligence — query generation carries the current date.
 * Run: bun test tests/unit/research-query-date.test.ts
 *
 * Pins the measured Q11 fix (2026-11-03): the query-refinement call now
 * states today's date and forbids memory-anchored years. Measured failure
 * without it: the model generated "Node.js latest version 2023" / "Node.js
 * release schedule 2023" — stale-year queries surfaced outdated release
 * pages and the answer reported a superseded LTS line. The SDK is the only
 * mocked boundary; the prompt text is captured, not invented.
 */
import { describe, test, expect, mock } from 'bun:test'

const state = { bodies: [] as unknown[] }

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      chat: {
        completions: {
          create: async (body: unknown) => {
            state.bodies.push(body)
            return {
              choices: [{ message: { content: '{"queries": ["Node.js latest version"]}' } }],
            }
          },
        },
      },
    }),
  },
}))

const { generateQueries } = await import('../../src/lib/research/pipeline')

describe('query generation — today\'s date anchors the year', () => {
  test('the refinement prompt states the current date and forbids memory years', async () => {
    state.bodies = []
    await generateQueries('What is the latest Node.js version?', {
      search: true,
      reason: 'test',
      risk: 'high',
    } as never)
    expect(state.bodies.length).toBe(1)
    const user = (state.bodies[0] as { messages: Array<{ role: string; content: string }> }).messages.find(
      (m) => m.role === 'user',
    )!.content
    const today = new Date().toISOString().slice(0, 10)
    expect(user).toContain(`Today's date is ${today}`)
    expect(user).toContain(`use ${new Date().getFullYear()}`)
    expect(user).toContain('Never put a year in a query from memory')
  })
})
