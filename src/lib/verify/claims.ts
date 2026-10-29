/**
 * BEAN Intelligence — claim-level grounding verification.
 *
 * Citation integrity alone cannot catch a hallucinated CLAIM that borrows a
 * real citation's slot, and it cannot catch a time-sensitive assertion made
 * with NO evidence at all (measured failure: an Auto answer declared an
 * officeholder and an election outcome while citing [3][4][5] with an empty
 * evidence set).
 *
 * This module closes that gap deterministically at the ORCHESTRATION level:
 *
 *   1. EXTRACT the important factual claims of the draft answer (LLM, JSON,
 *      zod-validated, bounded) — focused on changing/time-sensitive facts
 *      (officeholders, election results, office tenure, versions, prices,
 *      scores, statuses) plus other externally verifiable central claims.
 *   2. MATCH each claim against the ACTUAL retrieved evidence. Verdicts:
 *      supported | contradicted | unsupported. A source that merely mentions
 *      an entity does NOT support claims about its office, election outcome,
 *      dates or causes.
 *   3. MATERIAL problems (any contradicted claim, or any unsupported
 *      CHANGING claim) trigger ONE bounded regeneration with the specific
 *      problems fed back; the rewritten answer is re-checked once.
 *   4. States stay honest: material problems after the final check remove
 *      VERIFIED_FROM_SOURCES; every flagged claim becomes a failed
 *      verification entry the UI renders.
 *
 * The checker never edits the answer text itself — removal/correction/
 * qualification of unsupported claims is done by the model under
 * instruction, and the final verdicts come only from retrieved evidence.
 */
import ZAI from 'z-ai-web-dev-sdk'
import { z } from 'zod'
import type { VerificationCheckView } from '@/lib/riishe/states'

const verdictSchema = z.enum(['supported', 'contradicted', 'unsupported'])

const claimsSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(3).max(400),
        changing: z.boolean(),
        verdict: verdictSchema,
        evidenceIds: z.array(z.number().int().min(1).max(99)).max(12).default([]),
        /** True when the claim asserts a date/duration that conflicts with
         *  the evidence or with another statement in the answer. */
        dateConflict: z.boolean().default(false),
        note: z.string().max(300).optional(),
      }),
    )
    .max(12),
})

export interface ClaimVerdict {
  text: string
  /** True when the claim is a changing/time-sensitive fact. */
  changing: boolean
  verdict: 'supported' | 'contradicted' | 'unsupported'
  /** Evidence ids that (per the checker) support or contradict the claim. */
  evidenceIds: number[]
  /** True when the claim asserts a date that conflicts with the evidence
   *  or with another statement of the same answer (inconsistent dates). */
  dateConflict?: boolean
  note?: string
}

export interface ClaimCheckResult {
  ran: boolean
  claims: ClaimVerdict[]
  /** Honest degradation (malformed output, timeout, gateway failure). */
  degraded: string[]
}

interface CheckCompletion {
  choices?: Array<{ message?: { content?: string } }>
}

const CLAIM_SYSTEM =
  'You are a strict claim-verification engine for a fact-checking pipeline.\n' +
  'You receive an ANSWER and numbered EVIDENCE retrieved from the web. List the important factual claims ' +
  'the ANSWER makes about the world — prioritize CHANGING facts (who holds an office, election results and ' +
  'outcomes, swearing-in or appointment dates, tenure, prices, software versions, scores, statuses, ' +
  '"still/now" statements) and any other externally verifiable factual assertion central to the answer.\n' +
  'For each claim output:\n' +
  '- text: concise restatement (one sentence max)\n' +
  '- changing: true if it is a time-sensitive/changing fact\n' +
  '- verdict: "supported" if at least one numbered evidence item EXPLICITLY states it; "contradicted" if ' +
  'numbered evidence explicitly states otherwise; "unsupported" otherwise\n' +
  '- evidenceIds: the evidence numbers that state it (for contradicted: the ones that state otherwise)\n' +
  '- dateConflict: true when the claim asserts a date, year or duration that conflicts with the numbered ' +
  'evidence or with another statement elsewhere in the ANSWER (e.g. two different swearing-in years, ' +
  'inconsistent "since <date>" values)\n' +
  '- note: for problems, one short sentence (what the evidence actually says, or what is missing)\n' +
  'STRICT RULES:\n' +
  '- A source that merely MENTIONS an entity does NOT support claims about that entity\'s office, election ' +
  'victories, dates, or causes. Demand explicit statements.\n' +
  '- Use ONLY the numbered evidence for verdicts. Never use outside knowledge to support or excuse a claim.\n' +
  '- Do not list the user\'s question itself, opinions, or trivial stylistic statements as claims.\n' +
  '- Maximum 10 claims; the most important ones first.\n' +
  'Respond with JSON only: {"claims": [{"text": "...", "changing": true, "verdict": "supported", ' +
  '"evidenceIds": [1], "dateConflict": false, "note": "..."}]}'

/** Injectable transport (tests inject a stub; prod uses the gateway). */
export type ClaimCheckTransport = (
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
) => Promise<string>

async function gatewayTransport(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
  })
  return (completion as CheckCompletion).choices?.[0]?.message?.content ?? ''
}

export interface ClaimCheckInput {
  /** The drafted answer to verify. */
  answer: string
  /** The numbered evidence block the answer was grounded on (same ids as citations). */
  evidenceBlock: string
  transport?: ClaimCheckTransport
  timeoutMs?: number
}

/**
 * Extract + verify claims against the evidence. Never throws: any failure is
 * an honest `ran: false` with a degraded note (the caller then does NOT
 * claim claim-level verification — it simply cannot assert it).
 */
export async function checkClaims(input: ClaimCheckInput): Promise<ClaimCheckResult> {
  const empty: ClaimCheckResult = { ran: false, claims: [], degraded: [] }
  const evidence = input.evidenceBlock.trim()
  const answer = input.answer.trim()
  if (!evidence || !answer) return empty

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const raw = await Promise.race([
      (input.transport ?? gatewayTransport)([
        { role: 'assistant', content: CLAIM_SYSTEM },
        {
          role: 'user',
          content:
            `EVIDENCE:\n${evidence.slice(0, 18_000)}\n\nANSWER TO VERIFY:\n${answer.slice(0, 8_000)}\n\n` +
            'Return the JSON claim list now.',
        },
      ]),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('claim check timeout')), input.timeoutMs ?? 25_000)
      }),
    ])
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ...empty, degraded: ['claim check produced no parseable output'] }
    const parsed = claimsSchema.safeParse(JSON.parse(jsonMatch[0]))
    if (!parsed.success) return { ...empty, degraded: ['claim check output failed validation'] }
    return { ran: true, claims: parsed.data.claims, degraded: [] }
  } catch (e) {
    return {
      ...empty,
      degraded: [
        `claim check unavailable: ${e instanceof Error ? e.message.slice(0, 120) : 'failed'}`,
      ],
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface MaterialProblems {
  contradicted: ClaimVerdict[]
  /** Changing (time-sensitive) claims with no support in the evidence. */
  unsupportedChanging: ClaimVerdict[]
  /** Claims whose dates conflict with the evidence or with the answer itself. */
  dateConflicts: ClaimVerdict[]
}

/** A problem is MATERIAL when evidence contradicts a claim, a changing fact
 *  in the answer has no support in the retrieved evidence, or an important
 *  date is inconsistent (internally or against the evidence). */
export function findMaterialProblems(result: ClaimCheckResult): MaterialProblems | null {
  if (!result.ran) return null
  const contradicted = result.claims.filter((c) => c.verdict === 'contradicted')
  const unsupportedChanging = result.claims.filter((c) => c.verdict === 'unsupported' && c.changing)
  const dateConflicts = result.claims.filter((c) => c.dateConflict === true && c.verdict !== 'contradicted')
  if (contradicted.length === 0 && unsupportedChanging.length === 0 && dateConflicts.length === 0) return null
  return { contradicted, unsupportedChanging, dateConflicts }
}

/** Human-readable feedback fed to the model for the bounded regeneration. */
export function buildRegenerationFeedback(problems: MaterialProblems): string {
  const lines: string[] = []
  lines.push("BEAN's claim-level verifier compared your draft against the numbered retrieved evidence and found claims the evidence does not support:")
  for (const c of problems.contradicted) {
    const ids = c.evidenceIds.length > 0 ? ` (evidence ${c.evidenceIds.map((i) => `[${i}]`).join(' ')})` : ''
    lines.push(`- CONTRADICTED: "${c.text}"${ids}${c.note ? ` — ${c.note}` : ''}`)
  }
  for (const c of problems.unsupportedChanging) {
    lines.push(
      `- NOT SUPPORTED: "${c.text}" — no retrieved source states this. Do not infer it from sources that merely mention the entity.`,
    )
  }
  for (const c of problems.dateConflicts) {
    const ids = c.evidenceIds.length > 0 ? ` (evidence ${c.evidenceIds.map((i) => `[${i}]`).join(' ')})` : ''
    lines.push(
      `- DATE CONFLICT: "${c.text}"${ids}${c.note ? ` — ${c.note}` : ''} — use ONE consistent date taken from the retrieved evidence and remove the inconsistent statement.`,
    )
  }
  lines.push(
    'Rewrite the COMPLETE answer now: remove or correct every flagged claim so the answer reflects only what the retrieved sources actually state; ' +
      'keep citations only for claims the cited source genuinely supports; if sources disagree, state the disagreement and the source dates; ' +
      'state each fact once — never repeat the same claim with different dates or values; ' +
      'qualify anything you cannot verify. Keep the same question and language.',
  )
  return lines.join('\n')
}

/** Are material problems still present after the (bounded) regeneration? */
export function stillMaterial(result: ClaimCheckResult): boolean {
  return findMaterialProblems(result) !== null
}

/**
 * Which claim each retrieved source SUPPORTS (per the actual verification):
 * the first supported claim that cites it wins. Used for the per-source
 * "supports" line in the Sources section — real verification output, never
 * invented metadata. Only ids appearing in supported claims are mapped.
 */
export function buildSourceSupports(result: ClaimCheckResult | null): Map<number, string> {
  const map = new Map<number, string>()
  if (!result?.ran) return map
  for (const c of result.claims) {
    if (c.verdict !== 'supported') continue
    for (const id of c.evidenceIds) {
      if (!map.has(id)) map.set(id, c.text)
    }
  }
  return map
}

/**
 * Stable, NON-material gaps: background statements the evidence neither
 * supports nor contradicts. They must be reported ("explain exactly what
 * could not be verified"), not treated as failures.
 */
export function unverifiedBackgroundClaims(result: ClaimCheckResult | null): ClaimVerdict[] {
  if (!result?.ran) return []
  return result.claims.filter(
    (c) => c.verdict === 'unsupported' && !c.changing && c.dateConflict !== true,
  )
}

/**
 * Verification-summary entries for the claim check. Flagged claims become
 * FAILED entries (capped) so the UI shows exactly what the evidence could
 * not support; a clean check after a regeneration becomes a PASSED entry.
 */
export function claimVerificationEntries(
  result: ClaimCheckResult | null,
  regenerated: boolean,
): VerificationCheckView[] {
  if (!result || !result.ran) {
    if (result && result.degraded.length > 0) {
      // Verification is INCOMPLETE, not passed: the UI must see and show
      // exactly what could not be verified (never a silent drop).
      return [
        {
          check: 'claim grounding',
          status: 'incomplete',
          detail: `${result.degraded[0]} — sources were retrieved, but the claims in this answer could not be independently re-checked`,
        },
      ]
    }
    return []
  }
  const problems = findMaterialProblems(result)
  const entries: VerificationCheckView[] = []
  for (const c of [...problems?.contradicted ?? [], ...problems?.unsupportedChanging ?? []].slice(0, 6)) {
    entries.push({
      check: 'claim grounding',
      status: 'failed',
      detail:
        `"${c.text}" — ` +
        (c.verdict === 'contradicted'
          ? `retrieved evidence states otherwise${c.evidenceIds.length ? ` [${c.evidenceIds.join('][')}]` : ''}`
          : 'no retrieved source states this changing fact') +
        (c.note ? ` — ${c.note}` : ''),
    })
  }
  for (const c of (problems?.dateConflicts ?? []).slice(0, 4)) {
    entries.push({
      check: 'date consistency',
      status: 'failed',
      detail:
        `"${c.text}" — the stated date conflicts with ${c.evidenceIds.length ? 'the retrieved evidence' : 'another statement in this answer'}` +
        (c.note ? ` — ${c.note}` : ''),
    })
  }
  if (entries.length === 0) {
    entries.push({
      check: 'claim grounding',
      status: 'passed',
      detail:
        regenerated
          ? `all ${result.claims.length} factual claim(s) now match the retrieved evidence after one verification pass`
          : `${result.claims.length} factual claim(s) checked against the retrieved evidence`,
    })
  }
  // Honest gap reporting: background statements with no explicit evidence
  // support (not contradicted — simply unverified).
  const background = unverifiedBackgroundClaims(result).slice(0, 2)
  if (background.length > 0) {
    entries.push({
      check: 'claim grounding',
      status: 'incomplete',
      detail:
        `${background.length} background statement(s) had no explicit support in the retrieved evidence (not contradicted, left as general knowledge): ` +
        background.map((c) => `"${c.text}"`).join('; '),
    })
  }
  return entries
}

/** Grounding metadata (honest bookkeeping for the UI/report). */
export function groundingSummary(result: ClaimCheckResult | null, regenerated: boolean):
  | { checked: boolean; regenerated: boolean; contradicted: number; unsupported: number; passed: boolean; dateConflicts?: number; unavailable?: string }
  | null {
  if (!result) return null
  if (!result.ran) {
    return {
      checked: false,
      regenerated: false,
      contradicted: 0,
      unsupported: 0,
      passed: false,
      unavailable: result.degraded[0] ?? 'claim check did not run',
    }
  }
  const problems = findMaterialProblems(result)
  const dateConflicts = problems?.dateConflicts.length ?? 0
  return {
    checked: true,
    regenerated,
    contradicted: problems?.contradicted.length ?? 0,
    unsupported: problems?.unsupportedChanging.length ?? 0,
    passed: problems === null,
    ...(dateConflicts > 0 ? { dateConflicts } : {}),
  }
}
