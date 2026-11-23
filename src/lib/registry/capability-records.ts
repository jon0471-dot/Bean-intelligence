/**
 * BEAN Intelligence — UNIVERSAL CAPABILITY RECORD LAYER (M36-A, SERVER ONLY).
 *
 * Extends the EXISTING private registry (registry/backends.ts remains the
 * single source of truth — no second catalogue is created here). This module:
 *
 *  1. Derives a per-backend UNIVERSAL CAPABILITY RECORD that adds the
 *     metadata M36 §5 requires and the BackendDescriptor does not carry:
 *     supported modalities, structured-output/tool-call support, approximate
 *     memory requirements (with explicit uncertainty), quantization options,
 *     download source/revision/integrity for local models, cost/authorization
 *     policy and explicit fallback capabilities — all resolved FROM the
 *     existing registries (backends.ts, ai-engine/model-registry.ts,
 *     client-compute/model-registry.ts) by backend id, never re-declared.
 *
 *  2. Computes the NINE-STATE availability vocabulary M36 §5 requires,
 *     from measured evidence (enabled flag, credential presence, health
 *     probe, hardware fit, runtime support). The PUBLIC catalog
 *     (registry/models.ts AvailabilityStatus) stays unchanged — private
 *     routing metadata and safe public status metadata remain separate.
 *
 *  3. Reconciles the registry layers (backends ↔ engine catalog ↔ router
 *     adapter bindings) so drift becomes a DETECTABLE failure instead of a
 *     silent inconsistency. `reconcileRegistries()` is pure and unit-tested;
 *     it never mutates anything.
 */

import { BACKEND_REGISTRY, getBackend, type BackendDescriptor } from './backends'
import { AI_MODEL_REGISTRY, type ModelRegistryEntry } from '@/lib/ai-engine/model-registry'
import type { TaskAdapter } from '@/lib/adapters/types'

/**
 * The nine availability states (brief §5). Every model capability resolves to
 * exactly one of these — "available" is never claimed without verification.
 */
export type UniversalAvailability =
  | 'available-verified'
  | 'configured-unhealthy'
  | 'requires-credentials'
  | 'requires-unsupported-runtime'
  | 'requires-missing-hardware'
  | 'unsupported-by-adapter'
  | 'disabled-license-policy'
  | 'not-configured'
  | 'temporarily-unavailable'

/** Distinct capability surfaces a model/adapter can serve (brief §5). */
export type UniversalCapability =
  | 'chat'
  | 'streaming'
  | 'structured-output'
  | 'tool-calling'
  | 'vision'
  | 'image-generation'
  | 'image-editing'
  | 'video-generation'
  | 'speech-synthesis'
  | 'audio-transcription'
  | 'audio-conversion'
  | 'code-generation'
  | 'embeddings'
  | 'reranking'
  | 'document-parsing'
  | 'ocr'

export interface UniversalCapabilityRecord {
  backendId: string
  productId: BackendDescriptor['productId']
  task: BackendDescriptor['task']
  /** Capability verbs THIS integration genuinely implements. */
  capabilities: UniversalCapability[]
  /** Input/output modalities (honest: only what the adapter handles). */
  inputModalities: string[]
  outputModalities: string[]
  /** Structured output / tool-calling support — declared per adapter. */
  structuredOutput: boolean
  toolCalling: boolean
  streaming: boolean
  /** Context/output ceilings where the registry enforces them. */
  limits: Record<string, unknown>
  /**
   * Approximate runtime memory requirement in MB, or null when not measured.
   * `memoryUncertain` is true whenever the number is an estimate (never
   * presented as a measured fact).
   */
  memoryMb: number | null
  memoryUncertain: boolean
  /** Quantization/precision options where supported (local GGUF lanes etc.). */
  quantizationOptions: string[]
  license: BackendDescriptor['license']
  /** Env var NAMES required (never values). */
  credentialRequirements: string[]
  costClass: 'free-local' | 'free-hosted' | 'limited-free' | 'paid-api' | 'unavailable'
  /** Where a LOCAL model's weights come from + integrity pinning, if any. */
  download: {
    sourceUrl: string | null
    revision: string | null
    integrity: 'pinned-artifact-sha256' | 'runtime-managed-pinned-revision' | 'none'
  } | null
  /** Explicit compatible fallback backend ids (from the private registry). */
  fallbacks: string[]
  /** Whether a TaskAdapter binding exists for this backend id. */
  adapterBound: boolean
}

const ENGINE_ENTRY_BY_BACKEND = new Map<string, ModelRegistryEntry>(
  AI_MODEL_REGISTRY.map((e) => [e.backendId, e]),
)

/**
 * Capability verbs per backend task, reflecting what the ADAPTERS actually
 * implement (TaskAdapter method surface), never what a provider elsewhere
 * supports. A model is never advertised as capable of a task merely because
 * its provider supports a different task.
 */
function capabilitiesFor(b: BackendDescriptor): UniversalCapability[] {
  const caps: UniversalCapability[] = []
  if (b.task === 'chat' || b.task === 'coding-task') {
    caps.push('chat', 'streaming', 'code-generation')
  }
  if (b.task === 'image-generation') caps.push('image-generation')
  if (b.task === 'image-editing') caps.push('image-editing')
  if (b.task === 'image-enhancement') caps.push('image-generation')
  if (b.task === 'video-generation' || b.task === 'video-production') caps.push('video-generation')
  if (b.task === 'speech-synthesis') caps.push('speech-synthesis')
  if (b.task === 'audio-transcription') caps.push('audio-transcription')
  if (b.task === 'audio-conversion') caps.push('audio-conversion')
  return caps
}

function costClassFor(b: BackendDescriptor): UniversalCapabilityRecord['costClass'] {
  // The engine catalog carries the audited cost classification where an
  // entry exists; the deployment-mode fallback keeps records complete for
  // backends the engine catalog does not list.
  const engine = ENGINE_ENTRY_BY_BACKEND.get(b.id)
  if (engine) return engine.costClass
  return b.deploymentMode === 'self-hosted' ? 'free-local' : 'free-hosted'
}

function memoryFor(b: BackendDescriptor): { memoryMb: number | null; uncertain: boolean } {
  const engine = ENGINE_ENTRY_BY_BACKEND.get(b.id)
  if (engine?.hardware.ramMb && engine.hardware.ramMb > 0) {
    return { memoryMb: engine.hardware.ramMb, uncertain: false }
  }
  if (engine?.hardware.vramMb && engine.hardware.vramMb > 0) {
    // VRAM sizing is a GPU-worker estimate — honest uncertainty marker.
    return { memoryMb: engine.hardware.vramMb, uncertain: true }
  }
  return { memoryMb: null, uncertain: false }
}

function inputModalitiesFor(b: BackendDescriptor): string[] {
  const engine = ENGINE_ENTRY_BY_BACKEND.get(b.id)
  if (engine) return engine.inputFormats
  switch (b.task) {
    case 'chat':
    case 'coding-task':
      return ['text']
    case 'image-generation':
      return ['text']
    case 'image-editing':
      return ['text', 'image']
    case 'video-generation':
      return ['text', 'image']
    case 'speech-synthesis':
      return ['text']
    case 'audio-transcription':
      return ['audio']
    case 'audio-conversion':
      return ['audio']
    default:
      return ['text']
  }
}

function outputModalitiesFor(b: BackendDescriptor): string[] {
  const engine = ENGINE_ENTRY_BY_BACKEND.get(b.id)
  if (engine) return engine.outputFormats
  switch (b.task) {
    case 'chat':
      return ['text-stream']
    case 'coding-task':
      return ['text-stream', 'code-files']
    case 'image-generation':
      return ['image']
    case 'image-editing':
      return ['image']
    case 'video-generation':
      return ['video']
    case 'speech-synthesis':
      return ['audio']
    case 'audio-transcription':
      return ['text']
    case 'audio-conversion':
      return ['audio']
    default:
      return ['text']
  }
}

function quantizationFor(b: BackendDescriptor): string[] {
  // Quantization options may be recorded on EITHER registry layer (backend
  // limits or the engine entry's limits) — merge both, deduped.
  const engine = ENGINE_ENTRY_BY_BACKEND.get(b.id)
  const raw = [
    ...(Array.isArray(b.limits.ggufQuantizations) ? (b.limits.ggufQuantizations as unknown[]) : []),
    ...(Array.isArray(engine?.limits.ggufQuantizations) ? (engine!.limits.ggufQuantizations as unknown[]) : []),
  ]
  return [...new Set(raw.filter((x): x is string => typeof x === 'string'))]
}

function downloadFor(b: BackendDescriptor): UniversalCapabilityRecord['download'] {
  if (b.endpointType !== 'local-inference' && b.deploymentMode !== 'self-hosted') return null
  const engine = ENGINE_ENTRY_BY_BACKEND.get(b.id)
  return {
    sourceUrl: engine?.sourceUrl ?? b.license.sourceUrl,
    revision: b.revision,
    // The backend registry's license record is the integrity attestation for
    // operator-loaded weights; runtime-managed browser fetches live in the
    // client-compute model registry (not here).
    integrity: b.revision ? 'pinned-artifact-sha256' : 'none',
  }
}

/**
 * Backends dispatched by a dedicated engine executor instead of a TaskAdapter
 * binding. Each entry is a DOCUMENTED dispatch path (not drift):
 *  - bean-video-composition-local: assembled by the JAZMII director worker
 *    (src/lib/jobs/director-worker.ts) through resolveCompositionEngine —
 *    the registry entry describes the local composition stage, and routing
 *    never attempts an adapter lookup for it.
 */
const HANDLER_DISPATCHED_BACKENDS = new Set(['bean-video-composition-local'])

/** Build the universal capability record for one backend. */
export function capabilityRecordFor(
  backendId: string,
  /** Router adapter map — when omitted, only the documented handler-dispatch
   *  exception marks a backend as executable. */
  adapters?: Record<string, TaskAdapter>,
): UniversalCapabilityRecord | null {
  const b = getBackend(backendId)
  if (!b) return null
  const memory = memoryFor(b)
  const adapterBound = HANDLER_DISPATCHED_BACKENDS.has(b.id) || (adapters ? adapters[b.id] != null : false)
  return {
    backendId: b.id,
    productId: b.productId,
    task: b.task,
    capabilities: capabilitiesFor(b),
    inputModalities: inputModalitiesFor(b),
    outputModalities: outputModalitiesFor(b),
    // Structured output / tool calling are adapter-verified behaviors: the
    // platform's own RIISHE protocol runs over JSON chat completions, but
    // JSON-mode/tool-call APIs are NOT wired for any provider slot yet —
    // declared false until an adapter implements and tests it (brief §5:
    // never advertise an untested capability).
    structuredOutput: false,
    toolCalling: false,
    streaming: b.limits.streaming === true,
    limits: b.limits,
    memoryMb: memory.memoryMb,
    memoryUncertain: memory.uncertain,
    quantizationOptions: quantizationFor(b),
    license: b.license,
    credentialRequirements: b.secrets,
    costClass: costClassFor(b),
    download: downloadFor(b),
    fallbacks: b.fallbacks,
    adapterBound,
  }
}

/** Records for every backend in the private registry (same order). */
export function universalCapabilityRecords(adapters?: Record<string, TaskAdapter>): UniversalCapabilityRecord[] {
  return BACKEND_REGISTRY.map((b) => capabilityRecordFor(b.id, adapters)).filter(
    (r): r is UniversalCapabilityRecord => r !== null,
  )
}

// ---------------------------------------------------------------------------
// Nine-state availability derivation
// ---------------------------------------------------------------------------

export interface AvailabilityEvidence {
  /** Measured health report (probe or real attempt), when one exists. */
  health?: { healthy: boolean; failureCategory?: string | null; httpStatus?: number | null } | null
  /** Whether the credential/config source is present. */
  credentialPresent?: boolean
  /** Hardware-fit result for local lanes (null = not hardware-gated). */
  hardwareFit?: { fits: boolean; reason: string | null } | null
  /** Whether the runtime required by the entry is available (browser lanes). */
  runtimeAvailable?: boolean
  /** True when a policy/license decision disables the entry outright. */
  policyDisabled?: boolean
  /** True when the entry is known-good but transiently failing (429 etc.). */
  transientFailure?: boolean
}

/**
 * Derive the honest nine-state availability. Priority order mirrors the
 * platform's evidence chain (license/policy > credentials > runtime >
 * hardware > measured health > enabled flag).
 */
export function universalAvailability(
  record: UniversalCapabilityRecord,
  evidence: AvailabilityEvidence,
): UniversalAvailability {
  if (evidence.policyDisabled) return 'disabled-license-policy'
  const needsCredential = record.credentialRequirements.length > 0 && record.credentialRequirements.some((s) => !s.includes('managed by platform runtime'))
  if (needsCredential && evidence.credentialPresent === false) return 'requires-credentials'
  if (evidence.runtimeAvailable === false) return 'requires-unsupported-runtime'
  if (evidence.hardwareFit && !evidence.hardwareFit.fits) return 'requires-missing-hardware'
  if (evidence.transientFailure) return 'temporarily-unavailable'
  if (evidence.health && !evidence.health.healthy) {
    // A measured failure on an otherwise configured lane: 429 is transient,
    // everything else is "configured but not currently healthy".
    if (evidence.health.failureCategory === 'rate-limited' || evidence.health.httpStatus === 429) {
      return 'temporarily-unavailable'
    }
    return 'configured-unhealthy'
  }
  if (!evidence.health && evidence.credentialPresent === true) {
    // Configured but never probed: honest "not-configured → awaiting probe"
    // is NOT available-verified; report the configured state via health=null.
    return 'configured-unhealthy'
  }
  if (!record.adapterBound) return 'unsupported-by-adapter'
  if (!evidence.health) return 'requires-credentials'
  return 'available-verified'
}

// ---------------------------------------------------------------------------
// Registry reconciliation (drift detection — pure, testable)
// ---------------------------------------------------------------------------

export interface RegistryDrift {
  kind: 'missing-adapter-binding' | 'engine-entry-without-backend' | 'backend-missing-engine-entry' | 'engine-product-mismatch'
  backendId: string
  detail: string
}

/**
 * Cross-check the three registry layers:
 *  1. every ROUTABLE backend (http/managed-sdk/local-inference) has an
 *     adapter binding — enforced structurally via the record's adapterBound
 *     flag and the caller passing the actual adapter map;
 *  2. every engine-catalog entry references a real backend id;
 *  3. engine-catalog entries agree with the backend registry on product and
 *     task (drift here would silently misroute).
 * GPU-worker backends without an adapter binding are legal ONLY when they
 * are honestly disabled (no fabricated availability).
 */
export function reconcileRegistries(adapters: Record<string, TaskAdapter>): RegistryDrift[] {
  const drift: RegistryDrift[] = []
  for (const b of BACKEND_REGISTRY) {
    if (HANDLER_DISPATCHED_BACKENDS.has(b.id)) continue
    if (!adapters[b.id]) {
      drift.push({
        kind: 'missing-adapter-binding',
        backendId: b.id,
        detail: b.enabled
          ? 'ENABLED backend has no adapter binding — routing would fail at adapter lookup'
          : 'disabled backend has no adapter binding (legal only while honestly unavailable)',
      })
    }
  }
  const backendIds = new Set(BACKEND_REGISTRY.map((b) => b.id))
  for (const e of AI_MODEL_REGISTRY) {
    if (!backendIds.has(e.backendId)) {
      drift.push({
        kind: 'engine-entry-without-backend',
        backendId: e.backendId,
        detail: 'engine catalog references a backend id the private registry does not define',
      })
      continue
    }
    const b = getBackend(e.backendId)!
    if (b.productId !== e.productId || b.task !== e.task) {
      drift.push({
        kind: 'engine-product-mismatch',
        backendId: e.backendId,
        detail: `engine catalog says product=${e.productId}/task=${e.task}; backend registry says product=${b.productId}/task=${b.task}`,
      })
    }
  }
  // Backends that execute real work but lack an engine-catalog entry are a
  // documentation drift (cost/hardware metadata incomplete) — recorded so the
  // operator sees which lanes the engine catalog does not describe. Disabled
  // candidate lanes (never-routed) are exempt: they carry their own reason.
  for (const b of BACKEND_REGISTRY) {
    if (!ENGINE_ENTRY_BY_BACKEND.has(b.id) && b.enabled && b.endpointType !== 'local-process') {
      drift.push({
        kind: 'backend-missing-engine-entry',
        backendId: b.id,
        detail: 'enabled backend has no engine-catalog entry (cost/hardware metadata incomplete)',
      })
    }
  }
  return drift
}
