/**
 * M50.3 — BEAN AI STUDIO corrective-regression tests for the M50.2 pure core.
 *
 * Two measured correctness gaps were found in the merged M50.2
 * implementation and are fixed additively (no contract rewrite):
 *
 *  1. WARNING/INFO PRESERVATION ON SUCCESS — `compileWorkflowToPlan` used to
 *     return a successful `CompiledWorkflowPlan` WITHOUT the diagnostics
 *     that `validateWorkflowGraph` had produced, so a successful preview
 *     could lose honest backend-availability evidence. The plan now carries
 *     a bounded, deterministic `diagnostics` array preserving every warning
 *     and info diagnostic; errors still refuse compilation (unchanged).
 *     Tests below compile graphs that ACTUALLY USE the node whose surface
 *     is degraded — the pre-existing "unused LAXII" coverage is not
 *     sufficient to pin this.
 *
 *  2. BLOCKED AVAILABILITY STATE — BEAN's real capability-health vocabulary
 *     (src/lib/registry/status.ts `ProductHealthEntry.capabilities[].state`)
 *     includes 'blocked', but M50.2's `StudioAvailabilityState` omitted it,
 *     so a genuinely blocked capability could not be reported honestly.
 *     'blocked' now maps to a customer-safe WARNING (never a validation
 *     error, never operational, never an invented provider failure).
 *
 * Everything else is regression-pinned: schema version 1, port rules, task
 * mappings, QUALITY gate behavior, M41 contracts and compilation
 * determinism are untouched by the corrective changes.
 *
 * Run: bun test tests/unit/m50-3-corrective-diagnostics.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { looseGraph, type LooseStudioGraph } from '../helpers/m50-2-graphs'

import { compileWorkflowToPlan } from '../../src/lib/ai-studio/compile'
import { parseWorkflowGraph } from '../../src/lib/ai-studio/schema'
import { validateWorkflowGraph } from '../../src/lib/ai-studio/validate'
import { validateTaskGraph } from '../../src/lib/riishe/mission/graph'
import { MISSION_LIMITS } from '../../src/lib/riishe/mission/types'

/** research.web (riishe) → document.draft → deliverable — the smallest graph
 *  that USES a riishe-surfaced node (unlike the legacy unused-LAXII test). */
function riisueGraph(): LooseStudioGraph {
  return looseGraph({
    schemaVersion: 1,
    nodes: [
      { nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'sustainable coffee farming' } },
      { nodeId: 'd', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'write the report', deliverablePath: 'report.md' } },
      { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
    ],
    edges: [
      { edgeId: 'e1', from: { nodeId: 'r', port: 'pack' }, to: { nodeId: 'd', port: 'research' } },
      { edgeId: 'e2', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm', port: 'project' } },
    ],
  })
}

/** image.create (laxii) → deliverable — a graph that USES the laxii surface. */
function laxiiGraph(): LooseStudioGraph {
  return looseGraph({
    schemaVersion: 1,
    nodes: [
      { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'a coffee poster', size: '1024x1024' } },
      { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
    ],
    edges: [{ edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'm', port: 'image' } }],
  })
}

describe('M50.3 corrective 1 — warnings/info survive a SUCCESSFUL compilation', () => {
  test('not-configured on a USED surface lands in the successful plan diagnostics', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())), undefined, { riishe: 'not-configured' })
    expect(result.ok).toBe(true)
    if (!result.ok) return console.error(result.diagnostics)
    expect(result.diagnostics.some((d) => d.code === 'E_CAPABILITY_UNAVAILABLE' && d.severity === 'warning' && d.message.includes('not configured'))).toBe(true)
    // the plan is still structurally sound and accepted by the real M41 kernel
    expect(validateTaskGraph(result.tasks).valid).toBe(true)
  })

  test('unavailable on a USED surface lands in the successful plan diagnostics', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())), undefined, { riishe: 'unavailable' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('currently unavailable'))).toBe(true)
  })

  test('degraded on a USED surface lands in the successful plan diagnostics', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(laxiiGraph())), undefined, { laxii: 'degraded' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('degraded'))).toBe(true)
  })

  test('rate-limited on a USED surface lands in the successful plan diagnostics as info', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(laxiiGraph())), undefined, { laxii: 'rate-limited' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.some((d) => d.severity === 'info' && d.message.includes('rate-limited'))).toBe(true)
  })

  test('blocked on a USED surface lands in the successful plan diagnostics as warning', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(laxiiGraph())), undefined, { laxii: 'blocked' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('blocked'))).toBe(true)
  })

  test('a warning NEVER becomes an error and never blocks compilation', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())), undefined, {
      riishe: 'unavailable',
      laxii: 'blocked',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.every((d) => d.severity !== 'error')).toBe(true)
  })

  test('the compile boundary carries NO error diagnostics on success, all of them on failure', () => {
    const bad = riisueGraph()
    bad.nodes[0].config['topic'] = 'x'.repeat(400) // oversized → E_CONFIG refusal
    const failed = compileWorkflowToPlan(JSON.parse(JSON.stringify(bad)), undefined, { riishe: 'unavailable' })
    expect(failed.ok).toBe(false)
    if (failed.ok) return
    expect(failed.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  test('preserved diagnostics are DETERMINISTIC (byte-identical repeated compiles)', () => {
    const g = JSON.parse(JSON.stringify(riisueGraph()))
    const a = compileWorkflowToPlan(g, undefined, { riishe: 'degraded' })
    const b = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())), undefined, { riishe: 'degraded' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test('a clean graph compiles with an EMPTY diagnostics array (bounded output)', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics).toEqual([])
  })

  test('diagnostics stay bounded like validation output (≤300 chars/message)', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())), undefined, { riishe: 'unavailable' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const d of result.diagnostics) {
      expect(d.message.length).toBeLessThanOrEqual(300)
    }
    expect(result.diagnostics.length).toBeLessThanOrEqual(MISSION_LIMITS.maxTasks * 2)
  })
})

describe('M50.3 corrective 2 — the blocked availability state', () => {
  test('blocked is part of the Studio availability vocabulary and validates as a WARNING', () => {
    const parsed = parseWorkflowGraph(riisueGraph())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { availability: { riishe: 'blocked' } })
    expect(outcome.valid).toBe(true) // availability evidence never blocks validation
    const hit = outcome.diagnostics.find((d) => d.code === 'E_CAPABILITY_UNAVAILABLE')
    expect(hit).toBeDefined()
    expect(hit?.severity).toBe('warning')
    expect(hit?.message).toContain('blocked')
    expect(hit?.message).toContain('execution will fail') // honest, customer-safe
  })

  test('blocked does not fabricate a provider failure or claim the capability operational', () => {
    const parsed = parseWorkflowGraph(laxiiGraph())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { availability: { laxii: 'blocked' } })
    const joined = outcome.diagnostics.map((d) => d.message).join(' ')
    expect(outcome.diagnostics.some((d) => d.message.includes('LAXII'))).toBe(true)
    expect(joined.toLowerCase()).not.toContain('provider outage')
    expect(joined.toLowerCase()).not.toContain('fully operational')
  })

  test('the pure core still performs NO live probes (blocked is caller-supplied only)', () => {
    const parsed = parseWorkflowGraph(riisueGraph())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const silent = validateWorkflowGraph(parsed.graph, {})
    expect(silent.diagnostics).toHaveLength(0) // absence of evidence stays silence
  })
})

describe('M50.3 corrective regression — unchanged M50.2 contracts', () => {
  test('schema version 1 and node/edge contracts unchanged (successful plan shape)', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.schemaVersion).toBe(1)
    expect(result.tasks.map((t) => t.kind)).toEqual(['research', 'document-draft', 'verify-deliverable'])
    expect(result.gateAutoAppended).toBe(true)
    expect(result.deliverableTaskId).toBe(result.nodeTaskMap['d'])
  })

  test('port compatibility and task mappings unchanged (research → document pack edge)', () => {
    const result = compileWorkflowToPlan(JSON.parse(JSON.stringify(riisueGraph())))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const doc = result.tasks.find((t) => t.kind === 'document-draft')
    expect(doc?.verification.requireSourceCitation).toBe(true)
    expect(doc?.dependsOn).toEqual(['t1'])
  })
})
