/**
 * BEAN Intelligence — adapter contract (provider seam).
 *
 * Every upstream inference integration implements this interface. The router
 * speaks ONLY these normalized types; provider payloads never leak past
 * this boundary into customer responses.
 */

/**
 * MEASURED CHANGE (2026-11-04 connectivity audit): an honest, coarse failure
 * category carried alongside the probe outcome, so the dashboard can show
 * WHY a backend is down (rate-limited vs unreachable vs misconfigured vs a
 * redirect pretending to be health) without parsing free-text details.
 * Null/absent on a healthy report.
 */
export type HealthFailureCategory =
  | 'rate-limited'
  | 'auth'
  | 'billing'
  | 'timeout'
  | 'network'
  | 'unreachable'
  | 'misconfigured'
  | 'redirected'
  | 'not-configured'
  | 'backend-error'

export interface HealthReport {
  healthy: boolean
  checkedAt: string
  latencyMs: number | null
  detail: string
  /** HTTP status the probe observed, when a real HTTP response was received.
   *  null/absent = no HTTP exchange happened (network error, deferral) or the
   *  transport does not expose one (managed SDK). */
  httpStatus?: number | null
  /** Coarse failure class for unhealthy outcomes (null when healthy). */
  failureCategory?: HealthFailureCategory | null
  /** True when this report is served from the short-lived probe cache —
   *  it reflects the last REAL probe (checkedAt is that probe's time),
   *  never a fabricated fresh success. */
  cached?: boolean
}

// ---------------------------------------------------------------------------
// M47.2 — provider-native tool calling (adapter seam).
//
// These types travel ONLY between the RIISHE tool loop and adapters whose
// tool-calling registry record says 'native'. A native tool call is
// UNTRUSTED MODEL INPUT: by the time it reaches an executor it has passed
// the registry allowlist + schema validation + every server-side gate —
// exactly like a text-protocol TOOL_CALL, just over a structured channel.
// ---------------------------------------------------------------------------

/** The BEAN-internal tool schema handed to a provider (JSON Schema). */
export interface NativeToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments object. Validation ALWAYS happens
   *  server-side against the tool's own validator afterwards. */
  parameters: Record<string, unknown>
}

/** One tool call as the provider returned it (pre-validation). */
export interface NativeToolCall {
  /** Provider call identifier (e.g. OpenAI `call_…`). Preserved verbatim so
   *  tool results can be bound back to the exact call. */
  id: string
  name: string
  /** Raw argument encoding ('json-string' on OpenAI-shaped lanes). Parsed
   *  and validated server-side; never trusted structurally. */
  argumentsJson: string
}

export interface ChatTurn {
  /** 'tool' arrives ONLY on native lanes after a real tool execution — it
   *  binds a tool result back to the exact provider call id. Adapters that
   *  do not implement native tool calling will never see it (the loop never
   *  produces tool turns under the text protocol). */
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** Present when role='assistant' and the model emitted native tool calls
   *  in the same pass (the provider requires them replayed on the next
   *  request of the same tool conversation). */
  nativeToolCalls?: NativeToolCall[]
  /** Present when role='tool': the provider call id this result answers. */
  toolCallId?: string
}

/** The JSON that travels to providers which accept extra message shapes. */
export function nativeToolCallToWire(call: NativeToolCall): Record<string, unknown> {
  return {
    id: call.id,
    type: 'function',
    function: { name: call.name, arguments: call.argumentsJson },
  }
}

/**
 * M47.2 — internal tool specs → OpenAI-shaped request tools. MEASURED
 * (2026-11-28 live gateway): the hosted lane REJECTS bare {name,description,
 * parameters} entries with "tools[0].type:type cannot be empty" — the
 * provider wire format requires the {type:'function', function:{…}}
 * envelope. Both adapters convert here, so the internal spec shape stays
 * provider-neutral.
 */
export function nativeToolsToWire(specs: readonly NativeToolSpec[]): Array<Record<string, unknown>> {
  return specs.map((s) => ({
    type: 'function',
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters,
    },
  }))
}

export interface ChatRequest {
  messages: ChatTurn[]
  /** BEAN-enforced caps already applied by the router. */
  maxPromptChars: number
  maxHistoryMessages: number
  timeoutMs: number
  /** Higher reasoning effort for math/complex analysis (gateway thinking mode). */
  thinkingEnabled?: boolean
  /** M47.2: tool specs for lanes whose registry record says native. NEVER
   *  set for streaming requests on lanes where streamingToolCalls is false
   *  (the registry constraint; the loop enforces it before this is reached).
   *  Adapters that do not implement native tool calling ignore this field
   *  entirely — the text protocol keeps working unchanged. */
  nativeTools?: NativeToolSpec[]
}

export interface ChatResult {
  content: string
  tokensInEst: number | null
  tokensOutEst: number | null
  durationMs: number
  /** M47.2: structured tool calls the model emitted (native lanes only).
   *  Empty/absent = the pass ended without tool calls. Callers must treat
   *  these as REQUESTS — execution still runs through the governed tool
   *  registry, never directly. */
  nativeToolCalls?: NativeToolCall[]
}

export interface ImageRequest {
  prompt: string
  size: string
  timeoutMs: number
}

export interface ImageResult {
  /** Encoded image bytes. The managed gateway returns JPEG; the local
   *  Diffusers worker returns PNG. Callers must honor this field, not
   *  assume an extension. */
  bytes: Buffer
  width: number
  height: number
  format: 'jpeg' | 'png'
  durationMs: number
}

export interface CodeTaskRequest {
  messages: ChatTurn[]
  mode: 'generate' | 'explain' | 'review' | 'plan'
  maxPromptChars: number
  timeoutMs: number
}

export interface CodeTaskResult {
  content: string
  tokensInEst: number | null
  tokensOutEst: number | null
  durationMs: number
}

export interface TaskAdapter {
  readonly backendId: string
  /** Real readiness probe — never a constant true. */
  health(): Promise<HealthReport>
  chat?(req: ChatRequest): Promise<ChatResult>
  chatStream?(req: ChatRequest): AsyncGenerator<string, void, unknown>
  generateImage?(req: ImageRequest): Promise<ImageResult>
  /** Real image-to-image editing (image + prompt → edited image). */
  editImage?(req: { prompt: string; imageBase64: string; size?: string; timeoutMs?: number }): Promise<ImageResult>
  codeTask?(req: CodeTaskRequest): Promise<CodeTaskResult>
}
