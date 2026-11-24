Atlas ID: ATLAS-29 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# Professional Code Generation and Product Engineering

This file is the atlas's professional engineering-discipline reference for AI-assisted code generation and product delivery. It aligns with docs/agents/PROFESSIONAL-ENGINEERING-STANDARD.md and docs/agents/WEB-AND-APP-DELIVERY-CHECKLIST.md, and its safety model is CODE GIFTZ's, as implemented in BEAN Intelligence. Design-practice requirements (hierarchy, states, motion, accessibility) are specialised from [26-professional-software-ui-ux-and-motion-design.md](26-professional-software-ui-ux-and-motion-design.md); engineering fundamentals are grounded in [24-technology-engineering-and-computing.md](24-technology-engineering-and-computing.md).

## 1. Scope and Method

Generated code is judged by the same standard as human code: it must work in the real product, preserve what exists, and be honest about what it did. This file records the workflow that produces that standard, the quality gates that enforce it, and the safety model that makes an autonomous coder trustworthy. "Compiles" is the minimum bar, never the finish line: a successful build proves the absence of syntax and type errors, not the presence of correct behaviour.

## 2. The Professional Workflow

Delivery runs in ten steps:

1. Understand the request and its users: what outcome is wanted, for whom, under what constraints.
2. Inspect the existing project: framework, versions, dependencies, conventions, existing components, integrations, and data — before writing anything.
3. Write a requirements specification: scope, behaviours, edge cases, and what is explicitly out of scope.
4. Define the information architecture: navigation, page structure, and content model (file 26 §information architecture).
5. Set the visual direction: hierarchy, typography, spacing, colour tokens — from file 26's practice sections, not improvisation.
6. Plan data, API, security and state: schemas, endpoints, validation, auth boundaries, and client state before implementation touches code.
7. Implement within the existing architecture: follow the project's established patterns; additions fit, they do not fork the project.
8. Test interactions and responsive behaviour: every flow exercised, every state (loading, empty, error, success) verified, multiple widths checked.
9. Verify in a real browser preview: run the app and look at it; preview is evidence, not formality — the repo's preview-audit path (src/lib/code/preview-audit.ts) exists because this step fails silently otherwise.
10. Deliver with an honest completion report: what works, what was verified, what remains limited.

Steps 1–6 are planning, 7–9 are execution with evidence, 10 is honesty. Skipping the planning steps is how generated code arrives plausible and wrong.

## 3. Preservation Discipline

The first duty in an existing project is to preserve it. Never blind-overwrite: existing files are read before they are modified, and regeneration replaces a file only when the new version preserves its required behaviour. Concretely, preservation covers:

- Framework conventions: the project's router, styling system, and directory structure win over generic best practice.
- Existing components: reuse what exists; do not duplicate a component that is already there and working.
- Integrations: existing API contracts, environment variables, and third-party integrations keep working; new code adapts to them.
- Data: existing user data, schemas, and migrations are never destroyed by a delivery; destructive changes are migrations, planned and reversible.

BEAN enforces this in code: preservation checks for image-generation assets (src/lib/laxii/preservation.ts as the pattern), version history for every mutation, and file operations that are planned, reference-checked, and approved before execution (src/lib/code/file-ops). The general rule: a delivery that improves feature A while silently breaking feature B is a failed delivery.

## 4. Quality Gates

Delivery passes gates, not vibes:

- Type safety: the project's type checks pass with no new suppressions.
- Validation and error handling: every input path validates and every failure path responds — errors are surfaced, not swallowed.
- Responsive layouts: verified at multiple widths, not assumed from a single screenshot.
- Accessibility checks: semantic structure, labels, focus order, contrast (WCAG AA thresholds as established in file 26) — checked, not intended.
- Real builds and tests: the project's build command and test suite run for real; a delivery claims build success only from a build log and test success only from a test run.

The last gate is the honesty gate. "Compiles" is not "works": between build success and working behaviour lies everything dynamic — wiring, data flow, state transitions — and the workflow's step 9 (real browser preview) exists to close exactly that gap.

## 5. Anti-AI-Slop Gates

Generated products fail in recognisable ways, and the gates name them explicitly (docs/agents/CODE-QUALITY-AND-ANTI-AI-SLOP-GATES.md is the enforcing standard):

- No fake content: no fabricated charts with invented data, no testimonials from people who do not exist, no buttons that do nothing.
- No invented backend functionality: do not call endpoints that were never built, do not fabricate data where a backend should supply it, do not claim integrations that do not exist.
- Every visible control works or is clearly disabled: the file 26 §interaction states rule, enforced at code review — a decorative control is a defect, not a stub.

The common root is pretending: output that looks complete while depending on things that were never built. The gate's test question is "does each element do what it appears to do when used?" — and the answer must be backed by execution, not by intention.

## 6. Animation Quality Bar

Animation in delivered code follows file 26 §motion design as a hard bar, not a style preference: purpose-driven motion only (state feedback, spatial continuity, hierarchy reveal, progress communication), transform/opacity-only implementation for compositor efficiency, `prefers-reduced-motion` respected, jank avoided (no layout-property animation, no layout thrashing, `will-change` only with diagnosed need), and never blocking essential interactions. The library-level standards live in docs/agents/ANIMATION-AND-INTERACTION-STANDARD.md; BEAN implements with framer-motion and GSAP (upstreams in References). Decorative animation without product purpose is rejected at the same gate as fake content — it is the slop pattern that survives longest because it looks like polish.

## 7. Delivery Honesty

Delivery claims are evidence-backed:

- Real execution evidence over claims: screenshots from the running app, build logs, test output — attached to the delivery, not summarised from memory.
- Limitations reported: what was not built, not verified, or only partially working is stated in the completion report as a limitation, not hidden in silence.
- No fabricated test results: tests that did not run are not reported as passing; a skipped or failing test is reported as what it is.

This mirrors the atlas-wide honesty rules and BEAN's agent-honesty rules (file 28 §recovery and §evaluation): "completed with limitations" is a first-class outcome. A delivery report is trustworthy exactly when a reviewer could re-run it — which is why evidence artifacts accompany the claim.

## 8. The CODE GIFTZ Safety Model as Reference Pattern

CODE GIFTZ (BEAN's coding specialist) operationalises this file as a safety model:

- Plan-hash checks: the reviewed execution plan is hashed; execution proceeds only if the hash still matches (src/lib/giftz/execution-intent.ts), so what runs is what was approved.
- Version history with rollback: every mutation is versioned (src/lib/code/versioning.ts) and restorable via rollback endpoints (src/app/api/code-giftz/projects/[id]/versions/[seq]/rollback), so mistakes are reversible by design.
- Sandbox isolation: generated code executes in a restricted sandbox — OS `rlimit` caps (address space, CPU seconds, file size, process count) plus a fresh network namespace (src/lib/sandbox/runner.ts) — never with unrestricted host access.
- Approval-gated file operations: destructive or out-of-scope file operations are planned, reference-checked, and require explicit approval before execution (src/lib/code/file-ops).
- No auto-publish to external repositories: deliveries stay inside the project workspace; pushing to external systems is never an automatic side effect.

The pattern generalises beyond coding: hash-bind the approved intent, version every mutation, isolate execution, gate side effects on approval, and keep external surfaces out of automatic reach. Trust receipts (file 28 §safety) record the evidence.

## 9. Relationships

| Sibling | Relation | Rationale |
| --- | --- | --- |
| [26-professional-software-ui-ux-and-motion-design.md](26-professional-software-ui-ux-and-motion-design.md) | applies-to | Delivered code must satisfy that file's states, accessibility and motion bars |
| [28-agent-planning-tools-verification-and-recovery.md](28-agent-planning-tools-verification-and-recovery.md) | grounds-in | CODE GIFTZ is a concrete instance of the bounded-loop, approval and receipt patterns |
| [24-technology-engineering-and-computing.md](24-technology-engineering-and-computing.md) | applies-to | Build, test and CI practice applies that file's software-engineering lifecycle |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | grounds-in | Evidence-backed delivery claims follow the schema's honesty rules |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | evidenced-by | The coverage map records this domain's scope and review status |

## 10. References

- W3C Web Accessibility Initiative, WCAG Overview — https://www.w3.org/WAI/standards-guidelines/wcag/
- Next.js official documentation (framework conventions) — https://nextjs.org/docs
- MDN Web Docs, Web Security — https://developer.mozilla.org/en-US/docs/Web/Security
- Motion (framer-motion upstream repository) — https://github.com/motiondivision/motion
- GSAP repository — https://github.com/greensock/GSAP
- GSAP site — https://gsap.com
