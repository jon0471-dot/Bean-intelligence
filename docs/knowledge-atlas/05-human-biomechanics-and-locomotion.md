Atlas ID: ATLAS-05 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# 05 · Human Biomechanics and Locomotion

This file documents the mechanical principles that govern human movement and the locomotion repertoire — walking, running, jumping, hopping, and the non-linear locomotions — at a descriptive, textbook level. It depends on the musculoskeletal structures documented in [04-human-anatomy-and-physiology.md](04-human-anatomy-and-physiology.md) and on the mechanical laws documented in [16-physics-motion-forces-and-energy.md](16-physics-motion-forces-and-energy.md).

## 1. Scope and Method: Kinematics, Kinetics, and the Movement Pipeline

Biomechanics applies mechanics to living bodies: **kinematics** describes motion (positions, segment angles, velocities) while **kinetics** describes causes (forces, torques, impulses); both are needed because the same joint angle can be produced by very different force patterns. This file supplies the mechanics layer that the action entries of 06-08 instantiate, whose Class, phase, and parameter fields lean on the vocabulary defined here. Safety boundary: descriptive structure-and-mechanism knowledge only — not technique coaching, conditioning advice, or clinical gait analysis; those belong to qualified professionals.

## 2. Forces, Torques, Levers, and Whole-Body Mechanics

Muscles pull on bones across joints, so force transmission is rotational: a muscle force times its moment arm is a **torque**. Skeletal geometry creates the three lever classes. A **first-class lever** appears in head nodding, the atlanto-occipital joint sitting between neck-muscle pull behind and facial weight ahead. A **second-class lever** appears in rising onto the toes — forefoot fulcrum, body weight through the ankle, calf force at the heel with the longer arm — the body's rare force-favouring case. A **third-class lever** is the common limb pattern, as in elbow flexion where the biceps inserts close to the joint and the load sits in the hand: force is traded for speed and range, which is why tendon forces can greatly exceed the external load held.

External forces set the terms of every ground-based action. Gravity acts at the **centre of mass (COM)**, in standing adults near the pelvis at roughly 55% of stature (approximate; varies with build). The **ground reaction force (GRF)** — the ground's response to the body's push — determines, through its line of action relative to each joint, the moments the muscles must counter. Friction at the foot-ground interface enables push-off; its sudden loss is the mechanics of slipping (08 §3). Air and water resistance matter in sprinting and swimming.

**Base of support (BOS)** is the area under and between the supporting feet plus any hand supports; static balance requires the COM's projection to stay inside it, and dynamic balance is the active, continuous neuromuscular project of keeping it there. Wider stance, lower COM, and greater mass raise passive stability, but most real stability is actively controlled through the sensory-motor loop of 04 §6 and 08 §2. Energetically, movement exchanges potential and kinetic energy while tendons store and return strain energy, and metabolic cost shapes preference: at a given speed, people spontaneously select step frequencies near the energy-minimising cadence.

## 3. The Gait Cycle: Controlled Phase Vocabulary

One **gait cycle** runs from initial contact of one foot to the next initial contact of the same foot; at comfortable speed roughly 60% is **stance** (foot on ground) and 40% is **swing** (foot in air), with two brief **double-support** periods. The atlas uses the controlled phase vocabulary defined in [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) §3.2 (all values approximate, population averages):

| Phase | Share of cycle | Key events and mechanics |
| --- | --- | --- |
| Initial contact | ~0-2% | Heel-first touchdown ends swing; hip flexed ~20-25°, knee near extension, ankle near neutral; limb deceleration by hamstrings has just ended. |
| Loading response | ~2-12% | Weight acceptance; controlled knee flexion to ~15-18° absorbs shock; ankle moves toward plantarflexion as the foot lowers to the ground; first double support. |
| Mid-stance | ~12-31% | Single-limb support as the body passes over the foot; ankle dorsiflexes as the tibia advances; knee extends; contralateral limb swings past. |
| Terminal stance | ~31-50% | Heel rise and weight transfer onto the forefoot; ankle begins plantarflexion; COM passes ahead of the supporting foot; hip extends behind the body. |
| Pre-swing | ~50-62% | Rapid ankle plantarflexion completes push-off; knee flexes toward ~40°; second double support; toe-off ends stance. |
| Initial swing | ~62-75% | Knee flexion peaks near ~60° to clear the foot; hip begins flexing; ankle lifts from plantarflexion toward neutral. |
| Mid swing | ~75-87% | Knee extends as the tibia swings vertical; foot passes beneath the body; dorsiflexors maintain clearance. |
| Terminal swing | ~87-100% | Knee approaches extension; hamstrings eccentrically decelerate the shank; limb positioned for the next initial contact. |

Two mechanical through-lines run across the table: **shock absorption at weight acceptance**, where each loading response is an eccentric braking event, and the **ankle rocker sequence** — heel rocker at contact, ankle rocker in mid-stance, forefoot rocker at push-off — which with plantarflexor work and tendon recoil converts muscular effort into forward travel. Pelvic rotation and list, knee flexion, and arm swing smooth the COM's path and counterbalance trunk rotation.

## 4. Walking Parameters and Normal Variation

Comfortable overground walking in healthy adults clusters around: speed ~1.2-1.4 m/s; cadence ~100-120 steps per minute; stride length (same foot to same foot) ~1.2-1.6 m; stance ~60% and swing ~40% of the cycle; total double support ~20-25%. These are population-level approximations, not norms. Cadence and stride covary with stature; older adults on average walk more slowly with longer double-support phases; children walk at higher cadence with shorter strides; terrain, footwear, load carriage, fatigue, and cultural habit shift all values. Individual gait signatures remain recognisable inside the healthy range, which is why the atlas records ranges rather than targets and never treats deviation as disorder (diagnosis belongs to clinicians, per the safety boundary of 04 §1).

## 5. Running and Sprinting: Flight, Stance, and the Stretch-Shortening Cycle

Running differs from walking in one decisive respect: a **flight phase** replaces double support, and no part of the cycle has both feet down. Stance share shrinks as speed rises — roughly 30-40% of the cycle at recreational paces, shorter still in sprinting — so the supporting leg carries the body with less time available, and vertical GRF rises to roughly 2-3 × body weight at moderate running speeds and higher as speed increases. Each stance splits into braking (GRF directed backward against forward motion) followed by propulsion.

The defining engine of running is the **stretch-shortening cycle (SSC)**: an active muscle is first stretched (eccentric phase, storing elastic strain in series elements such as the Achilles tendon), held briefly (amortisation), then recoils into concentric work. Tendon recoil returns a substantial share of each stride's energy, making running metabolically cheaper than pure-muscle propulsion. Contact patterns vary normally — rearfoot, midfoot, and forefoot strikes all occur in healthy runners — and easy-pace cadences fall near 160-180 steps per minute, with individual, speed, and build variation.

**Sprinting** exaggerates the same mechanics: ground contacts commonly under ~0.2 s (shortest at elite speeds), large horizontal force production within that contact, high stride rates, trunk-lean and arm-drive contributions, and pronounced reliance on hip-extensor and ankle stiffness. Sprint technique is described here at mechanics level; coaching belongs elsewhere.

## 6. Jumping, Hopping, Skipping, and Non-Linear Locomotion

A **countermovement vertical jump** begins with a rapid downward dip (eccentric loading of the hip and knee extensors and the Achilles tendon), a brief amortisation, then explosive **triple extension** — hip, knee, and ankle extending together — driving the COM upward; flight is a projectile arc governed by takeoff velocity (16-physics). Elastic recoil plus reflex potentiation typically makes a countermovement jump a few to ~ten per cent higher than a static-start jump (approximate, varies by person and protocol). Arm swing adds takeoff momentum, and landing forces scale inversely with how much flexion absorbs the descent (08 §4-5). **Hopping** is the cyclic SSC in miniature — repeated bounce with tendon-dominant energy return — and **skipping** grafts an extra hop onto each step, producing the asymmetric gait children adopt spontaneously.

Non-linear locomotion generalises these principles to other body geometries. **Crawling** spreads support over four limbs, lowering the COM and widening the BOS at the cost of speed; reciprocal contralateral patterns echo walking coordination. **Climbing** couples pulling with grip forces and triple-flexion positioning; hold quality sets the friction budget. **Descending** — stairs, slopes, drops — is eccentric braking against gravity, with knee-control demands that make descent mechanically harder than ascent for many people. **Rolling** redistributes momentum across successive contacts, a floor-transition skill that reappears as fall-arrest technique (08 §3, §6). **Swimming** replaces ground reaction with fluid reaction: buoyancy offsets most body weight, drag dominates the force budget, and propulsion comes from coordinated hand and forearm paths plus kick; strokes are detailed in 07 §7.

## 7. Action Entries

Entries below follow the 12-field action schema of [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) (§3.1 Class vocabulary; §3.2 gait phases). All quantitative values are approximate population averages with normal variation; see the safety note in §1.

### A05-01 · Ordinary walking

| Field | Value |
| --- | --- |
| Name | Ordinary walking |
| Class | locomotion |
| Definition | Cyclic bipedal transport on level ground in which the body advances through alternating single-limb support and brief double support, powered by paired lower-limb push-offs. |
| Body segments | Whole body; pelvis and both lower limbs primarily; coordinated arm swing and trunk counter-rotation. |
| Joint actions | Hip flexion/extension ~0-30°; knee flexion 0 to ~60°; ankle dorsiflexion/plantarflexion ~15° each direction (approximate). |
| Phase structure | Stance: initial contact → loading response → mid-stance → terminal stance → pre-swing; swing: initial swing → mid swing → terminal swing. |
| Temporal profile | Full cycle ~1.0-1.2 s at comfortable speed; stance ~60%, swing ~40%; two double-support periods of ~10-15% each (approximate). |
| Kinetic profile | Vertical GRF with two peaks ~1.0-1.2 × body weight; braking then propulsive shear ~0.15-0.2 × body weight; low metabolic cost per metre (approximate). |
| Context | Level, firm, unobstructed surfaces; daily ambulation, shod or unshod. |
| Variation | Speed, stature, age, footwear, terrain, load carriage, and habitual style shift all values; healthy individual gait signatures remain recognisable. |
| Safety note | Descriptive only; not a gait-diagnostic instrument and not a substitute for clinical gait analysis. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 9-11); NCBI Bookshelf (ncbi.nlm.nih.gov/books); AMASS and HumanML3D include walking-class motion for data purposes (license notes in §9). |

### A05-02 · Running

| Field | Value |
| --- | --- |
| Name | Running |
| Class | locomotion |
| Definition | Cyclic bipedal transport at speeds where a flight phase replaces double support, with brief single-leg stance repeated on alternating sides. |
| Body segments | Whole body; lower limbs dominate; arms drive reciprocally to balance trunk rotation. |
| Joint actions | Stance hip extends from flexion; knee flexes ~30-45° under load then extends; ankle plantarflexes strongly at push-off; swing hip flexes ~60°+ (approximate). |
| Phase structure | Per stride: initial contact → loading (braking) → mid-stance → propulsion (push-off) → flight; then initial swing → mid swing → terminal swing. |
| Temporal profile | Full cycle ~0.6-0.8 s at recreational paces; stance ~30-40% and shrinking with speed; easy-pace cadence ~160-180 steps per minute (approximate). |
| Kinetic profile | Vertical GRF ~2-3 × body weight at moderate speed; braking-then-propulsion pattern; large share of stride energy returned by tendon recoil via the stretch-shortening cycle. |
| Context | Roads, tracks, trails; sprint through distance modalities. |
| Variation | Foot-strike pattern (rearfoot, midfoot, forefoot), cadence, stride length, footwear, surface, and build vary widely within healthy performance. |
| Safety note | Descriptive mechanics only; not training prescription or injury guidance. |
| Sources | OpenStax *Anatomy and Physiology 2e*; OpenStax *College Physics* (momentum and energy); NCBI Bookshelf; Motion-X and AMASS include running-class motion (license notes in §9). |

### A05-03 · Vertical jump (countermovement)

| Field | Value |
| --- | --- |
| Name | Vertical jump (countermovement) |
| Class | locomotion |
| Definition | Vertical displacement of the body by an explosive simultaneous push of both legs, preceded by a rapid countermovement dip that loads the extensor muscles and tendons. |
| Body segments | Both lower limbs, pelvis, trunk; arm swing contributes upward momentum. |
| Joint actions | Rapid hip/knee flexion then explosive hip-knee-ankle extension (triple extension); ankle plantarflexion at toe-off; shoulder flexion in arm swing (approximate). |
| Phase structure | Countermovement (eccentric load) → amortisation → propulsive extension (concentric) → flight → landing (arrest in 08 §5). |
| Temporal profile | Ground phases several hundred milliseconds (~0.3-0.5 s common); flight ~0.4-0.5 s for jumps of roughly 30-45 cm (approximate). |
| Kinetic profile | Peak propulsive GRF roughly 1.5-3 × body weight; landing forces scale inversely with absorption depth and can exceed takeoff forces; elastic recoil contributes to takeoff. |
| Context | Play, sport testing, dance and court-sport actions; depth and surface vary. |
| Variation | Countermovement typically adds a few to ~ten per cent height versus a static-start jump; arm swing, technique, and training shift outcomes; values vary widely between individuals. |
| Safety note | Descriptive mechanics; landing-surface and progression choices belong to qualified instruction. |
| Sources | OpenStax *Anatomy and Physiology 2e*; OpenStax *College Physics* (projectile motion, impulse); NCBI Bookshelf. |

### A05-04 · Squat (bodyweight lowering and rising)

| Field | Value |
| --- | --- |
| Name | Squat (bodyweight lowering and rising) |
| Class | posture-transition |
| Definition | Lowering of the body's COM by simultaneous flexion of hips, knees, and ankles, followed by extension back to standing; both a daily transition and a foundational exercise family. |
| Body segments | Both lower limbs, pelvis, trunk; arms counterbalance as needed. |
| Joint actions | Hip and knee flexion to chosen depth, ankle dorsiflexion with controlled heel contact, trunk inclination maintained over the foot (approximate, depth-dependent). |
| Phase structure | Initiation → eccentric descent → depth reversal → concentric ascent → terminal stabilisation. |
| Temporal profile | ~2-4 s per controlled repetition (approximate); transitions in daily life are faster and less symmetric. |
| Kinetic profile | Eccentric braking during descent, concentric drive during ascent; knee and hip extensor demands grow steeply with depth; loaded variants multiply loads on the same mechanics. |
| Context | Everyday transfers (low seats, lifting posture), resistance training, sport foundations. |
| Variation | Depth, stance width, foot turn-out, and trunk lean vary; hip and ankle geometry shift achievable depth within normal anatomy; heel elevation and arm positions are common adaptations. |
| Safety note | Descriptive mechanics only; loaded-technique coaching belongs to qualified professionals (technique families appear in 07 §6). |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 9-11); NCBI Bookshelf; Uberon (UBERON_0000981 femur, UBERON_0000979 tibia). |

## 8. Relationships

| Related file | Relation | Rationale |
| --- | --- | --- |
| [04-human-anatomy-and-physiology.md](04-human-anatomy-and-physiology.md) | grounds-in | Every torque, ROM value, and tendon-recoil claim here is grounded in the musculoskeletal structures documented there. |
| [16-physics-motion-forces-and-energy.md](16-physics-motion-forces-and-energy.md) | grounds-in | Forces, torques, impulses, and projectile behaviour applied to the body derive from classical mechanics. |
| [06-human-actions-gestures-and-motion.md](06-human-actions-gestures-and-motion.md) | explains-mechanism-of | The mechanics of COM, BOS, and joint torques explain how everyday actions and transitions are produced. |
| [07-human-dance-sports-and-performance.md](07-human-dance-sports-and-performance.md) | specialises | Sport and dance techniques in 07 are specialisations of the general locomotion and jump primitives documented here. |
| [08-human-falls-impact-balance-and-recovery.md](08-human-falls-impact-balance-and-recovery.md) | applies-to | COM-BOS mechanics and the stretch-shortening cycle apply directly to balance loss, landing, and recovery. |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | constrains | The schema fixes the controlled gait-phase vocabulary (§3.2) and the 12-field entry format used in §7. |
| [02-source-provenance-and-licensing.md](02-source-provenance-and-licensing.md) | evidenced-by | Sources and their licenses for all claims are registered there. |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | constrains | The coverage map fixes this file's domain boundaries and sibling filenames. |

## 9. References

- OpenStax, *Anatomy and Physiology 2e*. Publisher: Rice University; openstax.org; license: CC BY 4.0; accessed 2026-11-24.
- OpenStax, *College Physics*. Publisher: Rice University; openstax.org; license: CC BY 4.0; accessed 2026-11-24.
- NCBI Bookshelf (StatPearls biomechanics and gait entries). ncbi.nlm.nih.gov/books; accessed 2026-11-24.
- Uberon Multi-species Anatomy Ontology. obofoundry.org; license: CC BY 3.0; accessed 2026-11-24.
- Motion-X dataset. https://motion-x-dataset.github.io/; license: CC BY-NC-SA (non-commercial; not usable in commercial BEAN products without separate authorization); accessed 2026-11-24.
- AMASS (Archive of Motion Capture as Surface Shapes). https://amass.is.tue.mpg.de/; license: non-commercial research; accessed 2026-11-24.
- HumanML3D. https://github.com/EricGuoICT/HumanML3D; data not redistributable; component licenses apply; accessed 2026-11-24.
