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

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatTurn[]
  /** BEAN-enforced caps already applied by the router. */
  maxPromptChars: number
  maxHistoryMessages: number
  timeoutMs: number
  /** Higher reasoning effort for math/complex analysis (gateway thinking mode). */
  thinkingEnabled?: boolean
}

export interface ChatResult {
  content: string
  tokensInEst: number | null
  tokensOutEst: number | null
  durationMs: number
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
  codeTask?(req: CodeTaskRequest): Promise<CodeTaskResult>
}
