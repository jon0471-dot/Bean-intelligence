/**
 * M50.2 BEAN AI STUDIO — graph validation stage tests (hermetic, pure).
 *
 * Pins validation stages 3–10: linear/branching/parallel DAGs, cycle refusal,
 * disconnection semantics, deliverable designation, the real M41 bounds
 * (task cap, producer cap, per-node edges, critical-path wall clock),
 * availability-snapshot severity semantics (honest — never a promise), the
 * diagnostic vocabulary and its deterministic order, and duplicate platform
 * verification gates.
 *
 * Run: bun test tests/unit/m50-2-graph-validation.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { looseGraph, type LooseStudioGraph, type LooseStudioNode, type LooseStudioEdge } from '../helpers/m50-2-graphs'

import { parseWorkflowGraph } from '../../src/lib/ai-studio/schema'
import { graphTopologicalOrder, validateWorkflowGraph } from '../../src/lib/ai-studio/validate'
import { STUDIO_NODE_CONTRACTS, createStudioNodeRegistry } from '../../src/lib/ai-studio/registry'
import type { StudioNodeContract } from '../../src/lib/ai-studio/types'

function codesOf(outcome: { valid: boolean; diagnostics: Array<{ code: string }> }): string[] {
  return outcome.diagnostics.map((d) => d.code)
}

/** The canonical valid linear workflow: research → document → marker. */
function linearGraph(): LooseStudioGraph {
  return {
    schemaVersion: 1 as const,
    nodes: [
      { nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'sustainable coffee farming' } },
      { nodeId: 'd', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'write the report', deliverablePath: 'report.md' } },
      { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
    ],
    edges: [
      { edgeId: 'e1', from: { nodeId: 'r', port: 'pack' }, to: { nodeId: 'd', port: 'research' } },
      { edgeId: 'e2', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm', port: 'project' } },
    ],
  }
}

describe('M50.2 validation — valid DAG shapes', () => {
  test('a valid linear DAG validates clean', () => {
    const parsed = parseWorkflowGraph(linearGraph())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(true)
    expect(outcome.diagnostics).toHaveLength(0)
  })

  test('a valid branching DAG (two research inputs) validates clean', () => {
    const g = linearGraph()
    g.nodes.splice(2, 0, { nodeId: 'k', nodeType: 'knowledge.atlas', contractVersion: 1, config: { topic: 'coffee history' } })
    g.edges.splice(1, 0, { edgeId: 'e3', from: { nodeId: 'k', port: 'pack' }, to: { nodeId: 'd', port: 'research' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(true)
    expect(outcome.diagnostics).toHaveLength(0)
  })

  test('a valid parallel-lane DAG (image + audio into the gate) validates clean', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'a poster' } },
        { nodeId: 'a', nodeType: 'audio.speech', contractVersion: 1, config: { text: 'welcome to the show' } },
        { nodeId: 'q', nodeType: 'quality.verify', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'q', port: 'image' } },
        { edgeId: 'e2', from: { nodeId: 'a', port: 'audio' }, to: { nodeId: 'q', port: 'audio' } },
        { edgeId: 'e3', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'm', port: 'image' } },
      ],
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateWorkflowGraph(parsed.graph).valid).toBe(true)
  })

  test('a disconnected executable node is an honest side task (valid, M41 partial rule)', () => {
    const g = linearGraph()
    g.nodes.splice(2, 0, { nodeId: 'k', nodeType: 'knowledge.atlas', contractVersion: 1, config: { topic: 'coffee history' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(true)
    expect(outcome.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
  })

  test('deterministic topological order preserves insertion among equals', () => {
    const g = linearGraph()
    g.nodes.splice(2, 0, { nodeId: 'k', nodeType: 'knowledge.atlas', contractVersion: 1, config: { topic: 'coffee history' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // r and k start with zero indegree (insertion order), then d, then m.
    expect(graphTopologicalOrder(parsed.graph)).toEqual(['r', 'k', 'd', 'm'])
  })
})

/** A code-project relay used to express same-type chains (no real node has a
 *  code-project input; the relay maps to the REAL code-build kind). */
function relayRegistry() {
  const relay: StudioNodeContract = {
    execution: 'executable',
    nodeType: 'test.relay',
    contractVersion: 1,
    displayName: 'Test relay',
    category: 'engineering',
    description: 'Test-only relay (code-project in, code-project out).',
    taskKind: 'code-build',
    inputs: [{ id: 'project', type: 'code-project', required: false, cardinality: 'single' }],
    outputs: [{ id: 'project', type: 'code-project', required: false, cardinality: 'single' }],
    config: [],
    capabilitySurface: 'platform',
    trustRequirement: 'standard-gates',
    verification: { requireSelfVerification: true, minFileChanges: 1 },
    limits: { executionTimeoutMs: 20 * 60_000, maxAttempts: 1, maxCorrections: 1 },
    limitations: ['test-only'],
    status: 'implemented-substrate',
  }
  return createStudioNodeRegistry([...STUDIO_NODE_CONTRACTS, relay], [])
}

describe('M50.2 validation — cycles', () => {
  test('a multi-node cycle is refused deterministically', () => {
    const registry = relayRegistry()
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'b', nodeType: 'code.build', contractVersion: 1, config: { instruction: 'start the build' } },
        { nodeId: 'r1', nodeType: 'test.relay', contractVersion: 1, config: {} },
        { nodeId: 'r2', nodeType: 'test.relay', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'b', port: 'project' }, to: { nodeId: 'r1', port: 'project' } },
        { edgeId: 'e2', from: { nodeId: 'r1', port: 'project' }, to: { nodeId: 'r2', port: 'project' } },
        { edgeId: 'e3', from: { nodeId: 'r2', port: 'project' }, to: { nodeId: 'r1', port: 'project' } },
        { edgeId: 'e4', from: { nodeId: 'b', port: 'project' }, to: { nodeId: 'm', port: 'project' } },
      ],
    }
    const parsed = parseWorkflowGraph(g, { registry })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { registry })
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_CYCLE' && d.message.includes('circular connection'))).toBe(true)
    expect(graphTopologicalOrder(parsed.graph)).toBeNull()
    // determinism
    const again = validateWorkflowGraph(parsed.graph, { registry })
    expect(JSON.stringify(outcome.diagnostics)).toBe(JSON.stringify(again.diagnostics))
  })

  test('a self-edge is refused (a node cannot consume its own output)', () => {
    const registry = relayRegistry()
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'r1', nodeType: 'test.relay', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e0', from: { nodeId: 'r1', port: 'project' }, to: { nodeId: 'r1', port: 'project' } },
        { edgeId: 'e1', from: { nodeId: 'r1', port: 'project' }, to: { nodeId: 'm', port: 'project' } },
      ],
    }
    const parsed = parseWorkflowGraph(g, { registry })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { registry })
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_CYCLE')).toBe(true)
  })

  test('a type-mismatched self-reference is caught by the port rules (no fake cycle)', () => {
    const g = linearGraph()
    g.edges.push({ edgeId: 'e9', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'd', port: 'research' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PORT_TYPE' && d.message.includes('must match exactly'))).toBe(true)
  })
})

describe('M50.2 validation — deliverable designation (stage 10)', () => {
  test('a missing deliverable marker is refused', () => {
    const g = linearGraph()
    g.nodes = g.nodes.filter((n) => n.nodeId !== 'm')
    g.edges = g.edges.filter((e) => e.edgeId !== 'e2')
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(codesOf(outcome)).toContain('E_DELIVERABLE')
  })

  test('duplicate deliverable markers are refused', () => {
    const g = linearGraph()
    g.nodes.push({ nodeId: 'm2', nodeType: 'output.deliverable', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e3', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm2', port: 'project' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.filter((d) => d.code === 'E_DELIVERABLE' && d.message.includes('exactly one Deliverable'))).toHaveLength(1)
  })

  test('an ambiguous marker (two fed ports) is refused', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'poster' } },
        { nodeId: 'v', nodeType: 'video.create', contractVersion: 1, config: { prompt: 'clip about the poster' } },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'm', port: 'image' } },
        { edgeId: 'e2', from: { nodeId: 'v', port: 'video' }, to: { nodeId: 'm', port: 'video' } },
      ],
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_DELIVERABLE' && d.message.includes('exactly one artifact-producing task must feed'))).toBe(true)
  })

  test('an unconnected marker is refused', () => {
    const g = linearGraph()
    g.edges = g.edges.filter((e) => e.edgeId !== 'e2')
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_DELIVERABLE' && d.message.includes('not connected'))).toBe(true)
  })
})

describe('M50.2 validation — bounds (stage 7, real M41 caps)', () => {
  test('more nodes than the workflow cap is refused at the schema boundary', () => {
    const g = linearGraph()
    // 3 existing + 7 pads = 10 > maxNodes 9
    for (let i = 0; i < 7; i++) {
      g.nodes.push({ nodeId: `pad${i}`, nodeType: 'input.text', contractVersion: 1, config: {} })
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(false)
  })

  test('a dependency overflow at the gate (7 artifact producers) is refused', () => {
    const g: {
      schemaVersion: 1
      nodes: Array<{ nodeId: string; nodeType: string; contractVersion: 1; config: Record<string, string> }>
      edges: Array<{ edgeId: string; from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>
    } = {
      schemaVersion: 1,
      nodes: [{ nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} }],
      edges: [],
    }
    // 7 image producers (artifact producers) + marker = 8 nodes (≤9)
    for (let i = 0; i < 7; i++) {
      g.nodes.push({ nodeId: `i${i}`, nodeType: 'image.create', contractVersion: 1, config: { prompt: `poster number ${i}` } })
      g.edges.push({ edgeId: `ep${i}`, from: { nodeId: `i${i}`, port: 'image' }, to: { nodeId: 'm', port: 'image' } })
    }
    // marker takes exactly one feed — instead feed ONE and let the rest be
    // side producers; the gate (auto-appended at compile) must still depend
    // on all 7 → projected dependsOn overflow.
    g.edges = [g.edges[0]]
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_BOUNDS' && d.message.includes('artifact-producing tasks'))).toBe(true)
  })

  test('per-node incident edges above 6 are refused', () => {
    const g = looseGraph({
      schemaVersion: 1,
      nodes: [{ nodeId: 'src', nodeType: 'input.text', contractVersion: 1, config: { text: 'shared text' } }],
      edges: [],
    })
    // src fans out to 7 consumers + 1 marker = 9 nodes; src incident = 7 > 6
    for (let i = 0; i < 7; i++) {
      g.nodes.push({ nodeId: `d${i}`, nodeType: 'document.draft', contractVersion: 1, config: { instruction: `doc number ${i}` } })
      g.edges.push({ edgeId: `ef${i}`, from: { nodeId: 'src', port: 'text' }, to: { nodeId: `d${i}`, port: 'instruction' } })
    }
    g.nodes.push({ nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'em', from: { nodeId: 'd0', port: 'document' }, to: { nodeId: 'm', port: 'project' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_BOUNDS' && d.message.includes('connections'))).toBe(true)
  })

  test('a critical path beyond the 45-minute mission cap is refused', () => {
    // Three sequential 20-minute code-build relays = a 60-minute chain.
    const registry = relayRegistry()
    const g: {
      schemaVersion: 1
      nodes: Array<{ nodeId: string; nodeType: string; contractVersion: 1; config: Record<string, string> }>
      edges: Array<{ edgeId: string; from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>
    } = { schemaVersion: 1, nodes: [], edges: [] }
    for (let i = 0; i < 3; i++) {
      g.nodes.push({ nodeId: `c${i}`, nodeType: 'test.relay', contractVersion: 1, config: {} })
    }
    g.edges.push({ edgeId: 'x1', from: { nodeId: 'c0', port: 'project' }, to: { nodeId: 'c1', port: 'project' } })
    g.edges.push({ edgeId: 'x2', from: { nodeId: 'c1', port: 'project' }, to: { nodeId: 'c2', port: 'project' } })
    g.nodes.push({ nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'x3', from: { nodeId: 'c2', port: 'project' }, to: { nodeId: 'm', port: 'project' } })
    const parsed = parseWorkflowGraph(g, { registry })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { registry })
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_BOUNDS' && d.message.includes('capped at 45 minutes'))).toBe(true)
  })

  test('parallel media lanes within the cap stay valid (M41 media-production shape)', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'hero shot' } },
        { nodeId: 'a', nodeType: 'audio.speech', contractVersion: 1, config: { text: 'narration for the clip' } },
        { nodeId: 'v', nodeType: 'video.create', contractVersion: 1, config: { prompt: 'the clip' } },
        { nodeId: 'q', nodeType: 'quality.verify', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'v', port: 'prompt' } },
        { edgeId: 'e2', from: { nodeId: 'a', port: 'audio' }, to: { nodeId: 'v', port: 'prompt' } },
        { edgeId: 'e3', from: { nodeId: 'v', port: 'video' }, to: { nodeId: 'q', port: 'video' } },
        { edgeId: 'e4', from: { nodeId: 'v', port: 'video' }, to: { nodeId: 'm', port: 'video' } },
      ],
    }
    // NOTE: prompt inputs are single-cardinality text ports; image/audio are
    // artifact types and cannot feed them — this graph must be REFUSED by the
    // exact type rules (artifacts never masquerade as prompt text).
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.filter((d) => d.code === 'E_PORT_TYPE')).toHaveLength(2)
  })
})

describe('M50.2 validation — availability semantics (stage 8, snapshot-only)', () => {
  test('not-configured/unavailable/degraded → warnings that never block validation', () => {
    const parsed = parseWorkflowGraph(linearGraph())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, {
      availability: { riishe: 'not-configured', laxii: 'unavailable' },
    })
    // riishe is the research node's surface → a warning exists
    expect(outcome.valid).toBe(true) // warnings NEVER block
    const warnings = outcome.diagnostics.filter((d) => d.code === 'E_CAPABILITY_UNAVAILABLE')
    expect(warnings.some((d) => d.severity === 'warning' && d.message.includes('not configured'))).toBe(true)
  })

  test('rate-limited → honest info; available → nothing; absent → nothing', () => {
    const parsed = parseWorkflowGraph(linearGraph())
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const rate = validateWorkflowGraph(parsed.graph, { availability: { riishe: 'rate-limited' } })
    expect(rate.diagnostics.some((d) => d.code === 'E_CAPABILITY_UNAVAILABLE' && d.severity === 'info')).toBe(true)
    expect(rate.valid).toBe(true)
    const ok = validateWorkflowGraph(parsed.graph, { availability: { riishe: 'available' } })
    expect(ok.diagnostics).toHaveLength(0)
    const silent = validateWorkflowGraph(parsed.graph, {})
    expect(silent.diagnostics).toHaveLength(0) // absence of evidence is not a claim
  })

  test('the platform surface is never availability-gated by the snapshot', () => {
    const g = linearGraph()
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { availability: { platform: 'unavailable' } })
    expect(outcome.diagnostics).toHaveLength(0)
  })
})

describe('M50.2 validation — node status and platform gates (stage 9)', () => {
  test('a rogue registry entry with proposed status is refused with E_PERMISSION', () => {
    const rogue: StudioNodeContract = {
      execution: 'executable',
      nodeType: 'future.thing',
      contractVersion: 1,
      displayName: 'Future thing',
      category: 'engineering',
      description: 'A not-yet-built node injected by a test registry.',
      taskKind: 'code-build',
      inputs: [],
      outputs: [{ id: 'project', type: 'code-project', required: false, cardinality: 'single' }],
      config: [],
      capabilitySurface: 'platform',
      trustRequirement: 'standard-gates',
      verification: {},
      limitations: ['test-only'],
      status: 'proposed',
    }
    const registry = createStudioNodeRegistry([...STUDIO_NODE_CONTRACTS, rogue], [])
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'f', nodeType: 'future.thing', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [{ edgeId: 'e1', from: { nodeId: 'f', port: 'project' }, to: { nodeId: 'm', port: 'project' } }],
    }
    const parsed = parseWorkflowGraph(g, { registry })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { registry })
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PERMISSION' && d.message.includes('not an implemented substrate'))).toBe(true)
  })

  test('duplicate quality.verify definitions are refused (platform-owned gate)', () => {
    const g = linearGraph()
    g.nodes.push({ nodeId: 'q1', nodeType: 'quality.verify', contractVersion: 1, config: {} })
    g.nodes.push({ nodeId: 'q2', nodeType: 'quality.verify', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e4', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'q1', port: 'project' } })
    g.edges.push({ edgeId: 'e5', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'q2', port: 'project' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.filter((d) => d.code === 'E_PERMISSION' && d.message.includes('at most one verification gate'))).toHaveLength(1)
  })

  test('any config key on the platform gate is rejected (nothing to override with)', () => {
    const g = linearGraph()
    g.nodes.push({ nodeId: 'q', nodeType: 'quality.verify', contractVersion: 1, config: { verification: 'skip' } })
    g.edges.push({ edgeId: 'e4', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'q', port: 'project' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_CONFIG' && d.message.includes('no configuration field'))).toBe(true)
  })
})

describe('M50.2 validation — deterministic diagnostics', () => {
  test('the same graph always yields byte-identical diagnostics in stage order', () => {
    const g = linearGraph()
    ;(g.nodes[1].config as Record<string, string>)['deliverablePath'] = '../escape.md'
    g.nodes.push({ nodeId: 'x', nodeType: 'input.text', contractVersion: 1, config: {} })
    const a = parseWorkflowGraph(g)
    expect(a.ok).toBe(true)
    const b = parseWorkflowGraph(JSON.parse(JSON.stringify(g)))
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const va = validateWorkflowGraph(a.graph)
    const vb = validateWorkflowGraph(b.graph)
    expect(JSON.stringify(va)).toBe(JSON.stringify(vb))
    expect(va.valid).toBe(false)
    expect(codesOf(va)).toContain('E_CONFIG')
  })

  test('the diagnostic vocabulary is exactly the documented set', async () => {
    const { STUDIO_DIAGNOSTIC_CODES } = await import('../../src/lib/ai-studio/types')
    const codes: string[] = [...STUDIO_DIAGNOSTIC_CODES]
    expect(codes.sort()).toEqual(
      ['E_SCHEMA', 'E_UNKNOWN_NODE', 'E_PORT_TYPE', 'E_CYCLE', 'E_MISSING_INPUT', 'E_CONFIG', 'E_BOUNDS', 'E_CAPABILITY_UNAVAILABLE', 'E_PERMISSION', 'E_DELIVERABLE'].sort(),
    )
  })
})

