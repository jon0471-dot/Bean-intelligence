/**
 * BEAN Intelligence — generation grounding pipeline (LAXII & JAZMII).
 *
 * Before an image/video generation reaches the EXISTING models, this module:
 *   1. understands the prompt (language, entities, intent, domains) — pure;
 *   2. decides whether REAL factual grounding is worth its latency
 *      (multimodal grounding mode: real creatures, real places, factual
 *      scenes) vs curated world knowledge alone;
 *   3. runs a bounded, cache-aware retrieval for the entities that need
 *      factual fidelity (SNIPPETS ONLY — page reads are not worth their
 *      latency inside a generation path);
 *   4. compiles a compact structured conditioning package around the user's
 *      ORIGINAL prompt: world-knowledge constraints, motion timeline (video),
 *      camera/light directives, and fidelity notes with real source hosts.
 *
 * Hard contracts:
 *  - The user's prompt is preserved VERBATIM and FIRST — conditioning is
 *    appended guidance, never a rewrite.
 *  - Retrieval failures degrade honestly (a note is recorded, generation
 *    continues with curated knowledge alone). The conditioning block NEVER
 *    fabricates a source: only hosts actually returned by the provider are
 *    cited.
 *  - Deterministic-first: understanding + assembly are microseconds; the
 *    only network cost is at most ONE bounded search (single retry per the
 *    research layer's measured policy).
 */

import { understandPrompt, type PromptUnderstanding } from './understanding'
import { assembleWorldKnowledge, renderWorldKnowledgeBlock, type WorldComponent } from './world'
import { extractCinematography, renderCinematographyBlock, type CinematographyDirectives } from './cinema'
import { compileSceneSpecification } from './scene-spec'
import { searchWithBoundedRetry, runSharedSearch } from '@/lib/research/pipeline'
import type { WebSearchResult } from '@/lib/research/provider'
import { getSearchCache } from '@/lib/research/cache'
import { LANGUAGE_NAMES } from './language'

export type GroundingMode = 'none' | 'facts'

export interface GroundingEvidence {
  host: string
  url: string
  title: string
  /** One-line relevance digest used in fidelity notes. */
  note: string
}

export interface GenerationGrounding {
  mode: GroundingMode
  understanding: PromptUnderstanding
  /** Appended structured conditioning block (may be empty). */
  conditioning: string
  /** Full conditioned prompt: original verbatim + conditioning. */
  conditionedPrompt: string
  /** Real retrieved sources actually used (may be empty). */
  evidence: GroundingEvidence[]
  /** Curated world components assembled for this prompt. */
  knowledgeKeys: string[]
  cinematography: CinematographyDirectives
  /** Structured scene specification (Part B §1) — persisted for audit. */
  sceneSpec: Record<string, unknown>
  /** Honest degradation notes (retrieval unavailable, timeouts…). */
  degraded: string[]
  timing: { understandMs: number; retrieveMs: number; compileMs: number; totalMs: number }
  /** Language the prompt was written in (audit + answer-language policy). */
  promptLanguage: string
}

// ---------------------------------------------------------------------------
// Injectable search seam (tests stub this; prod uses the shared pipeline)
// ---------------------------------------------------------------------------

export type GroundingSearch = (
  query: string,
  opts: { num?: number; recencyDays?: number },
) => Promise<WebSearchResult[]>

async function defaultGroundingSearch(q: string, opts: { num?: number; recencyDays?: number }): Promise<WebSearchResult[]> {
  const outcome = await searchWithBoundedRetry(q, opts)
  if (outcome.error !== null) throw new Error(outcome.error)
  return outcome.results
}

let searchImpl: GroundingSearch = defaultGroundingSearch

/** Test seam — swap the retrieval implementation (null restores default). */
export function setGroundingSearchForTests(fn: GroundingSearch | null): void {
  searchImpl = fn ?? defaultGroundingSearch
}

// ---------------------------------------------------------------------------
// Mode decision (pure)
// ---------------------------------------------------------------------------

/**
 * Decide whether generation needs live factual retrieval.
 * Curated world knowledge (world.ts) already covers generic anatomy,
 * physics, materials and nature — that needs NO search. Retrieval earns its
 * latency only when the prompt names REAL-SPECIFIC things a model may get
 * factually wrong: concrete species, real places/landmarks, or technical
 * domains (vehicles, architecture) where accuracy is verifiable.
 */
export function decideGenerationGrounding(u: PromptUnderstanding): GroundingMode {
  if (u.intent !== 'generate-image' && u.intent !== 'generate-video' && u.intent !== 'edit-image') return 'none'
  // Fantastical subjects do not need factual grounding.
  const fantastical = /\b(dragon|phoenix|unicorn|mermaid|fairy|griffin|alien\w*|spaceship|fantasy\s+creature)\b/i.test(u.normalized)
  if (fantastical && u.creatures.length <= 1) return 'none'
  const realCreature = u.creatures.some((c) => !/dragon|phoenix|unicorn|mermaid|fairy|griffin/.test(c))
  const realPlace = u.places.length > 0
  const technicalDomain = u.domains.some((d) =>
    ['automotive-aerospace', 'architecture-construction', 'manufacturing-mechanical', 'medicine-healthcare'].includes(d.domain),
  )
  if (realCreature || realPlace || technicalDomain) return 'facts'
  return 'none'
}

// ---------------------------------------------------------------------------
// Bounded retrieval
// ---------------------------------------------------------------------------

const RETRIEVE_TIMEOUT_MS = Number(process.env.BEAN_INTEL_GROUNDING_TIMEOUT_MS ?? 9_000)

/**
 * Build the grounded retrieval query for the prompt's primary factual
 * subject (deterministic). English descriptors broaden indexing; the
 * detected entity terms stay verbatim.
 */
export function buildGroundingQuery(u: PromptUnderstanding): string | null {
  const species = u.creatures.find((c) => !/dragon|phoenix|unicorn|mermaid|fairy|griffin/.test(c))
  if (species) return `${species} real appearance anatomy and movement reference`
  if (u.places.length > 0) return `${u.places[0]} real appearance landmark view`
  if (u.domains.some((d) => d.domain === 'automotive-aerospace')) {
    const m = u.normalized.match(/\b(car|truck|motorcycle|airplane|aircraft|drone|rocket)\b/i)
    if (m) return `${m[1].toLowerCase()} real design and movement reference`
  }
  return null
}

async function retrieveEvidence(u: PromptUnderstanding): Promise<{ evidence: GroundingEvidence[]; degraded: string[] }> {
  const query = buildGroundingQuery(u)
  if (!query) return { evidence: [], degraded: [] }
  const cached = getSearchCache<WebSearchResult>(query, undefined, 'moderate')
  if (cached.hit) {
    return { evidence: digestResults(cached.value), degraded: [] }
  }
  let results: WebSearchResult[]
  try {
    const run = searchImpl(query, { num: 5 })
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('grounding retrieval timeout')), RETRIEVE_TIMEOUT_MS))
    results = await Promise.race([run, timeout])
  } catch (e) {
    return {
      evidence: [],
      degraded: [
        `factual grounding retrieval did not complete (${e instanceof Error ? e.message : 'unavailable'}); ` +
          `continuing with curated world knowledge only — no source is claimed`,
      ],
    }
  }
  cached.put(results)
  return { evidence: digestResults(results), degraded: [] }
}

function digestResults(results: WebSearchResult[]): GroundingEvidence[] {
  return results
    .filter((r) => r.url && r.title)
    .slice(0, 3)
    .map((r) => ({
      host: r.hostName,
      url: r.url,
      title: r.title.slice(0, 120),
      note: r.snippet.replace(/\s+/g, ' ').slice(0, 240),
    }))
}

// ---------------------------------------------------------------------------
// Conditioning compilation
// ---------------------------------------------------------------------------

/** Character budget for the APPENDED conditioning block (per product).
 *  LAXII IMAGE QUALITY (2026-11-10): raised 2200→2600 so the §1 scene
 *  specification AND the world-knowledge facts coexist (measured: the tiger
 *  conditioning needed both; the user prompt itself is never truncated). */
const CONDITIONING_BUDGET: Record<'laxii' | 'jazmii', number> = { laxii: 2600, jazmii: 2600 }

function fidelityNotes(evidence: GroundingEvidence[]): string {
  if (evidence.length === 0) return ''
  const lines = ['FIDELITY NOTES (retrieved references):']
  for (const e of evidence) {
    lines.push(`- ${e.host}: ${e.note}`)
  }
  return lines.join('\n')
}

/**
 * Motion timeline for video generation (deterministic decomposition).
 * Encodes beginning → action → physics → end state; the ACTION phrasing is
 * taken from the user's own prompt so the timeline never invents events.
 */
export function buildMotionTimeline(prompt: string, u: PromptUnderstanding): string {
  const actionCore = prompt.replace(/\s+/g, ' ').trim()
  const flight = u.creatures.length > 0 || /\b(fly\w*|soar\w*|wing\w*)\b/i.test(actionCore)
  const lines = ['MOTION TIMELINE:']
  if (flight) {
    lines.push('- Start: subject grounded/prepared, weight gathered, environment at rest.')
    lines.push('- Action: the requested movement develops with proper limb/wing mechanics and continuous weight shift.')
    lines.push('- Middle: motion at full expression — no pose holds mid-action, no position jumps.')
    lines.push('- End: motion settles into a stable, physically plausible final state.')
  } else {
    lines.push('- Start: establish the scene and subject exactly as described, at rest or in the stated initial motion.')
    lines.push('- Action: the requested movement develops continuously with consistent speed and direction.')
    lines.push('- End: motion settles naturally; all subjects/objects remain consistent with the start state.')
  }
  return lines.join('\n')
}

/**
 * Compile the full conditioning block. Bounded to the product budget;
 * truncation drops the LOWEST-priority sections first (fidelity notes →
 * extra world facts) and NEVER touches the user prompt.
 */
export function compileConditioning(
  u: PromptUnderstanding,
  worldComponents: WorldComponent[],
  evidence: GroundingEvidence[],
  product: 'laxii' | 'jazmii',
  opts: { referenceContinuity?: string } = {},
): string {
  const cinema = extractCinematography(u.normalized)
  const sections: Array<{ priority: number; text: string }> = []

  // LAXII IMAGE QUALITY (2026-11-10, Part B §1): the structured scene
  // specification is the §1 core deliverable — subjects/count, spatial
  // layers, light direction, materials and contact points — so it takes
  // budget precedence over the (longer) world-knowledge facts, which fill
  // the remaining budget. The user's prompt itself is NEVER truncated.
  if (product === 'laxii') {
    const spec = compileSceneSpecification(u, cinema)
    if (spec.block) sections.push({ priority: 1, text: spec.block })
  }

  const worldBlock = renderWorldKnowledgeBlock(worldComponents)
  if (worldBlock) sections.push({ priority: 2, text: worldBlock })

  if (product === 'jazmii') {
    sections.push({ priority: 1, text: buildMotionTimeline(u.normalized, u) })
  }
  sections.push({ priority: 3, text: renderCinematographyBlock(cinema, product) })

  if (opts.referenceContinuity) sections.push({ priority: 0, text: opts.referenceContinuity })

  const notes = fidelityNotes(evidence)
  if (notes) sections.push({ priority: 4, text: notes })

  // Assemble within budget (highest priority first, then re-order).
  const ordered = [...sections].sort((a, b) => a.priority - b.priority)
  const kept: string[] = []
  let used = 0
  for (const s of ordered) {
    if (used + s.text.length + 2 <= CONDITIONING_BUDGET[product]) {
      kept.push(s.text)
      used += s.text.length + 2
    }
  }
  return kept.join('\n\n')
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Full image-generation intelligence (LAXII).
 * Never throws; every failure degrades into `degraded` notes.
 */
export async function prepareImageIntelligence(rawPrompt: string): Promise<GenerationGrounding> {
  return prepareGenerationIntelligence(rawPrompt, 'laxii')
}

/**
 * Full video-generation intelligence (JAZMII).
 * `referenceContinuity` carries the previous-shot/reference-image continuity
 * directives when the caller extracted them (vision analysis is the
 * caller's concern — continuity.ts).
 */
export async function prepareVideoIntelligence(
  rawPrompt: string,
  opts: { referenceContinuity?: string } = {},
): Promise<GenerationGrounding> {
  return prepareGenerationIntelligence(rawPrompt, 'jazmii', opts)
}

async function prepareGenerationIntelligence(
  rawPrompt: string,
  product: 'laxii' | 'jazmii',
  opts: { referenceContinuity?: string } = {},
): Promise<GenerationGrounding> {
  const t0 = performance.now()
  const degraded: string[] = []

  const u = understandPrompt(rawPrompt, product)
  const understandMs = performance.now() - t0

  const mode = decideGenerationGrounding(u)
  const tR = performance.now()
  let evidence: GroundingEvidence[] = []
  if (mode === 'facts') {
    const r = await retrieveEvidence(u)
    evidence = r.evidence
    degraded.push(...r.degraded)
  }
  const retrieveMs = performance.now() - tR

  const tC = performance.now()
  const worldComponents = assembleWorldKnowledge(u)
  const cinemaDirectives = extractCinematography(u.normalized)
  const sceneSpec = compileSceneSpecification(u, cinemaDirectives)
  const conditioning = compileConditioning(u, worldComponents, evidence, product, opts)
  const compileMs = performance.now() - tC

  const conditionedPrompt =
    conditioning.length > 0 ? `${rawPrompt.trim()}\n\n${conditioning}` : rawPrompt.trim()

  if (u.language.confidence < 0.5 && u.language.primary !== 'en') {
    degraded.push(
      `language detection low-confidence (${LANGUAGE_NAMES[u.language.primary]}); the original wording was preserved verbatim as the primary conditioning text`,
    )
  }

  return {
    mode,
    understanding: u,
    conditioning,
    conditionedPrompt,
    evidence,
    knowledgeKeys: worldComponents.map((w) => w.key),
    cinematography: cinemaDirectives,
    sceneSpec: sceneSpec.fields,
    degraded,
    timing: {
      understandMs: round2(understandMs),
      retrieveMs: round2(retrieveMs),
      compileMs: round2(compileMs),
      totalMs: round2(performance.now() - t0),
    },
    promptLanguage: u.language.primary,
  }
}

function round2(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100)
}
