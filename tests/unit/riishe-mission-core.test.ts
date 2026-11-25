/**
 * M41 Phase 1 — mission contracts (types) + DAG kernel (graph).
 *
 * The full task contract (objective, inputs, expected output, dependencies,
 * authorization scope, status, verification criteria, resource limits),
 * lifecycle transitions, structural validation, scheduling semantics,
 * skip propagation, deliverable-chain outcome decisions and bounded
 * parallel lanes — all deterministic and pinned here.
 */
import { describe, test, expect } from 'bun:test'

import {
  buildTaskSpec,
  canRetryTask,
  canTransitionMission,
  canTransitionTask,
  KIND_AGENT,
  KIND_AUTH_SCOPE,
  MISSION_KIND_AGENT_SEAM,
  MISSION_LIMITS,
  MissionContractError,
  normalizeLimits,
  TASK_LIMIT_CAPS,
  type MissionTaskSpec,
} from '../../src/lib/riishe/mission/types'
import {
  decideMissionOutcome,
  deliverableChain,
  dependentsOf,
  downstreamOf,
  readyTaskIds,
  requireValidTaskGraph,
  skippedDownstream,
  takeParallelBatch,
  topologicalOrder,
  validateTaskGraph,
} from '../../src/lib/riishe/mission/graph'

// ---------------------------------------------------------------------------
// Contract builder
// ---------------------------------------------------------------------------

describe('mission buildTaskSpec', () => {
  test('derives agent and authScope from the kind — no caller can widen them', () => {
    const t = buildTaskSpec({
      id: 't1',
      kind: 'code-build',
      title: 'Build',
      objective: 'Build the landing page project.',
      expectedOutput: 'Working files with real diffs.',
    })
    expect(t.agent).toBe('code-giftz')
    expect(t.authScope).toBe('project-write')
    expect(t.dependsOn).toEqual([])
    expect(t.limits.maxCorrections).toBe(1)
  })

  test('fixed kind→agent routing covers every kind and matches the scope map', () => {
    for (const row of MISSION_KIND_AGENT_SEAM) {
      expect(KIND_AGENT[row.kind]).toBe(row.agent)
      expect(KIND_AUTH_SCOPE[row.kind]).toBe(row.scope)
    }
    // The safety-critical property: media kinds create assets, retrieval is
    // read-only, and NOTHING carries a destructive/publishing scope.
    expect(KIND_AUTH_SCOPE['image-asset']).toBe('asset-create')
    expect(KIND_AUTH_SCOPE['video-asset']).toBe('asset-create')
    expect(KIND_AUTH_SCOPE['audio-asset']).toBe('asset-create')
    expect(KIND_AUTH_SCOPE['research']).toBe('retrieval-read')
    expect(KIND_AUTH_SCOPE['knowledge']).toBe('retrieval-read')
    expect(KIND_AUTH_SCOPE['verify-deliverable']).toBe('mission-inspect')
    const scopes = MISSION_KIND_AGENT_SEAM.map((r) => r.scope)
    expect(scopes.every((s) => ['project-write', 'asset-create', 'retrieval-read', 'mission-inspect'].includes(s))).toBe(true)
    expect(scopes).not.toContain('delete')
    expect(scopes).not.toContain('publish')
    expect(scopes).not.toContain('deploy')
  })

  test('rejects malformed ids, empty titles, undersized/oversized text', () => {
    expect(() => buildTaskSpec({ id: 'Bad Id', kind: 'research', title: 'x', objective: 'abc', expectedOutput: 'abc' })).toThrow(MissionContractError)
    expect(() => buildTaskSpec({ id: 't1', kind: 'research', title: '', objective: 'abc', expectedOutput: 'abc' })).toThrow(MissionContractError)
    expect(() => buildTaskSpec({ id: 't1', kind: 'research', title: 't', objective: 'ab', expectedOutput: 'abc' })).toThrow(MissionContractError)
    expect(() => buildTaskSpec({ id: 't1', kind: 'research', title: 't', objective: 'abc', expectedOutput: 'ab' })).toThrow(MissionContractError)
    const long = 'x'.repeat(MISSION_LIMITS.taskObjectiveChars + 1)
    expect(() => buildTaskSpec({ id: 't1', kind: 'research', title: 't', objective: long, expectedOutput: 'abc' })).toThrow(MissionContractError)
  })

  test('rejects self-dependency and unsafe param keys/values', () => {
    expect(() =>
      buildTaskSpec({ id: 't1', kind: 'research', title: 't', objective: 'abc', expectedOutput: 'abc', dependsOn: ['t1'] }),
    ).toThrow(MissionContractError)
    expect(() =>
      buildTaskSpec({ id: 't1', kind: 'research', title: 't', objective: 'abc', expectedOutput: 'abc', params: { 'bad-key!': 'v' } }),
    ).toThrow(MissionContractError)
    expect(() =>
      buildTaskSpec({ id: 't1', kind: 'research', title: 't', objective: 'abc', expectedOutput: 'abc', params: { ok: 'x'.repeat(4001) } }),
    ).toThrow(MissionContractError)
  })

  test('normalizes resource limits into the hard caps', () => {
    expect(normalizeLimits(undefined)).toEqual({ executionTimeoutMs: 10 * 60_000, maxAttempts: 1, maxCorrections: 1 })
    expect(normalizeLimits({ executionTimeoutMs: 999_999_999, maxAttempts: 99, maxCorrections: 9 }).executionTimeoutMs).toBe(TASK_LIMIT_CAPS.executionTimeoutMs)
    expect(normalizeLimits({ maxAttempts: 99 }).maxAttempts).toBe(2)
    expect(normalizeLimits({ maxCorrections: 9 }).maxCorrections).toBe(1)
    expect(normalizeLimits({ executionTimeoutMs: 1 }).executionTimeoutMs).toBe(10_000)
    const t = buildTaskSpec({
      id: 't1',
      kind: 'research',
      title: 't',
      objective: 'abc',
      expectedOutput: 'abc',
      limits: { executionTimeoutMs: 999_999_999 },
    })
    expect(t.limits.executionTimeoutMs).toBe(TASK_LIMIT_CAPS.executionTimeoutMs)
  })

  test('dedupes dependency lists and caps their size', () => {
    const t = buildTaskSpec({
      id: 't9',
      kind: 'verify-deliverable',
      title: 'Verify',
      objective: 'Inspect the delivered artifacts.',
      expectedOutput: 'Integrity confirmed.',
      dependsOn: ['a', 'a', 'b'],
    })
    expect(t.dependsOn).toEqual(['a', 'b'])
    expect(() =>
      buildTaskSpec({
        id: 't9',
        kind: 'verify-deliverable',
        title: 'Verify',
        objective: 'Inspect the delivered artifacts.',
        expectedOutput: 'Integrity confirmed.',
        dependsOn: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      }),
    ).toThrow(MissionContractError)
  })
})

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

describe('mission lifecycle', () => {
  test('mission transitions: planned → running → terminal, terminals closed', () => {
    expect(canTransitionMission('planned', 'running')).toBe(true)
    expect(canTransitionMission('planned', 'cancelled')).toBe(true)
    expect(canTransitionMission('running', 'completed')).toBe(true)
    expect(canTransitionMission('running', 'completed_partial')).toBe(true)
    expect(canTransitionMission('running', 'failed')).toBe(true)
    expect(canTransitionMission('planned', 'completed')).toBe(false)
    expect(canTransitionMission('completed', 'running')).toBe(false)
    expect(canTransitionMission('failed', 'running')).toBe(false)
    expect(canTransitionMission('cancelled', 'running')).toBe(false)
  })

  test('task transitions: forward-only, failed may re-enter running once (retry seam)', () => {
    expect(canTransitionTask('pending', 'ready')).toBe(true)
    expect(canTransitionTask('ready', 'running')).toBe(true)
    expect(canTransitionTask('running', 'done')).toBe(true)
    expect(canTransitionTask('running', 'failed')).toBe(true)
    expect(canTransitionTask('done', 'running')).toBe(false)
    expect(canTransitionTask('skipped', 'running')).toBe(false)
    expect(canTransitionTask('cancelled', 'running')).toBe(false)
    expect(canTransitionTask('failed', 'running')).toBe(true)
  })

  test('canRetryTask honors the attempt budget', () => {
    const limits = { executionTimeoutMs: 60_000, maxAttempts: 2, maxCorrections: 1 }
    expect(canRetryTask('failed', 1, limits)).toBe(true)
    expect(canRetryTask('failed', 2, limits)).toBe(false)
    expect(canRetryTask('done', 0, limits)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DAG validation
// ---------------------------------------------------------------------------

function spec(id: string, dependsOn: string[] = [], kind: MissionTaskSpec['kind'] = 'research'): MissionTaskSpec {
  return buildTaskSpec({
    id,
    kind,
    title: `Task ${id}`,
    objective: `Execute ${kind} for ${id}.`,
    expectedOutput: `Verified ${kind} output.`,
    dependsOn,
  })
}

describe('mission graph validation', () => {
  test('accepts a well-formed diamond', () => {
    const tasks = [spec('t1'), spec('t2', ['t1']), spec('t3', ['t1']), spec('t4', ['t2', 't3'])]
    const v = validateTaskGraph(tasks)
    expect(v.valid).toBe(true)
    expect(() => requireValidTaskGraph(tasks)).not.toThrow()
  })

  test('rejects duplicate ids, unknown deps, self-deps and cycles honestly', () => {
    const dup = [spec('t1'), spec('t1')]
    expect(validateTaskGraph(dup).problems.some((p) => p.includes('Duplicate'))).toBe(true)

    const unknown = [spec('t1', ['ghost'])]
    expect(validateTaskGraph(unknown).problems.some((p) => p.includes('unknown task'))).toBe(true)

    const cycle = [spec('t1', ['t2']), spec('t2', ['t3']), spec('t3', ['t1'])]
    const cv = validateTaskGraph(cycle)
    expect(cv.valid).toBe(false)
    expect(cv.problems.some((p) => p.includes('cycle'))).toBe(true)
  })

  test('caps task count', () => {
    const many = Array.from({ length: MISSION_LIMITS.maxTasks + 1 }, (_, i) => spec(`t${i}`))
    expect(validateTaskGraph(many).problems.some((p) => p.includes('capped'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ordering + scheduling
// ---------------------------------------------------------------------------

describe('mission scheduling', () => {
  const diamond = [spec('t1'), spec('t2', ['t1']), spec('t3', ['t1']), spec('t4', ['t2', 't3'], 'code-build')]

  test('topological order never places a task before its dependencies', () => {
    const order = topologicalOrder(diamond)
    expect(order).not.toBeNull()
    const pos = new Map((order as string[]).map((id, i) => [id, i]))
    expect(pos.get('t1')!).toBeLessThan(pos.get('t2')!)
    expect(pos.get('t1')!).toBeLessThan(pos.get('t3')!)
    expect(pos.get('t2')!).toBeLessThan(pos.get('t4')!)
    expect(pos.get('t3')!).toBeLessThan(pos.get('t4')!)
  })

  test('cycle detection yields null order', () => {
    const cycle = [spec('a', ['b']), spec('b', ['a'])]
    expect(topologicalOrder(cycle)).toBeNull()
  })

  test('ready set: only dependency-satisfied schedulable tasks', () => {
    const tasks = diamond
    const empty = readyTaskIds(tasks, new Map())
    expect(empty).toEqual(['t1'])
    const afterRoot = readyTaskIds(tasks, new Map([['t1', 'done'], ['t2', 'running'], ['t3', 'ready']]))
    expect(afterRoot).toEqual(['t3'])
    const withRootDone = readyTaskIds(tasks, new Map([['t1', 'done']]))
    expect(withRootDone).toEqual(['t2', 't3'])
    const nearEnd = readyTaskIds(tasks, new Map([['t1', 'done'], ['t2', 'done'], ['t3', 'done'], ['t4', 'pending']]))
    expect(nearEnd).toEqual(['t4'])
  })

  test('dependents + downstream sets are exact', () => {
    expect(dependentsOf(diamond, 't1')).toEqual(['t2', 't3'])
    expect(dependentsOf(diamond, 't4')).toEqual([])
    expect(downstreamOf(diamond, ['t2'])).toEqual(new Set(['t2', 't4']))
  })

  test('skip propagation reaches only unexecuted downstream tasks', () => {
    const tasks = [spec('a'), spec('b', ['a']), spec('c', ['b']), spec('d'), spec('e', ['d'])]
    const states = new Map<string, import('../../src/lib/riishe/mission/types').MissionTaskStatus>([
      ['a', 'failed'],
      ['d', 'done'],
    ])
    expect(skippedDownstream(tasks, states)).toEqual(['b', 'c'])
    // done/running work is never "skipped" retroactively
    const states2 = new Map<string, import('../../src/lib/riishe/mission/types').MissionTaskStatus>([
      ['a', 'failed'],
      ['b', 'running'],
    ])
    expect(skippedDownstream(tasks, states2)).toEqual(['c'])
    // nothing failed → nothing skipped
    expect(skippedDownstream(tasks, new Map([['a', 'done'], ['d', 'running']]))).toEqual([])
  })

  test('deliverable chain includes the deliverable and its transitive inputs', () => {
    const tasks = [spec('a'), spec('b', ['a']), spec('side'), spec('verify', ['b'], 'verify-deliverable')]
    const chain = deliverableChain(tasks, 'verify')
    expect(chain).toEqual(new Set(['verify', 'b', 'a']))
    expect(chain.has('side')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Outcome decision — the honesty core
// ---------------------------------------------------------------------------

describe('mission outcome decision', () => {
  const tasks = [spec('a'), spec('side'), spec('verify', ['a'], 'verify-deliverable')]

  test('all done → completed', () => {
    const d = decideMissionOutcome(tasks, new Map([['a', 'done'], ['side', 'done'], ['verify', 'done']]), 'verify')
    expect(d.outcome).toBe('completed')
  })

  test('side failure with verified deliverable chain → completed_partial (never silent success)', () => {
    const d = decideMissionOutcome(tasks, new Map([['a', 'done'], ['side', 'failed'], ['verify', 'done']]), 'verify')
    expect(d.outcome).toBe('completed_partial')
    expect(d.reason).toContain('side')
  })

  test('deliverable-chain failure → failed even if side tasks succeeded', () => {
    const d = decideMissionOutcome(tasks, new Map([['a', 'failed'], ['side', 'done'], ['verify', 'skipped']]), 'verify')
    expect(d.outcome).toBe('failed')
    expect(d.reason).toContain('deliverable chain')
  })

  test('unfinished deliverable → incomplete while executing (never a premature verdict)', () => {
    const d = decideMissionOutcome(tasks, new Map([['a', 'done'], ['side', 'done'], ['verify', 'running']]), 'verify')
    expect(d.outcome).toBe('incomplete')
  })

  test('stuck deliverable with terminal failure upstream → failed (a plan is not a completion)', () => {
    const d = decideMissionOutcome(tasks, new Map([['a', 'failed'], ['side', 'done'], ['verify', 'skipped']]), 'verify')
    expect(d.outcome).toBe('failed')
    expect(d.reason).toContain('deliverable chain')
  })

  test('active side tasks → incomplete (executor keeps running)', () => {
    const d = decideMissionOutcome(tasks, new Map([['a', 'done'], ['side', 'running'], ['verify', 'done']]), 'verify')
    expect(d.outcome).toBe('incomplete')
  })
})

// ---------------------------------------------------------------------------
// Parallel lanes
// ---------------------------------------------------------------------------

describe('parallel lanes', () => {
  test('bounded batch preserves spec order and respects the mission cap', () => {
    const ready = ['a', 'b', 'c', 'd', 'e']
    expect(takeParallelBatch(ready, 2)).toEqual(['a', 'b'])
    expect(takeParallelBatch(ready, 99)).toHaveLength(MISSION_LIMITS.maxParallelTasks)
    expect(takeParallelBatch(ready, 0)).toHaveLength(1)
  })
})
