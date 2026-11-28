# M47 — NATIVE TOOL EXECUTION (the protocol inside the existing architecture)

## One executor, two wire protocols

M47 adds NO second executor and NO agent framework. The M45/M46 bounded tool loop (`src/lib/riishe/toolloop.ts`) gained a protocol dimension:

- **text** (unchanged): `TOOL_CALL: {"tool","input"}` lines parsed server-side; results fed back as a TOOL_RESULTS user turn.
- **native** (new, registry-gated): tools travel in the request (`nativeTools`), the model returns structured calls, results return as `role:'tool'` turns bound to provider call ids.

## Execution flow (real, measured)

```
user message
→ server-derived intent (classifyTurnIntent — from the REAL message, never model fields)
→ capability planner (selectTools; execution_decision only when intent+route authority agree)
→ route permission (explicit-permission keys in ToolContext)
→ provider capability resolution (resolveToolInvocationPolicy — registry-authoritative)
→ tool registry (nativeToolSpecs — explicit or minimal-object schemas)
→ model request with tools (buffered non-streaming pass; measured streaming constraint)
→ provider-native tool_calls (untrusted input)
→ validateNativeCalls (allowlist / malformed-arguments / missing-identity refusal classes)
→ executeToolCall (THE governed executor: validate() → permission recheck → bounded execution → audit)
→ role:'tool' results (every call id answered, refusals included)
→ final conversational response (TOOL_CALL syntax stripped defensively either way)
```

Protected operations additionally cross the M44 Trust Engine and the digest-bound owner approval flow — the native channel does not touch them.

## Refusal classes (pre-execution, honest)

- `tool-not-enabled` — the name is not in this turn's enabled registry set.
- `malformed-arguments` — arguments are not a JSON object (broken JSON, array, number, string, null).
- `missing-call-identity` — unusable id/name; never executed on a guess.

Every refused id still receives an honest `role:'tool'` result (the provider conversation stays well-formed and the model learns WHY); refusals are counted and degraded-noted; nothing is silently dropped and nothing is fabricated.

## Measured live behavior (hosted lane, 2026-11-28)

- Non-streaming pass with tools → genuine call emitted (`finish_reason=tool_calls`).
- Streaming pass with tools → zero usable deltas → the registry's `streamingToolCalls=false` is a hard constraint: the orchestrator's native solve passes are ALWAYS buffered `adapter.chat` calls.
- Tool-result round-trip → accepted; ids bound exactly.
- Wire envelope required (`type:'function'`) — bare specs rejected; `nativeToolsToWire()` converts.

## Adapter coverage honesty

- hosted: native implemented + measured.
- openai-compatible router lane: native wire support implemented, DORMANT — the runtime never sets `nativeTools` for a lane whose registry record is `unknown`; it activates only after operator configuration AND a per-model measurement.
- anthropic: text-protocol; any misrouted native turn is converted defensively to an honestly-labeled user turn (no crash, no invented semantics).
- llamacpp: text-protocol; per-build/per-GGUF variance keeps it unmeasured.
