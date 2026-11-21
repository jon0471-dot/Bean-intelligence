# 01 — February 2027 Product Strategy

Owner-approved · planning date 2026-11-20 · target **public launch February 2027** ·
signature advantage **Trust** · infrastructure budget **₹0/month** ·
repository `jon0471-dot/Bean-intelligence`, branch `main`.

## Mission

Turn BEAN Intelligence into a trust-first AI work platform for everyday users,
students, creators, developers, professionals and businesses. The product must
help users research, understand documents, create work and build software
**while making its actions, evidence, limitations, failures and recovery
behavior understandable**. The objective is not another generic chatbot or a
maximum feature count; it is shipping a reliable public product in February
2027.

## Non-negotiable architecture and product boundaries

Existing products and responsibilities are preserved exactly:

- **RIISHE** — primary conversational AI experience, reasoning, research,
  project context, task orchestration.
- **CODE GIFTZ** — coding and engineering specialist.
- **LAXII** — image and creative processing specialist.
- **JAZMII** — video and media processing specialist.
- **Shared platform** — existing API gateway, model/provider registry,
  authentication, database, queue, persistent jobs and other established
  infrastructure.
- **Trust Engine** — shared cross-platform execution evidence, permissions,
  checkpoints, recovery and truthful task status.

Hard boundaries: no competing re-implementations of existing infrastructure;
no changes to BEAN FX / BEAN Folio / BEAN Education or any other repository;
no Ollama; no mandatory paid AI providers, paid GPU services or paid cloud
infrastructure; no using one visitor's hardware to process another user's
work; no replacing established architecture because a new implementation looks
easier.

## Product priority order

1. Trust Engine foundation.
2. RIISHE unified chat and project memory.
3. Research Agent.
4. Document Intelligence Agent.
5. CODE GIFTZ Engineering Agent integration.
6. Model transparency and zero-budget execution.
7. Reliability, privacy, security and release readiness.

LAXII and JAZMII remain available through their existing product paths; only
their **verified** capabilities are exposed, and no unavailable generation or
processing capability is ever promised.

## February launch scope

**Must be ready:** RIISHE unified chat; real model selection; Project Memory;
Trust Engine receipts; evidence-linked research; Research Agent; Document
Intelligence Agent; CODE GIFTZ Engineering Agent integration; task
checkpoints and recovery; permissions and approvals; provider/local execution
transparency; secure, reproducible deployment.

**Postponed:** public agent marketplace, complex agent swarms, foundation
model training, paid BEAN-operated GPU inference, visitor-to-visitor
distributed compute, unverified autonomous computer control, unvalidated large
integration catalogue.

## The ₹0 constraint

No recurring infrastructure spend. Design rules: local inference where
actually supported; browser inference where actually supported; CPU fallback
where practical; optional **user-configured** providers; transparent provider
and runtime selection; no hidden paid-provider fallback; no automatic
provider substitution that misleads the user; no unsupported privacy or
free-usage claims. If a capability requires a paid service or unavailable
compute, it is marked unavailable or user-configured — costs are never quietly
incurred (enforced today by `src/lib/providers/cost-guard.ts`,
`src/lib/providers/account-quota.ts` and `costUnit: null` honesty in the
backend registry).

## Strategy in one line

Ship the Trust Engine first, wire every agent capability to real evidence and
honest verification, expose only verified capabilities, and keep the platform
operating at ₹0 on existing, measured infrastructure.
