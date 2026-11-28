/**
 * M50.2 BEAN AI STUDIO — typed port system tests (hermetic, pure).
 *
 * Pins the port contract: exact type identity (NO implicit coercion), both
 * endpoints must resolve, correct direction, cardinality enforcement,
 * required-input satisfaction, and structural-node connection rules. The
 * full input/output type compatibility matrix is exercised over the REAL
 * registry plus a minimal synthetic registry that supplies the otherwise
 * unexpressable same-type pairs (json→json, verification-result→
 * verification-result) — the synthetic contracts map to REAL M41 kinds and
 * add no vocabulary.
 *
 * Run: bun test tests/unit/m50-2-ports.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { looseGraph, type LooseStudioGraph, type LooseStudioNode, type LooseStudioEdge } from '../helpers/m50-2-graphs'

import { validateWorkflowGraph } from '../../src/lib/ai-studio/validate'
import { parseWorkflowGraph } from '../../src/lib/ai-studio/schema'
import { STUDIO_NODE_CONTRACTS, createStudioNodeRegistry } from '../../src/lib/ai-studio/registry'
import type { StudioNodeContract } from '../../src/lib/ai-studio/types'

function codesOf(result: { ok: boolean; outcome?: { diagnostics: Array<{ code: string; message: string }> } }): string[] {
  if (result.ok) return []
  return (result.outcome?.diagnostics ?? []).map((d) => d.code)
}

function messagesOf(result: { ok: boolean; outcome?: { diagnostics: Array<{ code: string; message: string }> } }): string {
  if (result.ok) return ''
  return (result.outcome?.diagnostics ?? []).map((d) => d.message).join(' | ')
}

/** A synthetic registry that adds two pass-through contracts so every
 *  port-type pair can be expressed. Both map to the REAL 'research' kind —
 *  no vocabulary is invented. */
const syntheticExtra: StudioNodeContract[] = [
  {
    execution: 'executable',
    nodeType: 'test.consumer',
    contractVersion: 1,
    displayName: 'Test consumer',
    category: 'research',
    description: 'Test-only consumer accepting every port type once.',
    taskKind: 'research',
    inputs: STUDIO_NODE_CONTRACTS.flatMap((c) => c.outputs.map((o) => ({ id: `in-${o.type}`, type: o.type, required: false, cardinality: 'many' as const }))),
    outputs: [],
    config: [],
    capabilitySurface: 'platform',
    trustRequirement: 'standard-gates',
    verification: { minSources: 3 },
    limitations: ['test-only'],
    status: 'implemented-substrate',
  },
]
const syntheticRegistry = createStudioNodeRegistry([...STUDIO_NODE_CONTRACTS, ...syntheticExtra], [])

function baseGraph(): LooseStudioGraph {
  return {
    schemaVersion: 1 as const,
    nodes: [
      { nodeId: 'src', nodeType: 'input.text', contractVersion: 1, config: { text: 'hello' } },
    ],
    edges: [] as Array<{ edgeId: string; from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>,
  }
}

describe('M50.2 ports — exact-type compatibility matrix', () => {
  const producerTypes = STUDIO_NODE_CONTRACTS.filter((c) => c.execution === 'executable' || c.nodeType === 'input.text').flatMap(
    (c) => c.outputs.map((o) => ({ nodeType: c.nodeType, port: o.id, type: o.type })),
  )
  const consumerTypes = syntheticExtra[0].inputs.map((i) => ({ port: i.id, type: i.type }))

  test('every (outputType → inputType) pair connects ONLY when types are identical', () => {
    const minConfig: Record<string, Record<string, string>> = {
      'input.text': { text: 'hello' },
      'research.web': { topic: 'a real topic here' },
      'knowledge.atlas': { topic: 'a real topic here' },
      'code.build': { instruction: 'build it' },
      'document.draft': { instruction: 'write it' },
      'image.create': { prompt: 'a poster' },
      'video.create': { prompt: 'a clip' },
      'audio.speech': { text: 'hello there' },
      'quality.verify': {},
    }
    for (const producer of producerTypes) {
      for (const consumer of consumerTypes) {
        const g = {
          schemaVersion: 1 as const,
          nodes: [
            { nodeId: 'p', nodeType: producer.nodeType, contractVersion: 1, config: { ...(minConfig[producer.nodeType] ?? {}) } },
            { nodeId: 'sink', nodeType: 'test.consumer', contractVersion: 1, config: {} },
          ],
          edges: [
            { edgeId: 'e', from: { nodeId: 'p', port: producer.port }, to: { nodeId: 'sink', port: consumer.port } },
          ],
        }
        if (producer.port === 'json') (g.nodes[0].config as Record<string, string>)['jsonValue'] = '{"ok": true}'
        const parsed = parseWorkflowGraph(g, { registry: syntheticRegistry })
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) continue
        const outcome = validateWorkflowGraph(parsed.graph, { registry: syntheticRegistry })
        const accepted = producer.type === consumer.type
        // Judge the PAIR by port-contract diagnostics only (bounds/deliverable
        // diagnostics are irrelevant to typing).
        const portDiag = outcome.diagnostics.filter((d) => d.code === 'E_PORT_TYPE')
        if (accepted) {
          expect(portDiag).toHaveLength(0)
        } else {
          expect(portDiag.some((d) => d.message.includes('must match exactly'))).toBe(true)
        }
      }
    }
  })

  test('the matrix covers all eight first-release types', () => {
    const types = new Set<string>([...producerTypes.map((p) => p.type), ...consumerTypes.map((c) => c.type)])
    for (const t of ['text', 'json', 'research-pack', 'code-project', 'image-asset', 'video-asset', 'audio-asset', 'verification-result']) {
      expect(types.has(t)).toBe(true)
    }
  })

  test('no implicit conversion: json never reaches text; artifacts never reach text', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'sink', nodeType: 'test.consumer', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'src', port: 'json' }, to: { nodeId: 'sink', port: 'in-text' } })
    g.edges.push({ edgeId: 'e2', from: { nodeId: 'src', port: 'text' }, to: { nodeId: 'sink', port: 'in-code-project' } })
    const parsed = parseWorkflowGraph(g, { registry: syntheticRegistry })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { registry: syntheticRegistry })
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.filter((d) => d.code === 'E_PORT_TYPE')).toHaveLength(2)
  })
})

describe('M50.2 ports — real-registry connections', () => {
  test('research-pack feeds document.draft; code-project feeds the deliverable marker', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'sustainable coffee' } },
        { nodeId: 'd', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'write it up' } },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'r', port: 'pack' }, to: { nodeId: 'd', port: 'research' } },
        { edgeId: 'e2', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm', port: 'project' } },
      ],
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateWorkflowGraph(parsed.graph).valid).toBe(true)
  })

  test('image.create can hand its asset to the marker and to the gate', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'a golden retriever' } },
        { nodeId: 'q', nodeType: 'quality.verify', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'q', port: 'image' } },
        { edgeId: 'e2', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'm', port: 'image' } },
      ],
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateWorkflowGraph(parsed.graph).valid).toBe(true)
  })

  test('the verification-result output has no consumer port (no first-release consumer)', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'q', nodeType: 'quality.verify', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'q', port: 'result' }, to: { nodeId: 'src', port: 'json' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PORT_TYPE' && d.message.includes('not an input port'))).toBe(true)
  })
})

describe('M50.2 ports — endpoint resolution and direction', () => {
  test('edges referencing a node that is not in the graph are refused', () => {
    const g = baseGraph()
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'ghost', port: 'text' }, to: { nodeId: 'src', port: 'text' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PORT_TYPE' && d.message.includes('does not exist'))).toBe(true)
  })

  test('invalid direction (output→input reversed) is refused as a non-output port', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'deep sea life' } })
    // from = an INPUT port (wrong direction), to = an OUTPUT port
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'r', port: 'topic' }, to: { nodeId: 'src', port: 'text' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PORT_TYPE' && d.message.includes('not an output port'))).toBe(true)
  })

  test('unknown ports on either side are refused', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'deep sea life' } })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'src', port: 'nope' }, to: { nodeId: 'r', port: 'topic' } })
    g.edges.push({ edgeId: 'e2', from: { nodeId: 'src', port: 'text' }, to: { nodeId: 'r', port: 'nope' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.filter((d) => d.code === 'E_PORT_TYPE')).toHaveLength(2)
  })
})

describe('M50.2 ports — cardinality', () => {
  test('a single-cardinality input refuses a second producer edge', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i1', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'sunset one' } },
        { nodeId: 'i2', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'sunset two' } },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'i1', port: 'image' }, to: { nodeId: 'm', port: 'image' } },
        { edgeId: 'e2', from: { nodeId: 'i2', port: 'image' }, to: { nodeId: 'm', port: 'image' } },
      ],
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PORT_TYPE' && d.message.includes('accepts one connection'))).toBe(true)
  })

  test('many-cardinality inputs (the gate) accept several producers', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'poster' } },
        { nodeId: 'v', nodeType: 'video.create', contractVersion: 1, config: { prompt: 'clip' } },
        { nodeId: 'q', nodeType: 'quality.verify', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'q', port: 'image' } },
        { edgeId: 'e2', from: { nodeId: 'v', port: 'video' }, to: { nodeId: 'q', port: 'video' } },
        { edgeId: 'e3', from: { nodeId: 'v', port: 'video' }, to: { nodeId: 'm', port: 'video' } },
      ],
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateWorkflowGraph(parsed.graph).valid).toBe(true)
  })
})

describe('M50.2 ports — required inputs', () => {
  test('a required input missing both edge and config is refused', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: {} })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_MISSING_INPUT' && d.portId === 'topic')).toBe(true)
  })

  test('a required input satisfied by a text edge compiles clean', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'src', port: 'text' }, to: { nodeId: 'r', port: 'topic' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.diagnostics.filter((d) => d.code === 'E_MISSING_INPUT')).toHaveLength(0)
  })

  test('config wins over an edge when both exist (deterministic precedence)', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: { topic: 'config topic here' } })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'src', port: 'text' }, to: { nodeId: 'r', port: 'topic' } })
    g.nodes.push({ nodeId: 'd', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'summarize it' } })
    g.edges.push({ edgeId: 'e2', from: { nodeId: 'r', port: 'pack' }, to: { nodeId: 'd', port: 'research' } })
    g.nodes.push({ nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e3', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm', port: 'project' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(validateWorkflowGraph(parsed.graph).valid).toBe(true)
  })

  test('text feeding a required input must satisfy the field minimum (research topics ≥ 8 chars)', () => {
    const g = baseGraph()
    ;(g.nodes[0].config as Record<string, string>)['text'] = 'tiny'
    g.nodes.push({ nodeId: 'r', nodeType: 'research.web', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'src', port: 'text' }, to: { nodeId: 'r', port: 'topic' } })
    g.nodes.push({ nodeId: 'd', nodeType: 'document.draft', contractVersion: 1, config: { instruction: 'summarize it' } })
    g.edges.push({ edgeId: 'e2', from: { nodeId: 'r', port: 'pack' }, to: { nodeId: 'd', port: 'research' } })
    g.nodes.push({ nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e3', from: { nodeId: 'd', port: 'document' }, to: { nodeId: 'm', port: 'project' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_CONFIG' && d.message.includes('shorter than'))).toBe(true)
  })
})

describe('M50.2 ports — structural-node connection rules', () => {
  test('input.text cannot feed the deliverable marker (type mismatch, no coercion)', () => {
    const g = baseGraph()
    g.nodes.push({ nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'src', port: 'text' }, to: { nodeId: 'm', port: 'project' } })
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PORT_TYPE')).toBe(true)
  })

  test('json output is honest: it exists, but no first-release input consumes it', () => {
    const input = STUDIO_NODE_CONTRACTS.find((c) => c.nodeType === 'input.text')
    expect(input?.outputs.some((p) => p.type === 'json')).toBe(true)
    const jsonConsumers = STUDIO_NODE_CONTRACTS.filter((c) => c.inputs.some((p) => p.type === 'json'))
    expect(jsonConsumers).toHaveLength(0)
  })

  test('input.text JSON port integrity is validated (connected ⇒ valid bounded JSON)', () => {
    // json can only be expressed toward a json input in the synthetic registry
    const g = baseGraph()
    g.nodes.push({ nodeId: 'sink', nodeType: 'test.consumer', contractVersion: 1, config: {} })
    g.edges.push({ edgeId: 'e1', from: { nodeId: 'src', port: 'json' }, to: { nodeId: 'sink', port: 'in-json' } })
    const parsed = parseWorkflowGraph(g, { registry: syntheticRegistry })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph, { registry: syntheticRegistry })
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_CONFIG' && d.message.includes('no JSON value'))).toBe(true)
    // with a real JSON value the port integrity error is gone
    ;(g.nodes[0].config as Record<string, string>)['jsonValue'] = '{"answer": 42}'
    const parsed2 = parseWorkflowGraph(g, { registry: syntheticRegistry })
    expect(parsed2.ok).toBe(true)
    if (!parsed2.ok) return
    const outcome2 = validateWorkflowGraph(parsed2.graph, { registry: syntheticRegistry })
    expect(outcome2.diagnostics.some((d) => d.code === 'E_CONFIG' && d.message.includes('JSON'))).toBe(false)
  })

  test('the deliverable marker cannot be fed from the verification gate', () => {
    const g = {
      schemaVersion: 1 as const,
      nodes: [
        { nodeId: 'i', nodeType: 'image.create', contractVersion: 1, config: { prompt: 'cover art' } },
        { nodeId: 'q', nodeType: 'quality.verify', contractVersion: 1, config: {} },
        { nodeId: 'm', nodeType: 'output.deliverable', contractVersion: 1, config: {} },
      ],
      edges: [
        { edgeId: 'e1', from: { nodeId: 'i', port: 'image' }, to: { nodeId: 'q', port: 'image' } },
        { edgeId: 'e2', from: { nodeId: 'q', port: 'result' }, to: { nodeId: 'm', port: 'project' } },
      ],
    }
    const parsed = parseWorkflowGraph(g)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const outcome = validateWorkflowGraph(parsed.graph)
    // verification-result ≠ code-project: exact-type refusal, and the marker
    // is then unconnected → deliverable refusal too.
    expect(outcome.valid).toBe(false)
    expect(outcome.diagnostics.some((d) => d.code === 'E_PORT_TYPE' && d.message.includes('must match exactly'))).toBe(true)
    expect(outcome.diagnostics.some((d) => d.code === 'E_DELIVERABLE')).toBe(true)
  })
})
