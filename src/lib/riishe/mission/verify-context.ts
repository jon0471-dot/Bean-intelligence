/**
 * BEAN Intelligence — M41.7 mission-aware verification context (pure).
 *
 * THE ROOT-CAUSE REPAIR for the M41 document/website audit-gate blocker:
 * the hosted self-verifier previously audited the assistant's FILE-FENCED
 * REPLY WRAPPER (```lang path=…```) instead of the actual deliverable. The
 * wrapper is delivery syntax — prose around fenced files — and the
 * verifier's bounded input truncated multi-file wrappers mid-file, so a
 * complete persisted deliverable was graded on a broken-looking conversation
 * fragment. This module gives the EXISTING verification pipeline a bounded,
 * trusted, system-authored description of WHAT is being built and WHERE the
 * real deliverable lives, plus the deterministic builder that turns the
 * extracted files into the audit input the verifier SHOULD see.
 *
 * Trust rules (structural, not conventional):
 *  - the context is built ONLY from the mission ledger's own task contract
 *    (ids, criteria, safeSourceUrl'd research titles/URLs) — never from
 *    model output;
 *  - it crosses the delegation boundary as a THIRD server-only parameter of
 *    submitCodingDelegation (the model-called delegate_coding tool cannot
 *    supply or alter it — validation has no mission fields);
 *  - the worker side parses it with a shape-checked reader that returns
 *    null on anything unexpected (untrusted data can only ever disable the
 *    mission-aware framing, never forge one);
 *  - verification criteria themselves never ride in this context — the
 *    executor keeps reading them from the mission task row, so a specialist
 *    can never change its own acceptance contract.
 *
 * PURE module — string/JSON only. No DB, no I/O. SERVER-ONLY consumers.
 */

import type { MissionDeliverableKind, VerificationCriteria } from './types'

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface MissionSourceRef {
  /** 1-based handoff index (matches the [n] citation markers the objective instructs). */
  index: number
  /** Query-stripped source URL (safeSourceUrl — no ids/tokens). */
  url: string
  /** Bounded source title. */
  title: string
}

export interface MissionVerificationContext {
  missionId: string
  taskId: string
  taskKind: 'document-draft' | 'code-build'
  /** What the deliverable IS — dispatches the deterministic persisted-file verifier. */
  deliverableKind: MissionDeliverableKind
  /** The authorized deliverable path (documents; null for multi-file websites). */
  deliverablePath: string | null
  /** Project files that MUST exist in the persisted workspace (websites). */
  requiredPaths: string[]
  /** Section headings that MUST appear in a document deliverable. */
  requiredSections: string[]
  /** The document must cite the handed-off sources (numbered [n] + Sources section). */
  requireCitations: boolean
  /** The handed-off sources — citation correspondence is checked against EXACTLY these. */
  sources: MissionSourceRef[]
  /** Deliverable content bounds (chars): below min → truncated/empty; above max → out of contract. */
  minDeliverableChars: number
  maxDeliverableChars: number
}

/** Bounded — the context rides inside coding-job paramsJson. */
export const VERIFY_CONTEXT_LIMITS = {
  maxSources: 8,
  maxRequiredPaths: 6,
  maxRequiredSections: 6,
  /** Hard cap on the serialized context inside job params. */
  serializedChars: 4000,
  minDeliverableChars: 400,
  maxDeliverableChars: 200_000,
  /** Audit-input budget for the hosted verifier (fits the pipeline's
   *  maxInputChars/2 draft budget with room for the framing header). */
  auditContentChars: 14_000,
  auditMaxFiles: 8,
  auditPerFileChars: 8_000,
} as const

// ---------------------------------------------------------------------------
// Build (executor side — from the mission ledger ONLY)
// ---------------------------------------------------------------------------

const CONTEXT_PATH_RE = /^[\w][\w.\-/ ]{0,198}$/

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

/** Query-stripped source URL (same normalization as the handoff pack). */
export function safeContextUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

/**
 * The EXACT numbered source list the document task receives in its handoff
 * pack (same dedupe/cap/normalization as researchPackHandoff — identical
 * numbering is what makes [n] citation correspondence checkable). Both the
 * delegation context and the deterministic verifier use THIS function, so
 * the indices the model saw are the indices the verifier trusts.
 */
export function handoffSourceRefs(
  sources: ReadonlyArray<{ url: string; title: string; snippet?: string }>,
): MissionSourceRef[] {
  const out: MissionSourceRef[] = []
  const seen = new Set<string>()
  for (const s of sources) {
    if (out.length >= VERIFY_CONTEXT_LIMITS.maxSources) break
    const url = safeContextUrl(s.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ index: out.length + 1, url, title: clip(s.title ?? '', 120) })
  }
  return out
}

/**
 * Build the trusted verification context from the task contract and the
 * handed-off research sources. Throws on unsafe paths (contract error —
 * the planner normalizes first; this is defense in depth).
 */
export function buildVerificationContext(input: {
  missionId: string
  taskId: string
  taskKind: 'document-draft' | 'code-build'
  criteria: VerificationCriteria
  sources: ReadonlyArray<{ url: string; title: string }>
}): MissionVerificationContext {
  const kindDefault: MissionDeliverableKind = input.taskKind === 'document-draft' ? 'document' : 'code'
  const deliverableKind = input.criteria.deliverableKind ?? kindDefault
  const deliverablePath = (() => {
    const p = input.criteria.deliverablePath
    if (!p) return null
    if (!CONTEXT_PATH_RE.test(p) || p.includes('..')) {
      throw new Error(`verification context: unsafe deliverable path "${p.slice(0, 60)}"`)
    }
    return p
  })()
  const requiredPaths = (input.criteria.requiredPaths ?? [])
    .slice(0, VERIFY_CONTEXT_LIMITS.maxRequiredPaths)
    .filter((p) => CONTEXT_PATH_RE.test(p) && !p.includes('..'))
  const requiredSections = (input.criteria.requiredSections ?? [])
    .slice(0, VERIFY_CONTEXT_LIMITS.maxRequiredSections)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
  const sources = handoffSourceRefs(input.sources)
  return {
    missionId: clip(input.missionId, 64),
    taskId: clip(input.taskId, 32),
    taskKind: input.taskKind,
    deliverableKind,
    deliverablePath,
    requiredPaths: deliverableKind === 'website' && requiredPaths.length === 0 ? ['index.html'] : requiredPaths,
    requiredSections,
    requireCitations: input.criteria.requireSourceCitation === true && sources.length > 0,
    sources,
    minDeliverableChars: VERIFY_CONTEXT_LIMITS.minDeliverableChars,
    maxDeliverableChars: VERIFY_CONTEXT_LIMITS.maxDeliverableChars,
  }
}

// ---------------------------------------------------------------------------
// Serialize / parse (the delegation boundary)
// ---------------------------------------------------------------------------

export function serializeVerificationContext(ctx: MissionVerificationContext): string {
  return JSON.stringify(ctx)
}

/**
 * Worker-side reader. The job params JSON is treated as UNTRUSTED: anything
 * that does not exactly match the expected shape resolves to null — which
 * simply restores the pre-M41.7 behavior (no mission framing). A malformed
 * context can never WEAKEN verification: all criteria still come from the
 * mission ledger via the deterministic verifiers.
 */
export function parseMissionVerificationContext(raw: unknown): MissionVerificationContext | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
  const taskKind = r.taskKind === 'document-draft' || r.taskKind === 'code-build' ? r.taskKind : null
  const missionId = str(r.missionId, 64)
  const taskId = str(r.taskId, 32)
  const deliverableKind: MissionDeliverableKind | null =
    r.deliverableKind === 'document' || r.deliverableKind === 'website' || r.deliverableKind === 'code'
      ? r.deliverableKind
      : null
  if (!missionId || !taskId || !taskKind || !deliverableKind) return null
  const deliverablePath = str(r.deliverablePath, 200)
  const paths = Array.isArray(r.requiredPaths)
    ? r.requiredPaths.filter((p): p is string => typeof p === 'string' && CONTEXT_PATH_RE.test(p) && !p.includes('..')).slice(0, VERIFY_CONTEXT_LIMITS.maxRequiredPaths)
    : []
  const sections = Array.isArray(r.requiredSections)
    ? r.requiredSections.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 80).slice(0, VERIFY_CONTEXT_LIMITS.maxRequiredSections)
    : []
  const sources: MissionSourceRef[] = []
  if (Array.isArray(r.sources)) {
    for (const s of r.sources.slice(0, VERIFY_CONTEXT_LIMITS.maxSources)) {
      if (!s || typeof s !== 'object') continue
      const sr = s as Record<string, unknown>
      const url = str(sr.url, 2000)
      const title = str(sr.title, 120)
      const index = typeof sr.index === 'number' && Number.isInteger(sr.index) && sr.index >= 1 && sr.index <= VERIFY_CONTEXT_LIMITS.maxSources ? sr.index : null
      if (!url || !/^https?:\/\//.test(url) || index === null) continue
      sources.push({ index, url, title: title ?? '' })
    }
  }
  const minChars = typeof r.minDeliverableChars === 'number' && Number.isFinite(r.minDeliverableChars)
    ? Math.min(VERIFY_CONTEXT_LIMITS.maxDeliverableChars, Math.max(1, Math.floor(r.minDeliverableChars)))
    : VERIFY_CONTEXT_LIMITS.minDeliverableChars
  const maxChars = typeof r.maxDeliverableChars === 'number' && Number.isFinite(r.maxDeliverableChars)
    ? Math.min(VERIFY_CONTEXT_LIMITS.maxDeliverableChars, Math.max(minChars, Math.floor(r.maxDeliverableChars)))
    : VERIFY_CONTEXT_LIMITS.maxDeliverableChars
  return {
    missionId,
    taskId,
    taskKind,
    deliverableKind,
    deliverablePath,
    requiredPaths: paths,
    requiredSections: sections,
    requireCitations: r.requireCitations === true && sources.length > 0,
    sources,
    minDeliverableChars: minChars,
    maxDeliverableChars: maxChars,
  }
}

// ---------------------------------------------------------------------------
// The deliverable audit input (worker side — what the hosted verifier sees)
// ---------------------------------------------------------------------------

export interface AuditFile {
  path: string
  content: string
}

/**
 * Build the hosted verifier's audit input from the EXTRACTED deliverable
 * files. The wrapper (prose + fences) is never shown as the deliverable:
 * this text is the actual file content, framed by a deterministic header
 * that states the delivery contract. Documents audit the ONE deliverable
 * file; websites audit a bounded manifest plus the entry/referenced file
 * contents (a package.json is never demanded — static sites are audited as
 * static sites).
 */
export function buildDeliverableAuditInput(
  files: ReadonlyArray<AuditFile>,
  ctx: MissionVerificationContext,
): { text: string; deliveredFiles: string[] } {
  const header: string[] = [
    '[MISSION DELIVERABLE AUDIT — system framing, not part of any user request]',
    `The specialist's reply text is a DELIVERY WRAPPER: prose around fenced code blocks (\`\`\`lang path=…\`\`\`).`,
    `Those fences are delivery syntax. The text under audit below is the EXTRACTED DELIVERABLE — the actual file content the specialist delivered, already separated from the wrapper.`,
    `Audit THIS content as the deliverable. Do not grade the wrapper's prose, fence syntax or truncation outside this extracted material.`,
    `Deliverable contract: task "${ctx.taskId}" (${ctx.taskKind}), deliverable kind "${ctx.deliverableKind}"${ctx.deliverablePath ? `, required file "${ctx.deliverablePath}"` : ''}${ctx.requiredPaths.length > 0 ? `, required files: ${ctx.requiredPaths.join(', ')}` : ''}.`,
  ]
  if (ctx.requireCitations && ctx.sources.length > 0) {
    header.push(
      `Citation contract: factual claims must cite ONLY the ${ctx.sources.length} handed-off research source(s) (numbered [n] markers resolving to a Sources section). A claim citing anything else is unsupported.`,
    )
  }
  if (ctx.requiredSections.length > 0) {
    header.push(`Required section headings: ${ctx.requiredSections.join(', ')}.`)
  }
  header.push('[EXTRACTED DELIVERABLE CONTENT — begins]')

  const deliveredFiles = files.map((f) => f.path)
  const parts: string[] = []
  // Ordering: the required/entry files first, then the rest by path — the
  // most contract-relevant content survives any budget pressure.
  const ordered = [...files].sort((a, b) => {
    const rank = (p: string): number => {
      if (ctx.deliverablePath && p === ctx.deliverablePath) return 0
      if (ctx.requiredPaths.includes(p)) return 1
      return 2
    }
    return rank(a.path) - rank(b.path) || a.path.localeCompare(b.path)
  })
  let budget = VERIFY_CONTEXT_LIMITS.auditContentChars
  let filesShown = 0
  for (const f of ordered) {
    if (filesShown >= VERIFY_CONTEXT_LIMITS.auditMaxFiles || budget <= 200) {
      parts.push(`[file ${f.path} — present on disk, ${f.content.length} chars, omitted from the audit excerpt for budget]`)
      continue
    }
    const cap = Math.min(VERIFY_CONTEXT_LIMITS.auditPerFileChars, budget)
    const body = f.content.length > cap ? `${f.content.slice(0, cap)}\n…(excerpt bounded for the audit; ${f.content.length} chars total on disk)` : f.content
    parts.push(`----- FILE: ${f.path} (${f.content.length} chars) -----\n${body}`)
    budget -= body.length
    filesShown += 1
  }
  if (files.length === 0) {
    parts.push('[NO DELIVERABLE FILE was extracted from the specialist\'s reply — nothing was delivered.]')
  }
  header.push(parts.join('\n\n'))
  header.push('[EXTRACTED DELIVERABLE CONTENT — ends]')
  return { text: header.join('\n'), deliveredFiles }
}

/**
 * The verifier's request framing: the original objective plus the
 * deterministic audit contract. The verifier still receives the request and
 * draft through the SAME buildVerifierUserTurn — only the text changes.
 */
export function buildMissionAuditRequest(objective: string, ctx: MissionVerificationContext): string {
  const lines = [
    clip(objective, 6000),
    '',
    '[VERIFICATION CONTRACT (system-authored, from the mission ledger)]',
    `- Mission ${ctx.missionId}, task ${ctx.taskId} (${ctx.taskKind}); the deliverable is a ${ctx.deliverableKind}.`,
    `- The "draft" below is the EXTRACTED DELIVERABLE content, not the specialist's conversational wrapper — audit the deliverable on its own terms.`,
    ...(ctx.deliverablePath ? [`- Required deliverable file: ${ctx.deliverablePath}.`] : []),
    ...(ctx.requiredPaths.length > 0 ? [`- Required project files: ${ctx.requiredPaths.join(', ')}.`] : []),
    ...(ctx.requiredSections.length > 0 ? [`- Required section headings: ${ctx.requiredSections.join(', ')}.`] : []),
    ...(ctx.requireCitations
      ? [
          `- Citation contract: every factual claim needs a numbered [n] citation resolving to the handed-off sources listed in the request; the document must carry a Sources section listing those exact URLs.`,
          `- Handed-off sources (the ONLY citable ones):`,
          ...ctx.sources.map((s) => `  [${s.index}] ${s.title} — ${s.url}`),
        ]
      : []),
    '- A truncated or incomplete deliverable cannot pass. Judge completeness from the extracted content itself.',
  ]
  return lines.join('\n')
}
