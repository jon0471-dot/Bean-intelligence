/**
 * BEAN Intelligence — unified prompt understanding (entities, intent,
 * professional-domain taxonomy, ambiguity, structured task plan).
 *
 * Pure and deterministic (microseconds): regex/keyword signals over the
 * normalized prompt. Shared by ALL FOUR products so that every lane
 * understands a request the same way before acting on it.
 *
 * The domain taxonomy covers the professional disciplines BEAN serves
 * (medicine, engineering, software, law, finance, media, photography,
 * animation/VFX, manufacturing, automotive/aerospace, music, languages,
 * history, wildlife, nature, skilled trades, …). It is a ROUTING taxonomy,
 * not a knowledge base: it tells retrieval and knowledge assembly WHICH
 * domains matter for a prompt; the actual facts come from live retrieval
 * and the world-knowledge components — never from this list alone.
 *
 * Honesty contract: classification is heuristic. Results carry the matched
 * signals so callers (and the evaluation suite) can audit WHY a domain or
 * intent was chosen. `ambiguous` flags are conservative — they mark prompts
 * whose subject/multiplicity is unclear, they never silently rewrite one.
 */

import { detectLanguage, extractPreservedTerms, type LanguageProfile, type PreservedTerms } from './language'

export type ProductLane = 'riishe' | 'laxii' | 'jazmii' | 'code-giftz'

export type Intent =
  | 'answer' // informational question / research / explanation
  | 'generate-image'
  | 'edit-image'
  | 'generate-video'
  | 'coding-task'
  | 'transformation' // summarize/translate/rewrite of user-provided material
  | 'smalltalk'

export interface DomainSignal {
  domain: string
  score: number
  matched: string[]
}

export interface PromptUnderstanding {
  /** Normalized prompt (NFC, control chars stripped) — everything downstream reads this. */
  normalized: string
  language: LanguageProfile
  terms: PreservedTerms
  intent: Intent
  /** Professional domains relevant to the prompt, strongest first (max 3). */
  domains: DomainSignal[]
  /** Species / creature mentions relevant to animal knowledge assembly. */
  creatures: string[]
  /** Natural phenomena mentioned (water, fire, smoke, weather…). */
  nature: string[]
  /** Materials mentioned (glass, metal, wood, cloth, liquid…). */
  materials: string[]
  /** Physics-rich actions mentioned (collision, pouring, falling, flight…). */
  physicsActions: string[]
  /** Named real-world places/landmarks (drives factual retrieval). */
  places: string[]
  /** Conservative ambiguity flags with reasons. */
  ambiguous: string[]
  /** Microsecond-level classification duration (for latency accounting). */
  durationMs: number
}

// ---------------------------------------------------------------------------
// Signal tables
// ---------------------------------------------------------------------------

/**
 * Professional-domain taxonomy seeds. Regexes are deliberately broad; the
 * score is match-count based so a prompt touching several domains ranks all
 * of them. Adding a domain = adding one row here (dynamic by retrieval, not
 * hardcoded knowledge).
 */
const DOMAIN_SEEDS: Array<{ domain: string; re: RegExp }> = [
  { domain: 'medicine-healthcare', re: /\b(medical|medicine|doctor|patient|symptom|disease|diagnos\w*|treatment|surgery|anatomy|clinical|therapy|drug|dosage|x-ray|mri|hospital|மருத்துவ|स्वास्थ्य)\b/i },
  { domain: 'engineering-electronics', re: /\b(circuit|voltage|current|resistor|capacitor|pcb|microcontroller|sensor|wiring|motor|transformer|embedded|arduino|raspberry)\b/i },
  { domain: 'computer-science-software', re: /\b(software|algorithm|data structure|api|database|framework|library|compiler|runtime|deploy|code|function|bug|program\w*|typescript|javascript|python|java\b|rust\b|golang)\b/i },
  { domain: 'architecture-construction', re: /\b(architecture|building|blueprint|floor plan|construction|concrete|beam|foundation|facade|interior design|renovation|structural)\b/i },
  { domain: 'science-mathematics', re: /\b(physics|chemistry|biology|mathematic\w*|theorem|equation|calculus|algebra|geometry|quantum|molecule|atom|experiment|lab)\b/i },
  { domain: 'physics', re: /\b(gravity|momentum|inertia|friction|velocity|acceleration|trajectory|fluid|optics|refraction|reflection|shadow|collision|kinetic)\b/i },
  { domain: 'biology-anatomy', re: /\b(anatomy|skeleton|muscle|bone|joint|organ|cell\b|dna|protein|species|evolution|physiology)\b/i },
  { domain: 'agriculture-environment', re: /\b(agricultur\w*|crop|farm\w*|soil|irrigation|harvest|climate|ecosystem|forest\w*|pollution|sustainab\w*)\b/i },
  { domain: 'law-governance', re: /\b(law|legal|statute|regulation|compliance|contract|court|lawsuit|liability|visa|policy|governance)\b/i },
  { domain: 'finance-accounting', re: /\b(finance|financial|accounting|invoice|tax\w*|balance sheet|profit|revenue|investment|stock|portfolio|budget|audit)\b/i },
  { domain: 'business-management', re: /\b(business|management|strategy|marketing|startup|stakeholder|roadmap|kpi|procurement|supply chain|hr\b)\b/i },
  { domain: 'education-research', re: /\b(education|teaching|curriculum|lesson|student|thesis|research paper|citation|academic|study plan)\b/i },
  { domain: 'media-filmmaking', re: /\b(film|filmmaking|cinema|scene|shot|camera|director|screenplay|storyboard|editing|footage|b-roll|cinematograph\w*)\b/i },
  { domain: 'photography-design', re: /\b(photo\w*|photography|lens|exposure|aperture|shutter|iso\b|composition|lighting|studio|portrait|design|typography|logo)\b/i },
  { domain: 'animation-vfx', re: /\b(animat\w*|vfx|cgi|keyframe|rigging|motion capture|render\w*|frame rate|stop motion|compositing)\b/i },
  { domain: 'manufacturing-mechanical', re: /\b(manufactur\w*|machin\w*|cnc|welding|tolerance|assembly line|gear|bearing|hydraulic|pneumatic|prototype)\b/i },
  { domain: 'automotive-aerospace', re: /\b(car|vehicle|automobile|engine|chassis|tire|tyre|brake|aircraft|airplane|drone|rocket|aerodynamic|cockpit|spacecraft)\b/i },
  { domain: 'music-sound', re: /\b(music|audio|sound|midi|mixing|mastering|equalizer|reverb|synthesizer|guitar|piano|drum|vocal|tempo)\b/i },
  { domain: 'languages-literature', re: /\b(translate|translation|grammar|literature|poem|poetry|novel|essay|language learning|vocabulary)\b/i },
  { domain: 'history-geography', re: /\b(history|historical|dynasty|war\b|empire|century|ancient|heritage|monument|geography|continent|river\b|mountain)\b/i },
  { domain: 'animals-wildlife', re: /\b(animal\w*|bird\w*|crow|eagle|sparrow|parrot|owl|cat|dog|puppy|kitten|monkey|elephant|tiger|lion|horse|deer|snake|crocodile|turtle|fish|shark|whale|dolphin|insect|butterfly|bee\b|wildlife|fauna|காகம்|மயில்|पशु|जानवर)\b/i },
  { domain: 'nature-environment-systems', re: /\b(nature|ocean|sea\b|wave\w*|waterfall|river|lake|rain\w*|storm\w*|cloud\w*|fire|flame|smoke|snow\w*|wind\w*|tree\w*|forest|volcano|desert|sunset|sunrise|landscape)\b/i },
  { domain: 'skilled-trades', re: /\b(plumb\w*|electrician|carpenter\w*|weld\w*|masonry|mason|roof\w*|paint\w* job|handyman|tailor|chef|bartender|mechanic)\b/i },
]

const CREATURE_WORDS: RegExp =
  /\b(crow|crows|eagle|eagles|hawk|falcon|owl|sparrow|parrot|peacock|pigeon|seagull|hummingbird|bird|birds|cat|cats|kitten|dog|dogs|puppy|monkey|monkeys|ape|apes|elephant|elephants|tiger|lion|horse|deer|wolf|fox|bear|snake|crocodile|lizard|turtle|tortoise|frog|fish|shark|whale|dolphin|octopus|butterfly|bee|dragon|phoenix|griffin)\b/gi

const NATURE_WORDS: RegExp =
  /\b(ocean|sea|wave|waves|waterfall|river|lake|rain|raindrop|storm|thunder|lightning|cloud|clouds|fog|mist|fire|flame|flames|smoke|dust|snow|blizzard|wind|breeze|gale|tree|trees|leaves|foliage|grass|flower\w*|volcano|lava|sunset|sunrise|galaxy|nebula)\b/gi

const MATERIAL_WORDS: RegExp =
  /\b(glass|metal|steel|iron|aluminium|aluminum|copper|wooden?|plastic|rubber|cloth|fabric|silk|leather|paper|concrete|marble|ceramic|porcelain|water|milk|honey|oil|juice|liquid|slime|lava|gold|silver|chrome)\b/gi

const PHYSICS_ACTION_WORDS: RegExp =
  /\b(fall\w*|jump\w*|leap\w*|collid\w*|crash\w*|smash\w*|shatter\w*|break\w*|splash\w*|pour\w*|spill\w*|flow\w*|dripp?ing|swim\w*|fly\w*|fl\w*ing|soar\w*|glid\w*|run\w*|sprint\w*|walk\w*|dance\w*|spin\w*|rotat\w*|swing\w*|throw\w*|toss\w*|launch\w*|explode\w*|bounce\w*|slide\w*|skid\w*|drift\w*)\b/gi

const PLACE_RE: RegExp =
  /\b((?:Mount|Lake|River|Fort|Beach|Bay|Isle|Island|Cape)\s+[A-Z][\p{L}]+|[A-Z][\p{L}]{3,}(?:\s+(?:City|Beach|Falls|Desert|Forest|National Park|Temple|Cathedral|Bridge|Tower))?)\b/gu

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

const IMAGE_INTENT: RegExp =
  /\b(generate|create|draw|make|render|design|produce)\b[^\n]{0,40}\b(image|picture|photo|illustration|artwork|poster|logo|wallpaper|portrait|painting|drawing|render)\b|\b(image|picture|photo|illustration|artwork|poster|wallpaper|portrait|painting)\s+(?:of|showing|depicting)\b|\b(t2i|text.to.image)\b/i
const EDIT_INTENT: RegExp =
  /\b(edit|modify|change|replace|remove|inpaint|retouch|recolor|outpaint)\b[^\n]{0,40}\b(image|photo|picture|background|region|area|part)\b|\b(remove|erase)\s+(the\s+)?(background|object|person)\b/i
const VIDEO_INTENT: RegExp =
  /\b(video|animation|animated|timelapse|slow.?motion|cinematic clip|clip|footage|camera move|dolly|tracking shot|pan\b|tilt\b|zoom in|zoom out)\b|\b(t2v|i2v|text.to.video|image.to.video)\b/i
const CODING_INTENT: RegExp =
  /\b(code|function|script|program|debug|refactor|implement|compile|api endpoint|unit test|class\b|npm\b|pip\b|stack trace|typescript|javascript|python|java\b|sql\b|html|css|react|node)\b/i
const TRANSFORM_INTENT: RegExp =
  /^\s*(summar\w+|translat\w+|rewrite|paraphras\w+|proofread|shorten|expand|reformat)\b/i

/**
 * Classify intent for a lane. The lane biases the default (LAXII submit =
 * generate-image even when the wording is a bare subject).
 */
export function classifyIntent(text: string, lane: ProductLane): Intent {
  const t = text.trim()
  if (!t) return lane === 'laxii' ? 'generate-image' : lane === 'jazmii' ? 'generate-video' : 'answer'
  if (EDIT_INTENT.test(t) && (lane === 'laxii' || /\b(image|photo|picture|background)\b/i.test(t))) return 'edit-image'
  if (TRANSFORM_INTENT.test(t)) return 'transformation'
  if (lane === 'laxii') return 'generate-image'
  if (lane === 'jazmii') return 'generate-video'
  if (lane === 'code-giftz') return CODING_INTENT.test(t) || t.length > 0 ? 'coding-task' : 'coding-task'
  // riishe / general:
  if (VIDEO_INTENT.test(t) && /\b(make|create|generate|produce|show|render|give)\b/i.test(t)) return 'generate-video'
  if (IMAGE_INTENT.test(t) && /\b(make|create|generate|produce|draw|render|show|give|design)\b/i.test(t)) return 'generate-image'
  if (/^(hi|hello|hey|thanks|thank you|good\s*(morning|evening|afternoon))\b[\s!,.?]*$/i.test(t)) return 'smalltalk'
  return 'answer'
}

// ---------------------------------------------------------------------------
// Ambiguity detection (conservative, flagged — never rewritten)
// ---------------------------------------------------------------------------

function ambiguityFlags(text: string, intent: Intent, terms: PreservedTerms): string[] {
  const flags: string[] = []
  const t = text.trim()
  if ((intent === 'generate-image' || intent === 'generate-video') && t.split(/\s+/).length < 3) {
    flags.push('very short generation prompt — subject, setting or style may be underspecified')
  }
  if (/\b(it|they|them|he|she|that|this)\b/i.test(t) && t.split(/\s+/).length <= 6 && intent === 'answer') {
    flags.push('pronoun likely refers to earlier conversation context')
  }
  if ((t.match(/\band\b/gi) ?? []).length >= 3 && (intent === 'generate-image' || intent === 'generate-video')) {
    flags.push('many conjoined elements — composition may be crowded or contradictory')
  }
  if (intent === 'edit-image' && terms.quoted.length === 0 && !/\b(background|left|right|top|bottom|center|middle|corner)\b/i.test(t)) {
    flags.push('edit target region may be ambiguous without a mask or spatial hint')
  }
  return flags
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function collect(re: RegExp, text: string, cap: number): string[] {
  const out = new Set<string>()
  for (const m of text.match(re) ?? []) {
    const w = m.trim().toLowerCase()
    if (w) out.add(w)
    if (out.size >= cap) break
  }
  return [...out]
}

/**
 * Understand a prompt for a product lane. Deterministic, no I/O, no model
 * calls — safe to run on EVERY request in every lane.
 */
export function understandPrompt(rawPrompt: string, lane: ProductLane): PromptUnderstanding {
  const t0 = performance.now()
  const normalized = rawPrompt.normalize('NFC')
  const language = detectLanguage(normalized)
  const terms = extractPreservedTerms(normalized)
  const intent = classifyIntent(normalized, lane)

  const domains: DomainSignal[] = []
  for (const seed of DOMAIN_SEEDS) {
    const matches = normalized.match(new RegExp(seed.re.source, seed.re.flags.includes('g') ? seed.re.flags : seed.re.flags + 'g')) ?? []
    if (matches.length > 0) {
      domains.push({ domain: seed.domain, score: matches.length, matched: [...new Set(matches.map((m) => m.toLowerCase()))].slice(0, 4) })
    }
  }
  domains.sort((a, b) => b.score - a.score)

  const understanding: PromptUnderstanding = {
    normalized,
    language,
    terms,
    intent,
    domains: domains.slice(0, 3),
    creatures: collect(CREATURE_WORDS, normalized, 6),
    nature: collect(NATURE_WORDS, normalized, 6),
    materials: collect(MATERIAL_WORDS, normalized, 6),
    physicsActions: collect(PHYSICS_ACTION_WORDS, normalized, 8),
    places: (normalized.match(PLACE_RE) ?? []).slice(0, 4),
    ambiguous: ambiguityFlags(normalized, intent, terms),
    durationMs: 0,
  }
  understanding.durationMs = Math.max(0, Math.round((performance.now() - t0) * 100) / 100)
  return understanding
}
