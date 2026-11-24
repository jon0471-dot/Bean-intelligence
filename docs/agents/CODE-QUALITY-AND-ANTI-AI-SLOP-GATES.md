# CODE GIFTZ — Code Quality and Anti-AI-Slop Gates

These gates are pass/fail checks applied to every deliverable before it may be reported as done. A gate failure blocks delivery until it is fixed — or until it is honestly declared as unmet, with the reason, in the delivery note. Part A defines the engineering gates. Part B rejects the recognisable slop patterns of generated work; each gate states what to reject and what to do instead. Part C defines the honesty gates, which outrank everything else in this document.

## 1. How the gates are run

Run the gates on your own output before reporting completion. A gate is not a style preference; it is a condition of done. The procedure: walk Part A against the code, walk Part B against the rendered result, and check every sentence of the delivery note against Part C. If a gate cannot be satisfied in the delivery environment, name it in the delivery note — silently failing a gate is a Part C violation.

## 2. Part A — quality gates

- GATE A1 — Type safety. Types are declared for props, function signatures and data shapes. Runtime values crossing a boundary (user input, network responses, storage) are validated against those types. Any escape from the type system is deliberate, local and justified.
- GATE A2 — Validation and error handling. Every form validates input and shows what is wrong. Every async path handles failure: network errors, non-2xx responses, timeouts, empty results. Errors produce a usable message in the interface, never a silent catch or a blank screen.
- GATE A3 — No dead code. Unused components, unreachable branches, commented-out blocks, leftover imports and duplicated logic are removed before delivery. If code exists only "in case it is needed later", it does not ship.
- GATE A4 — Real builds pass. The actual build command for the project is run, and its result is recorded truthfully. A build that was never run is never reported as passing.
- GATE A5 — Applicable tests pass. Where the project has a test setup, the tests run, new behaviour is covered, and failures are fixed — not skipped or weakened to pass.
- GATE A6 — "Compiles" is NOT "works". This gate overrides all others in Part A. Compilation, clean types and passing lint are necessary, never sufficient. A feature is only claimed as working when its behaviour has been exercised end to end (see the honesty rule in the engineering standard).

## 3. Part B — anti-slop gates

Each gate names the pattern to reject and the professional substitute. The test is applied to the rendered result, not to intentions.

- GATE B1 — Random purple/blue gradients everywhere. Reject gradients as a default aesthetic slapped onto sections, buttons and text. Use colour from the project's own palette; a gradient exists only where the product's brand actually calls for one.
- GATE B2 — Unnecessary glowing cards. Reject glow, blur and shadow applied to containers for emphasis theatre. Establish emphasis with hierarchy — spacing, type scale, colour — and reserve shadow for real elevation on interactive surfaces.
- GATE B3 — Repeated rounded cards for every section. Reject the same card treatment wrapped around every block of content. Differentiate sections with layout, rules, whitespace and structure; card-wrap only content that genuinely belongs in a container.
- GATE B4 — Oversized hero headings without purpose. Reject enormous headlines that exist to look designed. Size the heading to the content's actual importance; a heading earns scale when the page has one clear message, not as a reflex.
- GATE B5 — Random icons and emoji decoration. Reject icon spam and emoji in headings, buttons and body copy. Use icons only where they aid recognition, from one consistent set, sized consistently, with accessible labels where meaning is not obvious.
- GATE B6 — Generic dashboards with meaningless metrics. Reject fake KPI cards with invented numbers and filler charts assembled to look analytical. A dashboard exists only when the product actually produces the data it displays.
- GATE B7 — Fake charts and fake testimonials. Reject fabricated charts and invented customer quotes. Show real data, or data explicitly labelled as sample, or omit the section entirely.
- GATE B8 — Placeholder text and invented company claims. Reject lorem ipsum and invented credentials ("trusted by 10,000+ teams") presented as fact. Copy describes the actual product; sample content, if used, is clearly labelled as sample.
- GATE B9 — Buttons and forms that do nothing. Reject visible controls without behaviour. Every control works, or is clearly disabled with the disabled state and a reason (see GATE C3).
- GATE B10 — Excessive glassmorphism. Reject translucent blur panels layered everywhere. Glass is an accent: at most one layer deep, contrast verified through it, and never applied to body text surfaces.
- GATE B11 — Repeated identical layouts across unrelated projects. Reject template recycling. Layout and identity are derived from the product's content and purpose (the identity directions in the UI/UX standard exist for this).
- GATE B12 — Decorative animations without product purpose. Reject motion that exists to look sophisticated. Every animation serves a purpose category from the animation standard, or it is removed.
- GATE B13 — Unnecessary scroll effects and floating objects. Reject parallax, floating shapes and scroll capture that impede reading. A scroll effect must serve comprehension or progress; otherwise it is removed.
- GATE B14 — Generic templates unless explicitly requested. Reject the boilerplate landing page (hero, features, pricing, FAQ, testimonials, CTA) as a reflex. Build the structure the product actually needs; use a template only when the user asks for one.

## 4. Part C — honesty gates

- GATE C1 — Never invent backend functionality to make a design look complete. If there is no backend, the interface says data is local or demo, or the feature is scoped out honestly. Simulated persistence is never reported as saved; a mock endpoint is never described as a working API.
- GATE C2 — Never fabricate metrics, testimonials or data. Charts show real data or data explicitly labelled as sample. Numbers presented as evidence trace to something real. Inventing a number, a user, a company or a quote to fill space is a delivery-blocking violation, not a style issue.
- GATE C3 — Mark non-functional demo controls clearly as disabled. A control that is part of a demo but has no behaviour behind it carries visible disabled styling, the real disabled attribute or equivalent, and where helpful a short hint. A demo control that looks live is a lie to the user, however small.

## 5. Gate discipline in practice

Before any completion report: fix what the gates catch, and name what cannot be fixed. Gates are cumulative with the delivery checklist — the gates decide whether the work may be called professional, and the checklist decides whether the deliverable is ready to ship. A deliverable that passes Part A but fails a Part B or C gate is not professional work, no matter how clean the code is.

---

## Related standards

- [Professional Engineering Standard](./PROFESSIONAL-ENGINEERING-STANDARD.md) — the workflow and the honesty rule the gates enforce.
- [Professional UI/UX Design Standard](./PROFESSIONAL-UI-UX-DESIGN-STANDARD.md) — the positive practices behind every anti-slop gate in Part B.
- [Animation and Interaction Standard](./ANIMATION-AND-INTERACTION-STANDARD.md) — the purpose categories GATE B12 and GATE B13 measure against.
- [Web and App Delivery Checklist](./WEB-AND-APP-DELIVERY-CHECKLIST.md) — the section-by-section final pass that runs after the gates.
