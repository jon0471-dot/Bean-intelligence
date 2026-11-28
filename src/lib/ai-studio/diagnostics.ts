/**
 * BEAN Intelligence — M50.2 BEAN AI STUDIO diagnostic helper (pure).
 *
 * One constructor for structured, customer-safe, deterministic diagnostics.
 * Messages are bounded; node/port/edge context is explicit; no secrets, no
 * provider internals and no raw exception text can pass through.
 *
 * PURE module.
 */

import type { StudioDiagnostic, StudioDiagnosticCode, StudioDiagnosticSeverity } from './types'

/** Maximum diagnostic message length (bounded customer-safe output). */
export const DIAGNOSTIC_MESSAGE_MAX_CHARS = 300

export function diag(
  code: StudioDiagnosticCode,
  message: string,
  context: { nodeId?: string; portId?: string; edgeId?: string; severity?: StudioDiagnosticSeverity } = {},
): StudioDiagnostic {
  const clipped = message.trim()
  return {
    code,
    severity: context.severity ?? 'error',
    message: clipped.length <= DIAGNOSTIC_MESSAGE_MAX_CHARS
      ? clipped
      : `${clipped.slice(0, DIAGNOSTIC_MESSAGE_MAX_CHARS - 1)}…`,
    ...(context.nodeId ? { nodeId: context.nodeId } : {}),
    ...(context.portId ? { portId: context.portId } : {}),
    ...(context.edgeId ? { edgeId: context.edgeId } : {}),
  }
}

/** True when the diagnostics contain at least one hard refusal. */
export function hasErrors(diagnostics: readonly StudioDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}
