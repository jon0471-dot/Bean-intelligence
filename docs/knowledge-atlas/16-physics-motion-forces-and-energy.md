Atlas ID: ATLAS-16 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# 16. Physics: Motion, Forces and Energy

## 1. Scope and role in the atlas

This guide covers kinematics, Newtonian dynamics, energy and momentum, rotation, gravitation, fluids, thermodynamics, electromagnetism, waves and optics, and acoustics. It supplies the equations and mechanisms that the other physical-domain guides presuppose, with equations in plain-text notation. The movement mechanics of [05-human-biomechanics-and-locomotion.md](05-human-biomechanics-and-locomotion.md) are direct applications of sections 2 to 6; chemistry (17), materials (18), earth (19), ecology (20) and astronomy (21) each re-use specific subsets of what is documented here.

## 2. Kinematics: describing motion

Kinematics describes motion without asking what causes it. Position locates a body relative to a chosen origin; displacement is the straight-line change in position (a vector); distance is total path length (a scalar). Velocity is the rate of change of position; acceleration is the rate of change of velocity. The slope of a position-time graph is velocity; the slope of a velocity-time graph is acceleration.

For motion with constant acceleration, the SUVAT equations apply:

- v = u + a·t
- s = u·t + ½·a·t²
- v² = u² + 2·a·s
- s = ½·(u + v)·t

where s = displacement, u = initial velocity, v = final velocity, a = constant acceleration, t = elapsed time. Each equation omits one variable, so any three knowns determine the motion. Near Earth's surface, and ignoring air resistance, free fall has a constant downward acceleration g ≈ 9.8 m/s²; a dropped object gains about 9.8 m/s of downward speed each second.

## 3. Newton's laws and everyday movement

Newton's first law (inertia): a body keeps its velocity — including rest — unless a net external force acts. Second law: the net force equals mass times acceleration, F_net = m·a; acceleration is proportional to net force and inversely proportional to mass. Third law: forces occur in equal-and-opposite pairs acting on different bodies.

Real movement makes these concrete. A sprinter accelerates forward because the sprinter pushes backward on the ground and the ground, by the third law, pushes forward on the sprinter; the horizontal part of that ground reaction force, limited by friction, is what speeds the runner up. A braking bicycle decelerates because friction between tyres and road supplies a backward net force. A jumper leaves the ground by extending the legs, pushing down and being pushed up. These mechanisms are the working vocabulary of human biomechanics (05): walking, balance and falls are applications of ground reaction force, support geometry and the projectile equations of motion.

## 4. Work, energy and conservation

Work is force acting through displacement along the force: W = F·d·cos(theta). Kinetic energy is KE = ½·m·v²; gravitational potential energy near the surface is PE = m·g·h; elastic potential energy of a spring of stiffness k is ½·k·x². The work-energy theorem states that net work equals the change in kinetic energy. Power is work per time: P = W/t, equivalently P = F·v for a force moving a body at speed v.

Energy is conserved: in a closed system it changes form but the total is constant. A falling ball converts gravitational potential energy to kinetic energy; friction and air resistance convert mechanical energy into thermal energy, which is why mechanical energy alone appears to "run out". This bookkeeping is the same ledger ecology uses for trophic energy flow (20) and biomechanics uses for the metabolic cost of movement (05).

## 5. Momentum and impulse: collisions and falls

Momentum is p = m·v. With no external net force, the total momentum of colliding bodies is conserved. Impulse is force acting over a time interval, J = F·Δt, and equals the change in momentum: J = Δp. The same momentum change can therefore be produced by a large force over a short time or a small force over a long time.

This is the central reasoning tool for impacts and falls. Landing with bent knees extends the stopping time and stopping distance, so the peak force on the body is far smaller than in a stiff-legged landing; a fall onto a padded mat hurts less than a fall onto concrete for the same reason — the padding extends the deceleration interval. Vehicle crumple zones and airbags apply the identical principle. Impact severity also scales with kinetic energy, which grows with the square of speed: doubling impact speed quadruples the energy that must be absorbed.

## 6. Rotation: torque, moment of inertia, angular momentum

Torque measures turning effectiveness: tau = r·F·sin(theta), where r is the distance from the pivot to the point where force F is applied. The rotational analogue of Newton's second law is tau_net = I·alpha, where I is the moment of inertia and alpha the angular acceleration. I depends not only on mass but on how the mass is distributed: mass farther from the rotation axis gives a larger I, making the body harder to spin up or slow down. Angular momentum L = I·omega is conserved when net torque is zero — a spinning figure skater pulls in the arms, I falls, and omega rises to compensate.

Locomotion constantly manages angular momentum: arm swing counter-rotates the torso during walking and running, and balance recovery uses torque from ground reaction forces at the feet. Structural engineering (18) reuses these ideas for beam bending and torsion.

## 7. Gravitation: weight versus mass

Newton's law of gravitation is F = G·m1·m2 / r²: the force between two masses falls with the square of their separation, so doubling the distance quarters the force. Weight is the gravitational force on a body; near Earth's surface, W = m·g. Mass, by contrast, measures inertia — the resistance to acceleration — and does not change with location. On the Moon a person has the same mass but about one sixth the weight. Weightlessness in orbit is not the absence of gravity: an orbiting station and its occupants are in continuous free fall together, so no support force is felt. The same law governs falling bodies here and planetary orbits (21).

## 8. Fluid mechanics: pressure, buoyancy, flow

Pressure is force per area, P = F/A, acting perpendicular to surfaces. In a static fluid, pressure transmits equally in all directions (Pascal's principle): because pressure is shared, a small force on a small piston balances a large force on a large piston — the working principle of hydraulic brakes and lifts. Archimedes' principle: the buoyant force on a submerged body equals the weight of fluid displaced, F_b = rho·g·V_displaced; a body floats when its average density is lower than the fluid's.

For flowing fluids, Bernoulli's principle states that along a streamline the quantity P + ½·rho·v² + rho·g·h remains approximately constant: it is energy conservation per unit volume, trading pressure for speed and height. A common misconception attaches to lift: the "equal transit time" story — air over a wing's curved top must reach the trailing edge at the same time as air below, hence faster, hence lower pressure — is wrong. Lift arises from pressure differences created when a wing turns the airflow downward (a Newtonian action-reaction account); the Bernoulli and Newton descriptions agree once the real flow field is used. Drag and lift scale as D = ½·rho·v²·S·Cd and L = ½·rho·v²·S·CL, where rho is fluid density, v speed, S reference area, and Cd / CL are drag and lift coefficients that depend on shape and flow regime.

The Reynolds number Re = rho·v·L/mu (mu = viscosity) compares inertial to viscous forces. At low Re, viscosity dominates and flow is smooth and reversible — the regime of small organisms in water; at high Re, inertia dominates and turbulence becomes likely. Predicting the onset and structure of turbulence from first principles remains an active research problem (the turbulence closure problem), so engineering practice uses measured coefficients rather than solved equations at high Re.

## 9. Thermodynamics: heat, temperature, entropy

Temperature measures the average kinetic energy of molecular motion; heat is energy in transit because of a temperature difference; internal energy is the total molecular energy of a body. Heat moves by conduction (contact), convection (bulk fluid motion) and radiation (electromagnetic waves, needing no medium). The ideal gas law P·V = n·R·T links pressure, volume, amount (moles) and temperature for a dilute gas.

The first law of thermodynamics, ΔU = Q − W, is energy conservation including heat: internal energy rises with heat added and falls with work done by the system. The second law states that the total entropy of a closed system tends to increase: heat flows spontaneously from hot to cold, and no cyclic engine converts all absorbed heat into work, which caps engine efficiency. Entropy counts, conceptually, how dispersed the energy is over microscopic arrangements — a measure of disorder at the molecular scale. These limits constrain every engine, every weather process (19) and every metabolic energy budget (17, 20).

## 10. Electromagnetism: charge, current, fields

Electric charge is conserved and comes in positive and negative kinds; like charges repel, unlike charges attract. Coulomb's law, F = k·q1·q2 / r² with k ≈ 8.99×10^9 N·m²/C², has the same inverse-square form as gravitation but can repel as well as attract, which is why bulk matter is mostly neutral. An electric field is force per unit charge; field lines run from positive to negative charge. Electric current I is the rate of charge flow; for ohmic conductors, Ohm's law V = I·R relates voltage, current and resistance, and electrical power is P = V·I.

Moving charge produces magnetic fields; a charge moving in a magnetic field feels a force perpendicular to both its velocity and the field (q·v×B) — the principle of electric motors. Faraday's law of induction: a changing magnetic flux through a circuit induces a voltage — the principle of generators and transformers. Electromagnetic waves are coupled oscillating electric and magnetic fields that need no medium and travel in vacuum at c ≈ 3.0×10^8 m/s; light, radio and X-rays are all such waves at different frequencies.

## 11. Waves and optics

A wave is a propagating disturbance that transports energy without transporting matter. Its speed obeys v = f·lambda (speed = frequency × wavelength). Waves may be transverse (displacement perpendicular to travel, as on a string) or longitudinal (along the travel, as in sound). Superposition: overlapping waves add their displacements, giving constructive or destructive interference — the explanation of standing waves, noise cancellation and thin-film colours.

Reflection sends waves back at the mirrored angle; refraction bends waves that change speed crossing into a new medium, described by Snell's law n1·sin(theta1) = n2·sin(theta2), where the refractive index n = c/v. Lenses form images by refraction: converging lenses bring parallel rays to a focal point, diverging lenses spread them; image position follows from the focal length and object distance. Diffraction — waves bending around obstacles — sets the resolution limit of any optical instrument. Wave-particle duality (note): light and matter exhibit both wave behaviour (interference, diffraction) and particle behaviour (photons, discrete electrons); quantum mechanics describes this duality and is established physics, though its interpretations remain debated.

## 12. Acoustics: sound, resonance, Doppler

Sound is a longitudinal pressure wave travelling through a medium — about 343 m/s in air at 20 °C, faster in water and solids because their stiffness is higher. Pitch corresponds to frequency (human hearing spans roughly 20 Hz to 20 kHz, narrowing with age); loudness corresponds to amplitude or intensity. Resonance: every vibrating system has natural frequencies, and driving it at those frequencies amplifies the response — this tunes musical instruments and can make structures vibrate dangerously in wind.

The Doppler effect: when source and observer move relative to each other, the observed frequency shifts — higher while approaching, lower while receding — because successive wavefronts are emitted from advancing or retreating positions. The same mechanism underlies radar speed measurement and the redshift of receding galaxies used in cosmology (21).

## 13. Relationships

Relations use the controlled vocabulary registered in [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md), read as "this guide <relation> the sibling guide".

| Sibling guide | Relation | How the domains connect |
| --- | --- | --- |
| [05-human-biomechanics-and-locomotion.md](05-human-biomechanics-and-locomotion.md) | explains-mechanism-of | Newton's laws, impulse and torque are the physical basis of gait, balance and fall mechanics. |
| [17-chemistry-atoms-molecules-and-reactions.md](17-chemistry-atoms-molecules-and-reactions.md) | contrasts-with | Physics treats matter through bulk quantities and fields; chemistry explains the same matter through atomic structure and bonding. |
| [18-materials-and-engineering-science.md](18-materials-and-engineering-science.md) | constrains | Stress, strain, failure and fluid physics set the limits within which materials and structures are engineered. |
| [19-earth-oceans-weather-and-climate.md](19-earth-oceans-weather-and-climate.md) | explains-mechanism-of | Fluid dynamics, thermodynamics and radiation physics drive winds, ocean circulation and the greenhouse effect. |
| [20-ecology-evolution-and-environment.md](20-ecology-evolution-and-environment.md) | applies-to | Energy conservation and the second law underlie trophic energy flow and ecosystem energy budgets. |
| [21-astronomy-and-space.md](21-astronomy-and-space.md) | grounds-in | Orbital mechanics, gravitation and wave optics are the physics substrate of astronomy. |

## 14. References

Registered sources per [02-source-provenance-and-licensing.md](02-source-provenance-and-licensing.md); all accessed 2026-11-24.

- OpenStax, College Physics (Rice University, openstax.org, accessed 2026-11-24) — kinematics, Newton's laws, energy and momentum, rotation, gravitation, fluid mechanics, thermodynamics, electromagnetism, waves and optics, sound.
- NASA (nasa.gov, public domain, accessed 2026-11-24) — aerodynamics, lift and drag explanations and flight-regime background.
