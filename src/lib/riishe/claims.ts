/**
 * BEAN Intelligence — claim-support audit (pure, deterministic).
 *
 * Work-order contract: "Verify that each material factual claim is supported
 * by retrieved evidence" and "If retrieval succeeds but verification is
 * incomplete, explain exactly what could not be verified."
 *
 * This is an honest COVERAGE audit, not a fake NLI: it finds the answer's
 * material factual statements (specific dates/years, quantities, or proper
 * nouns) and reports which ones carry NO citation marker pointing at
 * retrieved evidence. On top of coverage it runs these research-quality
 * audits demanded by the work orders:
 *
 *  1. SUPPORTED vs UNSUPPORTED split — a sentence without a citation marker
 *     whose content (names, dates, quantities) IS present in the retrieved
 *     evidence is "supported but uncited" (a grounding/presentation gap the
 *     repair pass fixes by adding the marker), NOT "unsupported". Only
 *     sentences whose content appears in NO retrieved source are reported as
 *     unsupported. Measured false-warning class (work order): the TN CM
 *     answer's claim was directly supported by the official source but was
 *     worded as "not covered by the retrieved sources".
 *  2. ALLEGATION ATTRIBUTION — sentences reporting suspects, detentions,
 *     arrests or accusations must carry attribution language ("police said",
 *     "according to", "reported"). A bare allegation stated as fact is
 *     flagged; the orchestrator feeds it to the bounded repair pass and,
 *     when repair does not fix it, names it in the verification note.
 *  3. NAME GROUNDING — proper-noun details in a CITED sentence must actually
 *     appear in the text (title/snippet/excerpt) of at least one source that
 *     sentence cites. Matching is punctuation-insensitive and
 *     acronym-aware: "TVK" is grounded when the cited source spells out
 *     "Tamilaga Vettri Kazhagam" and vice versa; "M.K. Stalin" matches
 *     "M K Stalin". This is the deterministic guard against snippet
 *     over-trust ("Hemavathi" vs "Hemalatha" in the measured Gingee runs)
 *     — equivalent wording of the SAME fact never flags, a name no cited
 *     source contains still does.
 *  4. PROBABILISTIC-OUTCOME ATTRIBUTION (sensitive cases) — a percentage
 *      attached to a case outcome ("a 90% chance she is alive") is a REPORTED
 *      estimate, never an independently verified probability: it must carry
 *      attribution language even when cited.
 *  5. INTERNAL NAME-CONFLICT (sensitive cases) — two different person names
 *      attached to the same role ("a seven-year-old girl") across the answer
 *      is a claim-to-source consistency defect: the reports disagree and the
 *      answer must say so instead of silently picking one.
 *  6. REPEATED HEDGES — uncertainty stated MORE than twice; the synthesis
 *     protocol requires a limitation to appear ONCE.
 *
 * It never upgrades a state and never invents support.
 */

import { splitProtected, splitIntoSentences } from './dedupe'
import { textMentionsTerm, placeKeysOf } from '@/lib/research/geo'
import { parseSourceDate } from '@/lib/research/rank'

export interface ClaimSupportAudit {
  /** Prose sentences carrying material factual signals. */
  materialCount: number
  /** Of those, how many carry at least one resolved citation marker. */
  supportedCount: number
  /** 0..1, or 1 when there are no material sentences (nothing unsupported). */
  coverage: number
  /** Material sentences with no citation marker and NO trace in the
   *  retrieved evidence — genuinely unsupported. */
  unsupported: string[]
  /** Material sentences with no citation marker whose content IS present in
   *  the retrieved evidence — supported but not tied to a citation. */
  uncitedSupported: string[]
  /** Exact totals for both lists above (the arrays are display-capped). */
  unsupportedTotal: number
  uncitedSupportedTotal: number
  /** First few unsupported-or-uncited material sentences (union of the two
   *  lists above, trimmed for display; kept for repair-pass inputs). */
  uncovered: string[]
  /** Sentences reporting an allegation with no attribution to a source. */
  unattributedAllegations: string[]
  /** Proper-noun details not found in the text of the sources cited for them. */
  ungroundedNames: string[]
  /** Uncertainty stated MORE than twice — the synthesis protocol requires a
   *  limitation to appear ONCE; this is the measured repeat-caveat defect. */
  repeatedHedges: string[]
  /** Sensitive-case only: percentage outcome claims reported without
   *  attribution ("a 90% chance" stated as an established finding). */
  unattributedProbabilistic: string[]
  /** Sensitive-case only: two or more different person names attached to the
   *  same role across the answer (the reports disagree on the identity). */
  nameConflicts: string[]
}

export interface ClaimAuditOptions {
  /** Turn concerns an ongoing incident/case — enables the sensitive-case
   *  probabilistic-attribution and name-conflict audits. */
  sensitiveCase?: boolean
  /** Searchable text of ALL retrieved sources (not only the cited ones) —
   *  powers the supported-but-uncited classification. */
  fullCorpus?: string
}

const STOP_CAPITALIZED = new Set([
  'the', 'this', 'that', 'these', 'those', 'there', 'here', 'when', 'while',
  'police', 'government', 'minister', 'officials', 'authorities', 'reports',
  'according', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may',
  'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'however', 'meanwhile', 'additionally', 'furthermore', 'overall', 'summary',
  // Role/agency words that appear capitalized mid-sentence but name no
  // individual ("Crime Branch-CID" is fine — the acronyms check catches it).
  'chief', 'crime', 'branch', 'district', 'superintendent', 'inspector',
  // Countries/temporal words: places are geo-grounded elsewhere, and these
  // appear constantly inside attribution frames ("India Today reported...")
  // where they name the PUBLISHER, not a person in the case.
  'india', 'today', 'updated', 'published',
])

/**
 * Evidence-gap meta-statements ("The retrieved reports do not specify why...",
 * "- Whether any suspects have been identified (this information was not
 * confirmed in any of the provided sources)") describe the ABSENCE of
 * evidence; they are not factual claims about the world and must not be
 * counted as uncovered material claims. Gate = an evidence word AND a
 * negation/gap cue anywhere in the sentence (order-independent). Sentences
 * that DO carry a resolved citation are still audited (a cited sentence is a
 * claim, whatever its phrasing).
 */
const EVIDENCE_NOUN_RE = /\b(?:retrieved|reports?|sources?|evidence|coverage)\b/i
const EVIDENCE_NEGATION_RE =
  /\b(?:was\s+not|were\s+not|is\s+not|are\s+not|do(?:es)?\s+not|did\s+not|could\s+not|cannot|not\s+confirmed|not\s+specif\w+|not\s+stated?|not\s+establish\w+|not\s+identif\w+|not\s+available|no\s+(?:newer|specific|official|dated|clear|information)|remain(?:s|ed)?\s+(?:unknown|unresolved|open)|leave[sd]?\s+(?:specific\s+)?questions?\s+open|unconfirmed)\b/i

function isEvidenceMetaSentence(sentence: string): boolean {
  return EVIDENCE_NOUN_RE.test(sentence) && EVIDENCE_NEGATION_RE.test(sentence)
}

/**
 * Allegation vocabulary: claims about suspects, detentions, arrests and
 * culpability. When such a claim appears in a missing-person or crime
 * answer it must be attributed, never stated as bare fact. The crime-verb
 * families (abduct/murder/rape/traffic/torture...) are included because a
 * bare "X abducted the girl" is precisely the unsupported-allegation
 * failure class the work order forbids.
 */
const ALLEGATION_RE =
  /\b(suspect|suspects|suspected|detained|detention|arrested|arrest|accused|accuses|alleged|alleges|allegation|allegations|charged|interrogat\w*|custody|kidnapper|kidnap\w*|abduct\w*|murder\w*|rape[ds]?|molest\w*|traffick\w*|tortur\w*|strangl\w*|culprit|perpetrator|prime facie)\b/i

/**
 * Attribution cues that make an allegation honest: the claim is tied to the
 * officials or outlet that reported it.
 */
const ATTRIBUTION_RE =
  /\b(said|says|according to|reported|reports|report|reporting|told|claimed|stated|states|announced|confirmed|citing|quoted|per the|per a)\b/i

/**
 * Uncertainty/hedge vocabulary: the phrasings an answer uses to say a fact
 * could not be verified. One occurrence is honest; THREE or more is the
 * measured "same caveat repeated in every paragraph" defect the synthesis
 * protocol forbids.
 */
const HEDGE_RE =
  /\b(could not be (?:verified|confirmed|established|determined)|cannot be (?:verified|confirmed)|no newer (?:reporting|coverage|updates?)|unverified|unconfirmed|not officially confirmed|remains? unverified|treat (?:it|them|this) as unverified)\b/i

/** How many hedge sentences are allowed before the repeat is flagged. */
export const HEDGE_REPEAT_THRESHOLD = 2

/**
 * Sensitive-case probabilistic-outcome vocabulary: a percentage attached to
 * one of these outcome words is a REPORTED estimate about the case ("police
 * said there is a 90% chance she is alive") and must be attributed to the
 * reporting that contains it — never presented as an independently verified
 * probability.
 */
const PROBABILITY_RE = /\b\d{1,3}\s*(?:%|percent\b)/i
const OUTCOME_LIKELIHOOD_RE =
  /\b(chance|odds|probability|probable|likely|likelihood|possibility|survival|survive[ds]?|alive|deceased|found)\b/i

/**
 * Role keywords that anchor WHO a name identifies in a sensitive-case answer.
 * A person name near one of these ("the missing girl, identified as ...",
 * "seven-year-old Hemalatha") participates in the name-conflict audit; the
 * same role with two different names across the answer is a contradiction.
 */
const ROLE_KEYWORD_RE =
  /\b(girl|boy|child|children|woman|man|person|victim|suspect|accused|toddler|infant|teen|teenager|student|minors?)\b|\b\d+\s*[- ]?year\s*[- ]?old\b|\b(?:seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[- ]year[- ]old\b/gi

/** Token window around a role keyword inside which a name counts as attached. */
const ROLE_NAME_WINDOW = 7

/** Lowercase the answer and strip characters that never distinguish names. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function splitSentences(prose: string): string[] {
  const lines = prose.split('\n')
  const sentences: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (/^#{1,6}\s/.test(trimmed)) continue // headings assert nothing by themselves
    sentences.push(...splitIntoSentences(trimmed))
  }
  return sentences
}

const QUESTION_RE = /\?\s*$/

function isMaterial(sentence: string): boolean {
  // Specific years and calendar dates.
  if (/\b(?:19|20)\d{2}\b/.test(sentence)) return true
  // Quantities: ages, counts, percentages, versions, distances.
  if (/\b\d[\d.,]*\s*(?:percent|%|year|month|day|hour|people|children|girl|boy|woman|man|police|officer|km|km\/h|kg|crore|lakh|million|billion|version|committees?|agencies?)\b/i.test(sentence)) return true
  if (/\b\d{2,}\b/.test(sentence)) return true
  // Named entities: a capitalized token that is not the sentence opener or a
  // common connective/role word (e.g. "Hemalatha", "Tamil Nadu"), ALL-CAPS
  // acronyms ("CB-CID", "DGP", "CCTV"), or a multiword proper sequence.
  const tokens = sentence.split(/\s+/)
  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i].replace(/[^\p{L}\p{N}-]/gu, '')
    if (/^[A-Z][A-Z-]{1,7}$/.test(tok)) return true
    if (/^[A-Z][a-z]{3,}$/.test(tok) && !STOP_CAPITALIZED.has(tok.toLowerCase())) return true
    // Multi-word proper sequence: "X Y" both capitalized mid-sentence.
    if (i + 1 < tokens.length) {
      const a = tokens[i].replace(/[^\p{L}\p{N}-]/gu, '')
      const b = tokens[i + 1].replace(/[^\p{L}\p{N}-]/gu, '')
      if (/^[A-Z]/.test(a) && /^[A-Z][a-z]/.test(b) && !STOP_CAPITALIZED.has(a.toLowerCase())) return true
    }
  }
  return false
}

function supportedIds(sentence: string): number[] {
  const ids: number[] = []
  const re = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sentence)) !== null) {
    for (const part of m[1].split(',')) ids.push(Number(part.trim()))
  }
  return ids
}

/** Proper-noun candidate tokens in a sentence (for the name-grounding audit). */
export function properNameCandidates(sentence: string): string[] {
  const names = new Set<string>()
  const tokens = sentence.split(/\s+/)
  for (let i = 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/^\p{P}+|\p{P}+$/gu, '')
    if (bare.length === 0) continue
    // Attribution SUBJECTS are outlets, not identifying details: skip the
    // token a reporting verb belongs to ("The Hindu reported ...") and the
    // object of "according to X". Otherwise every attributed sentence would
    // flag its own publisher as an "ungrounded name".
    const next = (tokens[i + 1] ?? '').replace(/^\p{P}+/u, '')
    if (/^(reported|reports|said|says|states|told|confirmed|announced|claimed|stated|wrote|added|noted)\b/i.test(next)) continue
    const prev = (tokens[i - 1] ?? '').replace(/\p{P}+$/gu, '')
    if (/^according$/i.test(prev)) continue
    if (/^[A-Z][A-Z-]{2,7}$/.test(bare)) {
      names.add(bare) // acronym (CB-CID, DGP; 3+ chars — "DT"/"TN"-style short forms stay out)
      continue
    }
    if (/^[A-Z][a-z]{3,}$/.test(bare) && !STOP_CAPITALIZED.has(bare.toLowerCase())) {
      names.add(bare)
    }
  }
  return [...names]
}

/**
 * Initialisms of multiword capitalized sequences in a text: "Tamilaga Vettri
 * Kazhagam" -> "tvk". Lets the name-grounding audit accept the ACRONYM when
 * the cited source spells the name out (and the expansion when the source
 * only uses the acronym — the reverse direction is handled by checking each
 * expansion word against the acronym's own letters via the corpus
 * initialism map built from the SENTENCE).
 */
export function corpusInitialisms(corpus: string): Set<string> {
  const out = new Set<string>()
  // Articles/prepositions never participate in a proper-name expansion:
  // "The Tamilaga Vettri Kazhagam" initials are TVK, not TTVK (measured
  // false negative: including "The" broke the acronym equivalence check).
  const GLUE = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'de', 'di'])
  const re = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(corpus)) !== null) {
    const words = m[0].split(/\s+/).filter((w) => !GLUE.has(w.toLowerCase()))
    if (words.length < 2) continue
    const initials = words.map((w) => w[0]).join('')
    if (initials.length >= 2) out.add(initials.toLowerCase())
  }
  return out
}

/**
 * Strip markdown decorations so token positions reflect the prose: a bullet
 * like "- **Oct 16, 2026**: Intensive search..." shifts "Intensive" away from
 * sentence-initial position, and without stripping, the emphasis marker made
 * a role word into a false person-name candidate (measured: the Gingee
 * answer produced a bogus "Hemalatha" vs "Intensive" conflict).
 */
function stripMarkdownDecor(sentence: string): string {
  return sentence
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '') // list bullets / numbered items
    .replace(/\*\*|__/g, '') // bold/italic emphasis
    .replace(/^#{1,6}\s+/, '') // defensive: heading markers
}

/**
 * Person-name candidates for the conflict audit: mixed-case proper words
 * (acronyms like CB-CID are organizations, not people, and are excluded;
 * gazetteer places like Gingee/Chennai are places, not people), grouped as
 * adjacent multiword names ("Joseph Vijay"), with single-letter initials
 * ("V Hemavathi") stripped, and with attribution-frame publishers skipped.
 */
function personNameCandidates(sentence: string): string[] {
  const tokens = stripMarkdownDecor(sentence).split(/\s+/)
  const places = new Set(placeKeysOf(sentence))
  const names: string[] = []
  let i = 1
  while (i < tokens.length) {
    const bare = tokens[i].replace(/^\p{P}+|\p{P}+$/gu, '')
    const isProper = /^[A-Z][a-z]{3,}$/.test(bare) && !STOP_CAPITALIZED.has(bare.toLowerCase())
    if (!isProper) {
      i += 1
      continue
    }
    // A capitalized word right after a colon starts a new clause (measured:
    // "- **Oct 16, 2026**: Intensive search ..." put the clause's first word
    // mid-token-list and made it a false person-name candidate). Clause
    // starts are not mid-sentence proper nouns for the conflict audit.
    const prevRaw = tokens[i - 1] ?? ''
    if (prevRaw.length === 0 || /[:：]\s*$/.test(prevRaw)) {
      i += 1
      continue
    }
    const next = (tokens[i + 1] ?? '').replace(/^\p{P}+/u, '')
    if (/^(reported|reports|said|says|states|told|confirmed|announced|claimed|stated|wrote|added|noted)\b/i.test(next)) {
      i += 1
      continue
    }
    const prev = (tokens[i - 1] ?? '').replace(/\p{P}+$/gu, '')
    if (/^according$/i.test(prev)) {
      i += 1
      continue
    }
    // group adjacent proper words into one name ("Joseph Vijay")
    let name = bare
    let j = i + 1
    while (j < tokens.length) {
      const nb = tokens[j].replace(/^\p{P}+|\p{P}+$/gu, '')
      if (/^[A-Z][a-z]{3,}$/.test(nb) && !STOP_CAPITALIZED.has(nb.toLowerCase())) {
        name += ` ${nb}`
        j += 1
      } else break
    }
    if (!places.has(name.toLowerCase()) && !places.has(bare.toLowerCase())) {
      names.push(name)
    }
    i = j
  }
  return names
}

/** Person names attached to a role keyword ("the missing girl, ...") in a sentence. */
function roleAttachedNames(sentence: string): Array<{ role: string; name: string }> {
  const out: Array<{ role: string; name: string }> = []
  const tokens = stripMarkdownDecor(sentence).split(/\s+/)
  const roleRe = new RegExp(ROLE_KEYWORD_RE.source, 'gi')
  // find role keywords with their token index
  const rolePositions: Array<{ idx: number; role: string }> = []
  tokens.forEach((tok, idx) => {
    roleRe.lastIndex = 0
    const m = roleRe.exec(tok)
    if (m) rolePositions.push({ idx, role: m[0].toLowerCase().replace(/\s+/g, '-') })
  })
  if (rolePositions.length === 0) return out
  // Canonical buckets: age phrases ("seven-year-old", "7-year-old") describe
  // the same subject as the person noun they modify — mapping them to the
  // noun's bucket (child/adult) is what lets "seven-year-old Hemalatha" and
  // "the missing girl ... Hemavathi" land in ONE bucket and conflict.
  const CHILD_WORDS = new Set(['girl', 'boy', 'child', 'children', 'toddler', 'infant', 'teen', 'teenager', 'student', 'minor', 'minors'])
  const ADULT_WORDS = new Set(['woman', 'man', 'person', 'victim'])
  const canonicalRole = (role: string): string => {
    if (/\d+[- ]?year[- ]?old/.test(role) || /\b(?:seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[- ]year[- ]old/.test(role)) {
      return 'age-described'
    }
    if (CHILD_WORDS.has(role)) return 'child'
    if (ADULT_WORDS.has(role)) return 'adult'
    return role
  }
  // An age phrase next to an explicit person noun is that noun's bucket.
  const buckets = new Map<string, number>() // bucket -> nearest role token idx
  for (const r of rolePositions) {
    const canon = canonicalRole(r.role)
    const existing = buckets.get(canon)
    if (existing === undefined || Math.abs(r.idx) < Math.abs(existing)) buckets.set(canon, r.idx)
  }
  for (const [canon] of buckets) {
    if (canon !== 'age-described') continue
    const ageIdx = buckets.get('age-described') as number
    for (const [other, idx] of buckets) {
      if (other === 'age-described') continue
      if (Math.abs(idx - ageIdx) <= 2) {
        buckets.delete('age-described') // the age phrase modifies this noun
        break
      }
    }
  }
  const names = personNameCandidates(sentence)
  for (const name of names) {
    const firstWord = name.split(' ')[0]
    const pos = tokens.findIndex((t) => t.replace(/^\p{P}+|\p{P}+$/gu, '') === firstWord)
    if (pos < 0) continue
    let best: { role: string; dist: number } | null = null
    for (const [canon, idx] of buckets) {
      const dist = Math.abs(idx - pos)
      if (dist <= ROLE_NAME_WINDOW && (best === null || dist < best.dist)) {
        best = { role: canon, dist }
      }
    }
    if (best) out.push({ role: best.role, name })
  }
  return out
}

/**
 * Internal name-conflict audit (sensitive cases): two DIFFERENT person names
 * attached to the same role across the answer ("seven-year-old Hemalatha" in
 * one sentence, "7-year-old V Hemavathi" in another) mean the reports
 * disagree on the identity — the answer must surface that disagreement.
 * Returns display fragments naming the conflicting names per role.
 */
export function findInternalNameConflicts(answer: string): string[] {
  const byRole = new Map<string, Set<string>>()
  const prose = splitProtected(answer)
    .map(({ text, code }) => (code ? ' ' : text))
    .join('\n')
  for (const sentence of splitSentences(prose)) {
    for (const { role, name } of roleAttachedNames(sentence)) {
      const set = byRole.get(role) ?? new Set<string>()
      set.add(name)
      byRole.set(role, set)
    }
  }
  const conflicts: string[] = []
  for (const [role, namesSet] of byRole) {
    if (namesSet.size < 2) continue
    // one name being a component of another ("Vijay" vs "Joseph Vijay") is
    // the same person, not a conflict
    const names = [...namesSet]
    const genuine = names.filter(
      (n) => !names.some((other) => other !== n && normalizeName(other).includes(normalizeName(n))),
    )
    if (genuine.length >= 2) {
      conflicts.push(`"${genuine.slice(0, 3).join('" vs "')}" (for the ${role})`)
    }
  }
  return conflicts.slice(0, 2)
}

function trimForDisplay(s: string): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}...` : clean
}

/** Distinctive content signals used to classify an uncited sentence:
 *  proper names and calendar years are decisive; bare numbers are weaker. */
function contentSignals(sentence: string): { strong: string[]; weak: string[] } {
  const strong: string[] = [...properNameCandidates(sentence)]
  const years: string[] = sentence.match(/\b(?:19|20)\d{2}\b/g) ?? []
  strong.push(...years)
  const weak = (sentence.match(/\b\d[\d.,]*\b/g) ?? [])
    .map((n) => n.replace(/[.,]+$/, ''))
    .filter((n) => !years.includes(n) && n.length > 0)
  return { strong, weak }
}

/**
 * Audit which material sentences carry resolved citations. `resolvedIds` is
 * the set of citation ids that actually resolve to retrieved sources.
 * `sourceTexts` (cited source id -> its searchable text: title + snippet +
 * full-page excerpt when read) powers the name-grounding audit; when it is
 * absent or a sentence cites nothing, name grounding is skipped for that
 * sentence (the coverage audit already flags uncited sentences).
 * `opts.fullCorpus` (all retrieved sources' searchable text) powers the
 * supported-vs-unsupported classification of UNCITED sentences.
 */
export function auditClaimSupport(
  answer: string,
  resolvedIds: ReadonlySet<number>,
  sourceTexts?: ReadonlyMap<number, string>,
  opts: ClaimAuditOptions = {},
): ClaimSupportAudit {
  const prose = splitProtected(answer)
    .map(({ text, code }) => (code ? ' ' : text))
    .join('\n')
  const sentences = splitSentences(prose)
  const fullCorpus = opts.fullCorpus ?? ''
  const initialisms = corpusInitialisms(fullCorpus)
  let materialCount = 0
  let supportedCount = 0
  const unsupported: string[] = []
  const uncitedSupported: string[] = []
  let unsupportedTotal = 0
  let uncitedSupportedTotal = 0
  const unattributedAllegations: string[] = []
  const ungroundedNames: string[] = []
  const unattributedProbabilistic: string[] = []
  const repeatedHedges: string[] = []
  let hedgeCount = 0
  for (const sentence of sentences) {
    if (QUESTION_RE.test(sentence)) continue // questions assert nothing
    const ids = supportedIds(sentence)
    const hasResolvedCitation = ids.some((id) => resolvedIds.has(id))
    // Evidence-gap meta-statements assert nothing about the world — they
    // describe what the evidence lacks. Exempt only when UNcited: a cited
    // sentence is a claim whatever its phrasing.
    if (!hasResolvedCitation && isEvidenceMetaSentence(sentence)) continue
    // Repeated-uncertainty audit (synthesis protocol: state a limitation
    // ONCE). Counted for EVERY prose sentence; after the threshold the
    // first repeating sentences are reported for the bounded repair pass.
    if (HEDGE_RE.test(sentence)) {
      hedgeCount += 1
      if (hedgeCount > HEDGE_REPEAT_THRESHOLD && repeatedHedges.length < 2) {
        repeatedHedges.push(trimForDisplay(sentence))
      }
    }
    // Allegation-attribution audit: applies to EVERY prose sentence, not
    // only material ones — a bare "a suspect has been detained" with no
    // number or proper noun is exactly the failure class the work order
    // forbids, and a material-only gate would let it slip through.
    if (unattributedAllegations.length < 2 && ALLEGATION_RE.test(sentence) && !ATTRIBUTION_RE.test(sentence)) {
      unattributedAllegations.push(trimForDisplay(sentence))
    }
    // Probabilistic-outcome attribution (sensitive cases only): "a 90%
    // chance she is alive" is a reported estimate — attribution language is
    // required even when the sentence carries a citation, because a bare
    // percentage presents speculation as an established finding.
    if (
      opts.sensitiveCase &&
      unattributedProbabilistic.length < 2 &&
      PROBABILITY_RE.test(sentence) &&
      OUTCOME_LIKELIHOOD_RE.test(sentence) &&
      !ATTRIBUTION_RE.test(sentence)
    ) {
      unattributedProbabilistic.push(trimForDisplay(sentence))
    }
    if (!isMaterial(sentence)) continue
    materialCount += 1
    const cited = hasResolvedCitation
      if (cited) {
      supportedCount += 1
    } else {
      // Classification (work-order fix): does the retrieved evidence actually
      // contain this sentence's content? Supported-but-uncited is a
      // presentation gap (the repair pass adds the marker); unsupported is a
      // real integrity problem. EVERY distinctive signal (names, years,
      // numbers) must be found — a shared subject name plus invented details
      // ("Joseph Vijay ... Mayor of Chennai") is still unsupported.
      const { strong, weak } = contentSignals(sentence)
      const allFound = (signals: string[], normalized: boolean): boolean => {
        if (signals.length === 0) return false
        return signals.every((s) =>
          normalized ? textMentionsTerm(fullCorpus, s) : fullCorpus.toLowerCase().includes(s.toLowerCase()),
        )
      }
      const uncited = strong.length > 0 ? allFound(strong, true) : allFound(weak, false)
      if (uncited) {
        uncitedSupportedTotal += 1
        if (uncitedSupported.length < 2) uncitedSupported.push(trimForDisplay(sentence))
      } else {
        unsupportedTotal += 1
        if (unsupported.length < 2) unsupported.push(trimForDisplay(sentence))
      }
    }
    // Name-grounding audit: only for sentences that DO cite, so the audit
    // never double-flags what the coverage audit already reports.
    if (cited && sourceTexts && sourceTexts.size > 0 && ungroundedNames.length < 2) {
      const corpus = ids
        .filter((id) => sourceTexts.has(id))
        .map((id) => (sourceTexts.get(id) ?? ''))
        .join(' ')
      if (corpus.length > 0) {
        const corpusLower = corpus.toLowerCase()
        const corpusNormalized = normalizeName(corpus)
        const fullLower = fullCorpus.toLowerCase()
        const sentenceInitialisms = corpusInitialisms(sentence)
        for (const name of properNameCandidates(sentence)) {
          const nLower = name.toLowerCase()
          const nNormalized = normalizeName(name)
          // Organization acronyms (CB-CID, DGP, TVK...) are institutional
          // vocabulary, not identifying details about a person: when the page
          // read failed and the cited source's snippet lacks the short form
          // that OTHER retrieved sources plainly use, flagging it would be
          // noise (measured: "CB-CID could not be located" on a snippet-only
          // corpus). Acronyms may therefore be grounded in ANY retrieved
          // source; person names stay cited-source-only.
          const isAcronym = /^[A-Z][A-Z-]{2,7}$/.test(name)
          const grounded =
            corpusLower.includes(nLower) || // exact form
            (nNormalized.length >= 3 && corpusNormalized.includes(nNormalized)) || // punctuation-insensitive ("M.K." vs "M K")
            initialisms.has(nLower) || // answer's acronym = corpus expansion ("TVK" = "Tamilaga Vettri Kazhagam")
            (isAcronym && nLower.length >= 2 && fullLower.includes(nLower)) || // acronym in the wider evidence
            (sentenceInitialisms.size > 0 &&
              [...sentenceInitialisms].some((ini) => ini.length >= 2 && corpusLower.includes(ini)) &&
              isPartOfExpansion(name, sentence)) // answer's expansion = corpus acronym
          if (!grounded) {
            ungroundedNames.push(name)
            break // one flag per sentence is enough for repair
          }
        }
      }
    }
  }
  const uncovered = [...unsupported, ...uncitedSupported].slice(0, 2)
  const coverage = materialCount === 0 ? 1 : supportedCount / materialCount
  const nameConflicts = opts.sensitiveCase ? findInternalNameConflicts(answer) : []
  return {
    materialCount,
    supportedCount,
    coverage,
    unsupported,
    uncitedSupported,
    unsupportedTotal,
    uncitedSupportedTotal,
    uncovered,
    unattributedAllegations,
    ungroundedNames,
    repeatedHedges,
    unattributedProbabilistic,
    nameConflicts,
  }
}

/** True when `name` belongs to a multiword capitalized expansion in the
 *  sentence whose initials appear as an acronym token in the sentence itself
 *  (the corpus-side check happens at the call site). */
function isPartOfExpansion(name: string, sentence: string): boolean {
  const re = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(sentence)) !== null) {
    const words = m[0].split(/\s+/)
    if (words.some((w) => w.toLowerCase() === name.toLowerCase())) return true
  }
  return false
}

/**
 * Currency-consistency audit (pure): flags an answer whose latest-status
 * claim cites only sources meaningfully OLDER than the newest retrieved
 * evidence. Measured failure (work order): the Next.js answer said "the
 * latest stable version is 16.1 (Dec 18, 2025 blog)" while the evidence set
 * also contained the current registry record — a stale answer conflicting
 * with newer dated reporting. Returns a short warning fragment or null.
 */
export function staleCurrencyConflict(args: {
  answer: string
  /** Age in days of the NEWEST dated source the answer cites (null when none cited source carries a parseable date). */
  citedNewestAgeDays: number | null
  /** Age in days of the NEWEST dated source in the retrieved evidence. */
  evidenceNewestAgeDays: number | null
  /** Minimum gap (days) between cited-newest and evidence-newest to flag. */
  minGapDays?: number
}): string | null {
  const { answer, citedNewestAgeDays, evidenceNewestAgeDays, minGapDays = 30 } = args
  if (!/\b(latest|newest|current|most\s+recent|as\s+of)\b/i.test(answer)) return null
  if (evidenceNewestAgeDays === null) return null
  if (citedNewestAgeDays === null) return null
  if (citedNewestAgeDays - evidenceNewestAgeDays < minGapDays) return null
  return (
    `newer retrieved evidence exists (up to ${evidenceNewestAgeDays} day${evidenceNewestAgeDays === 1 ? '' : 's'} old) than the newest cited source ` +
    `(${citedNewestAgeDays} days old) — the latest-status claim may be out of date`
  )
}

/**
 * Undated "as of" claims (pure): flags sentences that state an explicit date
 * ("As of October 27, 2026, ...") while EVERY source they cite carries NO
 * verifiable publication date. Work-order rule: the answer must not present
 * an undated report as the latest confirmed development — a dated "as of"
 * framing whose date no cited source verifies is exactly that failure
 * (measured: an undated News18 video page carried an "As of October 27"
 * claim). Returns display fragments.
 */
export function undatedAsOfClaims(
  answer: string,
  citedDates: ReadonlyMap<number, string | null>,
): string[] {
  const flags: string[] = []
  const prose = splitProtected(answer)
    .map(({ text, code }) => (code ? ' ' : text))
    .join('\n')
  for (const sentence of splitSentences(prose)) {
    if (QUESTION_RE.test(sentence)) continue
    if (!/\bas\s+of\b/i.test(sentence)) continue
    if (!/\b\d{1,2}\b|\b(?:19|20)\d{2}\b/.test(sentence)) continue
    const ids = supportedIds(sentence)
    if (ids.length === 0) continue // uncited currency phrasing is the coverage audit's domain
    if (!ids.every((id) => citedDates.has(id))) continue // only fully-cited sentences
    const allUndated = ids.every((id) => citedDates.get(id) === null || citedDates.get(id) === undefined)
    if (allUndated && flags.length < 2) flags.push(trimForDisplay(sentence))
  }
  return flags
}
