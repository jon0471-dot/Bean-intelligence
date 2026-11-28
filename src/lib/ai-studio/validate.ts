/**
 * BEAN Intelligence — M50.2 BEAN AI STUDIO deterministic graph validation
 * (pure).
 *
 * The ten ordered validation stages of the M50.1 architecture (§6.2). Stages
 * 1–2 (schema/version/size + registry resolution) run in schema.ts; this
 * module runs stages 3–10 on the PARSED graph:
 *
 *   3. Port existence, exact type compatibility and cardinality
 *   4. Cycle detection and deterministic topological ordering
 *   5. Required-input validation (edge or allowed bounded config value)
 *   6. Per-node configuration validation
 *   7. Graph, task, dependency and resource bounds (real M41 caps)
 *   8. Capability-availability diagnostics (explicit snapshot only)
 *   9. Permission and node-status validation
 *  10. Deliverable designation validation
 *
 * Determinism: the same graph + the same registry + the same availability
 * snapshot ALWAYS produce the same diagnostics in the same order (stages in
 * order; within a stage, graph node/edge order; a frozen array).
 *
 * Honesty: availability diagnostics come ONLY from the explicit snapshot the
 * caller passes — the pure core never probes health, reads the environment
 * or infers availability. A validation pass is NEVER a promise that a
 * backend will succeed later; the existing execution-time router preflight
 * stays authoritative.
 *
 * PURE module — no DB, no I/O, no env reads, no time, no randomness.
 */

import { WORKFLOW_LIMITS } from './limits'
import { STUDIO_NODE_REGISTRY } from './registry'
import type { StudioNodeRegistry } from './registry'
import { diag, hasErrors } from './diagnostics'
import { normalizeLimits } from '@/lib/riishe/mission/types'
import { MISSION_LIMITS } from '@/lib/riishe/mission/types'
import type {
  AvailabilitySnapshot,
  StudioCapabilitySurface,
  StudioDiagnostic,
  StudioGraphNode,
  StudioNodeContract,
  StudioPortSpec,
  StudioWorkflowGraph,
  WorkflowValidationOutcome,
} from './types'

// ---------------------------------------------------------------------------
// Port types that a deliverable may be designated from (the actual artifacts
// users can deliver; research packs and verification results are not
// deliverables)
// ---------------------------------------------------------------------------

const DELIVERABLE_PORT_TYPES = ['code-project', 'image-asset', 'video-asset', 'audio-asset'] as const

/** Executable output port types that produce a mission artifact (the tasks
 *  the platform QUALITY gate must depend on). */
const ARTIFACT_PORT_TYPES = DELIVERABLE_PORT_TYPES

export interface ValidateWorkflowGraphOptions {
  registry?: StudioNodeRegistry
  availability?: AvailabilitySnapshot
}

/**
 * Validate the parsed graph (stages 3–10). Deterministic and ordered.
 */
export function validateWorkflowGraph(
  graph: StudioWorkflowGraph,
  options: ValidateWorkflowGraphOptions = {},
): WorkflowValidationOutcome {
  const registry = options.registry ?? STUDIO_NODE_REGISTRY
  const availability = options.availability ?? {}
  const problems: StudioDiagnostic[] = []

  const nodeById = new Map<string, StudioGraphNode>()
  for (const n of graph.nodes) if (!nodeById.has(n.nodeId)) nodeById.set(n.nodeId, n)
  const contractOf = (node: StudioGraphNode): StudioNodeContract | null =>
    registry.resolve(node.nodeType, node.contractVersion)

  // --- Stage 3: port existence, direction, exact type, cardinality --------
  const resolvedEdges: Array<{
    edgeId: string
    fromNode: StudioGraphNode
    fromContract: StudioNodeContract
    fromPort: StudioPortSpec
    toNode: StudioGraphNode
    toContract: StudioNodeContract
    toPort: StudioPortSpec
  }> = []

  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.from.nodeId)
    const toNode = nodeById.get(edge.to.nodeId)
    if (!fromNode || !toNode) {
      problems.push(
        diag('E_PORT_TYPE', `Edge "${edge.edgeId}" connects a node that does not exist in this workflow.`, {
          edgeId: edge.edgeId,
        }),
      )
      continue
    }
    const fromContract = contractOf(fromNode)
    const toContract = contractOf(toNode)
    if (!fromContract || !toContract) continue // already reported by stage 2
    const fromPort = fromContract.outputs.find((p) => p.id === edge.from.port)
    const toPort = toContract.inputs.find((p) => p.id === edge.to.port)
    if (!fromPort) {
      problems.push(
        diag(
          'E_PORT_TYPE',
          `Edge "${edge.edgeId}" starts at "${edge.from.port}", which is not an output port of "${fromContract.displayName}".`,
          { edgeId: edge.edgeId, nodeId: fromNode.nodeId, portId: edge.from.port },
        ),
      )
      continue
    }
    if (!toPort) {
      problems.push(
        diag(
          'E_PORT_TYPE',
          `Edge "${edge.edgeId}" ends at "${edge.to.port}", which is not an input port of "${toContract.displayName}".`,
          { edgeId: edge.edgeId, nodeId: toNode.nodeId, portId: edge.to.port },
        ),
      )
      continue
    }
    if (fromPort.type !== toPort.type) {
      problems.push(
        diag(
          'E_PORT_TYPE',
          `Edge "${edge.edgeId}" connects a ${fromPort.type} output to a ${toPort.type} input — port types must match exactly; there is no implicit conversion.`,
          { edgeId: edge.edgeId, nodeId: toNode.nodeId, portId: toPort.id },
        ),
      )
      continue
    }
    resolvedEdges.push({ edgeId: edge.edgeId, fromNode, fromContract, fromPort, toNode, toContract, toPort })
  }

  // Cardinality (input ports): count resolved incoming edges per (node,port).
  const incomingByPort = new Map<string, number>()
  for (const e of resolvedEdges) {
    const key = `${e.toNode.nodeId}::${e.toPort.id}`
    incomingByPort.set(key, (incomingByPort.get(key) ?? 0) + 1)
  }
  for (const node of graph.nodes) {
    const contract = contractOf(node)
    if (!contract) continue
    for (const port of contract.inputs) {
      if (port.cardinality !== 'single') continue
      const count = incomingByPort.get(`${node.nodeId}::${port.id}`) ?? 0
      if (count > 1) {
        problems.push(
          diag(
            'E_PORT_TYPE',
            `Input "${port.id}" of node "${node.nodeId}" accepts one connection but ${count} edges were connected.`,
            { nodeId: node.nodeId, portId: port.id },
          ),
        )
      }
    }
  }

  // --- Stage 4: cycle detection + deterministic topological order ----------
  const adjacency = new Map<string, string[]>()
  for (const e of resolvedEdges) {
    const list = adjacency.get(e.fromNode.nodeId) ?? []
    if (!list.includes(e.toNode.nodeId)) list.push(e.toNode.nodeId)
    adjacency.set(e.fromNode.nodeId, list)
  }
  const cycle = findCycle(graph.nodes.map((n) => n.nodeId), adjacency)
  if (cycle) {
    problems.push(
      diag(
        'E_CYCLE',
        `This workflow contains a circular connection through: ${cycle.join(' → ')}. Loops are not supported.`,
        { nodeId: cycle[0] },
      ),
    )
  }

  // --- Stage 5: required inputs -------------------------------------------
  const effectiveText = new Map<string, { value: string; sourceNodeId: string | null }>()
  for (const node of graph.nodes) {
    const contract = contractOf(node)
    if (!contract) continue
    for (const port of contract.inputs) {
      if (!port.required) continue
      const configField =
        contract.config.find((f) => f.satisfiableByTextEdge && f.id === textConfigFieldForPort(contract, port.id)) ?? null
      const configValue = configField ? (node.config[configField.id] ?? '').trim() : ''
      const incomingText = resolvedEdges.filter(
        (e) => e.toNode.nodeId === node.nodeId && e.toPort.id === port.id,
      )
      if (configValue.length > 0) {
        effectiveText.set(`${node.nodeId}::${port.id}`, { value: configValue, sourceNodeId: null })
        continue
      }
      if (incomingText.length > 0) {
        const source = incomingText[0].fromNode
        const sourceField = sourceTextValue(source)
        if (sourceField !== null) {
          effectiveText.set(`${node.nodeId}::${port.id}`, { value: sourceField, sourceNodeId: source.nodeId })
          continue
        }
      }
      problems.push(
        diag(
          'E_MISSING_INPUT',
          `"${contract.displayName}" on node "${node.nodeId}" needs its "${port.id}" input — connect a text input or fill the configuration field.`,
          { nodeId: node.nodeId, portId: port.id },
        ),
      )
    }
  }

  // --- Stage 6: per-node configuration validation --------------------------
  for (const node of graph.nodes) {
    const contract = contractOf(node)
    if (!contract) continue
    const knownFieldIds = new Set(contract.config.map((f) => f.id))
    for (const key of Object.keys(node.config)) {
      if (!knownFieldIds.has(key)) {
        problems.push(
          diag(
            'E_CONFIG',
            `"${contract.displayName}" on node "${node.nodeId}" has no configuration field "${key}" — unknown configuration is rejected (graphs carry data only).`,
            { nodeId: node.nodeId },
          ),
        )
      }
    }
    for (const field of contract.config) {
      const raw = node.config[field.id]
      if (raw === undefined) continue
      const value = raw
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        problems.push(
          diag('E_CONFIG', `Configuration "${field.id}" on node "${node.nodeId}" exceeds its ${field.maxLength}-character limit.`, {
            nodeId: node.nodeId,
          }),
        )
      }
      const trimmed = value.trim()
      if (field.minLength !== undefined && trimmed.length > 0 && trimmed.length < field.minLength) {
        problems.push(
          diag('E_CONFIG', `Configuration "${field.id}" on node "${node.nodeId}" is shorter than its ${field.minLength}-character minimum.`, {
            nodeId: node.nodeId,
          }),
        )
      }
      if (field.type === 'enum' && field.enumValues && trimmed.length > 0 && !field.enumValues.includes(trimmed)) {
        problems.push(
          diag('E_CONFIG', `Configuration "${field.id}" on node "${node.nodeId}" must be one of the supported values.`, {
            nodeId: node.nodeId,
          }),
        )
      }
      if (field.pattern && trimmed.length > 0 && !pathPatternSafe(field.pattern, trimmed)) {
        problems.push(
          diag('E_CONFIG', `Configuration "${field.id}" on node "${node.nodeId}" is not a safe project-relative file path.`, {
            nodeId: node.nodeId,
          }),
        )
      }
    }
    // input.text: JSON output integrity — when the json port is wired, the
    // jsonValue must be real, bounded JSON (pure parse, deterministic).
    if (contract.execution === 'structural' && node.nodeType === 'input.text') {
      const jsonWired = resolvedEdges.some(
        (e) => e.fromNode.nodeId === node.nodeId && e.fromPort.id === 'json',
      )
      if (jsonWired) {
        const raw = (node.config['jsonValue'] ?? '').trim()
        if (raw.length === 0) {
          problems.push(diag('E_CONFIG', `The JSON input on node "${node.nodeId}" is connected but has no JSON value.`, { nodeId: node.nodeId }))
        } else {
          let ok = true
          try {
            JSON.parse(raw)
          } catch {
            ok = false
          }
          if (!ok) {
            problems.push(diag('E_CONFIG', `The JSON value on node "${node.nodeId}" is not valid JSON text.`, { nodeId: node.nodeId }))
          }
        }
      }
    }
    // Effective values that ride edges must ALSO satisfy the field bounds —
    // oversized edge values are rejected, never silently clipped.
    for (const port of contract.inputs) {
      if (!port.required) continue
      const fieldId = textConfigFieldForPort(contract, port.id)
      const field = fieldId ? contract.config.find((f) => f.id === fieldId) : undefined
      if (!field) continue
      const effective = effectiveText.get(`${node.nodeId}::${port.id}`)
      if (!effective) continue
      if (field.minLength !== undefined && effective.value.trim().length < field.minLength) {
        problems.push(
          diag('E_CONFIG', `The text feeding "${port.id}" on node "${node.nodeId}" is shorter than its ${field.minLength}-character minimum.`, {
            nodeId: node.nodeId,
            portId: port.id,
          }),
        )
      }
    }
  }

  // --- Stage 7: graph, task, dependency and resource bounds ----------------
  const executable = graph.nodes.filter((n) => {
    const c = contractOf(n)
    return c?.execution === 'executable'
  })
  const structural = graph.nodes.filter((n) => {
    const c = contractOf(n)
    return c?.execution === 'structural'
  })
  const gateNodes = executable.filter((n) => n.nodeType === 'quality.verify')
  const tasksAfterGate = executable.length + (gateNodes.length === 0 ? 1 : 0)
  if (tasksAfterGate > MISSION_LIMITS.maxTasks) {
    problems.push(
      diag(
        'E_BOUNDS',
        `This workflow compiles to ${tasksAfterContractCount(executable.length, gateNodes.length)} tasks including the mandatory verification gate; the mission cap is ${MISSION_LIMITS.maxTasks}.`,
      ),
    )
  }

  const incident = new Map<string, number>()
  for (const edge of graph.edges) {
    incident.set(edge.from.nodeId, (incident.get(edge.from.nodeId) ?? 0) + 1)
    incident.set(edge.to.nodeId, (incident.get(edge.to.nodeId) ?? 0) + 1)
  }
  for (const node of graph.nodes) {
    const count = incident.get(node.nodeId) ?? 0
    if (count > WORKFLOW_LIMITS.maxEdgesPerNode) {
      problems.push(
        diag(
          'E_BOUNDS',
          `Node "${node.nodeId}" has ${count} connections; the cap is ${WORKFLOW_LIMITS.maxEdgesPerNode} per node.`,
          { nodeId: node.nodeId },
        ),
      )
    }
  }

  // Artifact producers: the mandatory gate depends on EVERY producer, so a
  // valid workflow has at most the M41 per-task dependency cap of them.
  const artifactProducers = executable.filter((n) => {
    const c = contractOf(n)
    if (!c || c.execution !== 'executable') return false
    return c.outputs.some((p) => (ARTIFACT_PORT_TYPES as readonly string[]).includes(p.type))
  })
  if (artifactProducers.length > MISSION_LIMITS.maxDependenciesPerTask) {
    problems.push(
      diag(
        'E_BOUNDS',
        `This workflow has ${artifactProducers.length} artifact-producing tasks; the verification gate must depend on every one of them and a task is capped at ${MISSION_LIMITS.maxDependenciesPerTask} dependencies.`,
      ),
    )
  }

  // Wall-clock projection: the longest dependency chain (critical path) of
  // normalized execution timeouts must fit the real mission cap. A chain that
  // already exceeds the cap can never finish inside one governed run.
  // Structural nodes weigh nothing (they compile to no task).
  if (!cycle) {
    const gateContract = gateNodes.length > 0 ? contractOf(gateNodes[0]) : null
    const gateTimeout = normalizeLimits(
      gateContract && gateContract.execution === 'executable' ? gateContract.limits : undefined,
    ).executionTimeoutMs
    const timeoutOf = new Map<string, number>()
    for (const node of executable) {
      const c = contractOf(node)
      if (!c || c.execution !== 'executable') continue
      timeoutOf.set(node.nodeId, normalizeLimits(c.limits).executionTimeoutMs)
    }
    const memo = new Map<string, number>()
    const criticalPath = (nodeId: string): number => {
      const cached = memo.get(nodeId)
      if (cached !== undefined) return cached
      memo.set(nodeId, 0) // cycle-guard (graph is acyclic here)
      const deps = adjacency.get(nodeId) ?? []
      let best = 0
      for (const dep of deps) best = Math.max(best, criticalPath(dep))
      const total = best + (timeoutOf.get(nodeId) ?? 0)
      memo.set(nodeId, total)
      return total
    }
    let maxChain = 0
    for (const node of graph.nodes) maxChain = Math.max(maxChain, criticalPath(node.nodeId))
    // Include the auto-appended gate when the user omitted it (it runs after
    // every producer, so it extends the longest producer chain).
    if (gateNodes.length === 0 && artifactProducers.length > 0) {
      maxChain += gateTimeout
    }
    if (maxChain > MISSION_LIMITS.missionTimeoutMs) {
      problems.push(
        diag(
          'E_BOUNDS',
          `The longest chain of task timeouts in this workflow projects to about ${Math.ceil(maxChain / 60_000)} minutes; one governed run is capped at ${MISSION_LIMITS.missionTimeoutMs / 60_000} minutes.`,
        ),
      )
    }
  }

  // --- Stage 8: capability-availability diagnostics (snapshot only) --------
  for (const node of executable) {
    const c = contractOf(node)
    if (!c || c.execution !== 'executable') continue
    if (c.capabilitySurface === 'platform') continue // inline platform lanes
    const state = availability[c.capabilitySurface as StudioCapabilitySurface] ?? 'unknown'
    if (state === 'unavailable' || state === 'not-configured') {
      problems.push(
        diag(
          'E_CAPABILITY_UNAVAILABLE',
          state === 'not-configured'
            ? `"${c.displayName}" is currently not configured on this deployment. Validation still passes structurally, but execution will fail until the backend is configured.`
            : `"${c.displayName}" is currently unavailable on this deployment. Validation still passes structurally, but execution may fail.`,
          { nodeId: node.nodeId, severity: 'warning' },
        ),
      )
    } else if (state === 'degraded') {
      problems.push(
        diag(
          'E_CAPABILITY_UNAVAILABLE',
          `"${c.displayName}" is reporting degraded health right now; execution may fail. Validation is not a guarantee.`,
          { nodeId: node.nodeId, severity: 'warning' },
        ),
      )
    } else if (state === 'rate-limited') {
      problems.push(
        diag(
          'E_CAPABILITY_UNAVAILABLE',
          `"${c.displayName}" is temporarily rate-limited. This is external and transient; the run will retry within its budget or fail honestly.`,
          { nodeId: node.nodeId, severity: 'info' },
        ),
      )
    }
    // 'available' and 'unknown'/absent: no diagnostic. Absence of evidence is
    // not evidence of availability — and validation is never a promise.
  }

  // --- Stage 9: permission and node-status validation ----------------------
  // The platform QUALITY gate is platform-owned: at most ONE definition may
  // exist in a graph (duplicates/conflicts are refused — the compiler would
  // otherwise have to choose between user-defined gates, which it never does).
  if (gateNodes.length > 1) {
    for (const extra of gateNodes.slice(1)) {
      problems.push(
        diag(
          'E_PERMISSION',
          'A workflow can carry at most one verification gate — verification is platform-owned and cannot be defined twice.',
          { nodeId: extra.nodeId },
        ),
      )
    }
  }
  for (const node of graph.nodes) {
    const c = contractOf(node)
    if (!c) continue
    if (c.status !== 'implemented-substrate') {
      problems.push(
        diag('E_PERMISSION', `Node "${c.displayName}" is not an implemented substrate and can never be compiled.`, {
          nodeId: node.nodeId,
        }),
      )
    }
    if (c.trustRequirement !== 'standard-gates') {
      problems.push(
        diag(
          'E_PERMISSION',
          `Node "${c.displayName}" requires a trust contract that does not exist yet; workflows cannot carry it.`,
          { nodeId: node.nodeId },
        ),
      )
    }
  }

  // --- Stage 10: deliverable designation -----------------------------------
  const markers = structural.filter((n) => n.nodeType === 'output.deliverable')
  if (markers.length === 0) {
    problems.push(diag('E_DELIVERABLE', 'Add one Deliverable node and connect exactly one artifact-producing task to it.'))
  } else {
    for (const extra of markers.slice(1)) {
      problems.push(
        diag('E_DELIVERABLE', `A workflow has exactly one Deliverable node; node "${extra.nodeId}" is an extra marker.`, {
          nodeId: extra.nodeId,
        }),
      )
    }
    const marker = markers[0]
    const markerContract = contractOf(marker)
    const fed = resolvedEdges.filter((e) => e.toNode.nodeId === marker.nodeId)
    if (markerContract && markerContract.execution === 'structural') {
      if (fed.length === 0) {
        problems.push(
          diag(
            'E_DELIVERABLE',
            'The Deliverable node is not connected. Connect exactly one artifact-producing task (project, image, video or audio).',
            { nodeId: marker.nodeId },
          ),
        )
      } else if (fed.length > 1) {
        problems.push(
          diag(
            'E_DELIVERABLE',
            `The Deliverable node has ${fed.length} connections; exactly one artifact-producing task must feed it.`,
            { nodeId: marker.nodeId },
          ),
        )
      } else {
        const producer = fed[0]
        if (producer.fromContract.execution !== 'executable' || producer.fromContract.taskKind === 'verify-deliverable') {
          problems.push(
            diag(
              'E_DELIVERABLE',
              'The deliverable must be designated from a real artifact-producing task — never from the verification gate or an input node.',
              { nodeId: marker.nodeId, edgeId: producer.edgeId },
            ),
          )
        }
        if (!(DELIVERABLE_PORT_TYPES as readonly string[]).includes(producer.fromPort.type)) {
          problems.push(
            diag('E_DELIVERABLE', 'Research packs and verification results cannot be designated as deliverables.', {
              nodeId: marker.nodeId,
              portId: producer.fromPort.id,
            }),
          )
        }
      }
    }
  }

  const ordered = problems.slice()
  return { valid: !hasErrors(ordered), diagnostics: ordered }
}

// ---------------------------------------------------------------------------
// Shared pure helpers (used by the compiler too)
// ---------------------------------------------------------------------------

/** The config field id that can satisfy a required text port, when one exists. */
export function textConfigFieldForPort(contract: StudioNodeContract, portId: string): string | null {
  if (contract.execution !== 'executable') return null
  switch (portId) {
    case 'topic':
      return 'topic'
    case 'objective':
    case 'instruction':
      return 'instruction'
    case 'prompt':
      return 'prompt'
    case 'narration':
      return 'text'
    default:
      return null
  }
}

/** The effective text value of an input.text node (its `text` config). */
export function sourceTextValue(node: StudioGraphNode): string | null {
  if (node.nodeType !== 'input.text') return null
  const raw = node.config['text']
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Pattern check with the M41 path-safety rule (no traversal anywhere). */
function pathPatternSafe(pattern: string, value: string): boolean {
  if (value.includes('..')) return false
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

function tasksAfterContractCount(executableCount: number, gateNodes: number): number {
  return executableCount + (gateNodes === 0 ? 1 : 0)
}

/**
 * Deterministic topological order of the graph nodes (Kahn's algorithm with
 * insertion-order tie-breaks — the same stability rule as the M41 kernel's
 * topologicalOrder). Returns null when a cycle exists.
 */
export function graphTopologicalOrder(graph: StudioWorkflowGraph): string[] | null {
  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const n of graph.nodes) indegree.set(n.nodeId, 0)
  for (const e of graph.edges) {
    if (!indegree.has(e.from.nodeId) || !indegree.has(e.to.nodeId)) continue
    indegree.set(e.to.nodeId, (indegree.get(e.to.nodeId) ?? 0) + 1)
    const list = dependents.get(e.from.nodeId) ?? []
    list.push(e.to.nodeId)
    dependents.set(e.from.nodeId, list)
  }
  const order: string[] = []
  const queue = graph.nodes.filter((n) => (indegree.get(n.nodeId) ?? 0) === 0).map((n) => n.nodeId)
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    for (const dep of dependents.get(id) ?? []) {
      const d = (indegree.get(dep) ?? 1) - 1
      indegree.set(dep, d)
      if (d === 0) queue.push(dep)
    }
  }
  return order.length === graph.nodes.length ? order : null
}

/** Iterative three-color cycle finder (M41 kernel semantics). Returns the
 *  involved node ids in cycle order, or null. */
function findCycle(nodeIds: readonly string[], adjacency: ReadonlyMap<string, string[]>): string[] | null {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const id of nodeIds) color.set(id, WHITE)
  const pathStack: string[] = []
  for (const root of nodeIds) {
    if (color.get(root) !== WHITE) continue
    const stack: Array<{ id: string; i: number }> = [{ id: root, i: 0 }]
    color.set(root, GRAY)
    pathStack.length = 0
    pathStack.push(root)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      const deps = adjacency.get(top.id) ?? []
      if (top.i >= deps.length) {
        color.set(top.id, BLACK)
        stack.pop()
        pathStack.pop()
        continue
      }
      const dep = deps[top.i++]
      const c = color.get(dep) ?? WHITE
      if (c === GRAY) {
        // Found a cycle: slice the path from the first occurrence of dep.
        const start = pathStack.indexOf(dep)
        return pathStack.slice(start === -1 ? 0 : start).concat(dep)
      }
      if (c === WHITE) {
        color.set(dep, GRAY)
        stack.push({ id: dep, i: 0 })
        pathStack.push(dep)
      }
    }
  }
  return null
}
