/**
 * BEAN Intelligence — scene grounding pipeline (Part 4 of the work order):
 * prompt understanding -> structured scene representation.
 *
 * For each image/video request this identifies entities, species/anatomy,
 * materials, environment, physical interactions, motion, camera, lighting,
 * weather and temporal constraints, then produces a structured ScenePlan.
 * Deterministic and offline: activates ontology modules from the prompt in
 * the user's language and merges their knowledge into one plan. Failure to
 * find any signal yields an honest low-confidence plan — never a invented
 * scene.
 */

import { activatedModules, WORLD_MODULES, type WorldModuleId } from './ontology'
import { analyzeLanguage, type LanguageAnalysis } from '../language'

export interface Subject {
  /** Coarse subject class driving anatomy/physics selection. */
  class:
    | 'person' | 'bird' | 'mammal-quadruped' | 'fish-aquatic' | 'reptile'
    | 'insect' | 'vehicle' | 'water-body' | 'fire' | 'plant' | 'object'
    | 'landscape' | 'unknown'
  /** The surface form that triggered this subject (original language). */
  mention: string
  /** Whether the subject is a specific named real-world entity
   *  ("Eiffel Tower", "Peregrine falcon") vs a generic class ("a bird"). */
  namedEntity: boolean
}

export interface ScenePlan {
  /** The verbatim user prompt — grounding NEVER replaces user content. */
  originalPrompt: string
  language: LanguageAnalysis
  subjects: Subject[]
  /** Activated world modules with their trigger evidence. */
  modules: Array<{ id: WorldModuleId; evidence: string[] }>
  /** Motion verbs detected in the prompt (walk, run, fly, pour, shatter...). */
  motionVerbs: string[]
  environment: string | null
  lighting: string | null
  weather: string | null
  cameraCues: string[]
  materials: string[]
  /** Physics/spatial rules that MUST hold in this scene. */
  constraints: string[]
  /** Failure modes steered away from (negative conditioning). */
  negativeConstraints: string[]
  /** Measured activation confidence — how many independent signals fired. */
  confidence: number
  /** Honest notes for the product metadata (what grounding actually used). */
  notes: string[]
}

/* Motion verb tables: verb -> subject-agnostic physical description used by
 * the motion timeline. Multilingual where the served languages have compact
 * unambiguous verbs. */
const MOTION_VERBS: Record<string, string> = {
  // EN
  walking: 'legged locomotion with alternating stance/swing legs', walk: 'legged locomotion', running: 'fast locomotion with a flight phase', run: 'fast locomotion', jumping: 'crouch-launch-flight-landing cycle', jump: 'crouch-launch-flight-landing cycle', flying: 'aerial locomotion with beating or gliding surfaces', fly: 'aerial locomotion', falling: 'gravity-driven descent with increasing speed', fall: 'gravity-driven descent', swimming: 'buoyant locomotion with body undulation', swim: 'buoyant locomotion', pouring: 'gravity stream with viscosity shape', pour: 'gravity stream', breaking: 'material failure at the weakest structure', break: 'material failure', shattering: 'radial fragmentation from impact', shatter: 'radial fragmentation', exploding: 'rapid energy release with debris and smoke', explode: 'rapid energy release', spinning: 'rotation about an axis', spin: 'rotation', bouncing: 'elastic impact rebound', bounce: 'elastic rebound', dancing: 'rhythmic whole-body motion', dance: 'rhythmic whole-body motion', driving: 'vehicle locomotion with wheel rotation', driving2: '', climbing: 'alternating limb traction against gravity', climb: 'limb traction against gravity', waving: 'limb arc with cloth lag', flowing: 'fluid motion following terrain', flow: 'fluid motion', drifting: 'passive motion with wind or current', melting: 'solid-to-liquid transition with sagging', melt: 'solid-to-liquid transition', burning: 'buoyant combustion flicker', burn: 'combustion',
  // TA
  'நடக்க': 'legged locomotion', 'ஓட': 'fast locomotion', 'பறக்க': 'aerial locomotion', 'விழும்': 'gravity-driven descent', 'நீந்த': 'buoyant locomotion',
  // HI
  'चलना': 'legged locomotion', 'दौड़ना': 'fast locomotion', 'उड़ना': 'aerial locomotion', 'गिरना': 'gravity-driven descent', 'तैरना': 'buoyant locomotion',
  // ML
  'നടക്കുക': 'legged locomotion', 'ഓടുക': 'fast locomotion', 'പറക്കുക': 'aerial locomotion', 'വീഴുക': 'gravity-driven descent',
  // AR
  'يمشي': 'legged locomotion', 'يجري': 'fast locomotion', 'يطير': 'aerial locomotion', 'يسقط': 'gravity-driven descent',
  // ES
  caminando: 'legged locomotion', corriendo: 'fast locomotion', volando: 'aerial locomotion', cayendo: 'gravity descent',
  // ZH
  '走路': 'legged locomotion', '跑步': 'fast locomotion', '飞': 'aerial locomotion', '下落': 'gravity descent', '流动': 'fluid motion',
  // JA
  '歩く': 'legged locomotion', '走る': 'fast locomotion', '飛ぶ': 'aerial locomotion', '落ちる': 'gravity descent', '流れる': 'fluid motion',
}
delete MOTION_VERBS.driving2 // sentinel cleanup

const ENVIRONMENT_TRIGGERS: Array<[RegExp, string]> = [
  [/\b(indoors|indoor|room|kitchen|office|studio|library)\b/i, 'indoor interior'],
  [/\b(beach|shore|seaside|coast)\b/i, 'seashore'],
  [/\b(ocean|sea|lake|river|waterfall|underwater)\b/i, 'open water / waterfront'],
  [/\b(forest|jungle|woods)\b/i, 'forest'],
  [/\b(mountain|cliff|valley|canyon)\b/i, 'mountainous terrain'],
  [/\b(city|street|urban|downtown|skyline|road)\b/i, 'urban environment'],
  [/\b(desert|dune|savanna)\b/i, 'arid landscape'],
  [/\b(snowfield|glacier|tundra|snowy)\b/i, 'snow-covered terrain'],
  [/\b(garden|park|field|meadow|farm)\b/i, 'open green space'],
  [/\b(space|orbit|galaxy|nebula)\b/i, 'outer space'],
  [/கடல்|அலை|ஆறு/, 'open water / waterfront'],
  [/समुद्र|नदी/, 'open water / waterfront'],
  [/കടൽ|നദി/, 'open water / waterfront'],
  [/بحر|نهر|محيط/, 'open water / waterfront'],
  [/海|川| Ocean| ocean/, 'open water / waterfront'],
]

const LIGHTING_TRIGGERS: Array<[RegExp, string]> = [
  [/\b(sunset|sunrise|golden hour|dusk|dawn)\b/i, 'golden-hour low sun with long warm shadows'],
  [/\b(night|midnight|moonlight|starlight)\b/i, 'night lighting with a single dominant cool key'],
  [/\b(bright sunlight|noon|midday|sunny)\b/i, 'hard midday sun with short shadows'],
  [/\b(overcast|cloudy|diffuse)\b/i, 'soft overcast light with no hard shadows'],
  [/\b(neon|cyberpunk|city lights)\b/i, 'mixed artificial neon with colored spill'],
  [/\b(candle|firelight|lantern|campfire)\b/i, 'warm flickering low key light'],
  [/\b(studio|softbox|rim light)\b/i, 'controlled studio lighting'],
  [/夕焼け|夜/, 'low/night lighting'],
  [/日落|夜景/, 'low/night lighting'],
]

const WEATHER_TRIGGERS: Array<[RegExp, string]> = [
  [/\b(rain|raining|rainstorm|drizzle)\b/i, 'rain'],
  [/\b(snow|snowing|blizzard)\b/i, 'snow'],
  [/\b(fog|foggy|mist|misty|haze)\b/i, 'fog/mist'],
  [/\b(storm|thunder|lightning|hurricane|cyclone)\b/i, 'storm'],
  [/\b(windy|windstorm|breeze)\b/i, 'wind'],
  [/मौसम|बारिश|बर्फ/, 'rain/snow'],
  [/மழை|பனி/, 'rain/mist'],
  [/مطر|ثلج/, 'rain/snow'],
  [/雨|雪/, 'rain/snow'],
]

const CAMERA_TRIGGERS: Array<[RegExp, string]> = [
  [/\b(close-?up|macro)\b/i, 'close-up framing on the subject'],
  [/\b(wide shot|wide angle|establishing)\b/i, 'wide establishing framing'],
  [/\b(aerial|drone|bird'?s-?eye|overhead)\b/i, 'aerial overhead viewpoint'],
  [/\b(low angle|worm'?s-?eye)\b/i, 'low upward angle'],
  [/\b(pan|panning)\b/i, 'horizontal pan following the action'],
  [/\b(zoom|dolly|tracking shot|follow)\b/i, 'camera moves with the subject'],
  [/\b(slow motion|slow-?mo)\b/i, 'slow-motion timing'],
  [/\b(time-?lapse)\b/i, 'time-lapse timing'],
  [/\b(one shot|long take|single take)\b/i, 'single continuous take'],
  [/\b(static shot|locked off)\b/i, 'static locked-off camera'],
]

const MATERIAL_TRIGGERS: Array<[RegExp, string]> = [
  [/\bglass|window|mirror\b/i, 'glass'],
  [/\bmetal|steel|iron|aluminum|chrome\b/i, 'metal'],
  [/\bwood(en)?|plank|timber\b/i, 'wood'],
  [/\brubber\b/i, 'rubber'],
  [/\b(cloth|fabric|silk|cotton|denim|linen)\b/i, 'cloth'],
  [/\b(paper|cardboard)\b/i, 'paper'],
  [/\b(porcelain|ceramic)\b/i, 'ceramic'],
  [/\bconcrete|stone|marble\b/i, 'stone/concrete'],
  [/\bwater|liquid|juice|oil|honey|syrup\b/i, 'liquid'],
]

/** Named-entity heuristics: capitalized multi-word spans (Latin scripts) or
 *  known species/entity multi-word names ("Peregrine falcon", "Bengal tiger"). */
const KNOWN_MULTIWORD_SPECIES = [
  'peregrine falcon', 'bald eagle', 'bengal tiger', 'african elephant',
  'indian elephant', 'great white shark', 'king cobra', 'golden retriever',
  'german shepherd', 'humpback whale', 'monarch butterfly', 'peacock spider',
  'siberian husky', 'eiffel tower', 'taj mahal', 'mount everest',
]

const SUBJECT_MAP: Array<[RegExp, Subject['class']]> = [
  [/\b(person|people|man|woman|child|boy|girl|human|athlete|dancer|portrait|crowd)\b/i, 'person'],
  [/மனிதன்|பெண்|ஆண்|குழந்தை/, 'person'],
  [/इंसान|आदमी|औरत|बच्चा/, 'person'],
  [/മനുഷ്യൻ|സ്ത്രീ|പുരുഷൻ/, 'person'],
  [/إنسان|رجل|امرأة|طفل/, 'person'],
  [/persona|hombre|mujer|niño/i, 'person'],
  [/人|男人|女人|孩子/, 'person'],
  [/\b(bird|eagle|falcon|hawk|owl|parrot|crow|pigeon|sparrow|hummingbird|peacock|flamingo|swan|duck|hen|rooster)\b/i, 'bird'],
  [/பறவை|மயில்|கழுகு/, 'bird'],
  [/पक्षी|मोर|चील/, 'bird'],
  [/പക്ഷി|പരുന്ത്/, 'bird'],
  [/طائر|نسر|عصفور/, 'bird'],
  [/pájaro|ave\b|águila/i, 'bird'],
  [/鸟|老鹰|鸽子/, 'bird'],
  [/鳥|鷲|ハト/, 'bird'],
  [/\b(cat|dog|horse|cow|lion|tiger|deer|elephant|monkey|rabbit|bear|wolf|fox|sheep|goat|pig)\b/i, 'mammal-quadruped'],
  [/பூனை|நாய்|யானை|குரங்கு|சிங்கம்/, 'mammal-quadruped'],
  [/बिल्ली|कुत्ता|हाथी|बंदर|शेर|घोड़ा/, 'mammal-quadruped'],
  [/പൂച്ച|നായ|ആന/, 'mammal-quadruped'],
  [/قطة|كلب|فيل|قرد|أسد/, 'mammal-quadruped'],
  [/gato|perro|caballo|león|elefante|mono/i, 'mammal-quadruped'],
  [/猫|狗|大象|猴子|狮子/, 'mammal-quadruped'],
  [/猫|犬|象|猿|ライオン/, 'mammal-quadruped'],
  [/\b(fish|shark|dolphin|whale|turtle|octopus|jellyfish|frog)\b/i, 'fish-aquatic'],
  [/மீன்/, 'fish-aquatic'],
  [/मछली|शार्क|डॉल्फिन/, 'fish-aquatic'],
  [/മീൻ/, 'fish-aquatic'],
  [/سمكة|دلفين|حوت/, 'fish-aquatic'],
  [/pez|tiburón|delfín|ballena/i, 'fish-aquatic'],
  [/鱼|鲨鱼|海豚|鲸/, 'fish-aquatic'],
  [/魚|鮫|イルカ/, 'fish-aquatic'],
  [/\b(snake|lizard|crocodile|iguana|gecko|tortoise)\b/i, 'reptile'],
  [/பாம்பு/, 'reptile'],
  [/सांप|छिपकली/, 'reptile'],
  [/പാമ്പ്/, 'reptile'],
  [/ثعبان|تمساح/, 'reptile'],
  [/serpiente|cocodrilo|lagartija/i, 'reptile'],
  [/蛇|鳄鱼/, 'reptile'],
  [/蛇|ワニ/, 'reptile'],
  [/\b(car|vehicle|truck|motorcycle|bicycle|bus|train|airplane|boat|ship)\b/i, 'vehicle'],
  [/வாகனம்|கார்/, 'vehicle'],
  [/गाड़ी|कार|ट्रक|रेल/, 'vehicle'],
  [/വാഹനം/, 'vehicle'],
  [/سيارة|شاحنة|قطار/, 'vehicle'],
  [/coche|camión|moto|tren|avión/i, 'vehicle'],
  [/汽车|卡车|火车|飞机/, 'vehicle'],
  [/車|トラック|電車|飛行機/, 'vehicle'],
  [/\b(fire|flame|campfire|bonfire|candle)\b/i, 'fire'],
  [/நெருப்பு/, 'fire'],
  [/आग|अग्नि/, 'fire'],
  [/തീ|അഗ്നി/, 'fire'],
  [/نار|حريق/, 'fire'],
  [/fuego|llama/i, 'fire'],
  [/火|火焰/, 'fire'],
  [/火|炎/, 'fire'],
  [/\b(tree|trees|forest|flower|plant|leaf|leaves|garden)\b/i, 'plant'],
  [/மரம்|இலை|பூ/, 'plant'],
  [/पेड़|पौधा|फूल|पत्ते/, 'plant'],
  [/മരം|ഇല|പൂവ്/, 'plant'],
  [/شجرة|زهرة/, 'plant'],
  [/árbol|flor|planta|hoja/i, 'plant'],
  [/树|花|植物|叶/, 'plant'],
  [/木|花|植物|葉/, 'plant'],
  [/\b(ocean|sea|wave|river|lake|waterfall|beach|mountain|valley|sky|cloud|landscape|sunset|sunrise)\b/i, 'landscape'],
  [/கடல்|அலை|ஆறு|மலை/, 'landscape'],
  [/समुद्र|लहर|नदी|पहाड़/, 'landscape'],
  [/കടൽ|തിര|മല/, 'landscape'],
  [/بحر|موج|نهر|جبل|منظر/, 'landscape'],
  [/mar\b|ola|río|montaña|paisaje|cielo/i, 'landscape'],
  [/海|浪|河|山|风景|天空/, 'landscape'],
  [/海|波|川|山|風景|空/, 'landscape'],
]

function classifySubjects(text: string): Subject[] {
  const subjects: Subject[] = []
  const lower = text.toLowerCase()
  for (const [re, cls] of SUBJECT_MAP) {
    const m = re.exec(text)
    if (!m) continue
    if (subjects.some((s) => s.class === cls)) continue
    subjects.push({ class: cls, mention: m[0], namedEntity: KNOWN_MULTIWORD_SPECIES.includes(lower.includes(m[0].toLowerCase()) ? m[0].toLowerCase() : '') })
  }
  // Named-entity recognition, two paths:
  //  1. Known multiword species/landmarks anywhere in the text (any case):
  //     "peregrine falcon", "Eiffel Tower" — mark the matching subject.
  //  2. Capitalized multi-word Latin spans mid-sentence (proper nouns the
  //     lexicon does not list) attached to an existing subject class.
  const lowerText = text.toLowerCase()
  for (const known of KNOWN_MULTIWORD_SPECIES) {
    if (lowerText.includes(known)) {
      const hit = subjects.find((s) => known.includes(s.mention.toLowerCase()))
      if (hit) {
        hit.namedEntity = true
        // The fact-lookup query needs the FULL species/entity name, not the
        // bare class mention ("peregrine falcon", not "falcon").
        if (hit.mention.length < known.length) hit.mention = known
      }
    }
  }
  const namedRe = /(?<![.!?]\s)(?<!^)\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g
  let nm: RegExpExecArray | null
  while ((nm = namedRe.exec(text)) !== null) {
    const span = nm[1]
    const hit = subjects.find((s) => s.mention.toLowerCase() === span.toLowerCase())
    if (hit) {
      hit.namedEntity = true
      continue
    }
    // Only count it when it overlaps a known subject class or known list.
    const isKnown = KNOWN_MULTIWORD_SPECIES.includes(span.toLowerCase())
    if (isKnown) subjects.push({ class: subjects.some((s) => s.class === 'bird') ? 'bird' : 'mammal-quadruped', mention: span, namedEntity: true })
  }
  return subjects
}

function firstMatch(text: string, table: Array<[RegExp, string]>): string | null {
  for (const [re, label] of table) {
    if (re.test(text)) return label
  }
  return null
}

/** Whether the scene plan would benefit from live factual retrieval. */
export function needsEntityFacts(plan: ScenePlan): boolean {
  return plan.subjects.some((s) => s.namedEntity)
}

/**
 * Analyze a generation prompt into a structured scene representation.
 * Deterministic; safe to call on every image/video job (microseconds).
 */
export function analyzeScene(prompt: string): ScenePlan {
  const text = (prompt ?? '').slice(0, 4000)
  const language = analyzeLanguage(text)
  const activated = activatedModules(text)
  const subjects = classifySubjects(text)
  const notes: string[] = []

  // The spatial/temporal module is ALWAYS active for generation tasks:
  // every image and every video lives in a consistent frame (work order
  // Part 4: "Visual consistency constraints" apply to every request).
  if (!activated.has('spatial')) {
    activated.set('spatial', ['always-on for generation'])
  }

  const motionVerbs: string[] = []
  for (const [verb, physical] of Object.entries(MOTION_VERBS)) {
    if (!physical) continue
    const isNonLatin = !/^[a-z]+$/.test(verb)
    const hit = isNonLatin
      ? text.includes(verb)
      : new RegExp(`(^|[^\\p{L}])${verb}(|s|ing|ed|s\\b)([^\\p{L}]|$)`, 'u').test(text.toLowerCase()) ||
        new RegExp(`(^|[^\\p{L}])${verb}([^\\p{L}]|$)`, 'u').test(text.toLowerCase())
    if (hit && !motionVerbs.includes(physical)) motionVerbs.push(physical)
  }

  const environment = firstMatch(text, ENVIRONMENT_TRIGGERS)
  const lighting = firstMatch(text, LIGHTING_TRIGGERS)
  const weather = firstMatch(text, WEATHER_TRIGGERS)
  const cameraCues: string[] = []
  for (const [re, cue] of CAMERA_TRIGGERS) if (re.test(text)) cameraCues.push(cue)
  const materials: string[] = []
  for (const [re, mat] of MATERIAL_TRIGGERS) if (re.test(text) && !materials.includes(mat)) materials.push(mat)

  // Merge constraints/negatives from activated modules (ordered, deduped).
  const constraints: string[] = []
  const negativeConstraints: string[] = []
  const modules: ScenePlan['modules'] = []
  for (const m of WORLD_MODULES) {
    const evidence = activated.get(m.id)
    if (!evidence) continue
    modules.push({ id: m.id, evidence })
    for (const c of m.constraints) if (!constraints.includes(c)) constraints.push(c)
    for (const n of m.negatives) if (!negativeConstraints.includes(n)) negativeConstraints.push(n)
  }

  if (subjects.length === 0) notes.push('No specific subject detected — treating the scene as environment/object study.')
  else notes.push(`Subjects: ${subjects.map((s) => `${s.class}${s.namedEntity ? ' (named entity)' : ''}`).join(', ')}.`)
  if (modules.length > 0) {
    notes.push(`World modules activated: ${modules.map((m) => m.id).join(', ')}.`)
  }
  if (motionVerbs.length > 0) notes.push(`Motion: ${motionVerbs.join('; ')}.`)
  if (environment) notes.push(`Environment: ${environment}.`)
  if (lighting) notes.push(`Lighting: ${lighting}.`)
  if (weather) notes.push(`Weather: ${weather}.`)

  const signals = subjects.length + modules.length + motionVerbs.length + (environment ? 1 : 0) + (lighting ? 1 : 0) + cameraCues.length
  const confidence = Math.min(1, signals / 8)

  return {
    originalPrompt: text,
    language,
    subjects,
    modules,
    motionVerbs,
    environment,
    lighting,
    weather,
    cameraCues,
    materials,
    constraints: constraints.slice(0, 12),
    negativeConstraints: negativeConstraints.slice(0, 10),
    confidence: Math.round(confidence * 100) / 100,
    notes,
  }
}
