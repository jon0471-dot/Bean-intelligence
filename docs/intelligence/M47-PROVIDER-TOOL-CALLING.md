# M47 — PROVIDER TOOL CALLING (capability registry)

## The five evidence states

`native` · `text-protocol` · `unsupported` · `unknown` · `temporarily-unavailable` (`NATIVE_TOOL_CALLING_STATES`, `src/lib/riishe/tool-invocation.ts`).

- `native` — a real probe/response demonstrated native tool calling for the lane's configured model. Exactly one lane holds it: **`bean-llm-hosted-primary`**, measured 2026-11-28.
- `text-protocol` — the lane carries tools through the RIISHE text protocol (the shipped M45/M46 wire).
- `unsupported` — MEASURED to not support native calling (reserved; no lane currently measures to it).
- `unknown` — no measurement exists. Three lanes hold it (`bean-llm-openai-compatible`, `bean-llm-anthropic`, `bean-chat-local-llamacpp`): their wire protocols define native tool use, but no provider is configured in this deployment, so no per-model measurement exists — native is never advertised from an unmeasured state.
- `temporarily-unavailable` — was usable, is not right now (dormant credential, breaker, outage). Runtime condition, re-evaluated per turn.

## The measured hosted-lane record

| Field | Value | Basis |
| --- | --- | --- |
| requestCarriesTools | true | probe accepted `tools` + `tool_choice:'auto'` |
| responseCallShape | `openai-tool_calls` | probe 1 returned a structured `tool_calls` array |
| toolResultShape | `openai-role-tool` | probe 3 accepted the round-trip |
| toolCallIdStyle | `openai-call-id` | ids preserved verbatim (`call_…`) |
| argumentEncoding | `json-string` | `function.arguments` is a JSON string |
| streamingToolCalls | **false (hard)** | probe 4: streaming+tools produced ZERO usable deltas |
| multiCallPerResponse | **null (unmeasured)** | handled safely — the loop executes any bounded count |
| measuredAt / evidence | 2026-11-28 / `scripts/m47-native-tool-probe.ts` | 4 real gateway calls |

## Wire contract discovered live

- Bare `{name,description,parameters}` tool entries are REJECTED: `tools[0].type:type cannot be empty` → `nativeToolsToWire()` emits `{type:'function', function:{name,description,parameters}}` (test-pinned).
- Assistant turns carrying calls are replayed WITH their `tool_calls`; results return as `role:'tool'` + `tool_call_id`.

## Runtime authority + diagnostics

`resolveToolCallingDescriptor(backendId, providerModel?)` is authoritative for runtime selection; per-model overrides are explicit and audited in the note. `resolveToolInvocationPolicy` returns `protocol` + `nativeState` + `streamingToolCalls` so the orchestrator selects the native path and honors the buffered-only constraint. `toolCallingDiagnostics()` projects every lane's evidence state (secret-free, test-pinned) into the admin models overview via `gatewayModelsOverview().toolCalling`.

## Per-model honesty

The hosted lane's checkpoint is provider-managed (identity not disclosed to tenants); the measurement is therefore recorded at lane level with `measuredAt` making checkpoint drift auditable, and the committed probe re-verifies on demand. External lanes are narrowed per model only after a real measurement exists (`MODEL_NATIVE_OVERRIDES`).
