/**
 * BEAN Intelligence — world ontology: structured physical-world knowledge
 * shared by ALL FOUR products (Part 3 of the world-knowledge work order).
 *
 * NOT a foundation model, NOT a static world dump: reusable modules that are
 * assembled dynamically per request (work order: "Create reusable structured
 * knowledge and reasoning components that can be assembled dynamically for
 * each request"). Each module carries:
 *   - triggers: words that activate the module (EN + the served languages)
 *   - facts:    real physical knowledge used as conditioning/knowledge
 *   - constraints: "must" clauses compiled into generation prompts
 *   - negatives: known failure modes the generators must be steered away from
 *
 * Facts are phrased so an LLM can use them as knowledge AND an image/video
 * pipeline can use them as conditioning clauses. All content is
 * deterministic, offline, license-free (authored in-repo).
 */

export type WorldModuleId =
  | 'human' | 'animal' | 'nature' | 'materials' | 'physics' | 'spatial'

export interface WorldModule {
  id: WorldModuleId
  label: string
  /** Multilingual activation triggers (lowercase; matched on word boundaries
   *  for Latin scripts and substring for non-Latin scripts). */
  triggers: string[]
  /** Concise physical facts — the reusable knowledge payload. */
  facts: string[]
  /** Constraints compiled into image/video generation prompts. */
  constraints: string[]
  /** Known generative-model failure modes to steer away from. */
  negatives: string[]
}

/* ------------------------------------------------------------------ */
/* A. HUMAN WORLD                                                      */
/* ------------------------------------------------------------------ */

const HUMAN: WorldModule = {
  id: 'human',
  label: 'Human world',
  triggers: [
    // EN
    'person', 'people', 'man', 'woman', 'child', 'boy', 'girl', 'human',
    'walking', 'running', 'jumping', 'dancing', 'falling', 'face', 'hand',
    'finger', 'skeleton', 'muscle', 'smile', 'expression', 'clothes',
    'clothing', 'dress', 'shirt', 'fabric', 'athlete', 'dancer', 'portrait',
    // TA
    'மனிதன்', 'பெண்', 'ஆண்', 'குழந்தை', 'நடக்க', 'ஓட', 'கை', 'முகம்', 'சிரிப்பு',
    // HI
    'इंसान', 'आदमी', 'औरत', 'बच्चा', 'चलना', 'दौड़ना', 'हाथ', 'चेहरा', 'मुस्कान',
    // ML
    'മനുഷ്യൻ', 'സ്ത്രീ', 'പുരുഷൻ', 'കുഞ്ഞ്', 'നടക്കുക', 'ഓടുക', 'കൈ', 'മുഖം',
    // AR
    'إنسان', 'رجل', 'امرأة', 'طفل', 'يمشي', 'يجري', 'يد', 'وجه', 'ابتسامة',
    // ES
    'persona', 'hombre', 'mujer', 'niño', 'caminar', 'correr', 'mano', 'cara', 'sonrisa',
    // ZH
    '人', '男人', '女人', '孩子', '走路', '跑步', '手', '脸', '微笑',
    // JA
    '人', '男性', '女性', '子供', '歩く', '走る', '手', '顔', '笑顔',
  ],
  facts: [
    'Humans are bipedal: walking alternates a stance leg and a swing leg, with a heel-strike, weight transfer over the arch, and a toe-off push.',
    'The arms counter-swing opposite to the legs during walking and running (right arm forward when left leg is forward) to balance angular momentum.',
    'Running has a flight phase with both feet off the ground; walking always keeps at least one foot grounded.',
    'The skeleton is the rigid frame: 206 bones. Joints move only within their hinge/ball limits — the elbow and knee are hinges (they bend one way, never backwards), the shoulder and hip are ball joints.',
    'A hand has 5 fingers (4 fingers + 1 opposable thumb); finger joints bend toward the palm and knuckles do not hyperextend.',
    'Facial expressions come from facial muscles: a genuine (Duchenne) smile raises the mouth corners AND narrows the eyes (orbicularis oculi); fear raises the eyebrows and widens the eyes; anger lowers and knits the brows.',
    'Clothing is pulled down by gravity and shaped by the body beneath: fabric drapes in folds radiating from tension points, flares with motion, and trails falling motion; stiff denim folds broadly, silk folds finely and flows.',
    'When a human interacts with an object, contact deforms softly (fingertips press into fruit, gripping flexes fingers around it) and weight is carried visibly through the posture.',
    'Jumping = crouch (store elastic energy in legs) → explosive extension → flight → flexed landing that absorbs momentum; hair and loose clothing lag the motion.',
    'Falling bodies accelerate downward and limbs flail or shield; hair, fabric and loose objects rise relative to the body during free fall.',
  ],
  constraints: [
    'correct human anatomy: five-fingered hands, hinge joints bending only in their natural direction, realistic leg articulation',
    'natural bipedal gait with counter-swinging arms when walking or running is shown',
    'facial expression that matches the stated emotion with the eyes and mouth agreeing',
    'clothing that drapes by gravity and follows the motion of the body',
  ],
  negatives: [
    'wrong number of fingers or fused fingers',
    'joints bending backwards, extra or missing limbs',
    'both arms swinging in the same direction as the same-side leg',
    'floating feet with no visible ground contact during a walk',
    'clothing painted rigidly like armor (unless the subject wears armor)',
  ],
}

/* ------------------------------------------------------------------ */
/* B. ANIMAL WORLD                                                     */
/* ------------------------------------------------------------------ */

const ANIMAL: WorldModule = {
  id: 'animal',
  label: 'Animal world',
  triggers: [
    // EN
    'bird', 'birds', 'eagle', 'falcon', 'hawk', 'owl', 'parrot', 'crow',
    'pigeon', 'sparrow', 'hummingbird', 'peacock', 'wing', 'feather', 'flight',
    'flying', 'flock', 'cat', 'dog', 'monkey', 'elephant', 'horse', 'cow',
    'lion', 'tiger', 'deer', 'rabbit', 'snake', 'lizard', 'crocodile',
    'fish', 'shark', 'dolphin', 'whale', 'turtle', 'frog', 'paw', 'tail',
    'running animal', 'locomotion',
    // TA
    'பறவை', 'கழுகு', 'காகம்', 'மயில்', 'இறக்கை', 'பறக்க', 'பூனை', 'நாய்', 'யானை', 'குரங்கு', 'மீன்', 'பாம்பு',
    // HI
    'पक्षी', 'चील', 'कौआ', 'मोर', 'पंख', 'उड़ना', 'बिल्ली', 'कुत्ता', 'हाथी', 'बंदर', 'मछली', 'सांप',
    // ML
    'പക്ഷി', 'പരുന്ത്', 'കൊക്ക്', 'ചിറക്', 'പറക്കുക', 'പൂച്ച', 'നായ', 'ആന', 'കുരങ്ങ്', 'മീൻ', 'പാമ്പ്',
    // AR
    'طائر', 'عصفور', 'نسر', 'جَناح', 'يطير', 'قطة', 'كلب', 'فيل', 'قرد', 'سمكة', 'ثعبان',
    // ES
    'pájaro', 'ave', 'águila', 'ala', 'pluma', 'volar', 'gato', 'perro', 'elefante', 'mono', 'pez', 'serpiente',
    // ZH
    '鸟', '老鹰', '翅膀', '羽毛', '飞', '猫', '狗', '大象', '猴子', '鱼', '蛇',
    // JA
    '鳥', '鷲', '翼', '羽', '飛ぶ', '猫', '犬', '象', '猿', '魚', '蛇',
  ],
  facts: [
    'Bird wings are modified forelimbs: the humerus, radius/ulna and fused hand bones support three feather groups — primaries at the wingtip (thrust), secondaries on the inner wing (lift), and coverts smoothing the airflow.',
    'A downstroke (wings pushed down and forward) generates lift and thrust; the upstroke folds/slots the wing to reduce drag. Wingtips trail slightly UP on the upstroke — never folded crisply backwards like hands.',
    'Wingbeat frequency scales inversely with size: hummingbirds ~40–50 beats/s, sparrows ~12–15/s, pigeons ~6–8/s, eagles ~2/s (soaring with slow, occasional beats between long glides).',
    'Birds take off by leaping and beating hard (often downward-swept first strokes), bank by tilting the whole body and fanning the tail as a rudder, and land by flaring: wings back, tail down, legs forward, feathers raised to dump lift.',
    'Feathers overlap like roof shingles in layers; in flight the primary feathers separate and twist at the tips; on the ground wings fold over the back with primaries tucked.',
    'Feathered legs end in toes (typically 3 forward, 1 back) that grip perches; birds do not have arms with hands.',
    'Quadruped mammals (cats, dogs, horses) walk with a four-beat gait and diagonal pairing at trot; the tail counterbalances turns; the spine flexes in gallop.',
    'Cats possess an aerial righting reflex — they twist the front and rear body halves in opposite directions mid-fall to land feet-first; dogs do not always succeed.',
    'Elephants walk on padded feet, swing the trunk as a sensitive grasping organ with two "fingers" at its tip, and flap large ears for cooling.',
    'Monkeys and apes grip branches with both hands and feet (opposable thumbs); knuckle-walkers (chimpanzees, gorillas) support the front on folded fingers.',
    'Fish swim by lateral undulation of the body + caudal (tail) fin thrust; pectoral fins steer and brake; they do not move in straight rigid lines.',
    'Snakes locomote by serpentine side-to-side waves pushing against the ground; reptiles walk with a low sprawled gait (legs out to the sides) — unlike mammals\' upright legs.',
    'Animal behavior is environmental: birds scatter from threats, cats crouch before pouncing, dogs lower the front and raise the haunches when playing.',
  ],
  constraints: [
    'anatomically correct wings with layered feathers, primaries separating at the tips, wingtip motion matching the beat phase',
    'wingbeat frequency appropriate to the species\' size (small birds beat fast, large birds soar slowly)',
    'correct limb count and posture for the species (sprawled reptile legs, upright mammal legs, gripping bird toes)',
    'species-appropriate locomotion (lateral undulation for fish and snakes, four-beat gait for quadrupeds)',
  ],
  negatives: [
    'wings bending backwards at the "wrist" or folding like folding chairs mid-downstroke',
    'featherless membrane wings on feathered birds',
    'extra or missing limbs; two-headed bodies',
    'fish or snakes moving as rigid straight rods',
    'birds flying with hands or human arm joints visible in the wing',
  ],
}

/* ------------------------------------------------------------------ */
/* C. NATURE                                                           */
/* ------------------------------------------------------------------ */

const NATURE: WorldModule = {
  id: 'nature',
  label: 'Nature',
  triggers: [
    // EN
    'water', 'river', 'waterfall', 'ocean', 'sea', 'wave', 'waves', 'splash',
    'fire', 'flame', 'smoke', 'wind', 'rain', 'cloud', 'storm', 'thunder',
    'lightning', 'tree', 'trees', 'forest', 'leaf', 'leaves', 'plant',
    'flower', 'snow', 'ice', 'frost', 'weather', 'beach', 'lake', 'mist', 'fog',
    // TA
    'நீர்', 'ஆறு', 'அருவி', 'கடல்', 'அலை', 'தண்ணீர்', 'நெருப்பு', 'புகை', 'காற்று', 'மழை', 'மேகம்', 'மரம்', 'இலை', 'பனி',
    // HI
    'पानी', 'नदी', 'झरना', 'समुद्र', 'लहर', 'आग', 'धुआँ', 'हवा', 'बारिश', 'बादल', 'पेड़', 'पत्ते', 'बर्फ',
    // ML
    'വെള്ളം', 'നദി', 'വെള്ളച്ചാട്ടം', 'കടൽ', 'തിര', 'അഗ്നി', 'പുക', 'കാറ്റ്', 'മഴ', 'മേഘം', 'മരം', 'ഇല', 'മഞ്ഞ്',
    // AR
    'ماء', 'نهر', 'شلال', 'بحر', 'موج', 'نار', 'دخان', 'ريح', 'مطر', 'سحاب', 'شجرة', 'ثلج',
    // ES
    'agua', 'río', 'cascada', 'mar', 'ola', 'fuego', 'humo', 'viento', 'lluvia', 'nube', 'árbol', 'nieve',
    // ZH
    '水', '河', '瀑布', '海', '浪', '火', '烟', '风', '雨', '云', '树', '雪',
    // JA
    '水', '川', '滝', '海', '波', '火', '煙', '風', '雨', '雲', '木', '雪',
  ],
  facts: [
    'Water is transparent with a refractive index ~1.33: submerged parts look shifted and light caustics dance on pool floors; splashes throw droplets that fall in parabolas under gravity.',
    'Ocean waves are traveling energy: water moves in orbits, rising slightly forward as the crest passes; waves break in shallow water when the crest outruns the trough, throwing foam forward (whitewater) — breakers do not "roll uphill".',
    'Waterfalls accelerate downward, tear into aerated white froth at the base, and raise a persistent mist cloud where the plunge pool is hit.',
    'Rivers flow downhill, erode outer bends and deposit sediment on inner bends; floating objects drift WITH the current.',
    'Fire is buoyant combustion: hot gas rises, so flames flicker upward and taper; flame color indicates temperature (deep red ~600°C, orange-yellow ~1000–1200°C, blue at the base where combustion is cleanest).',
    'Smoke rises above fire in turbulent plumes that widen and dissipate with height; it drifts with wind and thins as particles disperse — it never falls or flows downward on its own.',
    'Wind moves flexible things in the direction it blows: flags stream away from the wind origin, grass and leaves bend in gusts, waves on water travel with the wind, loose debris tumbles; rigid things do not bend.',
    'Rain falls in near-vertical streaks (slanted by wind), splashes into crowns on hard ground, beads on leaves, and leaves surfaces wet and reflective.',
    'Clouds form where moist air rises and cools: cumulus are low puffy heaps with flat bases, cirrus are high wispy ice streaks, stratus are low layered sheets; storm cumulonimbus tower with dark flat anvils.',
    'Trees flex from the base and tip progressively more at the crown in wind; branches whip late relative to the trunk; leaves flutter individually.',
    'Snow falls slowly, settles and accumulates on upward-facing surfaces, compacts under weight and crunches/puffs when disturbed; ice is transparent-to-translucent, slick, and cracks in shiny fractures.',
  ],
  constraints: [
    'water that is transparent and refractive, with parabolic droplets and forward-breaking crests',
    'flames that rise and taper with physically plausible color, smoke that ascends and dissipates',
    'wind that moves flags, foliage and loose material in one consistent direction',
    'cloud types with plausible shapes and heights; rain that falls and splashes, not static specks',
  ],
  negatives: [
    'smoke flowing downward or fire burning with a downward flame',
    'waves breaking inland of the shoreline or frozen mid-air foam with no gravity',
    'rain drawn as uniform straight lines through the whole frame with no splash or depth',
    'trees bending from the tips while the trunk stays rigid',
    'water painted opaque like milk (unless the style explicitly calls for it)',
  ],
}

/* ------------------------------------------------------------------ */
/* D. MATERIALS AND OBJECTS                                            */
/* ------------------------------------------------------------------ */

const MATERIALS: WorldModule = {
  id: 'materials',
  label: 'Materials and objects',
  triggers: [
    // EN
    'glass', 'mirror', 'window', 'metal', 'steel', 'iron', 'aluminum',
    'wood', 'plank', 'rubber', 'cloth', 'fabric', 'silk', 'paper', 'liquid',
    'water pouring', 'oil', 'honey', 'collision', 'crash', 'impact', 'break',
    'breaking', 'shatter', 'shattering', 'dent', 'bend', 'stretch', 'car',
    'vehicle', 'truck', 'motorcycle', 'machine', 'engine', 'robot', 'bottle',
    // TA
    'கண்ணாடி', 'உலோகம்', 'மரம்', 'துணி', 'காகிதம்', 'மோதல்', 'உடைக்க', 'வாகனம்',
    // HI
    'काँच', 'धातु', 'लकड़ी', 'कपड़ा', 'कागज़', 'टक्कर', 'तोड़ना', 'गाड़ी',
    // ML
    'കണ്ണാടി', 'ലോഹം', 'മരം', 'തുണി', 'കൂട്ടിയിടി', 'വാഹനം',
    // AR
    'زجاج', 'معدن', 'خشب', 'قماش', 'ورق', 'تصادم', 'سيارة',
    // ES
    'vidrio', 'metal', 'madera', 'tela', 'papel', 'choque', 'coche',
    // ZH
    '玻璃', '金属', '木头', '布', '纸', '碰撞', '车',
    // JA
    'ガラス', '金属', '木', '布', '紙', '衝突', '車',
  ],
  facts: [
    'Glass shatters into sharp shards radiating from the impact point: radial cracks first, then concentric circles; tempered glass breaks into small blunt granules; a mirror keeps its silvered backing on the shards.',
    'Metal deforms by denting and bending — it does not crumple like paper or shatter like glass; stressed steel can glow before failing; aluminum tears with bright silvery edges.',
    'Wood breaks by splintering ALONG the grain, exposing pale fibrous interiors; the break line follows the weakest fiber path, never a clean geometric cut.',
    'Rubber stretches with visible thinning, stores elastic energy, and rebounds past its rest length on release (wobble-settle); it does not tear unless cut.',
    'Cloth folds in gravity-driven drape curves, resists stretching (woven cloth) while shearing easily, whips when swung, and settles in soft overlapping folds.',
    'Liquids pour in a stream shaped by viscosity: water is fast, thin and splashy; oil is slower with a glassy sheen; honey is slow, ropey and folds onto itself. All streams thin as they accelerate downward.',
    'Rigid-body collisions transfer momentum instantly at contact: the struck object accelerates away, lighter objects fly farther, energy converts to deformation, spin and sound at impact — not after.',
    'Vehicles are mechanical systems: wheels rotate with ground speed (no sliding unless braking), suspension compresses on bumps and leans outward in turns, and crashes crumple the chassis zones designed to fold.',
    'Objects persist: an object occluded by another keeps its shape and position; a resting object stays resting until a force moves it (Newton\'s first law).',
  ],
  constraints: [
    'material-accurate failure: radial shard patterns for glass, dents/bends for metal, grain-following splinters for wood, elastic stretch for rubber',
    'viscosity-consistent liquid motion (water splashy, honey ropey)',
    'instantaneous momentum transfer at collision contact with deformation and debris at the point of impact',
    'wheels rotating at ground speed and suspension/lean consistent with vehicle motion',
  ],
  negatives: [
    'glass breaking into a single neat hole or spherical marble chunks',
    'metal crumpling like paper or shattering like ceramic',
    'wood snapping into clean geometric pieces with no grain',
    'water pouring like syrup or honey pouring like water (unless stated)',
    'collisions where objects stop dead with no deformation, spin, or debris',
  ],
}

/* ------------------------------------------------------------------ */
/* E. PHYSICS                                                          */
/* ------------------------------------------------------------------ */

const PHYSICS: WorldModule = {
  id: 'physics',
  label: 'Physics',
  triggers: [
    // EN
    'gravity', 'falling', 'falls', 'drop', 'momentum', 'force', 'speed',
    'acceleration', 'friction', 'inertia', 'spin', 'bounce', 'trajectory',
    'throw', 'thrown', 'light', 'shadow', 'shadows', 'reflection', 'refraction',
    'perspective', 'depth', 'bounce', 'pendulum', 'swing', 'orbit', 'float', 'floating',
    // TA
    'ஈர்ப்பு', 'விழும்', 'வேகம்', 'உராய்வு', 'நிழல்', 'ஒளி', 'பிரதிபலிப்பு',
    // HI
    'गुरुत्वाकर्षण', 'गिरना', 'गति', 'घर्षण', 'छाया', 'प्रकाश', 'परावर्तन',
    // ML
    'ഗുരുത്വാകർഷണം', 'വീഴ്ച', 'വേഗത', 'ഘർഷണം', 'നിഴൽ', 'പ്രകാശം',
    // AR
    'جاذبية', 'سقوط', 'سرعة', 'احتكاك', 'ظل', 'ضوء', 'انعكاس',
    // ES
    'gravedad', 'caída', 'velocidad', 'fuerza', 'sombra', 'luz', 'reflejo',
    // ZH
    '重力', '下落', '速度', '摩擦', '阴影', '光', '反射',
    // JA
    '重力', '落下', '速度', '摩擦', '影', '光', '反射',
  ],
  facts: [
    'Gravity accelerates falling objects downward at 9.81 m/s²: dropped things fall in straight vertical lines, thrown things follow parabolic arcs, and speed increases continuously during a fall.',
    'Momentum is conserved in collisions and transfers through chains (dominoes, billiard breaks): the impulse enters at contact and propagates outward — pieces never start moving before they are touched.',
    'Friction opposes sliding motion: rough surfaces stop objects quickly, ice and wet floors let them slide; sliding produces heat and wear trails.',
    'Inertia: a moving object keeps its velocity until a force changes it; turning vehicles and running humans lean INTO the turn and carry loose items in the old direction.',
    'Light travels in straight lines and casts shadows away from the light source; a small/hard light gives sharp-edged shadows, a large/diffuse light gives soft-edged ones; shadow length grows as the source drops toward the horizon.',
    'Reflection: the angle of incidence equals the angle of reflection — mirrors and wet streets mirror the scene; a reflective sphere reflects the environment with curved distortion.',
    'Refraction bends light at media boundaries (straw appearing kinked in water, pools looking shallower than they are).',
    'Perspective: parallel lines converge at vanishing points; objects shrink with distance; foreground objects overlap background ones; atmospheric haze desaturates distant planes.',
    'Floating objects (wood, ice) displace their weight in water and ride high; denser objects sink; bubbles rise; balloons rise in air because of buoyancy, not anti-gravity.',
  ],
  constraints: [
    'gravity-consistent motion: vertical falls, parabolic throws, continuous acceleration',
    'shadows cast away from the stated light source with edge softness matching the light size',
    'reflections obeying equal-angle geometry on mirrors and glossy surfaces',
    'perspective with consistent vanishing points and size-with-distance scaling',
  ],
  negatives: [
    'objects floating or falling upward with no stated cause',
    'shadows pointing in inconsistent directions within one scene',
    'reflections that show a different scene than their surroundings',
    'throw trajectories that curve upward after release without force',
  ],
}

/* ------------------------------------------------------------------ */
/* F. SPATIAL AND TEMPORAL INTELLIGENCE                                */
/* ------------------------------------------------------------------ */

const SPATIAL: WorldModule = {
  id: 'spatial',
  label: 'Spatial and temporal intelligence',
  triggers: [
    // EN
    'camera', 'zoom', 'pan', 'tilt', 'aerial', 'drone', 'close-up', 'closeup',
    'wide shot', 'dolly', 'tracking', 'scene', 'background', 'foreground',
    'occlusion', 'behind', 'in front of', 'timeline', 'sequence', 'continuous',
    'one shot', 'long take', 'video',
    // (scene-structure words appear in every language as loanwords; the
    // video/image routes activate this module by DEFAULT — see analyze.ts)
  ],
  facts: [
    'Object persistence: objects do not appear, disappear, or change identity between frames unless they visibly enter/exit or are transformed on screen.',
    'Scene geometry is consistent: the floor stays at one height, walls stay put, and the spatial relation between objects (A left of B, on top of C) is preserved across the sequence.',
    'Camera continuity: one camera move per beat; after a cut, screen direction and eyelines stay consistent (180° rule); zooms and pans are smooth with acceleration ramps, not jumps.',
    'Motion trajectories are continuous: position and velocity change smoothly between frames; objects moving left keep moving left unless a force changes that.',
    'Cause and effect are ordered in time: the cause frame precedes the effect frame (a ball hits the window, THEN glass breaks; feet touch ground, THEN dust puffs).',
    'Occlusion is ordered by depth: nearer objects paint over farther ones consistently as relative positions change.',
    'Lighting is consistent across a sequence: one sun (or set of lamps) with one direction; shadow angles and color temperature do not jump between shots of the same scene.',
    'Temporal continuity in video: hair, cloth, water and fire keep their state across frames — a spilled liquid stays spilled; smoke drifts, it does not reset.',
  ],
  constraints: [
    'consistent scene geometry and object positions across the whole sequence',
    'smooth continuous camera motion with one move per beat and consistent screen direction',
    'effect frames strictly after cause frames',
    'one consistent light source direction and color temperature throughout',
  ],
  negatives: [
    'objects teleporting, duplicating, or vanishing between frames',
    'camera position jumping without a cut',
    'lighting direction flipping between frames of the same scene',
    'backgrounds that shift geometry while the subject moves',
  ],
}

export const WORLD_MODULES: WorldModule[] = [HUMAN, ANIMAL, NATURE, MATERIALS, PHYSICS, SPATIAL]

export function getModule(id: WorldModuleId): WorldModule {
  const m = WORLD_MODULES.find((w) => w.id === id)
  if (!m) throw new Error(`Unknown world module: ${id}`)
  return m
}

/**
 * Trigger matching: Latin-script triggers match on word boundaries (so
 * "cat" does not match "category"), non-Latin triggers match as substrings
 * (no reliable word boundaries without a tokenizer; substrings are safe for
 * these compact lexical units).
 */
export function matchTriggers(text: string, triggers: string[]): string[] {
  const lower = text.toLowerCase()
  const hits: string[] = []
  for (const t of triggers) {
    if (!t) continue
    if (/[\u0400-\u9fff\u0b80-\u0dff\u0600-\u06ff\u3040-\u30ff\uac00-\ud7af]/.test(t)) {
      if (lower.includes(t)) hits.push(t)
    } else {
      const re = new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'u')
      if (re.test(lower)) hits.push(t)
    }
  }
  return hits
}

/**
 * Count trigger activations per module for a text. Used by scene analysis
 * and by the evaluation suite (a module must activate on its domain's words
 * in multiple languages).
 */
export function activatedModules(text: string): Map<WorldModuleId, string[]> {
  const out = new Map<WorldModuleId, string[]>()
  for (const m of WORLD_MODULES) {
    const hits = matchTriggers(text, m.triggers)
    if (hits.length > 0) out.set(m.id, hits)
  }
  return out
}
