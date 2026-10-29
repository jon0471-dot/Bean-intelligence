/**
 * BEAN Intelligence — adapter contract (provider seam).
 *
 * Every upstream inference integration implements this interface. The router
 * speaks ONLY these normalized types; provider payloads never leak past
 * this boundary into customer responses.
 */

export interface HealthReport {
  healthy: boolean
  checkedAt: string
  latencyMs: number | null
  detail: string
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
  /** JPEG bytes (gateway returns JPEG). */
  bytes: Buffer
  width: number
  height: number
  format: 'jpeg'
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
