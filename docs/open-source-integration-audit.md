# BEAN Intelligence — Open-Source Integration Audit (RIISHE upgrade)

**Scope:** the five projects named in the work order (Part C), evaluated for compatibility
with RIISHE's existing gateway/orchestrator architecture. Audited 2026-11-01; license facts
were read directly from each repository's LICENSE file (GitHub API + raw license text), not
from memory.

**Governing decision: adopt patterns, not code.** RIISHE already implements the relevant
mechanisms natively (SSE orchestration protocol carrying evidence metadata, a bounded tool
loop over an explicit registry, research pipeline with citation auditing). Where a project
offers a component RIISHE genuinely lacks, the recommendation names the *specific* component
and its integration cost. No code was copied in this upgrade; nothing below is a claim about
code we vendored — we vendored nothing.

---

## 1. vercel/ai (Vercel AI SDK) — Apache-2.0 ✅ compatible

- **License:** Apache License 2.0 (LICENSE: "Copyright 2023 Vercel, Inc."). Permissive;
  compatible with proprietary use; NOTICE obligations only apply if we redistribute code.
- **Maintenance / compatibility:** very active; TypeScript-first; React 19 / Next 16 aligned
  (our stack). It is the de-facto standard `useChat`/streaming layer.
- **Useful components:** `useChat` + `StreamData` for transport; tool-calling helpers
  (`generateTool`/zod schemas).
- **Security:** no server-execution surface by itself; tools execute in OUR code. Low risk.
- **Integration cost:** **high for transport, low for value.** RIISHE's SSE protocol is
  *richer* than a generic text stream — it carries `{stage, research:{queries}, tool:{name,
  status}, reset, done+meta}` events that drive the honesty UI (states, verification notes,
  real source cards). Migrating to `useChat` would require either abandoning that metadata
  or forking the protocol — a regression, not an upgrade.
- **Decision:** no dependency added. The existing runtime already follows the same
  ExternalStoreRuntime pattern assistant-ui documents (see below). Re-evaluate the AI SDK's
  *tool schema helpers* if RIISHE ever gains a second consumer (e.g. a mobile client).

## 2. assistant-ui/assistant-ui — MIT ✅ compatible

- **License:** MIT (verified via GitHub API SPDX).
- **Maintenance:** active, React 19 compatible, shadcn/Radix-native (our UI primitives).
- **Useful components:** `ExternalStoreRuntime` (bring-your-own state — exactly the
  architecture `use-riishe-chat.ts` implements: transport + conversation state in one
  runtime, presentational primitives elsewhere), thread primitives, a11y wiring.
- **Security:** client-side rendering library; no privileged operations. Low risk.
- **Integration cost:** moderate — it would replace the presentational layer
  (`riishe-messages.tsx`/composer) but our components are already purpose-built for the
  black/gold identity, evidence cards and verification notes; assistant-ui's stock thread
  would need heavy theming to preserve the BEAN identity.
- **Decision:** adopt the *pattern* (already done — the runtime hook is our
  ExternalStoreRuntime equivalent); do not adopt the library this cycle. No duplicate
  features gained for the cost of a UI rewrite.

## 3. LibreChat-AI/LibreChat — MIT ✅ compatible (as reference)

- **License:** MIT (LICENSE: "Copyright (c) 2026 LibreChat").
- **Maintenance:** very active; Node/Express + Mongo stack — **different** from our
  Next.js/Prisma/SQLite stack.
- **Useful components:** its UX model for per-conversation actions (hover delete, rename,
  search, date grouping), multi-provider registry, agent/tool permission UI.
- **Security:** it is a *whole application*; copying it would import MongoDB, a second
  auth system and a second gateway — directly violating the "no second gateway" constraint.
- **Integration cost:** prohibitive as a dependency; cheap as a UX/design reference.
- **Decision:** reference only. The sidebar/agent-UX requirements in the work order were
  implemented natively; no code or dependency taken.

## 4. open-webui/open-webui — custom "Open WebUI License" ⚠️ NOT usable for our purpose

- **License:** NOT open-source in the OSI sense. The LICENSE is a BSD-3-derived text with a
  material branding clause: licensees are "strictly prohibited from altering, removing,
  obscuring, or replacing any 'Open WebUI' branding … in any deployment or distribution"
  outside narrow exceptions (small deployments; a paid/enterprise route). It also reserves
  the "Open WebUI" trademark. This is a source-available license, **not** MIT/Apache.
- **Implication for BEAN:** embedding or deriving UI from Open WebUI would (a) ship its
  branding obligations into a product whose identity is BEAN's, and (b) conflict with the
  work order's "Do not change BEAN Intelligence branding / RIISHE's identity".
- **Maintenance:** active (Python/Svelte stack — also not our stack).
- **Decision:** **do not integrate.** Incompatible license for our use case + duplicate
  features + different stack. This is the one project of the five with a hard blocker, and
  the branding clause — not merely the stack — is the reason.

## 5. langchain-ai/langgraph — MIT ✅ compatible (pattern reference)

- **License:** MIT (verified via GitHub API SPDX).
- **Maintenance:** active; Python-first (JS port `@langchain/langgraph` exists).
- **Useful components:** the graph/state-machine model for multi-step agent workflows:
  explicit nodes, bounded iterations, checkpointed state, human-in-the-loop interrupts.
- **Security:** a runtime for OUR graph definitions; no privileged surface of its own.
- **Integration cost:** adding `@langchain/langgraph` would introduce the LangChain
  dependency family alongside our own orchestrator — two orchestration engines for one
  product (violates "avoid duplicate features"). RIISHE's orchestrator already implements
  the substance of the pattern: Understand → Retrieve → bounded tool loop (≤3 rounds,
  ≤5 calls/round) → Solve → Verify → repair pass, with per-stage events and honest states.
- **Decision:** pattern adopted conceptually (bounded loop + approval gates + typed
  failures); no dependency added.

---

## Summary matrix

| Project | License | Verdict | Dependency added? | What we took |
|---|---|---|---|---|
| vercel/ai | Apache-2.0 | Compatible, redundant here | No | Streaming-protocol patterns (already native) |
| assistant-ui | MIT | Compatible, redundant here | No | ExternalStoreRuntime pattern (already native) |
| LibreChat | MIT | Reference-only (different stack) | No | Per-conversation UX model (implemented natively) |
| open-webui | Custom, branding-restricted | **Blocked** | No | Nothing |
| langgraph | MIT | Compatible, redundant here | No | Bounded tool-graph pattern (already native) |

## Security posture notes (applicable to all)

- No new runtime dependencies were introduced by this upgrade (verified in
  `package.json` — the file pipeline uses the pre-existing `jszip`, `pdf-parse`, `sharp`).
- Tool execution remains: fixed registry, zod input validation, per-tool timeouts, output
  caps, sanitized errors, permission keys (`allowCodeExecution`) narrowed per turn by the
  capability planner; no model-generated text ever executes as shell; no secrets in prompt
  or tool scope.
- If any of these libraries is adopted later, re-audit at that time: pin exact versions,
  review their transitive deps, and keep the vendored surface minimal.
