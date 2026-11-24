Atlas ID: ATLAS-25 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# Architecture, Art, Music and Visual Design

This file records the atlas vocabulary for built architecture, visual art, music fundamentals, and visual/graphic design. It documents recognised traditions, formal elements, and principles as general categories; it records no invented building, artwork, or composition details, and does not claim exhaustive coverage of any tradition.

## 1. Scope and Method

The creative disciplines share a method: formal elements (the components), compositional principles (how components are organised), and traditions (recognised historical categories). This file separates those three layers deliberately. Tradition names are used as recognised categories with regional and chronological limits — they classify, they do not rank — and any specific claim about a named structure, artwork, or piece requires a verifiable source, which this general file does not supply. Physics grounding for structure and sound is provided by Atlas files 18 and 16 (see the coverage map).

## 2. Architecture: Structural Logic

Buildings are organised material against gravity and environment. Loads divide into dead loads (the building's own weight), live loads (occupants, furniture), and environmental loads (wind, snow, seismic). The structural task is to gather loads and carry them safely to the ground: walls and columns carry compression, beams and slabs span and bend, braces and shear systems resist lateral force, and foundations transfer everything to soil. Material choice drives the structural vocabulary — masonry works in compression and builds thick walls and arches; timber spans modest distances with light frames; steel carries tension and allows long spans and slender frames; concrete, reinforced with steel, combines mass and mouldability. The mechanics behind these behaviours (stress, strain, material properties) are grounded in Atlas file 18; this file records the architectural consequences.

## 3. Architecture: Spatial Concepts

Beyond standing up, architecture organises space:

- Scale and human proportion: dimensions relate to the body and to activity; "human scale" is the conventional anchor, and deliberately overscaled space is itself a design tool.
- Proportion systems: ratio-based ordering (including classical proportional conventions) appears across traditions as a design convention, not a law.
- Light: natural light is treated as material — orientation, openings, and shading determine both use and mood of space.
- Circulation: the paths people take (entries, corridors, vertical circulation) define how a plan is read and used; thresholds (doorways, transitions) separate zones of access.

These spatial concepts are the vocabulary in which plans are described, compared, and evaluated across traditions.

## 4. Architectural Traditions Overview

Recognised traditions are recorded as categories with limits:

- Classical: the column-and-entablature system with the orders (Doric, Ionic, Corinthian as the standard set), proportional rules, and symmetry; the tradition that much later Western architecture references or reacts against.
- Gothic: pointed arches, ribbed vaults, and flying buttresses as the recognised structural-vocabulary features that opened walls to large windows.
- Vernacular: local, climate-responsive building with regional materials and inherited craft patterns — the broadest category globally, and the one least documented in general sources, so the atlas asserts no specifics beyond the category.
- Modern movements: the conventionally grouped nineteenth- and twentieth-century movements that foregrounded function, materials, and industrial production (with named subdivisions left to sourced files).

Tradition names carry no quality ranking. Hybrid and regional continuities are the historical norm, so clean single-tradition labels describe ideal types.

## 5. Visual Art: Formal Elements

The formal elements are the components of visual work:

- Line: the trace of a point — contour, direction, and gesture.
- Shape and form: two-dimensional areas and three-dimensional masses, geometric or organic.
- Color: hue, value (lightness), and saturation; colour behaviour (contrast, temperature, afterimage) is perceptual, not just physical.
- Texture: surface quality, actual or implied.
- Composition: the arrangement of all elements — balance, emphasis, rhythm, and unity describe how attention is guided.
- Perspective: conventional systems for representing depth, most prominently linear perspective (geometric projection from a viewpoint) and atmospheric cues such as value and detail loss with distance.

Perspective systems are conventions of representation, not truths about vision: they describe one inherited way of projecting three dimensions onto two, and many traditions use alternative or mixed conventions.

## 6. Art Movements Overview

Recognised movement categories are used as class labels: Renaissance (the conventionally framed revival and systematisation of classical representation, including perspective and anatomy study), Impressionism (the conventionally grouped nineteenth-century movement emphasising light, colour, and visible brushwork over finish), Expressionist and abstract categories (work foregrounding emotional force, or departing from representational depiction respectively), and modern/contemporary as umbrella period labels. Two rules apply: movements are bounded by region and period — applying a movement label outside its scope is an error the atlas avoids — and movement membership is a matter of art-historical consensus, not a mechanical style test. No invented artworks, artists, or dates are recorded in this file; specifics belong to sourced documents.

## 7. Music Fundamentals

Music is described through interacting parameters:

- Rhythm: the organisation of time — beat, tempo, and metre.
- Melody: a sequence of pitches perceived as a line — contour, range, and phrase structure.
- Harmony: simultaneous pitches and their relations; the basic unit is the interval (distance between pitches), and tertian chords (built from stacked thirds) are the common-practice Western building blocks, with tension and resolution providing directional motion.
- Dynamics: degrees of loudness.
- Timbre: tone quality — what distinguishes instruments and voices at the same pitch.

Pitch organisation uses scales (ordered pitch collections) and keys (a tonal centre drawn from a scale); intervals are named numerically (thirds, fifths) and qualify as consonant or dissonant by convention and perception. Form describes large-scale organisation: verse-chorus form (alternating refrain and development sections) and sonata form (exposition, development, recapitulation as the conventional description) are recorded as recognised categories, conceptually. The acoustics underneath these terms — frequency, harmonics, resonance, room behaviour — are grounded in Atlas file 16 and in open physics texts (References).

## 8. Acoustics Link

Sound production and perception connect music and architecture: instruments produce sound through vibrating systems whose harmonics shape timbre; rooms shape it further through reflection, absorption, and reverberation. Room acoustics is where architecture and audio engineering meet — concert halls, studios, and listening spaces are designed around controlling reflections and decay — and the physical basis is recorded in Atlas file 16 (see the coverage map). This file claims only the cross-domain vocabulary; measurements and standards belong to sourced engineering documents.

## 9. Visual and Graphic Design

Design organises elements to communicate:

- Grid systems: column-and-gutter frameworks that align content and create rhythm; CSS Grid is the web implementation and is documented by MDN (References).
- Typography: anatomy terms (baseline, x-height, ascender, descender, leading/line-height, kerning, tracking) and the broad classification of typefaces (serif, sans-serif, monospace, display) carry most design discussion; text-setting basics are documented by MDN.
- Color theory: the colour wheel, harmony schemes (complementary, analogous, triadic as the conventional set), and contrast. Contrast has an accessibility dimension with established W3C thresholds — WCAG 2.x requires 4.5:1 for normal text and 3:1 for large text (AA) — which carry into UI practice in [26-professional-software-ui-ux-and-motion-design.md](26-professional-software-ui-ux-and-motion-design.md).
- Hierarchy: size, weight, colour, and position establish reading order before content is read.
- Gestalt principles: proximity, similarity, and closure describe how perception groups elements — the standard conceptual vocabulary for explaining why layout "reads".
- Negative space: the empty areas that define grouping and emphasis; density is a design decision, not a default.

Design principles in this file are the general ground; product-interface specifics (spacing scales, tokens, interaction states) are specialised in file 26.

## 10. Relationships

| Sibling | Relation | Rationale |
| --- | --- | --- |
| [26-professional-software-ui-ux-and-motion-design.md](26-professional-software-ui-ux-and-motion-design.md) | specialises | File 26 applies these visual-design principles to professional product UI and motion |
| [24-technology-engineering-and-computing.md](24-technology-engineering-and-computing.md) | constrains | Display and rendering technology constrain how colour, type and motion reproduce on the web |
| [22-human-history-culture-and-society.md](22-human-history-culture-and-society.md) | grounds-in | Traditions in art and architecture are cultural products grounded in that file's culture framework |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | grounds-in | Category-only claims and no-invented-detail rules follow the schema |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | evidenced-by | The coverage map records this domain's scope and cross-links to Atlas files 16 and 18 |

## 11. References

- OpenStax, College Physics 2e (sound, waves, resonance) — https://openstax.org/details/books/college-physics-2e
- W3C Web Accessibility Initiative, WCAG Overview (contrast thresholds) — https://www.w3.org/WAI/standards-guidelines/wcag/
- MDN Web Docs, CSS Grid Layout — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout
- MDN Web Docs, Fundamental text and font styling — https://developer.mozilla.org/en-US/docs/Learn/CSS/Styling_text/Fundamentals
