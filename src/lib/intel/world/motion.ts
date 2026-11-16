/**
 * BEAN Intelligence — motion timeline builder (Part 4/Part 7 of the work
 * order): for video requests, a structured timeline with starting state,
 * actions, intermediate states, physical interactions, ending state and
 * camera continuity. Deterministic from the scene plan + motion verb
 * physics; the timeline is serialized into the provider prompt in the shape
 * the provider ACTUALLY supports (text), and persisted as structured
 * metadata for evaluation.
 */

import type { ScenePlan, Subject } from './analyze'

export interface MotionBeat {
  /** Normalized time window within the clip, e.g. [0, 0.2] = first 20%. */
  tStart: number
  tEnd: number
  /** What happens — physics-annotated. */
  action: string
  /** Physical rules in force during this beat. */
  physics: string[]
}

export interface MotionTimeline {
  startState: string
  beats: MotionBeat[]
  endState: string
  cameraContinuity: string
  /** Honest note when no motion was detected (static scene timeline). */
  note: string | null
}

/** Per-subject-class default states. */
function startStateFor(subjects: Subject[], scene: ScenePlan): string {
  const env = scene.environment ? ` in ${scene.environment}` : ''
  if (subjects.some((s) => s.class === 'bird')) return `A bird holds a stable posture with wings folded or gliding, feathers smoothed${env}.`
  if (subjects.some((s) => s.class === 'fish-aquatic')) return `The aquatic animal holds position mid-water, fins steadying${env}.`
  if (subjects.some((s) => s.class === 'person')) return `The person stands balanced over their feet, weight settled, arms relaxed${env}.`
  if (subjects.some((s) => s.class === 'mammal-quadruped')) return `The animal stands on four legs, head level, tail at rest${env}.`
  if (subjects.some((s) => s.class === 'vehicle')) return `The vehicle is at rest with wheels stopped, suspension neutral${env}.`
  if (subjects.some((s) => s.class === 'fire')) return `The flame burns steadily, upright, with a thin smoke thread rising${env}.`
  if (subjects.some((s) => s.class === 'water-body')) return `The water surface carries small natural ripples${env}.`
  return `The scene is at rest: every object in its natural position under gravity${env}.`
}

function endStateFor(subjects: Subject[], scene: ScenePlan): string {
  const env = scene.environment ? ` in ${scene.environment}` : ''
  if (scene.motionVerbs.some((m) => m.includes('gravity-driven descent'))) {
    return `The falling motion ends at ground contact with a small bounce-settle and dust or splash at the impact point${env}.`
  }
  if (scene.motionVerbs.some((m) => m.includes('aerial locomotion'))) {
    return `The flight settles into a steady glide or landing flare, wings braking, legs reaching for a perch or water${env}.`
  }
  if (scene.motionVerbs.some((m) => m.includes('fast locomotion'))) {
    return `The run decelerates to a stop over two to three steps, arms and tail settling, breathing visible${env}.`
  }
  if (scene.motionVerbs.some((m) => m.includes('legged locomotion'))) {
    return `The walk completes its last stride and comes to a balanced standstill${env}.`
  }
  if (scene.motionVerbs.some((m) => m.includes('material failure'))) {
    return `Debris from the failure has finished flying and settled; the broken pieces rest in stable positions${env}.`
  }
  if (subjects.some((s) => s.class === 'water-body')) return `The water continues its natural motion; any splash has fallen back and surface ripples spread outward${env}.`
  return `The scene rests again in a new stable state consistent with everything that just happened${env}.`
}

/**
 * Beat templates keyed by the physical motion description from analyze.ts.
 * Each beat carries the physics that MUST be visible — this is how the
 * grounding layer enforces "do not assume text retrieval guarantees physics".
 */
function beatsForMotion(motion: string, subjects: Subject[]): Array<{ action: string; physics: string[] }> {
  if (motion.includes('legged locomotion')) {
    return [
      { action: 'Weight shifts onto one leg; the other foot lifts with a slight body rise.', physics: ['balance maintained over the stance foot', 'arms (if human) counter-swing opposite to the stepping leg'] },
      { action: 'The stride carries through: heel strike, weight transfer over the arch, toe-off push.', physics: ['foot plants before the body passes over it', 'loose clothing and hair follow with a small lag'] },
      { action: 'Steps alternate with a steady rhythm; the body bobs slightly at each step.', physics: ['at least one foot grounded at all times (no walking flight phase)', 'ground contact visible under the planted foot'] },
    ]
  }
  if (motion.includes('fast locomotion')) {
    return [
      { action: 'A burst of acceleration: the body leans forward into the run.', physics: ['lean into acceleration', 'arms pump in opposition to the legs'] },
      { action: 'Full running cycle: drive, flight phase (both feet off ground), landing absorb.', physics: ['brief flight phase with both feet airborne', 'landing leg flexes to absorb momentum'] },
      { action: 'Sustained strides with visible effort — fabric, hair and tail streaming behind.', physics: ['air drag streams loose elements backward'] },
    ]
  }
  if (motion.includes('aerial locomotion')) {
    const bird = subjects.some((s) => s.class === 'bird')
    return [
      { action: bird ? 'Takeoff: a leap with hard downward wingbeats gaining lift.' : 'Launch into the air with accelerating lift.', physics: ['downstroke generates lift and forward thrust', 'wingtips twist and separate at the top of the stroke'] },
      { action: bird ? 'Steady flapping with occasional glide; the tail fans to steer.' : 'Steady forward flight.', physics: ['wingbeat rate matches body size (small = fast, large = slow)', 'banking tilts the whole body, not just the wings'] },
      { action: bird ? 'The wings sweep through a full stroke cycle; primaries separate on the upstroke.' : 'Continuous controlled motion.', physics: ['wings never fold backwards mid-downstroke', 'feathers overlap like shingles and flex under load'] },
    ]
  }
  if (motion.includes('gravity-driven descent')) {
    return [
      { action: 'The object/subject loses support and begins to fall.', physics: ['acceleration builds continuously from the first frame of the fall'] },
      { action: 'Fast descent with loose elements rising relative to the body.', physics: ['speed increases with every passing moment (9.81 m/s²)', 'hair and cloth trail upward during free fall'] },
      { action: 'Impact and settle.', physics: ['deformation/dust/splash exactly at the contact point', 'momentum converts to bounce, debris and sound'] },
    ]
  }
  if (motion.includes('buoyant locomotion')) {
    return [
      { action: 'The body undulates, pushing water backward.', physics: ['lateral wave travels from head to tail (fish)', 'fins steer and brake'] },
      { action: 'Steady swimming with bubbles and surface disturbance if near the top.', physics: ['water resists and streams along the body', 'light refracts across the surface above'] },
    ]
  }
  if (motion.includes('gravity stream') || motion.includes('fluid motion')) {
    return [
      { action: 'The liquid leaves its container/source and forms a falling stream.', physics: ['stream thins as it accelerates downward', 'splash crown and droplets where it lands'] },
      { action: 'The pour continues; the receiving level rises.', physics: ['viscosity sets the stream shape (water splashy, honey ropey)', 'droplets fall in parabolas'] },
    ]
  }
  if (motion.includes('material failure') || motion.includes('radial fragmentation') || motion.includes('rapid energy release')) {
    return [
      { action: 'Impact or overload reaches the material.', physics: ['nothing breaks before the force arrives'] },
      { action: 'Failure propagates: cracks race through the material, pieces separate.', physics: ['glass: radial + concentric shards from the impact point', 'wood: splinters follow the grain', 'debris flies outward with spin'] },
      { action: 'Fragments fly and settle; dust settles last.', physics: ['heavier pieces land nearer; momentum decays by friction'] },
    ]
  }
  if (motion.includes('elastic') || motion.includes('rebound')) {
    return [
      { action: 'The object strikes the surface and compresses.', physics: ['compression at contact, energy stores in elasticity'] },
      { action: 'Rebound with diminishing height, settling to rest.', physics: ['each bounce lower than the last (energy lost to heat/sound)'] },
    ]
  }
  if (motion.includes('crouch-launch-flight-landing') || motion.includes('jump')) {
    return [
      { action: 'A crouch lowers the body, storing elastic energy in the legs.', physics: ['weight gathers over the feet before any upward motion'] },
      { action: 'Explosive extension launches the body upward; loose elements lag behind.', physics: ['hair and cloth rise relative to the body at launch', 'the trajectory is a parabola under gravity'] },
      { action: 'Landing: legs flex to absorb momentum, then the body settles.', physics: ['flexed landing absorbs momentum', 'a small rebound/settle before stillness'] },
    ]
  }
  if (motion.includes('limb traction against gravity') || motion.includes('climb')) {
    return [
      { action: 'Alternating grips and footholds carry the body upward.', physics: ['three points of contact maintained through most phases', 'progress stops when a grip slips'] },
      { action: 'Steady upward progress with visible effort.', physics: ['gravity loads the hanging limbs between pulls'] },
    ]
  }
  if (motion.includes('passive motion with wind or current') || motion.includes('drift')) {
    return [
      { action: 'The object moves with the wind/current, not against it.', physics: ['direction matches the ambient flow field', 'rotation and bobbing from turbulence'] },
      { action: 'Slow dispersal as the flow carries it onward.', physics: ['no self-propulsion — speed matches the flow'] },
    ]
  }
  if (motion.includes('solid-to-liquid transition') || motion.includes('melt')) {
    return [
      { action: 'The solid softens and begins to sag.', physics: ['shape loses structure from the warmest point first'] },
      { action: 'The melt spreads into a pool.', physics: ['liquid obeys gravity and level; solids above sink into it'] },
    ]
  }
  if (motion.includes('limb arc with cloth lag') || motion.includes('wave')) {
    return [
      { action: 'The arm/limb sweeps an arc.', physics: ['cloth and sleeve follow with a visible delay'] },
      { action: 'The gesture completes and the limb returns to rest.', physics: ['momentum decays smoothly, no snap-freeze'] },
    ]
  }
  if (motion.includes('rotation')) {
    return [
      { action: 'Torque spins the object about its axis.', physics: ['rotation is continuous and smooth unless friction stops it'] },
      { action: 'Steady spin with any wobble from imbalance.', physics: ['loose parts lag and flare outward'] },
    ]
  }
  if (motion.includes('combustion')) {
    return [
      { action: 'The flame intensifies and flickers upward.', physics: ['flame tapers and rises; color matches temperature'] },
      { action: 'Smoke thickens and drifts with the wind.', physics: ['smoke ascends and widens with height'] },
    ]
  }
  if (motion.includes('rhythmic whole-body motion')) {
    return [
      { action: 'Rhythmic movement begins from a counted beat.', physics: ['weight shifts land on the beat', 'cloth and hair swing with a slight delay'] },
      { action: 'The dance continues with whole-body coordination.', physics: ['joints bend within natural limits', 'contact with the floor stays believable'] },
    ]
  }
  if (motion.includes('vehicle locomotion')) {
    return [
      { action: 'The vehicle accelerates; wheels spin up to ground speed.', physics: ['no wheel sliding unless braking', 'suspension compresses at launch'] },
      { action: 'Travel with environment passing at consistent speed.', physics: ['background motion matches speed; no teleporting obstacles'] },
    ]
  }
  return [
    { action: 'Subtle natural motion: micro-movements, ambient elements living.', physics: ['nothing moves without a cause', 'ambient motion (leaves, water, light) stays coherent'] },
  ]
}

function cameraContinuityFor(scene: ScenePlan, durationSec: number): string {
  const cue = scene.cameraCues[0]
  if (cue) {
    return `Camera: ${cue}. One move per beat, smooth acceleration ramps, screen direction and eyelines constant across the whole ${durationSec}s take; scene geometry and light direction never jump.`
  }
  return `Camera: a single steady framing that follows the action smoothly across the whole ${durationSec}s take — no jump cuts, consistent screen direction, consistent light direction.`
}

/**
 * Build the motion timeline. `durationSec` defaults to 5 (provider minimum).
 * When NO motion verb is present the timeline is honest about it: an ambient
 * "living scene" timeline, not a fabricated action sequence.
 */
export function buildMotionTimeline(scene: ScenePlan, durationSec = 5): MotionTimeline {
  const d = Math.max(3, Math.min(12, durationSec))
  const motions = scene.motionVerbs.length > 0 ? scene.motionVerbs : ['ambient']
  const note = scene.motionVerbs.length === 0
    ? 'No explicit motion in the prompt — ambient natural motion only (not a fabricated action sequence).'
    : null

  const rawBeats = motions.flatMap((m) => beatsForMotion(m, scene.subjects)).slice(0, 3)
  const n = rawBeats.length
  const beats: MotionBeat[] = rawBeats.map((b, i) => ({
    tStart: Math.round((i / n) * 100) / 100,
    tEnd: Math.round(((i + 1) / n) * 100) / 100,
    action: b.action,
    physics: b.physics,
  }))

  return {
    startState: startStateFor(scene.subjects, scene),
    beats,
    endState: endStateFor(scene.subjects, scene),
    cameraContinuity: cameraContinuityFor(scene, d),
    note,
  }
}

/**
 * Serialize the timeline into provider-consumable text (the hosted video
 * provider accepts a text prompt — the timeline folds into the prompt in
 * time-ordered, physics-annotated prose; structured data is persisted
 * alongside for evaluation, never claimed as provider-side conditioning).
 */
export function serializeTimeline(t: MotionTimeline): string {
  const beatLines = t.beats.map(
    (b) => `${Math.round(b.tStart * 100)}-${Math.round(b.tEnd * 100)}%: ${b.action} (${b.physics.join('; ')})`,
  )
  const lines = [
    `Start: ${t.startState}`,
    ...beatLines.map((l) => `Then ${l}`),
    `End: ${t.endState}`,
    t.cameraContinuity,
  ]
  return lines.join(' ')
}
