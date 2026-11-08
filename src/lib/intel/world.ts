/**
 * BEAN Intelligence — structured world-knowledge components (physical
 * reality grounding).
 *
 * Reusable, dynamically assembled knowledge for the domains generation and
 * answers actually touch: human anatomy/locomotion, animal species and
 * locomotion, natural phenomena, material behavior, physics, and
 * space-time continuity. Each component is a small structured constraint
 * set — assembled ON DEMAND by prompt understanding (nothing is preloaded
 * into any database; there is no offline knowledge warehouse).
 *
 * HONEST SCOPE CONTRACT (brief §4): these components are curated REFERENCE
 * CONSTRAINTS for conditioning and evaluation — they are NOT a physics
 * simulator, and nothing here claims to be one. Facts are deliberately
 * conservative, universally accepted statements (no invented measurements).
 * Where numeric values would risk being wrong, the component encodes the
 * INVARIANT (e.g. "two arms, two legs, five digits per hand") instead of a
 * possibly-wrong constant.
 */

import type { PromptUnderstanding } from './understanding'

export interface WorldComponent {
  key: string
  label: string
  domain: 'human' | 'animal' | 'nature' | 'material' | 'physics' | 'spacetime'
  /** Concept trigger — matched against the normalized prompt. */
  match: RegExp
  /** Compact, verifiable invariant facts (constraint lines). */
  facts: string[]
  /** Visual descriptors generation models respond to. */
  visualNotes: string[]
  /** The failure modes this knowledge exists to prevent. */
  defectsToAvoid: string[]
}

// ---------------------------------------------------------------------------
// A. Human world
// ---------------------------------------------------------------------------

const HUMAN_COMPONENTS: WorldComponent[] = [
  {
    key: 'human-proportions',
    label: 'Human body proportions',
    domain: 'human',
    match: /\b(person|people|man|woman|boy|girl|human|character|figure|dancer|athlete|soldier|worker|portrait|full.?body|standing|sitting)\b/i,
    facts: [
      'Adult body height is roughly 7.5 head-lengths; children have proportionally larger heads.',
      'Two arms and two legs; five digits per hand, five toes per foot.',
      'Legs account for about half of standing height; fingertips of relaxed arms reach mid-thigh.',
      'Shoulder width is roughly two to three head-widths for adults.',
    ],
    visualNotes: [
      'Skeleton defines the silhouette: visible landmarks are shoulders, elbows, wrists, pelvis, knees, ankles.',
      'Muscle groups read through skin only as soft shading, not hard outlines.',
    ],
    defectsToAvoid: ['extra or missing limbs/fingers', 'impossible joint bending (elbows/knees)', 'floating or detached body parts', 'adult proportions on a child or vice versa'],
  },
  {
    key: 'human-walk-run',
    label: 'Walking and running gait',
    domain: 'human',
    match: /\b(walk\w*|run\w*|sprint\w*|stroll\w*|march\w*|jog\w*|gait|step\w*|chase)\b/i,
    facts: [
      'Walking keeps at least one foot on the ground; there is a double-support phase every step.',
      'Running has a FLIGHT phase where both feet are off the ground — no flight phase means it is walking.',
      'Arms swing opposite to the legs (left arm forward with right leg).',
      'The head stays at a nearly constant height while walking; running adds vertical bounce.',
      'Ground contact begins heel-first in walking; running strikes mid-foot to forefoot.',
    ],
    visualNotes: [
      'Hip and shoulder counter-rotate subtly; torso leans slightly forward at speed.',
      'Cloth and hair lag and swing with each stride change.',
    ],
    defectsToAvoid: ['both feet planted while the torso glides (moonwalk artifact)', 'arms and same-side legs swinging together', 'limbs passing through each other', 'sliding feet without ground contact changes'],
  },
  {
    key: 'human-jump-fall',
    label: 'Jumping, falling and recovery',
    domain: 'human',
    match: /\b(jump\w*|leap\w*|hop\w*|fall\w*|tumble\w*|vault\w*|parkour|land\w*|dive)\b/i,
    facts: [
      'A jump begins with a crouch (knees/hips flex), extends through ankles-knees-hips, then an airborne ballistic arc.',
      'Airborne trajectories are parabolic; the body cannot steer mid-air without pushing off something.',
      'Landings flex knees and hips to absorb momentum; stiff-legged landings read as wrong.',
    ],
    visualNotes: ['Hair and loose clothing rise at the start of the fall, then trail upward during descent.'],
    defectsToAvoid: ['hovering without support', 'landing instantly without deceleration poses', 'changes of direction mid-air'],
  },
  {
    key: 'human-hands-face',
    label: 'Hands and face anatomy',
    domain: 'human',
    match: /\b(hand\w*|finger\w*|thumb|palm|face|facial|smile\w*|expression|eyes|close.?up|portrait)\b/i,
    facts: [
      'Five digits per hand: four fingers with three joints each and an opposable thumb with two.',
      'Eyes sit at approximately the vertical midpoint of the head; the ear spans roughly between eye and nose level.',
      'Expressions move features coherently: a genuine smile raises cheeks and narrows eyes together.',
    ],
    visualNotes: ['Knuckles crease and skin stretches over joints when the hand closes; tendons become visible on grip.'],
    defectsToAvoid: ['extra or missing fingers', 'fingers of unequal unrealistic length', 'asymmetric drifting eyes', 'teeth count that changes between frames'],
  },
  {
    key: 'human-clothing',
    label: 'Clothing and fabric on the body',
    domain: 'human',
    match: /\b(cloth\w*|fabric|dress|sari|saree|shirt|jacket|coat|robe|scarf|skirt|trousers|pants|uniform|veil|cloak|hoodie)\b/i,
    facts: [
      'Fabric drapes by gravity over the body form; folds concentrate where the body bends (elbows, knees, waist).',
      'Motion pulls cloth with a lag: hems and sleeves trail behind the movement that caused them.',
      'Wind inflates loose fabric away from the body downwind and presses it flat upwind.',
    ],
    visualNotes: ['Material thickness changes fold scale: silk forms small ripples, wool forms large soft folds.'],
    defectsToAvoid: ['cloth passing through the body', 'hem frozen while the body moves', 'fabric ignoring wind entirely'],
  },
]

// ---------------------------------------------------------------------------
// B. Animal world
// ---------------------------------------------------------------------------

const ANIMAL_COMPONENTS: WorldComponent[] = [
  {
    key: 'bird-flight',
    label: 'Bird flight mechanics',
    domain: 'animal',
    match: /\b(bird\w*|fly\w*|flight|wing\w*|feather\w*|soar\w*|glid\w*|hover\w*|perch\w*|takeoff|take.?off)\b/i,
    facts: [
      'The downstroke produces lift and forward thrust; the upstroke is partially folded to reduce drag.',
      'Takeoff for small/medium birds is a jump-and-flap: legs extend first, wings follow immediately.',
      'Landing is a flare: wings sweep back, tail tilts down as an airbrake, legs swing forward to meet the perch.',
      'Feathers separate into slots at the wingtips during slow flight and tight turns.',
    ],
    visualNotes: [
      'Wings never stay rigid — they twist: leading edge down on the downstroke, tipped up on the upstroke.',
      'Primary feathers bend individually under load near the wingtip.',
    ],
    defectsToAvoid: ['wings as rigid boards flapping in one piece', 'backwards wingbeat phasing', 'flight without wing movement', 'feather count visibly changing between frames'],
  },
  {
    key: 'crow',
    label: 'Crows (corvids)',
    domain: 'animal',
    match: /\b(crow|crows|corvid|raven|jackdaw)\b/i,
    facts: [
      'Crows are all-black passerines with a stout black bill and dark legs; plumage shows slight gloss in sunlight.',
      'In flight the crow’s tail is fan-shaped (rounded edge), the silhouette is steady with regular wingbeats.',
      'Crows are highly intelligent, cautious foragers: they hop on the ground, tilt the head to inspect, and cache food.',
      'Crows are social and often appear in pairs or loose groups rather than strictly alone.',
    ],
    visualNotes: ['Ground movement is a hop-walk mix; the head bobs forward on steps during attentive walking.'],
    defectsToAvoid: ['white or brightly colored plumage', 'wedge-shaped raven tail presented as a crow', 'Cartoon feet with wrong digit count (three toes forward, one back when perched)'],
  },
  {
    key: 'eagle',
    label: 'Eagles and large raptors',
    domain: 'animal',
    match: /\b(eagle|eagles|hawk|falcon|raptor|kite\b|vulture|osprey)\b/i,
    facts: [
      'Eagles have broad wings with separated "fingered" primary feathers at the tips, clearly visible while soaring.',
      'They soar on rising air with wings held in a shallow V, rarely flapping; flapping bursts alternate with long glides.',
      'Talons close around prey from the front; the hooked beak tears food rather than chewing.',
    ],
    visualNotes: ['A soaring eagle holds still primary-tip separation; the tail fans for steering and braking.'],
    defectsToAvoid: ['constant flapping during a glide', 'thin pointed falcon wings on an eagle', 'prehensile feet behaving like hands'],
  },
  {
    key: 'cat-dog',
    label: 'Cats and dogs',
    domain: 'animal',
    match: /\b(cat|cats|kitten|feline|dog|dogs|puppy|canine|pet)\b/i,
    facts: [
      'Both are digitigrade: they walk on their toe pads, not the flat foot.',
      'Cats have retractable claws and an extremely flexible spine; a falling cat rights itself by rotating the front then the hind body.',
      'Tails act as moving counterweights during turns and jumps.',
      'Dogs thermoregulate by open-mouth panting; cats pant rarely (usually stress/overheating).',
    ],
    visualNotes: ['Quadruped walk alternates diagonal limb pairs; the head lowers slightly as the front leg advances.'],
    defectsToAvoid: ['plantigrade flat-footed walking', 'reversed leg joints bending backwards (a common deformity)', 'extra or missing paws'],
  },
  {
    key: 'monkey-primate',
    label: 'Monkeys and primates',
    domain: 'animal',
    match: /\b(monkey|monkeys|ape|apes|chimpanzee|gorilla|orangutan|gibbon|baboon|macaque|langur|primate)\b/i,
    facts: [
      'Primates have highly mobile hands AND feet with grasping digits; many monkeys also use the tail for balance.',
      'Locomotion mixes quadrupedal walking, leaping, and (in gibbons/some species) arm-swinging brachiation.',
      'The face is mobile and expressive; gaze and head orientation coordinate strongly.',
    ],
    visualNotes: ['Knuckle-walking (great apes) bears weight on the middle phalanges, not flat palms.'],
    defectsToAvoid: ['human hands pasted onto animal bodies', 'tail duplicated or missing between shots'],
  },
  {
    key: 'elephant',
    label: 'Elephants',
    domain: 'animal',
    match: /\b(elephant|elephants|tusker|pachyderm)\b/i,
    facts: [
      'Elephants walk on padded feet nearly silently; the massive pillar-like legs keep the body level with little vertical bounce.',
      'The trunk is a fusion of nose and upper lip with a finger-like sensitive tip; it curls, lifts and sprays water.',
      'Large ears are used to radiate heat; they flap in hot conditions.',
      'Tusks (when present) are elongated incisor teeth, one on each side.',
    ],
    visualNotes: ['Shoulder blades and hip bones roll visibly under the skin at each slow step; ears ripple when flapped.'],
    defectsToAvoid: ['jointed "insect-like" trunk bending in the middle', 'bouncy galloping gait', 'trunk bending backwards'],
  },
  {
    key: 'reptile-aquatic',
    label: 'Reptiles and aquatic animals',
    domain: 'animal',
    match: /\b(snake|snakes|lizard|crocodile|alligator|turtle|tortoise|gecko|iguana|fish|shark|whale|dolphin|octopus|frog|aquatic)\b/i,
    facts: [
      'Lizards move with a sprawling side-to-side gait; snakes progress by undulation waves passing down the body.',
      'Fish swim by sweeping a VERTICAL tail fin side to side; whales and dolphins have HORIZONTAL flukes swept up and down.',
      'Crocodilians swim with legs tucked, the tail sculling; on land they use a high walk.',
      'Turtles/tortoises: shell is fixed anatomy — limbs emerge from specific openings and never pass through it.',
    ],
    visualNotes: ['Water surrounds fast swimmers with a visible bow wave and trailing wake.'],
    defectsToAvoid: ['fish tail flapping up-down like a whale', 'legs passing through the shell', 'snake moving like a rope being dragged rigid'],
  },
]

// ---------------------------------------------------------------------------
// C. Nature
// ---------------------------------------------------------------------------

const NATURE_COMPONENTS: WorldComponent[] = [
  {
    key: 'water-waves',
    label: 'Ocean waves and open water',
    domain: 'nature',
    match: /\b(ocean|sea\b|wave\w*|surf|shore|tide|beach|coast)\b/i,
    facts: [
      'Waves are traveling energy: water particles move in small orbits while the wave shape moves forward.',
      'Waves curl and break when they reach shallow water; the crest outruns the base and collapses forward.',
      'Breaking waves produce foam and wind-blown spray at the crest; the foam washes up the shore face and recedes.',
    ],
    visualNotes: ['Sun glints appear where the wave face angles toward the light; troughs read darker.'],
    defectsToAvoid: ['water surface moving as one rigid sheet', 'foam texture scrolling without shape change', 'wave crests rising and falling in place without travel'],
  },
  {
    key: 'waterfall-river',
    label: 'Waterfalls and rivers',
    domain: 'nature',
    match: /\b(waterfall|fall\w* water|river|stream|creek|rapids|current)\b/i,
    facts: [
      'Falling water accelerates downward, thinning into sheets and breaking into droplets; the base throws up persistent mist.',
      'Rivers flow downhill in the channel; the surface shows streaklines around rocks and eddies behind them.',
      'Splashes and foam concentrate where fast water meets obstacles or drops.',
    ],
    visualNotes: ['A river’s surface highlights follow the flow direction; standing pools read smoother and darker.'],
    defectsToAvoid: ['water flowing uphill', 'frozen curtain-like waterfall texture', 'mist absent at a high waterfall base'],
  },
  {
    key: 'fire-smoke',
    label: 'Fire and smoke',
    domain: 'nature',
    match: /\b(fire|flame\w*|burn\w*|bonfire|campfire|torch|ember\w*|smoke|smolder\w*)\b/i,
    facts: [
      'Flames rise: hot gas convects upward, so fire always points away from gravity (or toward the airflow).',
      'The flame base near the fuel is brightest; tips yellow-orange and thin out; blue appears near the fuel source in clean-burning zones.',
      'Fire consumes fuel progressively — burning areas spread upward and outward along the material.',
      'Smoke rises in turbulent curls, cools, widens and dissipates with distance and wind.',
    ],
    visualNotes: ['Embers glow orange and dim as they cool; fresh sparks rise faster than they fall.'],
    defectsToAvoid: ['flames pointing downward or sideways with no airflow', 'smoke sinking', 'fire burning with no fuel source', 'flame shape identical frame after frame'],
  },
  {
    key: 'rain-clouds-storm',
    label: 'Rain, clouds and storms',
    domain: 'nature',
    match: /\b(rain\w*|drizzle|storm\w*|thunder\w*|lightning|cloud\w*|monsoon|downpour|overcast|drizzl\w*)\b/i,
    facts: [
      'Rain falls essentially downward with wind drift; drops streak, splash on surfaces and wet them progressively.',
      'Clouds drift with the wind layer they form in; storm clouds darken from below and build vertically.',
      'Lightning is a near-instant flash whose light momentarily illuminates the whole scene before thunder follows.',
    ],
    visualNotes: ['Wet surfaces reflect the sky and brighten specular highlights; umbrellas and fabric shed visible streams.'],
    defectsToAvoid: ['rain falling in all directions', 'dry ground during a downpour', 'clouds moving opposite to visible wind effects'],
  },
  {
    key: 'wind-vegetation',
    label: 'Wind, trees and vegetation',
    domain: 'nature',
    match: /\b(wind\w*|breeze|gale|tree\w*|leaf|leaves|foliage|branch\w*|grass|bush\w*|flower\w*|field|meadow|forest)\b/i,
    facts: [
      'Wind acts on everything flexible at once: leaves flutter, branches sway, grass waves in traveling gusts.',
      'Flexible tips (thin branches, tall grass) move most; trunks barely move.',
      'Gusts arrive in waves, not as a constant uniform bend.',
    ],
    visualNotes: ['Debris/dust/petals picked by wind follow the same direction as the vegetation lean.'],
    defectsToAvoid: ['leaves moving while heavy branches stay rigid', 'all foliage oscillating in perfect unison'],
  },
  {
    key: 'snow-ice',
    label: 'Snow and ice',
    domain: 'nature',
    match: /\b(snow\w*|blizzard|ice\w*|frost\w*|glacier|icicle|hail\w*)\b/i,
    facts: [
      'Snow accumulates on upward-facing surfaces (shoulders, railings, branches) and slides off steep ones.',
      'Falling snow drifts with wind; footprints compress it and hold the shape briefly.',
      'Ice is glossy and translucent at edges; cracked ice fractures along sharp lines.',
    ],
    visualNotes: ['Breath fogs in cold air; snow muffles and dulls distant detail (atmospheric perspective).'],
    defectsToAvoid: ['snow on downward-facing surfaces only', 'footprints appearing ahead of the walker'],
  },
]

// ---------------------------------------------------------------------------
// D. Materials and objects
// ---------------------------------------------------------------------------

const MATERIAL_COMPONENTS: WorldComponent[] = [
  {
    key: 'glass-brittle',
    label: 'Glass (brittle fracture)',
    domain: 'material',
    match: /\b(glass|window|mirror|crystal|bottle|pane|shatter\w*)\b/i,
    facts: [
      'Glass is brittle: it does not bend before failure — cracks radiate from the impact point in radial and concentric patterns.',
      'Fragments are sharp-edged, scatter outward carrying the impact momentum, and fall under gravity.',
      'Cracks in a stressed pane grow with a faint tinkling sound and visible hairline webbing first.',
    ],
    visualNotes: ['Freshly broken edges catch bright specular highlights; dust and glittering shards hang briefly in the air.'],
    defectsToAvoid: ['glass bending like rubber before breaking', 'dull rounded fragments', 'shards floating upward'],
  },
  {
    key: 'metal-ductile',
    label: 'Metal (ductile deformation)',
    domain: 'material',
    match: /\b(metal\w*|steel|iron|aluminium|aluminum|copper|brass|chrome|alloy|dent\w*|weld\w*|grind\w*)\b/i,
    facts: [
      'Metal deforms before failing: impacts dent, bending leaves creases, and tearing needs great force.',
      'Ground or struck metal can throw sparks; polished metal shows sharp specular reflections of the environment.',
      'Welded/joined metal shows heat discoloration near the joint.',
    ],
    visualNotes: ['Dents crease smoothly with stretched highlights; scratched metal reveals brighter bare material.'],
    defectsToAvoid: ['metal shattering like ceramic', 'dents popping back instantly', 'reflection of a scene that does not exist around it'],
  },
  {
    key: 'wood-fibrous',
    label: 'Wood (fibrous fracture)',
    domain: 'material',
    match: /\b(wood\w*|timber|plank|log|branch\w*|tree trunk|splinter\w*|carve\w*|axe|chop\w*)\b/i,
    facts: [
      'Wood is anisotropic: it is much weaker along the grain — it splits, splinters and fibrous-tears along grain lines.',
      'Cutting across the grain needs edged tools and leaves smooth surfaces; breaking with the grain leaves jagged fibers.',
      'Varnished wood shows grain streaks under light; raw wood drinks light matte.',
    ],
    visualNotes: ['Splinters rotate independently as they separate; the break surface is lighter/dryer than the weathered outside.'],
    defectsToAvoid: ['wood snapping like dry spaghetti in mid-air with no fiber detail', 'grain direction changing between shots'],
  },
  {
    key: 'rubber-cloth-elastic',
    label: 'Rubber and cloth (elastic response)',
    domain: 'material',
    match: /\b(rubber|elastic|stretch\w*|bungee|latex|cloth|fabric|banner|flag|tarp\w*|sheet)\b/i,
    facts: [
      'Rubber stretches smoothly, thins at the stretched region, and snaps back with a wobble when released.',
      'Cloth resists by tension lines: pulled fabric shows straight taut creases from grip points, then drapes when released.',
      'Neither material springs instantly rigid — recovery is a short damped oscillation.',
    ],
    visualNotes: ['Stretch thins color slightly where the material is most extended.'],
    defectsToAvoid: ['infinite stretch with no thinning', 'cloth returning to rest with no settling motion'],
  },
  {
    key: 'liquid-pour',
    label: 'Liquids (pouring, viscosity, splash)',
    domain: 'material',
    match: /\b(water|milk|honey|oil|juice|syrup|wine|coffee|tea|liquid|pour\w*|spill\w*|drip\w*|splash\w*|fill\w*|glass of)\b/i,
    facts: [
      'A poured stream accelerates downward and thins as it falls; it breaks into droplets over enough distance.',
      'Viscosity sets the speed: water pours fast and splashy, honey/oil pour slow, rope-like and self-leveling.',
      'Impact produces a crown splash whose droplet count scales with impact speed; bubbles rise and pop at the surface.',
      'Liquid wets surfaces: a residual film glistens where it flowed.',
    ],
    visualNotes: ['The surface level rises smoothly while pouring; meniscus curves up the wall in a clean glass.'],
    defectsToAvoid: ['liquid holding a solid shape', 'splash without impact', 'level not rising while pouring continues'],
  },
  {
    key: 'collision-vehicle',
    label: 'Collisions and vehicle motion',
    domain: 'material',
    match: /\b(collid\w*|crash\w*|impact\w*|bump\w*|car|vehicle|truck|bike|motorcycle|bus|train|drive\w*|skid\w*|brake\w*)\b/i,
    facts: [
      'Momentum carries: heavy/fast objects continue moving through the impact, deforming at the contact zone.',
      'Braking wheels lock before skidding — tires leave marks, dust kicks up, the body pitches forward (nose-dive).',
      'Vehicles follow ground geometry: suspension compresses on bumps, body rolls outward in turns.',
    ],
    visualNotes: ['Wheel rotation direction must match travel direction; contact patches deform slightly under load.'],
    defectsToAvoid: ['wheels sliding without rotating', 'instant stops without weight transfer', 'collisions with no deformation or debris'],
  },
]

// ---------------------------------------------------------------------------
// E. Physics
// ---------------------------------------------------------------------------

const PHYSICS_COMPONENTS: WorldComponent[] = [
  {
    key: 'gravity-momentum',
    label: 'Gravity, momentum and inertia',
    domain: 'physics',
    match: /\b(gravity|fall\w*|drop\w*|throw\w*|toss\w*|launch\w*|projectile|arc|momentum|inertia|heav\w*|weight\w*)\b/i,
    facts: [
      'Unsupported objects accelerate downward; a thrown object follows a smooth parabolic arc.',
      'Momentum resists change: heavier or faster objects take visibly more time/distance to stop or turn.',
      'Nothing changes direction mid-air without a visible force acting on it.',
    ],
    visualNotes: ['Speed peaks at the bottom of a fall and at release; hanging objects hang straight down.'],
    defectsToAvoid: ['objects falling at constant speed', 'instant stops', 'floating objects with no support or thrust'],
  },
  {
    key: 'fluid-friction',
    label: 'Friction and fluid drag',
    domain: 'physics',
    match: /\b(friction|slide\w*|slip\w*|skid\w*|drag|swim\w*|underwater|resist\w*|screech\w*|slide)\b/i,
    facts: [
      'Sliding objects decelerate along the surface and can leave marks/dust; they do not glide forever.',
      'Water drag scales with speed: fast movement through water foams and trails bubbles.',
      'Rolling replaces sliding wherever wheels/balls can rotate.',
    ],
    visualNotes: ['Skid marks darken with braking force; underwater motion is slower with drifting particles.'],
    defectsToAvoid: ['objects sliding at constant speed uphill', 'no wake behind a fast swimmer'],
  },
  {
    key: 'optics-light',
    label: 'Light, shadow, reflection and refraction',
    domain: 'physics',
    match: /\b(light\w*|shadow\w*|reflect\w*|refract\w*|mirror|lens|shine\w*|glow\w*|glare|sunlight|lamp|spotlight|rim light|silhouette)\b/i,
    facts: [
      'Shadows form opposite the light source; a larger/softer source softens shadow edges, a small source hardens them.',
      'Reflection angle equals incidence angle on smooth surfaces; rough surfaces scatter the reflection (blurrier).',
      'Refraction bends light at the water/glass boundary — objects partially submerged appear bent/displaced at the surface line.',
      'Every light change must be consistent: one scene has one coherent sun/key direction unless a story reason changes it.',
    ],
    visualNotes: ['Mirrored/wet surfaces reflect the actual surrounding scene, including its color cast.'],
    defectsToAvoid: ['shadows pointing in different directions under one sun', 'reflections that ignore the environment', 'objects with no shadow on the ground plane'],
  },
]

// ---------------------------------------------------------------------------
// F. Space-time and continuity
// ---------------------------------------------------------------------------

const SPACETIME_COMPONENTS: WorldComponent[] = [
  {
    key: 'continuity-spacetime',
    label: 'Space-time continuity (objects, scene, camera)',
    domain: 'spacetime',
    match: /\b(shot|scene|sequence|camera|continue\w*|continuity|cut\b|transition|previous|next shot|consistent|same)\b/i,
    facts: [
      'Objects persist: something that leaves the frame exists off-screen and returns in a consistent state unless its change was shown.',
      'Motion is continuous: positions evolve smoothly; nothing teleports across cuts within the same scene.',
      'Screen direction is preserved between shots of the same scene (the 180° convention) unless a deliberate cut resets it.',
      'Lighting direction, color cast and weather stay coherent across shots of the same scene.',
      'Foreground occludes background consistently: layering never flips between frames.',
    ],
    visualNotes: ['Character identity anchors: face structure, hairstyle, outfit colors and props must persist between shots.'],
    defectsToAvoid: ['objects appearing/disappearing between frames', 'sudden light-direction flips', 'clothing or face changing between shots', 'duplicated body parts after a cut'],
  },
]

const ALL_COMPONENTS: WorldComponent[] = [
  ...HUMAN_COMPONENTS,
  ...ANIMAL_COMPONENTS,
  ...NATURE_COMPONENTS,
  ...MATERIAL_COMPONENTS,
  ...PHYSICS_COMPONENTS,
  ...SPACETIME_COMPONENTS,
]

/** Maximum components assembled per request (bounded context, brief §12). */
export const MAX_WORLD_COMPONENTS = 8

/**
 * Assemble the world-knowledge components relevant to a prompt.
 * Selection is membership-driven (creatures/nature/materials/physicsActions
 * from understanding) plus concept-regex matches. Deterministic and bounded.
 */
export function assembleWorldKnowledge(u: PromptUnderstanding): WorldComponent[] {
  const text = u.normalized
  const hints = new Set<string>([...u.creatures, ...u.nature, ...u.materials, ...u.physicsActions])
  const selected: WorldComponent[] = []
  for (const c of ALL_COMPONENTS) {
    const hit = c.match.test(text) || [...hints].some((h) => c.match.test(h))
    if (!hit) continue
    selected.push(c)
    if (selected.length >= MAX_WORLD_COMPONENTS) break
  }
  return selected
}

/**
 * Compact structured knowledge block for model conditioning.
 * Opens with an honest scope line — this is reference guidance, not a
 * physics engine — and stays far under prompt budgets (bounded lines).
 */
export function renderWorldKnowledgeBlock(components: WorldComponent[]): string {
  if (components.length === 0) return ''
  const lines: string[] = [
    'PHYSICAL-REALITY REFERENCE (curated constraint knowledge, not a physics simulation):',
  ]
  for (const c of components) {
    lines.push(`- ${c.label}:`)
    for (const f of c.facts.slice(0, 4)) lines.push(`  · ${f}`)
    if (c.defectsToAvoid.length > 0) {
      lines.push(`  Avoid: ${c.defectsToAvoid.slice(0, 4).join('; ')}.`)
    }
  }
  return lines.join('\n')
}
