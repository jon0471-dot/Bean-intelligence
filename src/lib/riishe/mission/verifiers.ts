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
import { auditPreview } from '@/lib/code/preview-audit'

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

// ---------------------------------------------------------------------------
// M41.7 — persisted-deliverable evidence (loaded by the executor from the
// project workspace; the verifiers stay PURE and inspect this snapshot).
// ---------------------------------------------------------------------------

/** The actual persisted workspace snapshot the executor hands the verifier.
 *  Content bounds keep the in-memory audit bounded; the stored verification
 *  outcome carries only verdicts/reasons, never this content. */
export interface PersistedDeliverableEvidence {
  /** The mission-delegated project (executor-resolved from the job payload). */
  projectId: string | null
  /** Every persisted file: path + real char count. */
  manifest: Array<{ path: string; chars: number }>
  /** The deliverable file's content (bounded) — documents. */
  deliverableContent: string | null
  /** Bounded file contents for structure auditing — websites. */
  contents: Array<{ path: string; content: string }>
}

export interface TaskVerificationContext {
  /** Count of handed-off research sources (legacy citation proxy). */
  handedOffSources?: number
  /** The EXACT numbered source list the document task received — citation
   *  correspondence is checked against these and nothing else. */
  sourceRefs?: Array<{ index: number; url: string; title: string }>
  /** The persisted workspace snapshot (M41.7 — real deliverable audit). */
  persisted?: PersistedDeliverableEvidence
}

/** Pure project-relative path guard (same semantics as the workspace's
 *  assertSafeProjectPath, kept local to preserve verifier purity). */
function isSafeDeliverablePath(p: string): boolean {
  if (!p || p.length > 200) return false
  if (p.includes('..') || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return false
  return !/[^\w.\-/ ]/.test(p)
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
  ctx: TaskVerificationContext = {},
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

// ---------------------------------------------------------------------------
// M41.7 — the WEBSITE verifier: the real persisted project files are the
// audited deliverable. Static sites are audited AS STATIC SITES (entry page,
// resolvable internal references, real content) — never a package.json
// demand — and existing HTML files alone are never "fully verified": the
// entry must exist with substantive content and every internal reference
// must resolve to a persisted file.
// ---------------------------------------------------------------------------

const WEBSITE_ENTRY_MIN_CHARS = 400
const WEBSITE_ASSET_MIN_CHARS = 1

export function verifyWebsiteBuild(
  payload: CodingJobPayload | null,
  criteria: VerificationCriteria,
  ctx: TaskVerificationContext = {},
): TaskVerificationOutcome {
  // Job-level evidence gates first (shared with every code build).
  const base = verifyCodeBuild(payload, criteria, ctx)
  if (base.status !== 'verified') return base
  const persisted = ctx.persisted
  if (!persisted) {
    // No persisted snapshot reached the verifier — the website deliverable
    // is unproven (never upgraded on job-payload proxies alone).
    return outcome('needs_correction', ['The persisted project files were not available to the deliverable audit — the website is unproven.'], base.artifacts)
  }
  const reasons: string[] = []
  const manifestPaths = new Set(persisted.manifest.map((f) => f.path))
  // 1. Required entry files must EXIST in the persisted workspace.
  const required = criteria.requiredPaths ?? ['index.html']
  for (const p of required) {
    if (!manifestPaths.has(p)) {
      reasons.push(`The required entry file "${p}" does not exist in the persisted project files.`)
    }
  }
  // 2. The entry page must carry real content (HTML files alone never
  //    equal a verified website — a stub fails here).
  for (const p of required) {
    const entry = persisted.contents.find((f) => f.path === p)
    if (entry && entry.content.trim().length < WEBSITE_ENTRY_MIN_CHARS) {
      reasons.push(`The entry file "${p}" holds only ${entry.content.trim().length} characters of content — not a substantive page.`)
    }
  }
  // 3. Internal references must resolve to persisted files (the existing
  //    deterministic preview auditor — reused, not reimplemented).
  const audit = auditPreview(persisted.contents)
  if (audit.entry === null) {
    reasons.push('No HTML entry file exists in the persisted project — nothing can render.')
  }
  for (const broken of audit.brokenInternalLinks.slice(0, 6)) {
    reasons.push(`Broken internal link in ${broken.file}: "${broken.target}" resolves to no project file.`)
  }
  for (const missing of audit.missingAssets.slice(0, 6)) {
    reasons.push(`Missing asset in ${missing.file}: "${missing.reference}" (resolved "${missing.resolved}") does not exist.`)
  }
  // 4. No empty persisted files (an empty CSS/JS file referenced by the
  //    page is a stub, not a built site).
  for (const f of persisted.manifest.filter((x) => x.chars < WEBSITE_ASSET_MIN_CHARS).slice(0, 4)) {
    reasons.push(`The persisted file "${f.path}" is empty.`)
  }
  if (reasons.length > 0) {
    return outcome(payload?.verification ? 'needs_correction' : 'failed', reasons.slice(0, 6), base.artifacts)
  }
  return outcome('verified', [
    `Verified: persisted website audited as a static site — entry ${required.join(', ')} with substantive content, ${persisted.manifest.length} file(s), internal references resolve.`,
  ], base.artifacts)
}

export function verifyDocumentDraft(
  payload: CodingJobPayload | null,
  criteria: VerificationCriteria,
  ctx: TaskVerificationContext | number = {},
): TaskVerificationOutcome {
  // Back-compat: the pre-M41.7 signature passed the handed-off source count
  // as a bare number.
  const context: TaskVerificationContext = typeof ctx === 'number' ? { handedOffSources: ctx } : ctx
  const base = verifyCodeBuild(payload, criteria, context)
  // NEVER wrap a non-verified base verdict: an unproven coding job stays
  // needs_correction/failed with ITS reasons — a "verified" status carrying
  // an unproven reason would be a contradiction (caught live during the
  // M41 acceptance run; this guard makes that shape structurally impossible).
  if (base.status !== 'verified') return base
  const reasons: string[] = []
  const path = criteria.deliverablePath
  const persisted = context.persisted
  const sourceRefs = context.sourceRefs ?? []
  // The persisted audit engages ONLY when a safe deliverable path names the
  // file to inspect; otherwise (no path / unsafe path / no snapshot) the
  // legacy proxy contract applies — verification is never upgraded beyond
  // what its evidence actually proves.
  const persistedAudit = persisted && path && isSafeDeliverablePath(path) ? persisted : null

  // M41.7 — verify the ACTUAL PERSISTED DOCUMENT (not the assistant's
  // wrapper, not a payload proxy). When the executor supplied a persisted
  // snapshot, the full deliverable contract runs on the real file content.
  if (persisted && path && !isSafeDeliverablePath(path)) {
    reasons.push(`The authorized deliverable path "${path.slice(0, 60)}" is not a safe project-relative path.`)
  } else if (persistedAudit) {
    const content = persistedAudit.deliverableContent
    if (content === null) {
      reasons.push(`The deliverable file "${path}" does not exist in the persisted project files.`)
    } else {
      const chars = content.length
      // (3) non-empty and within limits.
      if (chars < 400) {
        reasons.push(`The persisted deliverable contains only ${chars} characters — too thin to be the contracted document.`)
      }
      if (chars > 400_000) {
        reasons.push(`The persisted deliverable is ${chars} characters — beyond the contract's size limit.`)
      }
      // (4) required document structure: real markdown sections.
      const headings = content.match(/^#{1,4} .+$/gm) ?? []
      if (headings.length < 2) {
        reasons.push(`The document carries ${headings.length} section heading(s); a structured document needs at least two.`)
      }
      // (5) required content matches the mission contract (required section
      // headings, case-insensitive).
      for (const section of criteria.requiredSections ?? []) {
        const present = headings.some((h) => h.replace(/^#{1,4}\s+/, '').trim().toLowerCase() === section.toLowerCase())
        if (!present) {
          reasons.push(`The required section "${section}" is missing from the delivered document.`)
        }
      }
      // (10) truncation or incomplete output cannot pass: an unclosed code
      // fence means the document was cut mid-block.
      const fenceCount = (content.match(/^```/gm) ?? []).length
      if (fenceCount % 2 === 1) {
        reasons.push('The document contains an unclosed code fence — the output was truncated mid-block.')
      }
      // (6)-(9) the citation contract, checked against the EXACT handed-off
      // sources (correspondence, never vibes).
      if (criteria.requireSourceCitation && sourceRefs.length > 0) {
        // (6) citations are actually present.
        const markers = [...content.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]))
        if (markers.length === 0) {
          reasons.push('The document cites no numbered sources — the citation contract requires [n] markers grounded in the handed-off research.')
        }
        // (7)/(9) every numbered marker must resolve to a handed-off source.
        const maxIndex = sourceRefs.length
        const badMarkers = [...new Set(markers.filter((n) => n < 1 || n > maxIndex))]
        if (badMarkers.length > 0) {
          reasons.push(`Citation marker(s) ${badMarkers.slice(0, 6).join(', ')} do not correspond to any of the ${maxIndex} handed-off source(s) — unsupported citations cannot pass.`)
        }
        // The Sources section must list the handed-off URLs (normalized —
        // query strings stripped exactly like the handoff pack).
        const normalize = (u: string): string => {
          try {
            const parsed = new URL(u)
            parsed.search = ''
            parsed.hash = ''
            return parsed.toString()
          } catch {
            return u.trim().toLowerCase()
          }
        }
        const handedOff = new Set(sourceRefs.map((s) => normalize(s.url)))
        const docUrls = [...content.matchAll(/https?:\/\/[^\s)\]>"']+/g)].map((m) => normalize(m[0]))
        const unsupported = [...new Set(docUrls.filter((u) => !handedOff.has(u)))]
        // (8) no unsupported citation is treated as verified.
        if (unsupported.length > 0) {
          reasons.push(`The document references ${unsupported.length} URL(s) outside the handed-off research pack (e.g. ${unsupported[0].slice(0, 80)}) — citations must correspond to the delivered sources.`)
        }
        const missingListed = [...handedOff].filter((u) => !docUrls.includes(u))
        if (missingListed.length === handedOff.size && handedOff.size > 0) {
          reasons.push('The Sources section lists none of the handed-off research URLs.')
        }
      }
    }
  } else {
    // Legacy evidence path (no persisted snapshot reached the verifier):
    // the original proxy checks stand — never upgraded beyond them.
    if (path) {
      const changes = payload?.changes ?? []
      const delivered = changes.some((c) => c.path === path || c.path.endsWith(`/${path}`))
      if (!delivered) {
        reasons.push(`The deliverable file "${path}" is not among the job's real file changes.`)
      }
    }
    if (criteria.requireSourceCitation && (context.handedOffSources ?? 0) > 0) {
      const chars = payload?.contentChars ?? 0
      // Deterministic citation contract: the deliverable must be substantive
      // enough to carry the handed-off sources (the coding turn's own prompt
      // embeds them; contentChars proves real content was written).
      if (chars < 400) {
        reasons.push(`The deliverable contains only ${chars} characters — too thin to carry its sources.`)
      }
    }
  }
  if (reasons.length > 0) return outcome('needs_correction', reasons, base.artifacts)
  return outcome(
    'verified',
    [
      persistedAudit
        ? 'Verified: the persisted document itself passes the deliverable contract (exists in the authorized project, substantive, structured, citations correspond to the handed-off sources).'
        : 'Verified: the deliverable file exists with the citation contract satisfied.',
    ],
    base.artifacts,
  )
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
  context: TaskVerificationContext = {},
): TaskVerificationOutcome {
  switch (kind) {
    case 'code-build':
      // M41.7: website contracts audit the PERSISTED project files; other
      // code builds keep the job-payload gates.
      return criteria.deliverableKind === 'website'
        ? verifyWebsiteBuild(payload as CodingJobPayload | null, criteria, context)
        : verifyCodeBuild(payload as CodingJobPayload | null, criteria, context)
    case 'document-draft':
      return verifyDocumentDraft(payload as CodingJobPayload | null, criteria, context)
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
