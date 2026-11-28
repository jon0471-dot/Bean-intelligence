/**
 * BEAN Intelligence — M50.2 BEAN AI STUDIO deterministic compiler (pure).
 *
 * `compileWorkflowToPlan(graph, registry, availability)` — the ONE new pure
 * adapter of the M50.1 architecture (§6.3–§6.5): turns a validated, immutable
 * workflow graph into a `CompiledWorkflowPlan` — a validated
 * `MissionTaskSpec[]` built exclusively through the existing `buildTaskSpec`
 * (fixed kinds, fixed agents, fixed scopes, capped limits), ready for the
 * M50.5 governed-run adapter to hand to the EXISTING `createMissionFromPlan`.
 *
 * Hard boundary (M50.2 — pinned by tests):
 *  - NO mission is created; `createMissionFromPlan` is never called;
 *  - NO GenerationJob is enqueued and no executor/specialist adapter runs;
 *  - NO database, network, filesystem, environment or time access;
 *  - NO `MISSION_TYPES`/`'workflow'` union change (deferred to M50.5 by the
 *    architecture) — the dedicated `CompiledWorkflowPlan` type is returned
 *    instead of forcing a wrong `MissionPlan`;
 *  - the M41 text planner (`planMission`) is NOT consulted — the mission
 *    kernel stays the only execution engine, unchanged.
 *
 * Mandatory QUALITY gate: the compiler ALWAYS emits exactly one platform
 * `verify-deliverable` task depending on every artifact-producing task. A
 * user graph can never omit, weaken, duplicate or override it.
 *
 * Determinism: same graph + same registry ⇒ byte-identical plan (stable ids,
 * stable order, stable shaping). Compilation NEVER substitutes an unknown or
 * unsupported node — validation refuses the graph first.
 *
 * PURE module — no DB, no I/O, no env reads, no time, no randomness.
 */

import { buildTaskSpec, MISSION_LIMITS, MissionContractError, normalizeLimits } from '@/lib/riishe/mission/types'
import { validateTaskGraph } from '@/lib/riishe/mission/graph'
import type { MissionTaskSpec, VerificationCriteria } from '@/lib/riishe/mission/types'
import { parseWorkflowGraph } from './schema'
import {
  graphTopologicalOrder,
  sourceTextValue,
  textConfigFieldForPort,
  validateWorkflowGraph,
} from './validate'
import { diag, hasErrors } from './diagnostics'
import { STUDIO_NODE_REGISTRY } from './registry'
import type { StudioNodeRegistry } from './registry'
import type {
  AvailabilitySnapshot,
  CompiledWorkflowResult,
  StudioDiagnostic,
  StudioExecutableNodeContract,
  StudioGraphNode,
  StudioNodeContract,
  StudioWorkflowGraph,
} from './types'
import { WORKFLOW_GRAPH_SCHEMA_VERSION } from './limits'

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/** Numeric task-id comparison so t2 sorts before t10 (deterministic). */
function taskIdCompare(a: string, b: string): number {
  const na = Number.parseInt(a.slice(1), 10)
  const nb = Number.parseInt(b.slice(1), 10)
  if (Number.isNaN(na) || Number.isNaN(nb)) return a < b ? -1 : a > b ? 1 : 0
  return na - nb
}

export interface CompileWorkflowOptions {
  registry?: StudioNodeRegistry
  availability?: AvailabilitySnapshot
}

/**
 * Compile a workflow graph into a validated task plan (PURE — the M50.2
 * boundary). Returns structured failure diagnostics instead of ever
 * substituting a node or silently weakening a contract.
 */
export function compileWorkflowToPlan(
  graph: unknown,
  registry: StudioNodeRegistry = STUDIO_NODE_REGISTRY,
  availability?: AvailabilitySnapshot,
): CompiledWorkflowResult {
  const options: CompileWorkflowOptions = { registry, ...(availability ? { availability } : {}) }

  // --- Stages 1–2: parse + resolve (strict schema) --------------------------
  const parsed = parseWorkflowGraph(graph, { registry })
  if (!parsed.ok) {
    return { ok: false, diagnostics: parsed.outcome.diagnostics }
  }

  // --- Stages 3–10: full validation ----------------------------------------
  const validation = validateWorkflowGraph(parsed.graph, { registry, availability })
  if (!validation.valid) {
    return { ok: false, diagnostics: validation.diagnostics }
  }

  const g: StudioWorkflowGraph = parsed.graph
  const problems: StudioDiagnostic[] = []

  // --- Deterministic node order ---------------------------------------------
  const topo = graphTopologicalOrder(g)
  if (!topo) {
    // Validation already refuses cycles; this guard keeps the compiler total.
    return {
      ok: false,
      diagnostics: [diag('E_CYCLE', 'This workflow contains a circular connection; loops are not supported.')],
    }
  }
  const nodeById = new Map<string, StudioGraphNode>()
  for (const n of g.nodes) nodeById.set(n.nodeId, n)
  const contractOf = (node: StudioGraphNode): StudioNodeContract | null =>
    registry.resolve(node.nodeType, node.contractVersion)

  // Task-id assignment in topological order (structural nodes skip ids).
  const taskIdOf = new Map<string, string>()
  let nextTask = 1
  for (const nodeId of topo) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    const contract = contractOf(node)
    if (!contract || contract.execution !== 'executable') continue
    taskIdOf.set(nodeId, `t${nextTask++}`)
  }

  // Edge resolution (validated; defensive guards keep this total).
  interface ResolvedEdge {
    fromNodeId: string
    fromExecutable: boolean
    fromPortId: string
    fromPortType: string
    toNodeId: string
    toExecutable: boolean
    toPortId: string
    toPortType: string
  }
  const edges: ResolvedEdge[] = []
  for (const edge of g.edges) {
    const fromNode = nodeById.get(edge.from.nodeId)
    const toNode = nodeById.get(edge.to.nodeId)
    if (!fromNode || !toNode) continue
    const fc = contractOf(fromNode)
    const tc = contractOf(toNode)
    if (!fc || !tc) continue
    const fromPort = fc.outputs.find((p) => p.id === edge.from.port)
    const toPort = tc.inputs.find((p) => p.id === edge.to.port)
    if (!fromPort || !toPort) continue
    edges.push({
      fromNodeId: fromNode.nodeId,
      fromExecutable: fc.execution === 'executable',
      fromPortId: fromPort.id,
      fromPortType: fromPort.type,
      toNodeId: toNode.nodeId,
      toExecutable: tc.execution === 'executable',
      toPortId: toPort.id,
      toPortType: toPort.type,
    })
  }

  // Effective text per (node, port): config value wins, else the incoming
  // text edge's input.text value (deterministic precedence, validated bounds).
  const effectiveText = new Map<string, string>()
  for (const node of g.nodes) {
    const contract = contractOf(node)
    if (!contract || contract.execution !== 'executable') continue
    for (const port of contract.inputs) {
      if (port.type !== 'text' || !port.required) continue
      const fieldId = textConfigFieldForPort(contract, port.id)
      const configValue = fieldId ? (node.config[fieldId] ?? '').trim() : ''
      if (configValue.length > 0) {
        effectiveText.set(`${node.nodeId}::${port.id}`, configValue)
        continue
      }
      const incoming = edges.find((e) => e.toNodeId === node.nodeId && e.toPortId === port.id)
      if (incoming) {
        const source = nodeById.get(incoming.fromNodeId)
        const value = source ? sourceTextValue(source) : null
        if (value !== null) effectiveText.set(`${node.nodeId}::${port.id}`, value)
      }
    }
  }

  const textOf = (node: StudioGraphNode, portId: string): string => effectiveText.get(`${node.nodeId}::${portId}`) ?? ''

  const researchConnected = (nodeId: string, portId = 'research'): boolean =>
    edges.some((e) => e.toNodeId === nodeId && e.toPortId === portId)

  const depsFor = (nodeId: string): string[] => {
    const deps = new Set<string>()
    for (const e of edges) {
      if (e.toNodeId !== nodeId) continue
      if (!e.fromExecutable) continue // structural nodes compile to no task
      const depTaskId = taskIdOf.get(e.fromNodeId)
      if (depTaskId) deps.add(depTaskId)
    }
    return [...deps].sort(taskIdCompare)
  }

  // --- Per-node task shaping (deterministic; buildTaskSpec derives agent +
  // scope + normalized criteria/limits — never the graph) -------------------
  const specs: MissionTaskSpec[] = []
  const detected: string[] = []

  const buildSpecFor = (node: StudioGraphNode, contract: StudioExecutableNodeContract, deps: string[]): MissionTaskSpec => {
    switch (node.nodeType) {
      case 'research.web': {
        const topic = clip(textOf(node, 'topic'), MISSION_LIMITS.paramValueChars)
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'research',
          title: 'Gather cited evidence',
          objective:
            `Research the topic with live retrieval and collect real, attributable sources. Topic: ${clip(topic, 300)}. ` +
            `Collect at least three independent sources; for each capture the title and the URL.`,
          params: { topic: clip(topic, 300) },
          expectedOutput: 'A research pack of at least three real sources (title + URL each).',
          dependsOn: deps,
          verification: contract.verification,
          limits: contract.limits,
        })
      }
      case 'knowledge.atlas': {
        const topic = clip(textOf(node, 'topic'), MISSION_LIMITS.paramValueChars)
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'knowledge',
          title: 'Consult the knowledge atlas',
          objective: `Consult the curated knowledge atlas for established background on: ${clip(topic, 300)}.`,
          params: { topic: clip(topic, 300) },
          expectedOutput: 'At least one relevant atlas reference consulted.',
          dependsOn: deps,
          verification: contract.verification,
          limits: contract.limits,
        })
      }
      case 'code.build': {
        const instruction = clip(textOf(node, 'objective'), 3_600)
        const projectName = (node.config['projectName'] ?? '').trim()
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'code-build',
          title: 'Architect, build and verify the software',
          objective:
            `Architect and build the requested software${projectName ? ` (project name: "${clip(projectName, 60)}")` : ''} as real, ` +
            `working files in a new engineering project. Use a professional, coherent design; no generic template look. ` +
            `Ensure it runs. Objective from the user: ${clip(instruction, MISSION_LIMITS.taskObjectiveChars - 400)}`,
          params: projectName ? { projectName: clip(projectName, 60) } : {},
          expectedOutput: 'A completed coding job that created working project files with real diffs and a passing self-verification.',
          dependsOn: deps,
          verification: contract.verification,
          limits: contract.limits,
        })
      }
      case 'document.draft': {
        const docPath = (node.config['deliverablePath'] ?? '').trim() || 'document.md'
        const instruction = clip(textOf(node, 'instruction'), 3_200)
        const withResearch = researchConnected(node.nodeId)
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'document-draft',
          title: `Write the ${clip(docPath.replace(/\.md$/i, ''), 80)} deliverable`,
          objective:
            `Write the requested document as ${docPath} in a new engineering project. ` +
            (withResearch
              ? `Ground every factual claim in the research sources handed to you below; include a "Sources" section listing every source you used with its URL. `
              : '') +
            `Structure the document professionally (title, sections, conclusion). Do not invent facts that sources do not support; ` +
            `mark uncertainty explicitly. Request: ${clip(instruction, MISSION_LIMITS.taskObjectiveChars - 800)}`,
          params: { deliverablePath: docPath },
          expectedOutput: withResearch
            ? `A completed coding job whose real file changes include ${docPath} with cited sources.`
            : `A completed coding job whose real file changes include ${docPath}.`,
          dependsOn: deps,
          verification: {
            ...contract.verification,
            deliverablePath: docPath,
            requireSourceCitation: withResearch,
            ...(withResearch ? { requiredSections: ['Sources'] } : {}),
          } satisfies VerificationCriteria,
          limits: contract.limits,
        })
      }
      case 'image.create': {
        const prompt = clip(textOf(node, 'prompt'), 2_000)
        const size = (node.config['size'] ?? '').trim()
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'image-asset',
          title: 'Create the visual asset',
          objective: `Create the requested visual asset. Description: ${clip(prompt, MISSION_LIMITS.taskObjectiveChars - 60)}`,
          params: size ? { prompt, size } : { prompt },
          expectedOutput: 'A completed image-creation job with a real servable image artifact.',
          dependsOn: deps,
          verification: contract.verification,
          limits: contract.limits,
        })
      }
      case 'video.create': {
        const prompt = clip(textOf(node, 'prompt'), 2_000)
        const size = (node.config['size'] ?? '').trim()
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'video-asset',
          title: 'Produce the video clip',
          objective: `Produce the requested video clip. Description: ${clip(prompt, MISSION_LIMITS.taskObjectiveChars - 60)}`,
          params: size ? { prompt, size } : { prompt },
          expectedOutput: 'A completed video-creation job with a real servable video artifact and recorded provenance.',
          dependsOn: deps,
          verification: contract.verification,
          limits: contract.limits,
        })
      }
      case 'audio.speech': {
        const text = clip(textOf(node, 'narration'), 1_000)
        const voice = (node.config['voice'] ?? '').trim()
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'audio-asset',
          title: 'Produce the spoken audio',
          objective: `Synthesize the narration text exactly as provided (no rewriting): "${clip(text, 900)}"`,
          params: voice ? { text, voice } : { text },
          expectedOutput: 'A completed speech-synthesis job with a RIFF-validated audio artifact.',
          dependsOn: deps,
          verification: contract.verification,
          limits: contract.limits,
        })
      }
      case 'quality.verify': {
        // Platform contract — the user may place the node, but EVERY field
        // below is fixed here (the contract carries no user configuration).
        return buildTaskSpec({
          id: taskIdOf.get(node.nodeId) as string,
          kind: 'verify-deliverable',
          title: 'Verify the final deliverable',
          objective: 'Independently inspect every delivered artifact of this mission for integrity and coherence.',
          params: {},
          expectedOutput: 'Every delivered artifact of this workflow exists, is real, and passed integrity inspection.',
          dependsOn: deps,
          verification: {},
          limits: contract.limits,
        })
      }
      default: {
        // The registry only contains executable contracts with a shaping
        // rule; an unhandled executable contract is a registry programming
        // error and must fail loudly instead of guessing.
        throw new MissionContractError(`No deterministic compilation rule exists for node type "${node.nodeType}".`)
      }
    }
  }

  const gateNodeId: string | null = (() => {
    for (const node of g.nodes) {
      if (node.nodeType === 'quality.verify') return node.nodeId
    }
    return null
  })()

  // Artifact producers (the gate depends on EVERY one of them).
  const producerNodeIds: string[] = []
  for (const nodeId of topo) {
    const node = nodeById.get(nodeId)
    const contract = node ? contractOf(node) : null
    if (!node || !contract || contract.execution !== 'executable') continue
    if (node.nodeType === 'quality.verify') continue
    const producesArtifact = contract.outputs.some((p) =>
      ['code-project', 'image-asset', 'video-asset', 'audio-asset'].includes(p.type),
    )
    if (producesArtifact) producerNodeIds.push(nodeId)
  }

  // Compile executable nodes in topological order; user-placed gate defers
  // its dependsOn merge until every producer id exists.
  for (const nodeId of topo) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    const contract = contractOf(node)
    if (!contract || contract.execution !== 'executable') continue
    if (node.nodeType === 'quality.verify') continue // compiled after producers below
    try {
      specs.push(buildSpecFor(node, contract, depsFor(nodeId)))
    } catch (error) {
      // Never leak raw exception text; never substitute a task.
      problems.push(
        diag(
          'E_CONFIG',
          `Node "${node.nodeType}" on "${node.nodeId}" produced a value the task contract refused; the workflow cannot be compiled.`,
          { nodeId: node.nodeId },
        ),
      )
      void error
      return { ok: false, diagnostics: validation.diagnostics.concat(problems) }
    }
  }

  // --- The mandatory QUALITY gate -------------------------------------------
  let gateAutoAppended = false
  let gateTaskId: string
  if (gateNodeId) {
    gateTaskId = taskIdOf.get(gateNodeId) as string
    const gateNode = nodeById.get(gateNodeId) as StudioGraphNode
    const gateContract = contractOf(gateNode)
    if (!gateContract || gateContract.execution !== 'executable') {
      return {
        ok: false,
        diagnostics: validation.diagnostics.concat([diag('E_DELIVERABLE', 'The verification node is not a supported executable contract.')]),
      }
    }
    const gateDeps = new Set<string>(depsFor(gateNodeId))
    for (const producerId of producerNodeIds) {
      const dep = taskIdOf.get(producerId)
      if (dep) gateDeps.add(dep)
    }
    try {
      specs.push(buildSpecFor(gateNode, gateContract, [...gateDeps].sort(taskIdCompare)))
    } catch (error) {
      problems.push(
        diag('E_CONFIG', 'The verification gate could not be compiled; the workflow cannot run.', { nodeId: gateNodeId }),
      )
      void error
      return { ok: false, diagnostics: validation.diagnostics.concat(problems) }
    }
  } else {
    // Auto-append: the platform gate is uncapturable — absence in the graph
    // never means absence in the plan.
    gateAutoAppended = true
    gateTaskId = `t${nextTask++}`
    const gateProducerDeps = producerNodeIds
      .map((id) => taskIdOf.get(id))
      .filter((id): id is string => Boolean(id))
      .sort(taskIdCompare)
    const gateContract = STUDIO_NODE_REGISTRY.resolve('quality.verify', 1)
    if (!gateContract || gateContract.execution !== 'executable') {
      return {
        ok: false,
        diagnostics: [diag('E_DELIVERABLE', 'The platform verification contract is missing from the registry.')],
      }
    }
    try {
      specs.push(
        buildTaskSpec({
          id: gateTaskId,
          kind: 'verify-deliverable',
          title: 'Verify the final deliverable',
          objective: 'Independently inspect every delivered artifact of this mission for integrity and coherence.',
          params: {},
          expectedOutput: 'Every delivered artifact of this workflow exists, is real, and passed integrity inspection.',
          dependsOn: gateProducerDeps,
          verification: {},
          limits: normalizeLimits(gateContract.limits),
        }),
      )
    } catch (error) {
      problems.push(diag('E_BOUNDS', 'The verification gate could not be compiled within the mission caps.'))
      void error
      return { ok: false, diagnostics: validation.diagnostics.concat(problems) }
    }
  }

  // nodeTaskMap in task-id order (deterministic object key order) — built
  // purely from the emitted specs.
  const byTaskId = new Map<string, string>()
  for (const [nodeId, taskId] of taskIdOf) byTaskId.set(taskId, nodeId)
  const nodeTaskMap: Record<string, string> = {}
  for (const spec of specs) {
    const nodeId = byTaskId.get(spec.id)
    if (nodeId) nodeTaskMap[nodeId] = spec.id
  }

  // --- Deliverable designation ----------------------------------------------
  const markerNode = g.nodes.find((n) => n.nodeType === 'output.deliverable')
  let deliverableTaskId = ''
  let deliverableNodeId = ''
  if (markerNode) {
    deliverableNodeId = markerNode.nodeId
    const markerEdge = edges.find((e) => e.toNodeId === markerNode.nodeId)
    const producerTaskId = markerEdge ? taskIdOf.get(markerEdge.fromNodeId) : undefined
    if (producerTaskId) {
      deliverableTaskId = producerTaskId
    } else {
      problems.push(diag('E_DELIVERABLE', 'The Deliverable node is not connected to an artifact-producing task.', { nodeId: markerNode.nodeId }))
      return { ok: false, diagnostics: validation.diagnostics.concat(problems) }
    }
  } else {
    problems.push(diag('E_DELIVERABLE', 'Add one Deliverable node and connect exactly one artifact-producing task to it.'))
    return { ok: false, diagnostics: validation.diagnostics.concat(problems) }
  }

  // --- Final authority: the EXISTING M41 graph kernel ------------------------
  const graphCheck = validateTaskGraph(specs)
  if (!graphCheck.valid) {
    return {
      ok: false,
      diagnostics: validation.diagnostics.concat(
        graphCheck.problems.slice(0, 4).map((p) => diag('E_BOUNDS', clip(p, 280))),
      ),
    }
  }

  // --- Honest compilation summary -------------------------------------------
  detected.push(`${specs.length} governed task${specs.length === 1 ? '' : 's'} planned on the existing mission machinery.`)
  detected.push(
    gateAutoAppended
      ? 'The platform verification gate was added automatically (it cannot be omitted).'
      : 'The platform verification gate from the graph was preserved (its contract is fixed by the platform).',
  )
  const producerNode = markerEdge2NodeId(g, markerNode.nodeId)
  if (producerNode) {
    const producerNodeRef = nodeById.get(producerNode)
    const producerContract = producerNodeRef ? contractOf(producerNodeRef) : null
    if (producerContract) {
      detected.push(`The deliverable is designated from "${producerContract.displayName}".`)
    }
  }
  const chainNodes = new Set<string>()
  {
    // walk producers of the deliverable (transitive) for the side-task note
    const stack = [producerNode]
    while (stack.length > 0) {
      const id = stack.pop()
      if (!id || chainNodes.has(id)) continue
      chainNodes.add(id)
      for (const e of edges) if (e.toNodeId === id) stack.push(e.fromNodeId)
    }
  }
  const sideTasks = specs.length - [...chainNodes].filter((id) => taskIdOf.has(id)).length - 1
  if (sideTasks > 0) {
    detected.push(
      `${sideTasks} supporting task${sideTasks === 1 ? '' : 's'} run outside the deliverable chain; if one fails, the run completes partially — never fake-successfully.`,
    )
  }

  return {
    ok: true,
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    tasks: specs,
    // M50.3 CORRECTIVE FIX: successful compilations PRESERVE the warning +
    // info diagnostics from validation (e.g. honest availability evidence)
    // so previews never lose backend-truth information. By construction a
    // valid outcome carries no error severities; compilation still succeeds
    // with warnings — a warning is never upgraded or downgraded into a
    // refusal here.
    diagnostics: validation.diagnostics,
    deliverableTaskId,
    deliverableNodeId,
    gateTaskId,
    gateAutoAppended,
    nodeTaskMap,
    detected,
  }
}

/** The producer feeding the deliverable marker (validated to exist). */
function markerEdge2NodeId(g: StudioWorkflowGraph, markerNodeId: string): string | null {
  const edge = g.edges.find((e) => e.to.nodeId === markerNodeId)
  return edge ? edge.from.nodeId : null
}
