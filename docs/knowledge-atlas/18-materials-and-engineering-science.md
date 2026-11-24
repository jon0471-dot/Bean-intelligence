Atlas ID: ATLAS-18 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# 18. Materials and Engineering Science

Engineering turns physical law and material behaviour into artefacts that carry load, move, conduct, compute and act. This guide records the material classes, mechanical properties, failure modes and selection logic that connect chemistry and physics to designed structures and machines, and it supplies the structural, electronic and robotics vocabulary used elsewhere in the atlas.

## 1. Scope and role in the atlas

The guide covers material classes and their structure-property links, mechanical properties and testing concepts, failure modes, material selection logic, the engineering disciplines, structural engineering basics, electronics basics and robotics fundamentals. It consumes physics (16) and chemistry (17) directly and applies their vocabulary to biomechanics (05): the body is, mechanically, a structure of levers and tension elements subject to the same load types and failure physics.

## 2. Material classes and structure-property links

Metals: atoms bond metallically, sharing electrons in a sea; the non-directional bonding lets atomic layers slip without breaking the material, so metals are ductile, tough, electrically and thermally conductive, and can be strengthened by blocking slip (alloying, work hardening). Ceramics: ionic or covalent, often crystalline; strong bonds but no slip mechanism, so ceramics are hard, stiff, heat-resistant and compressively strong, but brittle in tension. Polymers: long covalent chains held together by covalent backbone bonds and weak intermolecular forces; light and versatile, but low stiffness and temperature capability, with time-dependent viscoelastic behaviour. Composites: combine classes to blend properties — stiff strong fibres (glass, carbon) embedded in a polymer matrix give high stiffness-to-weight in chosen directions; concrete reinforced with steel bars combines compressive and tensile strength. Semiconductors: silicon and similar elements whose conductivity sits between metals and insulators and can be controlled precisely by doping and structure — the class underlying all modern electronics.

In each class the causal chain runs the same way: bonding and microstructure determine response to force, heat and electricity. That chain is the chemistry-to-engineering bridge.

## 3. Mechanical properties

Stress is force per area, sigma = F/A; strain is fractional deformation, epsilon = ΔL/L. In the elastic region, deformation reverses when load is removed, and stress is proportional to strain with the constant of proportionality Young's modulus E = sigma/epsilon — a stiffness measure intrinsic to the material. Beyond the yield point, deformation becomes plastic (permanent).

Four distinct property words are often confused. Strength is the stress a material can carry before yielding or breaking. Toughness is the energy absorbed before fracture — the area under the whole stress-strain curve; a tough material deforms a long way before failing. Hardness is resistance to local surface indentation. Ductility is the amount of plastic deformation (stretching) before fracture. Steel is strong and ductile; glass is strong in compression but brittle and weak in tension; rubber is compliant but absorbs large amounts of energy.

Under repeated loading, fatigue causes failure at stresses far below static strength: tiny defects grow a little each cycle until a crack reaches critical size. Under sustained load at elevated temperature, creep causes slow, continuing deformation. Both mechanisms are time-dependent and are why inspected service life, not just rated strength, governs real designs.

## 4. Failure modes: brittle versus ductile fracture

Ductile materials fail by gross plastic deformation: they yield, neck, and absorb large energy before separating — forgiving, because they warn before they fail. Brittle materials fail suddenly by crack propagation: a stress raiser (a scratch, void or inclusion) concentrates stress at its tip, and the crack advances through the material with little overall deformation.

Griffith's insight, stated qualitatively: cracks concentrate stress at their tips, and a crack grows when the energy released by advancing balances the energy cost of creating new fracture surfaces; therefore larger pre-existing flaws lower the effective strength of a brittle body, which is why measured ceramic strength depends on defect population rather than on ideal bond strength. The practical consequences run through the whole engineering domain: pressure vessels get inspected for cracks, glass gets toughened to trap favourable surface stresses, and ductile steel is specified where sudden failure would be catastrophic.

## 5. Material selection logic

Selecting a material is negotiating a property space, because no material maximises everything: stiffness trades against density and cost; strength trades against ductility and ease of shaping; temperature capability trades against price. Design requirements translate into target property combinations — stiffness per unit weight for a light frame, toughness for an impact-prone part, thermal insulation for a handle — and candidate materials are compared on those combinations.

Ashby charts, as a concept, are the standard tool: log-log plots of one material property against another (for example stiffness against density) on which each material class occupies a characteristic field, making trade-offs visible at a glance and letting selection lines pick families that meet a performance index. This guide records the method and its logic without asserting any specific material data points; values belong to verified handbooks, not to this atlas.

## 6. Engineering disciplines overview

Civil and structural engineering optimises the safety, stability and serviceability of fixed infrastructure — buildings, bridges, dams — under gravity, wind, water and ground loads. Mechanical engineering optimises machines and energy systems: engines, drivetrains, thermal and fluid systems — motion, force and heat flow. Electrical and electronic engineering optimises the generation, transmission and processing of electrical energy and information, from power grids to microprocessors. Chemical engineering optimises the large-scale, safe transformation of matter: reactors, separations, process control. Software engineering optimises behaviour encoded as information: correctness, maintainability and predictable operation of programs, with no physical material at all — its "physics" is computation and logic. The disciplines differ in what they optimise, but they share the engineering core: requirements, constraints, safety factors, testing and iteration.

## 7. Structural engineering basics

Loads are classified as dead (permanent self-weight), live (occupancy, contents) and environmental or dynamic (wind, earthquake, moving vehicles). Members experience five load actions: tension (stretching), compression (shortening), bending (curvature with tension on one face and compression on the other), shear (layers sliding parallel) and torsion (twisting).

A truss resolves applied loads into purely axial forces — tension or compression in slender members pinned at joints — because triangles are rigid shapes; the geometry converts bending, which slender members resist poorly, into axial forces, which they resist efficiently. Safety factors divide the expected maximum load into the material's usable capacity, providing margins for uncertainty in loads, materials and construction. The I-shape of a beam is a direct consequence of bending mechanics: in bending, stress grows with distance from the neutral axis, so the flanges — placed far from that axis — carry most bending stress efficiently, while the connecting web carries shear; material is placed exactly where the demand is highest. The same logic appears in the skeleton: bone mass concentrates along the lines of greatest stress, which biomechanics (05) treats as an application of these structural principles.

## 8. Electronics basics

Passive components: resistors limit current and divide voltage (Ohm's law V = I·R governs them), capacitors store charge and block steady current while passing changing signals, inductors store energy in magnetic fields and oppose current change. Diodes conduct one way, rectifying alternating current and protecting against reversed polarity. Transistors — the active devices of modern electronics — act as switches and amplifiers: a small control signal gates a larger current. Combinations of transistors implement logic gates (AND, OR, NOT and from them all digital functions), and integrated circuits etch millions to billions of such gates onto semiconductor chips.

A printed circuit board (PCB) is the packaged implementation: an insulating substrate with etched copper conductors routing signals between soldered components, layered for power, ground and signal planes. Everything here is the applied branch of the electromagnetism recorded in the physics guide (16, section 10).

## 9. Robotics fundamentals

A robot is an engineered mover: it senses, decides and acts. Actuators convert energy into motion — electric motors (rotary, often geared), servos (motors with built-in position feedback), and hydraulic or pneumatic cylinders for high force. Sensors measure the robot and its environment: encoders report joint angles, inertial measurement units report acceleration and rotation, force and torque sensors report contact loads, and cameras and rangefinders report geometry.

Kinematic chains describe robot geometry in the same terms biomechanics (05) uses for the body: links (rigid segments) connected by joints (revolute or prismatic) form open or closed chains, and each independent joint contributes one degree of freedom; a robot arm's total degrees of freedom determine the poses its end effector can reach. Motion control then applies the physics guide's mechanics — torque at each joint against inertia and gravity — executed as computed control loops running on processors built from the electronics above. The vocabulary overlap is deliberate: joints, degrees of freedom, stance and gait mean the same thing in a walking robot and in a walking human.

## 10. Relationships

Relations use the controlled vocabulary registered in [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md), read as "this guide <relation> the sibling guide".

| Sibling guide | Relation | How the domains connect |
| --- | --- | --- |
| [16-physics-motion-forces-and-energy.md](16-physics-motion-forces-and-energy.md) | grounds-in | Stress, strain, bending and circuit behaviour are direct applications of mechanics and electromagnetism. |
| [17-chemistry-atoms-molecules-and-reactions.md](17-chemistry-atoms-molecules-and-reactions.md) | grounds-in | Material classes and their properties derive from bonding chemistry and microstructure. |
| [05-human-biomechanics-and-locomotion.md](05-human-biomechanics-and-locomotion.md) | applies-to | Load types, joints, degrees of freedom and failure physics apply directly to bones, muscles and gait. |
| [16-physics-motion-forces-and-energy.md](16-physics-motion-forces-and-energy.md) | evidenced-by | Measured moduli, strengths and fatigue limits are the experimental evidence base for the physics of solids. |
| [21-astronomy-and-space.md](21-astronomy-and-space.md) | applies-to | Lightweight structures, thermal control and onboard electronics apply engineering constraints to spacecraft. |

## 11. References

Registered sources per [02-source-provenance-and-licensing.md](02-source-provenance-and-licensing.md); all accessed 2026-11-24.

- OpenStax, College Physics (Rice University, openstax.org, accessed 2026-11-24) — elasticity, stress and strain, fluid and thermal behaviour of materials, circuits and semiconductor devices.
- OpenStax, Chemistry 2e (Rice University, openstax.org, accessed 2026-11-24) — bonding types, metallic, ionic and covalent solids, polymers and semiconductor band behaviour.
- NASA (nasa.gov, public domain, accessed 2026-11-24) — aerospace structures, composites, electronics and robotics engineering background.
