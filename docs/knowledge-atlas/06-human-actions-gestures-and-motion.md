Atlas ID: ATLAS-06 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# 06 · Human Actions, Gestures, and Motion

This file is the atlas's action ontology for everyday human movement: the postures people hold, the transitions between them, the ways hands meet objects, the gestures that carry meaning, and the daily activities that string these primitives together. It generalises the mechanics of [05-human-biomechanics-and-locomotion.md](05-human-biomechanics-and-locomotion.md) into a controlled vocabulary of action classes and provides the 12-field entry format that files 07 and 08 reuse.

## 1. Scope: The Action Ontology and How Entries Work

An **action** in this atlas is an intentional, structured movement episode with a recognisable start, phase progression, and end — as distinct from a static **posture** (a held configuration) and from reflexive or protective responses (documented in 08). Actions decompose into phases, recruit segments in characteristic sequences, and sit in a hierarchy: a daily activity such as dressing decomposes into reach-grasp-manipulate-release cycles, which decompose into joint actions grounded in 04 §4-5 and mechanics from 05 §2.

The **Class** field uses the controlled vocabulary of [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) §3.1. The eleven class values used across the atlas are: `posture` (held configuration), `posture-transition` (movement between configurations), `locomotion` (body transport), `object-interaction` (reach, grasp, manipulate, tool use), `gesture` (communicative movement), `daily-activity` (self-care and household tasks), `sport-skill`, `dance-technique`, `martial-technique`, `acrobatic` (gymnastic and performance elements), and `fall-response` (balance loss, protection, arrest, recovery).

Each entry is a 12-field record: **Name, Class, Definition, Body segments, Joint actions, Phase structure, Temporal profile, Kinetic profile, Context, Variation, Safety note, Sources**. Entries carry stable identifiers (A06-01, …) for cross-referencing. All values are descriptive population-level approximations; nothing here is instruction or diagnosis (safety boundary of 04 §1).

## 2. Postures and Postural Transitions

The canonical postures form a controlled set: **standing** (active balance over a narrow BOS), **sitting** (COM lowered, loads shifted to the seat), **lying** (supine, prone, or side-lying; the support surface carries the body and balance demands are minimal), **kneeling** (two-knee, half-kneel, or single-knee), and **squatting** as a sustained posture with depth and heel contact varying by ankle and hip geometry (04 §4; entry A05-04).

Transitions are where posture becomes action. **Sit-to-stand** is the mechanically heaviest common daily transfer: forward trunk lean moves the COM over the feet (flexion momentum), hip and knee extension raise it, and a final stabilisation settles balance; lower seats multiply the joint moments and arm push-off offloads them. **Stand-to-sit** reverses the sequence under eccentric control. **Lying-to-standing** is a multi-stage composite — roll, push to sitting, legs to floor, then sit-to-stand or rise via hands-and-knees and half-kneel — with difficulty varying by surface geometry and support use (entry A06-08). **Bending** splits into hip-hinge (spine long) and rounded-lumbar patterns, both normal, differing in load distribution rather than correctness. **Twisting** couples trunk rotation with foot and pelvis positioning, loading best when the base turns with the trunk. **Reaching** scales from elbow-height to overhead elevation (entry A06-02), and **stretching** is slow end-range lengthening of muscle-tendon units, static or dynamic, bounded by individual flexibility.

## 3. Grasp, Manipulation, and Tool Use

The hand is a grasping organ built around thumb opposition, which enables the two great grasp families. **Power grasps** wrap the whole hand around an object for force: cylindrical (handles, rails), spherical (knobs, balls), and hook (bag handles, bars). **Precision grasps** position the object between fingertips for control: tip pinch, tripod or three-jaw-chuck pinch (thumb, index, middle), and lateral pinch (thumb against the radial side of the index — keys, cards). Grip aperture scales to the object before contact, and grip force is calibrated to predicted load, adjusted by friction feedback.

**Manipulation** beyond contact includes repositioning forces (pressing, pulling, twisting) and **in-hand manipulation** — translating, rotating, or shifting an object within one grasp, grounded in the hand's intrinsic musculature (04 §5). **Bimanual coordination** assigns asymmetric roles — one hand stabilises while the other acts — and the roles swap fluidly. **Tool use** extends reach, force, and precision through the reach-grasp-orient-act-release chain, with tool affordances reshaping the arm's movement: a hammer concentrates force (entry A06-04), a spoon extends feeding reach, a key converts torque. **Assembling and disassembling** compose these into align-insert-turn-seat sequences, with bimanual stabilise-act roles throughout.

## 4. Communicative Gestures and Facial Expression

Gestures are movements produced for their meaning. A widely used typology classifies **co-speech gestures** into four families: **iconic** gestures depict concrete referents (a hand tracing a spiral while describing a staircase); **metaphoric** gestures give abstract ideas a spatial form; **deictic** gestures point out referents in real or imagined space (entry A06-05); **beat** gestures are small rhythmic strokes punctuating speech stress. Gesture rate and size vary widely across individuals and cultures, typically co-timed with speech prosody. **Emblems** — conventionalised signals such as a thumbs-up — carry fixed local meanings that differ across cultures, so the atlas records form and marks interpretation as culture-dependent rather than authoritative.

**Pointing** is the deictic core — index-finger extension with arm raise toward a referent — in variants including whole-hand and head-oriented pointing; documented cross-cultural variation includes lip-pointing in some communities, recorded as form-level observation. **Hand signs** in signed languages are structured linguistic systems combining handshape, location, movement, and palm orientation with facial grammar; the atlas documents their movement structure only, claiming no linguistic or cultural authority. **Facial expression** — brow, eyelid, and mouth configurations associated with emotion displays, plus conversational nods and eyebrow flashes — is widely replicated as broadly recognisable across cultures, with real cultural variation in display rules; descriptions here are form-level and variation-marked. Mechanically, communicative gesture is low-force, high-control movement on the same feedforward programmes as instrumental action (04 §6).

## 5. Daily Activities as Reach-Grasp-Manipulate-Release Sequences

Daily activities are composite actions built from the primitives of §2-4, and their atlas value lies in the decomposition. **Eating** chains utensil or hand-to-mouth transport with the **bite-chew cycle**: jaw cyclic opening and closing with tongue transport, seated at meal tempos. **Drinking** adds a controlled tilt phase (entry A06-06). **Dressing** is item-specific sequence knowledge: shirts (reach, shrug, pull), trousers (leg lifts or seated), fasteners — buttons are bimanual precision work (entry A06-07), zips bilateral pinches on opposed tabs, laces bimanual loop manipulation. **Bathing** runs reach-wash cycles across body regions, adapting to water, soap, and seating. **Grooming** — brushing hair, brushing teeth, shaving — uses cyclic arm strokes with mirror-guided or tactile control. **Cooking** chains gather → prepare → transform → season → serve, with cutting and stirring as cyclic tool actions at form level. **Cleaning** couples repetitive upper-limb strokes with whole-body repositioning and intermittent lifting. Across all of them the same signature recurs: vision locates, reach transports, grasp calibrates, manipulation applies, release concludes, and posture redistributes load between episodes.

## 6. Action Entries

Entries follow the 12-field schema (§1). All quantitative values are approximate population averages; variation is marked per entry.

### A06-01 · Sit-to-stand transfer

| Field | Value |
| --- | --- |
| Name | Sit-to-stand transfer |
| Class | posture-transition |
| Definition | Rising from a seated position to quiet standing by moving the COM forward over the feet and extending the hips and knees. |
| Body segments | Trunk, pelvis, both lower limbs; hands and arms assist on armrests or seat edge when used. |
| Joint actions | Trunk forward lean ~30-45°; hip flexion then extension; knee extension from ~90°; ankle dorsiflexion then plantarflexion (approximate, seat-dependent). |
| Phase structure | Preparatory lean (COM over feet) → seat-off → extension phase → terminal stabilisation. |
| Temporal profile | ~1-3 s typical (approximate); slower when performed quasi-statically without momentum. |
| Kinetic profile | Among the largest daily joint moments at hip and knee; lower seats multiply demand; arm push-off reduces lower-limb load. |
| Context | Chairs, toilets, bedsides, benches; frequent throughout the day. |
| Variation | Momentum-assisted versus quasi-static strategies; arm use; seat height and cushion geometry; performance varies widely with age and strength as population trends, not individually. |
| Safety note | Descriptive only; not a mobility assessment or clinical transfer-training protocol. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 10-11); NCBI Bookshelf. |

### A06-02 · Reaching overhead

| Field | Value |
| --- | --- |
| Name | Reaching overhead |
| Class | object-interaction |
| Definition | Transport of the hand upward toward a target above shoulder height, in preparation for grasp, placement, or gesture. |
| Body segments | Shoulder girdle, arm, forearm, hand; trunk extension and contralateral lean add height; heel rise optional. |
| Joint actions | Glenohumeral elevation with scapular upward rotation (scapulohumeral rhythm; full elevation ~180° combines ~120° glenohumeral and ~60° scapulothoracic contribution, approximate); elbow extension; wrist alignment to target. |
| Phase structure | Target fixation → transport (joint coordination toward target) → approach and alignment → contact or hold. |
| Temporal profile | ~0.5-1.5 s for casual reaches (approximate); slower for precise placement. |
| Kinetic profile | Low external force but sustained shoulder-girdle control; holding time multiplies muscular demand. |
| Context | Shelves, hanging rails, light switches, overhead storage; also gestural use. |
| Variation | Full elevation varies with shoulder and thoracic mobility within the healthy spectrum; trunk compensation patterns differ; comfortable holding height sits below full reach. |
| Safety note | Descriptive only; not workplace-ergonomics prescription or shoulder assessment. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 8, 14); Uberon (UBERON_0000976 humerus). |

### A06-03 · Precision pinch grasp

| Field | Value |
| --- | --- |
| Name | Precision pinch grasp |
| Class | object-interaction |
| Definition | Controlled prehension of a small object between fingertips, most characteristically thumb-index-tip (tip pinch) or thumb-index-middle (tripod pinch). |
| Body segments | Hand (thumb, index, middle), wrist, forearm; eyes guide approach. |
| Joint actions | Thumb opposition at the saddle joint; finger flexion at distal joints; wrist stabilisation; grip aperture shaping during reach (approximate). |
| Phase structure | Reach with aperture scaling → contact → force calibration → in-grasp manipulation → release. |
| Temporal profile | Reach-to-grasp ~0.3-0.8 s; sustained manipulation varies with task (approximate). |
| Kinetic profile | Low forces, high control; grip force calibrated to predicted slip via friction feedback; fine motor units dominate (04 §5). |
| Context | Coins, keys, needles, writing tools, small fasteners, touchscreens. |
| Variation | Hand size, digit length, and skill shift speed and grip selection; lateral pinch substitutes when visibility is poor; individual technique differs widely. |
| Safety note | Descriptive only; small-object handling hazards (ingestion, sharp edges) are situational, not covered here. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 8, 14); NCBI Bookshelf (hand anatomy entries); Uberon (hand skeleton terms). |

### A06-04 · Hammering (nail driving)

| Field | Value |
| --- | --- |
| Name | Hammering (nail driving) |
| Class | object-interaction |
| Definition | Striking an implement against a workpiece in repeated calibrated blows, coupling a power grasp with distal aim and impact control. |
| Body segments | Dominant hand and arm, shoulder, trunk; non-dominant hand sets and steadies the fastener early in the task. |
| Joint actions | Shoulder flexion/extension and elbow flexion/extension for the swing arc; wrist flick near impact; trunk rotation adds momentum (approximate). |
| Phase structure | Set-up and sightline → backswing → strike (acceleration to contact) → recoil → re-aim → repeat cycle. |
| Temporal profile | ~1-2 strikes per second in fluent work (approximate); slower for precision starts. |
| Kinetic profile | Impulsive force transfer at impact, brief and large; grip must transmit momentum while absorbing recoil; accuracy-force tradeoff governs swing amplitude. |
| Context | Woodwork, construction, household repairs; bimanual start (precision pinch sets the nail), then one-hand driving. |
| Variation | Wrist-dominant versus elbow-shoulder styles; strike tempos; tool mass and handle geometry alter the swing; individual styles differ widely. |
| Safety note | Descriptive mechanics only; striking-tool hazards and protective equipment are situational matters outside this file. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 10-11); OpenStax *College Physics* (impulse and momentum). |

### A06-05 · Pointing gesture

| Field | Value |
| --- | --- |
| Name | Pointing gesture |
| Class | gesture |
| Definition | Deictic gesture directing attention to a referent by extending the index finger and raising the arm toward it, usually co-timed with speech or gaze. |
| Body segments | Index finger, hand, arm, shoulder; head orientation and gaze co-occur; trunk turn for wide angles. |
| Joint actions | Index metacarpophalangeal extension with slight abduction; elbow extension or near-extension; shoulder flexion/abduction to aim (approximate). |
| Phase structure | Referent selection → arm transport toward line of sight → hold at aim → retraction. |
| Temporal profile | ~0.5-2 s per point including hold (approximate); beats and repeated points are faster. |
| Kinetic profile | Minimal force; precision lies in direction and co-timing with speech stress, not in load. |
| Context | Conversation, wayfinding, teaching, photography direction; also pre-verbal communication. |
| Variation | Whole-hand and head-oriented variants; lip-pointing documented in some communities as cultural form; gesture rate and amplitude vary widely between individuals and cultures. |
| Safety note | Descriptive form-level documentation only; meanings and conventions vary culturally and no interpretive authority is claimed. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 11, 14); NCBI Bookshelf (gesture and communication entries). |

### A06-06 · Pouring a drink

| Field | Value |
| --- | --- |
| Name | Pouring a drink |
| Class | daily-activity |
| Definition | Controlled transfer of liquid from a container to a vessel by lifting, transporting, and progressively tilting the container under visual monitoring of the stream. |
| Body segments | Hand and wrist, forearm, elbow, shoulder; trunk and eyes; second hand stabilises heavy vessels. |
| Joint actions | Cylindrical or handle grasp; forearm pronation and wrist flexion produce tilt; shoulder/elbow transport; micro-adjustments maintain stream position (approximate). |
| Phase structure | Grasp and lift → transport to target → progressive tilt with stream monitoring → stop-tilt → settle and return. |
| Temporal profile | ~3-6 s for a typical serve (approximate); slower for precise fills. |
| Kinetic profile | Modest loads scaling with vessel mass and fill level; two-hand strategies for kettles and bottles; spill avoidance favours slower tilt arcs near target fill. |
| Context | Kitchen and dining; hot and cold liquids; seated or standing. |
| Variation | Container geometry (spout, handle, flexibility) reshapes the tilt pattern; one- versus two-hand use; fill precision varies with practice and vessel transparency. |
| Safety note | Descriptive only; hot-liquid and breakage hazards are situational and outside this file's scope. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 8, 11); NCBI Bookshelf. |

### A06-07 · Buttoning

| Field | Value |
| --- | --- |
| Name | Buttoning |
| Class | daily-activity |
| Definition | Bimanual fine-motor fastening in which one hand stabilises the garment edge while the other pinches a button through its buttonhole. |
| Body segments | Both hands (thumb-index pinch dominant), wrists, forearms; eyes or tactile guidance. |
| Joint actions | Thumb-index-tip pinch; in-hand rotation of the button; index feed through hole; contralateral hand stabilises fabric between finger and thumb (approximate). |
| Phase structure | Align plackets → grasp button (pinch) → feed through buttonhole → release → smoothing → repeat per button. |
| Temporal profile | Roughly one button per second in fluent adult performance (approximate); slower when unseen or on small fasteners. |
| Kinetic profile | Very low forces; demand lies in bimanual coordination and haptic feedback rather than strength. |
| Context | Dressing (shirts, coats); seated or standing; also dolls' clothes, craft work. |
| Variation | Dominant-hand role swaps by preference; bottom-up versus top-down sequence choice; visual versus tactile control; speed varies with practice and fastener size. |
| Safety note | Descriptive only; difficulty with fastening has many causes and is not interpretable from this entry. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 8, 14); NCBI Bookshelf (hand function entries). |

### A06-08 · Lying-to-standing

| Field | Value |
| --- | --- |
| Name | Lying-to-standing |
| Class | posture-transition |
| Definition | Multi-stage rise from horizontal lying to standing, typically roll to side, push to sitting, bring legs to the floor, then sit-to-stand — or, from the floor, via hands-and-knees and half-kneel. |
| Body segments | Whole body; arms carry trunk load; hips and knees raise the COM in the final stage. |
| Joint actions | Trunk rotation for the roll; shoulder and elbow extension to push; hip/knee extension in the final rise; neck flexion to organise the roll (approximate). |
| Phase structure | Roll to side → push to sitting → legs to support surface → sit-to-stand (A06-01) or kneel-stand route → stabilisation. |
| Temporal profile | ~3-8 s depending on route and support (approximate). |
| Kinetic profile | Arms lift the trunk against gravity in early stages; final stage repeats sit-to-stand mechanics; support surfaces (bed edge, furniture) modify arm loading. |
| Context | Beds, sofas, floors, mats; morning rising, floor play, exercise recovery. |
| Variation | Route choice varies with surface height, body proportions, and habit; support use increases with age as a population trend, with wide individual spread; floor rises via kneel-stand are common across ages. |
| Safety note | Descriptive only; not a mobility assessment, and difficulty rising has many causes not inferable from this entry. |
| Sources | OpenStax *Anatomy and Physiology 2e* (chs. 10-11); NCBI Bookshelf. |

## 7. Relationships

| Related file | Relation | Rationale |
| --- | --- | --- |
| [04-human-anatomy-and-physiology.md](04-human-anatomy-and-physiology.md) | grounds-in | Hand anatomy, thumb opposition, and motor control ground every grasp, gesture, and transition documented here. |
| [05-human-biomechanics-and-locomotion.md](05-human-biomechanics-and-locomotion.md) | explains-mechanism-of | COM-BOS mechanics, lever action, and impulse principles explain how the actions here are produced and scaled. |
| [07-human-dance-sports-and-performance.md](07-human-dance-sports-and-performance.md) | specialises | Sport and dance techniques specialise the everyday action primitives documented here (grasp of implements, squats, reaches). |
| [08-human-falls-impact-balance-and-recovery.md](08-human-falls-impact-balance-and-recovery.md) | applies-to | The action ontology applies directly to fall-response entries, which reuse the same 12-field format and class system. |
| [16-physics-motion-forces-and-energy.md](16-physics-motion-forces-and-energy.md) | contrasts-with | Physics treats bodies as force-driven masses; actions here add intention, phase structure, and culturally shaped meaning. |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | constrains | The schema defines the Class vocabulary (§3.1) and the 12-field entry format this ontology implements. |
| [02-source-provenance-and-licensing.md](02-source-provenance-and-licensing.md) | evidenced-by | Registered sources and licenses for all claims are listed there; motion-dataset licenses are recorded there. |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | constrains | The coverage map fixes this file's domain boundaries and sibling filenames. |

## 8. References

- OpenStax, *Anatomy and Physiology 2e*. Publisher: Rice University; openstax.org; license: CC BY 4.0; accessed 2026-11-24.
- NCBI Bookshelf (StatPearls hand anatomy, hand function, and motor control entries). ncbi.nlm.nih.gov/books; accessed 2026-11-24.
- Uberon Multi-species Anatomy Ontology. obofoundry.org; license: CC BY 3.0; accessed 2026-11-24.
- HumanML3D (text-annotated human motion including everyday and gestural categories). https://github.com/EricGuoICT/HumanML3D; data not redistributable; component licenses apply; accessed 2026-11-24.
- Motion-X dataset. https://motion-x-dataset.github.io/; license: CC BY-NC-SA (non-commercial; not usable in commercial BEAN products without separate authorization); accessed 2026-11-24.
- AMASS (Archive of Motion Capture as Surface Shapes). https://amass.is.tue.mpg.de/; license: non-commercial research; accessed 2026-11-24.
