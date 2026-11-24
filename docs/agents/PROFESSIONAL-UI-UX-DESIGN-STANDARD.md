# CODE GIFTZ — Professional UI/UX Design Standard

This standard defines how CODE GIFTZ designs interfaces. The quality bar: every deliverable should look and behave like an experienced product designer shipped it, not like a template generator filled in. Design decisions are made deliberately, stated once as tokens, and applied everywhere.

## 1. Think like an experienced product designer

Before writing any markup, decide the hierarchy of the screen in one sentence: what the user must see first, act on second, understand after. Every element earns its place; an element with no answer to "what does this do for the user here" is removed. Design decisions are justified by the product's purpose and audience, never by what looks impressive in isolation.

## 2. Visual hierarchy

One primary action per view; secondary actions are visually subordinate. Use size, weight, colour and position together to communicate importance — not size alone. Headings describe the content beneath them; they do not decorate. Avoid uniform sameness: if every block on a page has equal visual weight, the user has no reading path. Give the eye an ordered route from headline to content to action.

## 3. Typography

Use a limited, deliberate type scale. Common-practice practice: a ratio of roughly 1.2-1.333 between scale steps, with body text at 16px (1rem) as the baseline and heading steps rising from it; hero or display sizes may step larger but must stay proportional to the rest of the scale.

- Line-height: body text 1.5-1.6 (1.4 acceptable for dense UI text), headings 1.1-1.25, single-line labels and buttons 1.
- Measure: 45-75 characters per line for reading text, with roughly 60 as the comfortable centre. UI labels and tables may run shorter; reading text never runs much longer.
- Maximum two type families per project. Use weight, size and colour for emphasis instead of adding a third family.
- Body text must pass the contrast requirements in section 5.

## 4. Spacing

Use a 4/8px spacing scale — 4, 8, 12, 16, 24, 32, 48, 64, 96 — and stay on it. Never eyeball arbitrary values like 13px or 27px. Spacing communicates grouping more reliably than borders: related items sit closer than unrelated ones. Common-practice ranges: container gutters 16-24px on mobile and 24-48px on desktop; vertical rhythm between sections 48-96px. Card padding is identical across every card of the same kind; section padding is identical across every section of the same kind.

## 5. Colour systems

Define semantic tokens with roles, then use roles everywhere — never raw ad-hoc hex values scattered through components:

- background, surface, surface-raised;
- text-primary, text-secondary, text-muted;
- border;
- primary (action), primary-hover, primary-active;
- danger, success, warning.

One accent colour carries actions and key highlights; supporting colours stay neutral. Contrast follows WCAG AA: 4.5:1 for normal text, 3:1 for large text (roughly 24px regular weight or 18.66px bold and above) and for meaningful UI component boundaries and icons. Never place light-grey text on a mid-grey background. For dark themes, use elevated surfaces and restrained accents rather than neon on black; verify that every text and icon combination in the actual theme passes contrast, not just the default one.

## 6. Design tokens and consistency

Radius, shadow, spacing, motion duration and colour roles are tokens defined once and referenced everywhere. Consistency compounds: the same card style for the same kind of content, the same button hierarchy on every page, the same page-header pattern on every view. Inconsistency is the most visible signature of generated work; a user should be able to predict what a control looks like before hovering it.

## 7. Layout, grids and negative space

Compose on a grid: 12 columns on desktop with a consistent vertical rhythm (4 or 8-point). Align to the grid, or break it deliberately once for emphasis — not accidentally everywhere. Negative space is a design material: give the primary content room, and let whitespace carry the emphasis that boxes and shadows would otherwise fake. Avoid dead corners, orphaned half-columns and stranded single cards at the end of a grid row unless the asymmetry is intentional.

## 8. Content structure

Meaningful content comes before decoration. Content follows the user's reading order: what is this, what does it do for me, what can I do now. Every section has a distinct job — a page where each section restates the same promise in different words is filler, and filler is cut. Write real headings, real labels and real copy that describes what this specific product actually does.

## 9. Components and interaction states

Every visible control must work, or be clearly presented as disabled — with the real disabled attribute/state and, where useful, a hint about why. Every interactive component defines the full state set: default, hover, focus, active/pressed, disabled, loading, empty, error, success. Focus must always be visible; never remove the focus outline without a replacement of equal or better visibility. Interactive states are built from tokens — a hover state is a defined shift, not an improvised opacity.

## 10. Responsive layout

Desktop, tablet and mobile are first-class cases, in that you verify all three. Navigation adapts to narrow widths with a pattern that actually works at 375px. Grids collapse with intent — you decide which columns matter on mobile rather than letting them wrap chaotically. Touch targets stay comfortable (44px minimum is common practice), text remains readable without zoom, and no width produces horizontal scrolling. A layout that only works at 1440px is not finished.

## 11. Accessibility

Semantic HTML first: real buttons and links, headings in order, inputs with labels (label elements, or aria-label where no visible label is possible), alt text on meaningful images, aria-hidden on decoration. Keyboard: everything mouse-operable is keyboard-operable, focus order follows the visual order, focus is visible. ARIA is the last resort for patterns semantics cannot express — prefer native elements and correct roles over attribute soup. Motion respects prefers-reduced-motion as defined in the animation standard.

## 12. Realistic states

Design and implement the states users actually meet, not only the happy path:

- Loading: skeleton or indicator sized to the real content, so nothing jumps when data arrives.
- Empty: explain what will appear here and what to do next.
- Error: a plain-language message naming what happened and what to try.
- Success: confirm the completed action and offer the next step.
- Disabled: visually and programmatically disabled, never merely grey-styled.

A screen that has only ever been rendered full of data is unfinished.

## 13. Visual identity — every project gets its own

Never make every generated project look identical. The identity follows the product's purpose, audience and content; it is chosen at step 1.6 of the engineering workflow and carried through every token. Concrete directions to choose from — mix and adapt them for the product, do not apply them as fixed templates:

1. Editorial/serif — for publications, content sites and writing platforms: serif or high-contrast display type, restrained palette, generous margins, hairline rules used sparingly, imagery treated with journalistic restraint.
2. Technical/monospace-accent — for developer tools, APIs and infrastructure: mono or grotesque type, tight spacing discipline, code presented first-class, dark-friendly neutral palette, accent reserved for status and syntax rather than decoration.
3. Warm/minimal — for consumer products, lifestyle brands and small businesses: soft neutrals, humanist sans type, rounded but not bubbly radii, ample whitespace, one warm accent, photography of people in real contexts.
4. Bold/brand-forward — for campaigns, portfolios and events: display type with presence, deliberate colour blocking, purposeful asymmetry, motion with narrative moments (see the animation standard).
5. Corporate/calm — for finance, legal and B2B SaaS: disciplined grid, muted palette with a single trust colour, clarity and data tables over flourish, conservative motion, typographic precision.
6. Data-dense/product — for dashboards and operational tools that mean it: compact type scale, dense but strictly aligned tables, clear status colours, minimal chrome, every pixel serving information.

If the request names a brand or style, follow it. If not, choose the direction the purpose implies and state the choice.

---

## Related standards

- [Professional Engineering Standard](./PROFESSIONAL-ENGINEERING-STANDARD.md) — the workflow whose step 1.6 selects the identity and tokens defined here.
- [Animation and Interaction Standard](./ANIMATION-AND-INTERACTION-STANDARD.md) — motion timing and easing referenced by the interaction states above.
- [Code Quality and Anti-AI-Slop Gates](./CODE-QUALITY-AND-ANTI-AI-SLOP-GATES.md) — rejects the slop patterns these standards are designed to prevent.
- [Web and App Delivery Checklist](./WEB-AND-APP-DELIVERY-CHECKLIST.md) — verifies visual, responsive and accessibility lines before delivery.
