Atlas ID: ATLAS-28 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# Agent Planning, Tools, Verification and Recovery

This file records the atlas vocabulary for AI agent fundamentals: the model-in-a-loop architecture, bounded tool use, planning, grounding and verification, failure recovery, memory, multi-agent coordination, safety, and evaluation. It maps each pattern to BEAN Intelligence's real implementation where one exists; operators should treat this file as the conceptual standard and the repo paths as its concrete instance.

## 1. Scope and Method

An agent is a language model wrapped in an execution loop: the model proposes actions (tool calls), the runtime executes them, results return to the model, and the cycle repeats until a goal is met or a bound is hit. Everything in this file follows from that loop's failure modes — unbounded cost, unverified claims, silent fallback, and runaway side effects. The architectural foundation (transformer attention) is cited to Vaswani et al. (References); tool-use and reasoning-loop patterns are cited to the tool-use and reasoning-plus-acting literature where certain, otherwise to upstream repositories.

## 2. Agent Fundamentals and Bounded Tool Loops

The LLM-in-a-loop architecture (model + tools + runtime) is powerful precisely because it is a loop, and dangerous for the same reason. Iteration caps therefore exist as a design requirement, not a tuning detail: without a bound, a confused model can retry a failing call forever, amplify a small error into a large one, or burn cost without progress. A bounded loop forces a decision — complete, or stop and report honestly. BEAN's orchestrator (src/lib/riishe/toolloop.ts) implements the bounded loop with per-turn iteration limits, and its retry policy (src/lib/riishe/retry.ts) is bounded as well: limits are part of the contract, so exhaustion is a reportable outcome rather than a crash.

## 3. Planning Approaches

Two planning styles are recognised, and both are legitimate with different trade-offs:

- Plan-then-execute: produce an explicit plan, then execute it. Good for transparency and review (a plan can be inspected before side effects), brittle when the world disagrees with the plan unless replanning is supported.
- Interleaved reactive: act, observe, decide next step from observations. Adapts to reality, but risks drifting from the goal without a stated plan to check against.

Task decomposition (splitting a goal into verifiable steps) and capability planning (choosing lanes based on real availability, not assumed capability — per file 27 §lifecycle) are shared requirements across both styles. BEAN's orchestrator interleaves: it classifies intent, plans capability, delegates to specialists through the durable queue, and keeps a workflow state that makes the plan inspectable mid-flight (src/lib/riishe/workflow.ts, src/lib/riishe/capability-plan.ts).

## 4. Tool Use

Tools are the agent's effectors, and their contracts are the safety surface:

- Tool contracts: every tool declares a name, description, parameter schema, and permission tier; the model can only call what the registry exposes (BEAN: src/lib/riishe/tools/registry.ts).
- Permission tiers: standard tools (read-only, reversible) run under normal policy; explicit-tier tools (side-effecting, destructive, or external-facing) require user approval before execution.
- Parameter validation: schemas are enforced before execution — the runtime validates types, ranges, and required fields, so a malformed call fails at the gate rather than corrupting state.
- Timeout enforcement: every tool call carries a timeout; a hung tool cannot hang the loop.

The contract principle generalises: an agent is trustworthy exactly to the extent that its tools validate inputs, declare permissions, and refuse undefined behaviour.

## 5. Grounding and Verification

Grounding ties claims to evidence. The atlas recognises four mechanisms, all implemented in BEAN's verify paths (src/lib/verify) and intel grounding pipeline:

- Evidence packs: captured sources (retrieved documents, tool outputs) are attached to the response so claims can be checked against what was actually read.
- Citation verification: cited sources are checked to exist and to support the claim; unsupported citations are removed or flagged rather than shown as authoritative.
- Claim auditing: statements are classified — evidenced, inference, or unverifiable — and the classification is visible to the user rather than asserted in prose.
- Output validation gates: responses pass structural and policy checks before delivery (grounding checks, injection guards, expression checks), so validation is a stage, not a hope.

The standard these implement is simple: a claim without evidence is labelled as such. Files that claim grounding must be able to show the check, and the repo's claim-grounding and clean-citations test suites assert exactly that.

## 6. Failure Recovery

Recovery is designed in classes, with honesty as the governing constraint:

- Retry with backoff: transient failures retry with backoff classes — immediate for cheap idempotent calls, exponential for load-dependent failures, and quota-aware backoff that honours upstream retry signals (BEAN: src/lib/riishe/retry.ts, src/lib/ai-engine/queue.ts).
- Breaker patterns: after repeated failures, stop calling the failing dependency for a period rather than hammering it; breakers convert cascades into visible degradation.
- Fallback ladders: when a lane fails, a lower-preference lane may serve — but explicit fallback only. A silent substitution (serving a different model or lane without reporting it) violates the atlas's honesty rules; the user must be able to see what served them.
- Partial-completion reporting: "completed with limitations" is a first-class outcome. A task that finished with degraded scope, fewer capabilities, or unverified output is reported as such — never presented as full success, and not buried as an error either.

## 7. Memory Architectures

Agent memory splits into short-term context (the conversation window — bounded, transient) and durable memory (persists beyond the session). The privacy-preserving pattern BEAN implements: durable memory is written only on an explicit user command (src/lib/riishe/memory-actions.ts), never by silent inference from conversation content, and recall is recent-first-bounded — the most recently created memories within a hard per-turn bound, with the selection policy published as a machine-readable label ('recent-first-bounded', src/lib/riishe/memory.ts).

The honesty rule is the important part: no semantic ranking is claimed where recency is the real policy. A memory feature that says "relevant memories" while selecting by recency is misdescribing itself; BEAN's selection description states that relevance ranking does not exist. Memory features in this atlas are judged on whether their stated policy matches their implemented policy.

## 8. Multi-Agent Coordination

Specialists (LAXII image, JAZMII video, GANGZII audio/TTS/ASR, CODE GIFTZ coding) coordinate with the orchestrator through three mechanisms:

- Specialist delegation through existing queues: work is handed to the durable job queue (src/lib/ai-engine/queue.ts, src/lib/jobs) rather than to ad-hoc channels, so tasks survive restarts, carry state, and are auditable.
- Duplicate suppression: idempotency and dedupe checks (src/lib/riishe/dedupe.ts) prevent retries and double-submissions from executing the same work twice — the classic coordination failure under retries.
- Receipt-based handoffs: a delegated task carries a trust receipt recording its state, inputs, and outcome; the receiver verifies the receipt rather than trusting an assertion, so handoffs are evidence-backed.

The pattern generalises: coordination is safe when the channel is durable, the work is idempotent, and the handoff carries evidence.

## 9. Safety

Agent safety reduces blast radius with layered controls:

- Approval gates for sensitive operations: BEAN's Trust Engine implements two-key approvals — sensitive tasks require a second, distinct authorisation before execution (src/lib/trust/approvals.ts); one actor cannot push sensitive work through alone.
- Sandboxing: untrusted execution runs in a restricted sandbox — OS-level resource limits (`rlimit`: address space, CPU seconds, process/file limits) plus a fresh network namespace — rather than behind application-level promises (src/lib/sandbox/runner.ts).
- Blast-radius reduction: cap resources, scope file operations to declared paths, dry-run plans before execution, and prefer reversible operations.
- Audit trails: Trust receipts are execution evidence — a tamper-evident record of what ran, with what inputs, producing what output (src/lib/trust/receipt.ts). Claims about agent behaviour are checked against receipts, not against intent.

## 10. Evaluation

Agent evaluation follows two rules: acceptance tests over mock trust, and honest environmental limitation reporting. Acceptance tests assert real behaviour — actual tool-loop behaviour, actual receipts, actual recovery from induced failures — over mocks that simulate success; a test suite that passes by faking the trust layer proves nothing. When an environment genuinely lacks a capability (a lane unavailable, a provider rate-limited), evaluation records the limitation honestly instead of fabricating a pass. BEAN's eval harness (evals/riishe, evals/code-giftz) stores per-suite results and consolidated reports, so every claim of agent quality traces to a stored run. An agent system that cannot show its evidence is treated, by atlas rules, as unverified.

## 11. Relationships

| Sibling | Relation | Rationale |
| --- | --- | --- |
| [27-ai-models-inference-and-multimodal-intelligence.md](27-ai-models-inference-and-multimodal-intelligence.md) | grounds-in | Agents execute on the inference lanes, capability gates and lifecycle documented there |
| [29-professional-code-generation-and-product-engineering.md](29-professional-code-generation-and-product-engineering.md) | specialises | CODE GIFTZ specialises the agent patterns here for code generation with plan-hash verification |
| [24-technology-engineering-and-computing.md](24-technology-engineering-and-computing.md) | applies-to | Sandboxing, timeouts and isolation apply this file's OS and security fundamentals |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | grounds-in | Evidence-labelled claims follow the schema's honesty rules |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | evidenced-by | The coverage map records this domain's scope and review status |

## 12. References

- Vaswani et al., "Attention Is All You Need", arXiv:1706.03762 — https://arxiv.org/abs/1706.03762
- Schick et al., "Toolformer: Language Models Can Teach Themselves to Use Tools", arXiv:2302.04761 — https://arxiv.org/abs/2302.04761
- Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models", arXiv:2210.03629 — https://arxiv.org/abs/2210.03629
