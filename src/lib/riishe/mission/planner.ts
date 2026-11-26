/**
 * BEAN Intelligence — M41 deterministic mission planner (pure).
 *
 * Turns ONE complex multi-part user objective into a concrete, dependency-
 * ordered task graph across the REAL specialist execution paths. This is
 * the Phase-1 "understand → decompose → order → assign" surface — and it is
 * deliberately DETERMINISTIC: narrow, testable request shapes decide the
 * decomposition (the same auditable discipline as the per-turn capability
 * planner). No second model call plans the mission; no uncontrolled
 * agent-to-agent conversation exists; every emitted task executes through a
 * fixed real path (KIND_AGENT/KIND_AUTH_SCOPE in ./types).
 *
 * The four canonical multi-agent workflows (M41 §3):
 *   A. website-build      — CODE GIFTZ builds (+ optional LAXII brand asset)
 *   B. media-production   — JAZMII video + LAXII visuals + GANGZII audio
 *   C. research-document  — live research → verified document deliverable
 *   D. debug-app          — CODE GIFTZ reproduces/fixes/verifies
 *
 * Anything that is not a genuine multi-part objective is refused with an
 * honest reason — the ordinary chat flow (existing tools) serves it.
 *
 * PURE module — regex + string shaping only. No DB, no I/O, no model calls.
 */

import {
  MISSION_LIMITS,
  buildTaskSpec,
  type MissionPlanResult,
  type MissionTaskSpec,
  type VerificationCriteria,
} from './types'
import { validateTaskGraph } from './graph'

// ---------------------------------------------------------------------------
// Detection shapes — deliberately narrow (creation verb + concrete artifact
// noun, mirroring the capability-plan discipline). Questions and opinions
// never plan missions.
// ---------------------------------------------------------------------------

const WEBSITE_BUILD_RE =
  /\b(build|create|make|develop|design|produce|set\s+up|launch)\b[^.?!;]{0,120}\b(website|web\s?site|web\s?app|landing\s+page|home\s+page|webpage|portfolio\s+site|dashboard|microsite|site\b)/i

const DEBUG_FIX_RE =
  /\b(debug|fix|repair|troubleshoot|diagnose)\b[^.?!;]{0,120}\b(app|application|website|project|code|program|script|bug|error|crash|failure|issue)/i

const VIDEO_CREATE_RE =
  /\b(create|produce|make|generate|assemble|put\s+together)\b[^.?!;]{0,120}\b(video|clip|short\s+film|animation|motion\s+graphic)/i

const AUDIO_NARRATION_RE =
  /\b(narration|voiceover|voice-over|narrate|spoken\s+track|audio\s+track|soundtrack\s+voice)/i

const IMAGE_ASSET_RE =
  /\b(logo|hero\s+image|banner|poster|thumbnail|cover\s+image|illustration|brand\s+image|icon\s+set|social\s+preview)/i

const RESEARCH_VERB_RE =
  /\b(research|investigate|gather\s+(sources|evidence|information)|look\s+into|fact-?check|verify\s+claims)\b/i

const DOCUMENT_NOUN_RE =
  /\b(report|brief|whitepaper|white\s+paper|summary|study|guide|write-?up|document|article|memo|dossier)\b/i

const QUESTION_OPENER_RE =
  /^\s*(how\s+(do|can|to|does)|what\s+(does|is|are|will)|why\s+(does|is|do)|can\s+you\s+(explain|show|tell|describe)|explain|describe|walk\s+me\s+through|review|compare)\b/i

// ---------------------------------------------------------------------------
// Deterministic extraction helpers (bounded, customer-safe)
// ---------------------------------------------------------------------------

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/** A quoted or "called/named X" project name (up to three words, stopping
 *  at a following conjunction), else null. */
export function extractProjectName(objective: string): string | null {
  const quoted = objective.match(/["“']([\w][\w\s.-]{1,60})["”']/)
  if (quoted) return clip(quoted[1].trim(), 60)
  const named = objective.match(
    /\b(?:called|named)\s+([\w][\w\s-]{1,60}?)(?=\s+(?:with|and|that|which|for|including|featuring)\b|[.,;!?]|$)/i,
  )
  if (named) return clip(named[1].trim(), 60)
  return null
}

/** Narration text only when the user supplied explicit spoken content. */
export function extractNarration(objective: string): string | null {
  const m = objective.match(
    /(?:narration|voiceover|voice-over|narrate|saying|reads?|script)\s*(?:ings?)?\s*[:：]\s*["“]?([^"”]{10,1000})["”]?/i,
  )
  return m ? clip(m[1].trim(), 1000) : null
}

/** The visual clause for a brand/hero asset (the noun phrase around the
 *  detected image noun), else null. */
export function extractImageClause(objective: string): string | null {
  const m = objective.match(
    /\b((?:a|an|the)?\s?[\w\s-]{0,60}(?:logo|hero\s+image|banner|poster|thumbnail|cover\s+image|illustration|brand\s+image|icon\s+set|social\s+preview)\b[^.?!;,]{0,80})/i,
  )
  return m ? clip(m[1].trim(), 200) : null
}

/** The video clause: an explicit "video about/showing X" or the objective. */
export function extractVideoPrompt(objective: string): string {
  const m = objective.match(/\bvideo\b[^.?!;]{0,20}?\b(?:about|showing|depicting|of|featuring)\b\s+([^.?!;]{3,300})/i)
  return clip(m ? m[1].trim() : objective, 2000)
}

/** Research topic: strip workflow verbs and document nouns, keep the subject. */
export function extractResearchTopic(objective: string): string {
  const stripped = objective
    .replace(
      /\b(research|investigate|gather|sources|evidence|information|look\s+into|fact-?check|verify\s+claims|then|and\s+then|write|draft|produce|create|generate|a|an|the)\s+/gi,
      ' ',
    )
    .replace(/\b(report|brief|whitepaper|white\s+paper|summary|study|guide|write-?up|document|article|memo|dossier)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return clip(stripped.length >= 8 ? stripped : objective, 300)
}

/** Document deliverable file name from the detected document noun. */
export function extractDocumentPath(objective: string): string {
  const noun = objective.match(/\b(report|brief|whitepaper|white\s+paper|summary|study|guide|write-?up|article|memo|dossier)\b/i)
  const kind = noun ? noun[1].toLowerCase().replace(/\s+/g, '-') : 'document'
  return `${kind}.md`
}

// ---------------------------------------------------------------------------
// Task factories — every emitted task carries the FULL contract.
// ---------------------------------------------------------------------------

function codeBuildTask(objective: string, deps: string[], opts: { debug?: boolean } = {}): MissionTaskSpec {
  const projectName = extractProjectName(objective)
  const instruction = opts.debug
    ? `Reproduce the reported problem first, then apply the minimal required code changes to fix it in the project` +
      `${projectName ? ` "${projectName}"` : ''}. Preserve existing functionality. Run the project's tests or a real ` +
      `sandbox execution to prove the fix. Objective from the user: ${clip(objective, MISSION_LIMITS.taskObjectiveChars - 400)}`
    : `Architect and build the requested software${projectName ? ` (project name: "${projectName}")` : ''} as real, ` +
      `working files in a new engineering project. Use a professional, coherent design; no generic template look. ` +
      `Ensure it runs. Objective from the user: ${clip(objective, MISSION_LIMITS.taskObjectiveChars - 400)}`
  const verification: VerificationCriteria = {
    requireSelfVerification: true,
    minFileChanges: 1,
    ...(opts.debug ? { requireSandboxPass: true } : {}),
  }
  return buildTaskSpec({
    id: 'build',
    kind: 'code-build',
    title: opts.debug ? 'Reproduce, fix and verify the issue' : 'Architect, build and verify the software',
    objective: instruction,
    params: projectName ? { projectName } : {},
    expectedOutput: opts.debug
      ? 'A completed coding job with real file changes, a passing self-verification and (for debug) a passing sandbox run.'
      : 'A completed coding job that created working project files with real diffs and a passing self-verification.',
    dependsOn: deps,
    verification,
    limits: { executionTimeoutMs: 20 * 60_000, maxAttempts: 1, maxCorrections: 1 },
  })
}

function documentDraftTask(objective: string, docPath: string, deps: string[]): MissionTaskSpec {
  return buildTaskSpec({
    id: 'document',
    kind: 'document-draft',
    title: `Write the ${docPath.replace(/\.md$/, '')} deliverable`,
    objective:
      `Write the requested document as ${docPath} in a new engineering project. Ground every factual claim in the ` +
      `research sources handed to you below; include a "Sources" section listing every source you used with its URL. ` +
      `Structure the document professionally (title, sections, conclusion). Do not invent facts that the sources do ` +
      `not support; mark uncertainty explicitly. Request: ${clip(objective, MISSION_LIMITS.taskObjectiveChars - 800)}`,
    params: { deliverablePath: docPath },
    expectedOutput: `A completed coding job whose real file changes include ${docPath} with cited sources.`,
    dependsOn: deps,
    verification: {
      requireSelfVerification: true,
      minFileChanges: 1,
      requireSourceCitation: deps.length > 0,
      deliverablePath: docPath,
    },
    // Two bounded attempts: every attempt still passes the REAL hosted
    // verifier; the budget only buys generation variance (measured live
    // during M41 acceptance — strict audits block single-attempt documents).
    limits: { executionTimeoutMs: 15 * 60_000, maxAttempts: 2, maxCorrections: 1 },
  })
}

function imageAssetTask(clause: string, deps: string[] = []): MissionTaskSpec {
  return buildTaskSpec({
    id: 'asset-image',
    kind: 'image-asset',
    title: 'Create the visual asset',
    objective: clip(clause, MISSION_LIMITS.taskObjectiveChars),
    params: { prompt: clip(clause, 2000) },
    expectedOutput: 'A completed image-creation job with a real servable image artifact.',
    dependsOn: deps,
    verification: { requireArtifact: true },
    limits: { executionTimeoutMs: 10 * 60_000, maxAttempts: 1, maxCorrections: 1 },
  })
}

function videoAssetTask(prompt: string, deps: string[] = []): MissionTaskSpec {
  return buildTaskSpec({
    id: 'asset-video',
    kind: 'video-asset',
    title: 'Produce the video clip',
    objective: clip(prompt, MISSION_LIMITS.taskObjectiveChars),
    params: { prompt: clip(prompt, 2000) },
    expectedOutput: 'A completed video-creation job with a real servable video artifact and recorded provenance.',
    dependsOn: deps,
    verification: { requireArtifact: true },
    limits: { executionTimeoutMs: 20 * 60_000, maxAttempts: 1, maxCorrections: 1 },
  })
}

function audioAssetTask(text: string, deps: string[] = []): MissionTaskSpec {
  return buildTaskSpec({
    id: 'asset-audio',
    kind: 'audio-asset',
    title: 'Produce the spoken audio',
    objective: `Synthesize the narration text exactly as provided (no rewriting): "${clip(text, 900)}"`,
    params: { text: clip(text, 1000) },
    expectedOutput: 'A completed speech-synthesis job with a RIFF-validated audio artifact.',
    dependsOn: deps,
    verification: { requireArtifact: true, requireAudioValidation: true },
    limits: { executionTimeoutMs: 10 * 60_000, maxAttempts: 1, maxCorrections: 1 },
  })
}

function researchTask(topic: string, deps: string[] = []): MissionTaskSpec {
  // The objective promises EXACTLY what the real retrieval lanes capture
  // (title + URL per source) — never more. An objective that over-promises
  // (e.g. supporting excerpts the lanes do not carry) would make the
  // document verifier audit against undeliverable requirements and block
  // honest work (measured live during the M41 acceptance window).
  return buildTaskSpec({
    id: 'research',
    kind: 'research',
    title: 'Gather cited evidence',
    objective:
      `Research the topic with live retrieval and collect real, attributable sources. Topic: ${clip(topic, 300)}. ` +
      `Collect at least three independent sources; for each capture the title and the URL.`,
    params: { topic: clip(topic, 300) },
    expectedOutput: 'A research pack of at least three real sources (title + URL each).',
    dependsOn: deps,
    verification: { minSources: 3 },
    limits: { executionTimeoutMs: 5 * 60_000, maxAttempts: 1, maxCorrections: 1 },
  })
}

function verifyDeliverableTask(deps: string[], expected: string): MissionTaskSpec {
  return buildTaskSpec({
    id: 'verify',
    kind: 'verify-deliverable',
    title: 'Verify the final deliverable',
    objective: 'Independently inspect every delivered artifact of this mission for integrity and coherence.',
    params: {},
    expectedOutput: clip(expected, MISSION_LIMITS.expectedOutputChars),
    dependsOn: deps,
    verification: {},
    limits: { executionTimeoutMs: 60_000, maxAttempts: 1, maxCorrections: 0 },
  })
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/**
 * Plan a mission from the user's objective. Returns an honest refusal for
 * anything that is not a genuine multi-part objective (single-domain
 * requests are served by the ordinary chat flow — no mission theater).
 */
export function planMission(objective: string): MissionPlanResult {
  const text = objective.trim()
  if (text.length < 12) {
    return { ok: false, reason: 'Describe the objective in a sentence or more — there is nothing multi-part to plan yet.' }
  }
  if (text.length > MISSION_LIMITS.objectiveChars) {
    return { ok: false, reason: `The objective is longer than ${MISSION_LIMITS.objectiveChars} characters; split it into steps.` }
  }
  if (QUESTION_OPENER_RE.test(text)) {
    return { ok: false, reason: 'This reads as a question, not an execution order — answering it needs no mission.' }
  }

  const wantsWebsite = WEBSITE_BUILD_RE.test(text)
  const wantsDebug = DEBUG_FIX_RE.test(text)
  const wantsVideo = VIDEO_CREATE_RE.test(text)
  const wantsNarration = AUDIO_NARRATION_RE.test(text) || /audio|voice|narration|voiceover/i.test(text)
  const wantsImage = IMAGE_ASSET_RE.test(text)
  const wantsResearch = RESEARCH_VERB_RE.test(text)
  const wantsDocument = DOCUMENT_NOUN_RE.test(text)

  // --- A. Website build (optionally with a brand asset) --------------------
  if (wantsWebsite) {
    const tasks: MissionTaskSpec[] = []
    const detected: string[] = ['software build requested']
    const imageClause = wantsImage ? extractImageClause(text) : null
    if (imageClause) {
      tasks.push(imageAssetTask(imageClause))
      detected.push('visual asset requested: the LAXII specialist prepares it before the build')
    }
    tasks.push(codeBuildTask(text, imageClause ? ['asset-image'] : []))
    tasks.push(
      verifyDeliverableTask(
        ['build'],
        imageClause
          ? 'The project files exist with a passing self-verification, and the requested visual asset was delivered by the visual specialist.'
          : 'The project files exist, run, and carry a passing self-verification.',
      ),
    )
    const type = 'website-build' as const
    return finish(type, detected, tasks, 'build')
  }

  // --- D. Debug an existing application ------------------------------------
  if (wantsDebug) {
    const build = codeBuildTask(text, [], { debug: true })
    const verify = verifyDeliverableTask(
      ['build'],
      'The fix is applied as real file changes, the self-verification passed and the sandbox run exited 0.',
    )
    return finish('debug-app', ['debug/repair of an existing application requested'], [build, verify], 'build')
  }

  // --- B. Media production (video + assets) --------------------------------
  if (wantsVideo && (wantsNarration || wantsImage || wantsResearch)) {
    const tasks: MissionTaskSpec[] = []
    const detected: string[] = ['video production requested']
    const imageClause = wantsImage ? extractImageClause(text) : null
    if (imageClause) {
      tasks.push(imageAssetTask(imageClause))
      detected.push('visual asset requested from the visual specialist')
    }
    const narration = extractNarration(text)
    if (narration) {
      tasks.push(audioAssetTask(narration, imageClause ? ['asset-image'] : []))
      detected.push('narration text provided for the audio specialist')
    }
    const videoPrompt = extractVideoPrompt(text)
    const videoDeps = imageClause ? ['asset-image'] : []
    tasks.push(videoAssetTask(videoPrompt, videoDeps))
    tasks.push(
      verifyDeliverableTask(
        ['asset-video', ...tasks.map((t) => t.id).filter((id) => id !== 'asset-video')],
        'Every media artifact exists as a real, validated file and each producer job reported completed.',
      ),
    )
    detected.push('video clip delegated to the video specialist')
    return finish('media-production', detected, tasks, 'asset-video')
  }

  // --- C. Research → verified document -------------------------------------
  if (wantsResearch && wantsDocument) {
    const topic = extractResearchTopic(text)
    const docPath = extractDocumentPath(text)
    const research = researchTask(topic)
    // Supporting (non-blocking) context: the Knowledge Atlas consultation is
    // a genuine side task — if it fails, the mission completes PARTIAL with
    // the verified deliverable intact (never silently dropped).
    const knowledge = buildTaskSpec({
      id: 'knowledge',
      kind: 'knowledge',
      title: 'Consult the knowledge atlas',
      objective: `Consult the curated knowledge atlas for established background on: ${clip(topic, 300)}.`,
      params: { topic: clip(topic, 300) },
      expectedOutput: 'At least one relevant atlas reference consulted.',
      dependsOn: [],
      verification: { minSources: 1 },
      limits: { executionTimeoutMs: 60_000, maxAttempts: 1, maxCorrections: 0 },
    })
    const doc = documentDraftTask(text, docPath, ['research'])
    const verify = verifyDeliverableTask(
      ['document'],
      `The ${docPath} deliverable exists with cited sources, and the research pack holds at least three real sources.`,
    )
    return finish(
      'research-document',
      ['live research requested', `document deliverable (${docPath}) requested`],
      [research, knowledge, doc, verify],
      'document',
    )
  }

  // --- Honest refusal for everything else ----------------------------------
  const singleDomainHints: string[] = []
  if (wantsVideo) singleDomainHints.push('video creation (the video specialist handles this directly)')
  if (wantsResearch && !wantsDocument) singleDomainHints.push('research (the chat flow answers with live sources)')
  if (wantsDocument && !wantsResearch) singleDomainHints.push('document writing (the engineering workspace handles this)')
  if (wantsImage) singleDomainHints.push('image creation (the visual specialist handles this directly)')
  if (singleDomainHints.length > 0) {
    return {
      ok: false,
      reason: `This is a single-domain request — ${singleDomainHints[0]} — so a multi-agent mission would add no real execution value. Ask for it directly, or combine several deliverables (for example: "research X and write a report", "build a website with a logo").`,
    }
  }
  return {
    ok: false,
    reason:
      'No multi-part execution objective was detected. Missions coordinate several specialists (build a website, produce a video with narration and visuals, research and write a sourced report, or debug an application). Describe an objective like that and the plan is created automatically.',
  }
}

/** Shared tail: validate the graph, find the deliverable, return the plan. */
function finish(
  missionType: (import('./types').MissionType),
  detected: string[],
  tasks: MissionTaskSpec[],
  deliverableTaskId: string,
): MissionPlanResult {
  const validation = validateTaskGraph(tasks)
  if (!validation.valid) {
    return { ok: false, reason: `The planned task graph is invalid: ${validation.problems[0]}` }
  }
  if (!tasks.some((t) => t.id === deliverableTaskId)) {
    return { ok: false, reason: 'The plan is missing its deliverable task.' }
  }
  return { ok: true, missionType, detected, deliverableTaskId, tasks }
}
