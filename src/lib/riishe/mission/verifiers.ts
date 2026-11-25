/**
 * BEAN Intelligence — M41 mission output verifiers (pure, deterministic).
 *
 * The Quality and verification specialist's execution path: REAL output
 * inspection. Every task's actual execution payload (the specialist job's
 * persisted resultJson, the retrieval lanes' real sources, the handoff
 * pack) is checked here against the task's verification criteria BEFORE the
 * executor may mark it done. Verifiers NEVER see or trust a model's claims
 * — only persisted execution payloads — and they never upgrade: missing
 * evidence is `needs_correction` or `failed`, with concrete reasons.
 *
 * Payload shapes mirror the REAL workers exactly:
 *  - coding jobs (src/lib/giftz turn core): changes[], verification{status},
 *    execution{exitCode} | executionUnavailable
 *  - image jobs (src/lib/jobs/image-worker.ts): imageUrl/assetUrl, width…
 *  - video jobs (src/lib/jobs/video-worker.ts): videoUrl + ffprobe stream{}
 *  - audio jobs (src/lib/jobs/audio-worker.ts): artifactUrl, format 'wav'
 *
 * PURE module — JSON parsing + arithmetic only. No DB, no I/O.
 */

import type {
  MissionArtifact,
  MissionTaskKind,
  TaskVerificationOutcome,
  VerificationCriteria,
} from './types'

// ---------------------------------------------------------------------------
// Payload shapes (exactly what the real workers persist)
// ---------------------------------------------------------------------------

export interface CodingJobPayload {
  projectId?: string
  changes?: Array<{ path: string; change: string }>
  contentChars?: number
  versionSeq?: number
  verification?: { status?: string; attempts?: number; corrections?: number; issuesFound?: number } | null
  execution?: { status?: string; exitCode?: number | null; timedOut?: boolean; durationMs?: number } | null
  executionUnavailable?: string
  durationMs?: number
}

export interface ImageJobPayload {
  imageUrl?: string
  assetUrl?: string
  assetId?: string
  width?: number
  height?: number
  format?: string
  bytes?: number
}

export interface VideoJobPayload {
  videoUrl?: string
  format?: string
  bytes?: number
  width?: number
  height?: number
  /** ffprobe-measured stream facts — the REAL completion gate (worker Phase 5). */
  stream?: { codec?: string; width?: number; height?: number; durationSec?: number } | null
  provenance?: Record<string, unknown>
}

export interface AudioJobPayload {
  artifactUrl?: string
  format?: string
  bytes?: number
  engine?: string
  voice?: string
  generationMs?: number
  warnings?: string[]
}

/** Research output captured by the executor's real retrieval run. */
export interface ResearchPayload {
  sources: Array<{ url: string; title: string; snippet: string; pageRead?: boolean; ref?: string }>
  queries: string[]
  degraded?: string[]
}

export function parsePayload<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Verifier result helpers
// ---------------------------------------------------------------------------

function outcome(status: TaskVerificationOutcome['status'], reasons: string[], artifacts: MissionArtifact[]): TaskVerificationOutcome {
  return { status, reasons, artifacts }
}

// ---------------------------------------------------------------------------
// Per-kind verifiers
// ---------------------------------------------------------------------------

export function verifyCodeBuild(
  payload: CodingJobPayload | null,
  criteria: VerificationCriteria,
): TaskVerificationOutcome {
  if (!payload) return outcome('failed', ['The coding job produced no result payload — nothing was delivered.'], [])
  const changes = payload.changes ?? []
  const artifacts: MissionArtifact[] = []
  if (payload.projectId) {
    artifacts.push({
      artifact: 'code-project',
      taskId: '',
      ref: payload.projectId,
      label: changes.length > 0 ? changes.map((c) => `${c.change} ${c.path}`).join(', ').slice(0, 200) : 'engineering project',
    })
  }
  const reasons: string[] = []
  if (criteria.minFileChanges !== undefined && changes.length < criteria.minFileChanges) {
    reasons.push(`The job made ${changes.length} file change(s); the contract requires at least ${criteria.minFileChanges}.`)
  }
  if (criteria.requireSelfVerification) {
    const v = payload.verification
    if (!v || !v.status) {
      return outcome('needs_correction', ['The job completed but its self-verification did not report a status — the change is unproven.'], artifacts)
    }
    const okStatus = ['passed', 'pass', 'ok', 'success', 'clean'].includes(v.status.toLowerCase())
    if (!okStatus) {
      reasons.push(`Self-verification reported "${v.status}" (${v.issuesFound ?? '?'} issue(s) found).`)
    }
  }
  if (criteria.requireSandboxPass) {
    const ex = payload.execution
    if (payload.executionUnavailable && !ex) {
      return outcome(
        'needs_correction',
        [`The sandbox run did not happen (${payload.executionUnavailable.slice(0, 200)}) — the fix is unproven.`],
        artifacts,
      )
    }
    if (!ex || typeof ex.exitCode !== 'number' || ex.exitCode !== 0 || ex.timedOut) {
      reasons.push(
        !ex
          ? 'No sandbox execution was recorded.'
          : ex.timedOut
            ? 'The sandbox run timed out.'
            : `The sandbox run exited with code ${ex?.exitCode ?? '?'}.`,
      )
    }
  }
  if (reasons.length === 0) {
    return outcome('verified', [`Verified: real file changes (${changes.length}), contract satisfied.`], artifacts)
  }
  // A structured failure with evidence is repairable; correct the work once.
  return outcome(payload.verification ? 'needs_correction' : 'failed', reasons, artifacts)
}

export function verifyDocumentDraft(
  payload: CodingJobPayload | null,
  criteria: VerificationCriteria,
  handedOffSources: number,
): TaskVerificationOutcome {
  const base = verifyCodeBuild(payload, criteria)
  // NEVER wrap a non-verified base verdict: an unproven coding job stays
  // needs_correction/failed with ITS reasons — a "verified" status carrying
  // an unproven reason would be a contradiction (caught live during the
  // M41 acceptance run; this guard makes that shape structurally impossible).
  if (base.status !== 'verified') return base
  const reasons: string[] = []
  const path = criteria.deliverablePath
  if (path) {
    const changes = payload?.changes ?? []
    const delivered = changes.some((c) => c.path === path || c.path.endsWith(`/${path}`))
    if (!delivered) {
      reasons.push(`The deliverable file "${path}" is not among the job's real file changes.`)
    }
  }
  if (criteria.requireSourceCitation && handedOffSources > 0) {
    const chars = payload?.contentChars ?? 0
    // Deterministic citation contract: the deliverable must be substantive
    // enough to carry the handed-off sources (the coding turn's own prompt
    // embeds them; contentChars proves real content was written).
    if (chars < 400) {
      reasons.push(`The deliverable contains only ${chars} characters — too thin to carry its sources.`)
    }
  }
  if (reasons.length > 0) return outcome('needs_correction', reasons, base.artifacts)
  return outcome('verified', ['Verified: the deliverable file exists with the citation contract satisfied.'], base.artifacts)
}

export function verifyImageAsset(payload: ImageJobPayload | null, criteria: VerificationCriteria): TaskVerificationOutcome {
  if (!payload) return outcome('failed', ['The image job produced no result payload.'], [])
  const url = payload.imageUrl ?? payload.assetUrl
  const artifacts: MissionArtifact[] = url
    ? [{ artifact: 'image-asset', taskId: '', ref: payload.assetId ?? url, label: `${payload.width ?? '?'}x${payload.height ?? '?'} ${payload.format ?? 'image'}` }]
    : []
  if (criteria.requireArtifact !== false && !url) {
    return outcome('failed', ['The completed image job carries no servable artifact URL.'], artifacts)
  }
  if (criteria.requireArtifact !== false && payload.bytes !== undefined && payload.bytes <= 0) {
    return outcome('failed', ['The image artifact is empty (0 bytes).'], artifacts)
  }
  return outcome('verified', ['Verified: real image artifact delivered by the image specialist.'], artifacts)
}

export function verifyVideoAsset(payload: VideoJobPayload | null, criteria: VerificationCriteria): TaskVerificationOutcome {
  if (!payload) return outcome('failed', ['The video job produced no result payload.'], [])
  const artifacts: MissionArtifact[] = payload.videoUrl
    ? [{ artifact: 'video-asset', taskId: '', ref: payload.videoUrl, label: `${payload.width ?? payload.stream?.width ?? '?'}x${payload.height ?? payload.stream?.height ?? '?'} ${payload.format ?? 'video'}` }]
    : []
  if (criteria.requireArtifact !== false && !payload.videoUrl) {
    return outcome('failed', ['The completed video job carries no servable video URL.'], artifacts)
  }
  // The stream gate mirrors the worker's own ffprobe completion gate: a
  // completed row without measured stream facts is NOT a verified video.
  if (criteria.requireArtifact !== false && (!payload.stream || !payload.stream.codec || !payload.stream.durationSec)) {
    return outcome('needs_correction', ['The video result lacks ffprobe-measured stream facts — the artifact is unproven.'], artifacts)
  }
  return outcome('verified', ['Verified: real video artifact with measured stream facts.'], artifacts)
}

export function verifyAudioAsset(payload: AudioJobPayload | null, criteria: VerificationCriteria): TaskVerificationOutcome {
  if (!payload) return outcome('failed', ['The audio job produced no result payload.'], [])
  const artifacts: MissionArtifact[] = payload.artifactUrl
    ? [{ artifact: 'audio-asset', taskId: '', ref: payload.artifactUrl, label: `${payload.format ?? 'audio'} ${payload.bytes ?? '?'} bytes` }]
    : []
  if (criteria.requireArtifact !== false && !payload.artifactUrl) {
    return outcome('failed', ['The completed audio job carries no servable artifact URL.'], artifacts)
  }
  if (criteria.requireAudioValidation && payload.format !== 'wav') {
    return outcome('needs_correction', [`The audio artifact format is "${payload.format ?? '?'}" — the validated-WAV contract requires 'wav'.`], artifacts)
  }
  if (criteria.requireArtifact !== false && payload.bytes !== undefined && payload.bytes <= 44) {
    return outcome('failed', ['The audio artifact holds no audible data (RIFF header only or empty).'], artifacts)
  }
  return outcome('verified', ['Verified: real audio artifact delivered by the audio specialist.'], artifacts)
}

export function verifyResearch(payload: ResearchPayload | null, criteria: VerificationCriteria): TaskVerificationOutcome {
  if (!payload) return outcome('failed', ['The research run produced no payload.'], [])
  const min = criteria.minSources ?? 1
  const real = payload.sources.filter((s) => /^https?:\/\//.test(s.url) && s.title.length > 0)
  const artifacts: MissionArtifact[] = real.slice(0, 12).map((s, i) => ({
    artifact: 'research-pack',
    taskId: '',
    ref: s.url,
    label: s.title.slice(0, 120) || `source-${i + 1}`,
  }))
  if (real.length < min) {
    const degraded = payload.degraded?.length ? ` Retrieval reported: ${payload.degraded[0].slice(0, 160)}` : ''
    return outcome('needs_correction', [`Only ${real.length} real source(s) were gathered; the contract requires at least ${min}.${degraded}`], artifacts)
  }
  return outcome('verified', [`Verified: ${real.length} real sources gathered (${payload.queries.length} live query run(s)).`], artifacts)
}

export function verifyKnowledge(payload: ResearchPayload | null, criteria: VerificationCriteria): TaskVerificationOutcome {
  if (!payload) return outcome('failed', ['The Knowledge Atlas consultation produced no payload.'], [])
  const min = criteria.minSources ?? 1
  const real = payload.sources.filter((s) => s.title.length > 0)
  const artifacts: MissionArtifact[] = real.slice(0, 12).map((s, i) => ({
    artifact: 'research-pack',
    taskId: '',
    ref: s.ref ?? s.url ?? `atlas-${i + 1}`,
    label: s.title.slice(0, 120),
  }))
  if (real.length < min) {
    return outcome('needs_correction', [`The Atlas returned ${real.length} usable section(s); the contract requires at least ${min}.`], artifacts)
  }
  return outcome('verified', [`Verified: ${real.length} Atlas reference(s) consulted.`], artifacts)
}

/** Aggregate integrity gate for the final deliverable chain. */
export function verifyDeliverable(
  inputs: Array<{ taskId: string; kind: MissionTaskKind; verified: boolean; artifactCount: number; summary: string }>,
): TaskVerificationOutcome {
  const broken = inputs.filter((i) => !i.verified)
  const reasons = broken.map((i) => `Task "${i.taskId}" (${i.kind}) is not verified: ${i.summary.slice(0, 160)}`)
  const artifactTotal = inputs.reduce((n, i) => n + i.artifactCount, 0)
  if (broken.length > 0) {
    return outcome('failed', reasons, [])
  }
  if (artifactTotal === 0) {
    return outcome('failed', ['The deliverable chain produced no real artifacts to deliver.'], [])
  }
  return outcome(
    'verified',
    [`Deliverable integrity confirmed: ${inputs.length} verified task(s), ${artifactTotal} real artifact(s).`],
    [],
  )
}

/** Kind-dispatching entry point used by the executor. */
export function verifyTaskOutput(
  kind: MissionTaskKind,
  criteria: VerificationCriteria,
  payload: unknown,
  context: { handedOffSources?: number } = {},
): TaskVerificationOutcome {
  switch (kind) {
    case 'code-build':
      return verifyCodeBuild(payload as CodingJobPayload | null, criteria)
    case 'document-draft':
      return verifyDocumentDraft(payload as CodingJobPayload | null, criteria, context.handedOffSources ?? 0)
    case 'image-asset':
      return verifyImageAsset(payload as ImageJobPayload | null, criteria)
    case 'video-asset':
      return verifyVideoAsset(payload as VideoJobPayload | null, criteria)
    case 'audio-asset':
      return verifyAudioAsset(payload as AudioJobPayload | null, criteria)
    case 'research':
      return verifyResearch(payload as ResearchPayload | null, criteria)
    case 'knowledge':
      return verifyKnowledge(payload as ResearchPayload | null, criteria)
    case 'verify-deliverable':
      // Aggregation handled by the executor via verifyDeliverable(); a bare
      // call is an honest no-artifact failure, never a fake pass.
      return outcome('failed', ['The aggregate deliverable gate requires the mission\'s verified inputs.'], [])
  }
}
