/**
 * BEAN Intelligence — client compute: output validation (Phase 1 contract +
 * Phase 11 honesty rule).
 *
 * "Do not show a task as completed unless its output passes validation."
 * Generic validators are registered per task kind; the scheduler refuses to
 * mark a task completed when validation fails (the failure is reported with
 * CLIENT_EXECUTION_FAILED + a validator reason, never silently dropped).
 *
 * Client-safe: no Node-only imports.
 */

export interface ValidationResult {
  valid: boolean
  reason?: string
}

export type OutputValidator = (output: unknown) => ValidationResult

const validators = new Map<string, OutputValidator>()

/** Register (or replace) a validator for a task kind. */
export function registerOutputValidator(kind: string, validator: OutputValidator): void {
  validators.set(kind, validator)
}

export function getOutputValidator(kind: string): OutputValidator | undefined {
  return validators.get(kind)
}

/** Built-in validators for the kinds shipped with this milestone. */
registerOutputValidator('image.preprocess', (output) => {
  const o = output as { width?: unknown; height?: unknown; blob?: unknown; bytes?: unknown } | null
  if (!o || typeof o !== 'object') return { valid: false, reason: 'Preprocess output missing.' }
  if (typeof o.width !== 'number' || o.width <= 0 || typeof o.height !== 'number' || o.height <= 0) {
    return { valid: false, reason: 'Preprocessed image has invalid dimensions.' }
  }
  const hasOutput = o.blob instanceof Blob || (typeof o.bytes === 'number' && o.bytes > 0)
  if (!hasOutput) return { valid: false, reason: 'Preprocessed image has no output bytes.' }
  return { valid: true }
})

registerOutputValidator('image.chroma-cutout', (output) => {
  const o = output as { width?: unknown; height?: unknown; transparentFraction?: unknown } | null
  if (!o || typeof o !== 'object') return { valid: false, reason: 'Cutout output missing.' }
  if (typeof o.width !== 'number' || o.width <= 0 || typeof o.height !== 'number' || o.height <= 0) {
    return { valid: false, reason: 'Cutout has invalid dimensions.' }
  }
  // Mirror the LAXII server coverage gate: a cutout with an implausible
  // transparency fraction is an honest failure, not a completed task.
  const t = o.transparentFraction
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 1) {
    return { valid: false, reason: 'Cutout coverage could not be measured.' }
  }
  if (t < 0.02) return { valid: false, reason: 'Cutout removed almost nothing — the chroma key likely failed.' }
  if (t > 0.98) return { valid: false, reason: 'Cutout removed almost everything — the chroma key likely failed.' }
  return { valid: true }
})

registerOutputValidator('code.analysis', (output) => {
  const o = output as { files?: unknown; issues?: unknown } | null
  if (!o || typeof o !== 'object') return { valid: false, reason: 'Analysis output missing.' }
  if (!Array.isArray(o.files) || !Array.isArray(o.issues)) {
    return { valid: false, reason: 'Analysis output has the wrong shape.' }
  }
  return { valid: true }
})

registerOutputValidator('video.reference-check', (output) => {
  const o = output as { ok?: unknown; width?: unknown; height?: unknown; bytes?: unknown } | null
  if (!o || typeof o !== 'object') return { valid: false, reason: 'Reference-check output missing.' }
  // A completed check with ok:false is a VALID result (the image is the
  // problem, not the check). Only a malformed check shape is invalid.
  if (typeof o.ok !== 'boolean') return { valid: false, reason: 'Reference-check did not report a boolean verdict.' }
  if (typeof o.bytes !== 'number' || o.bytes < 0) return { valid: false, reason: 'Reference-check has no measured byte size.' }
  return { valid: true }
})

registerOutputValidator('video.thumbnail', (output) => {
  const o = output as { blob?: unknown; width?: unknown; height?: unknown } | null
  if (!o || typeof o !== 'object') return { valid: false, reason: 'Thumbnail output missing.' }
  if (!(o.blob instanceof Blob) || (o.blob as Blob).size <= 0) {
    return { valid: false, reason: 'Thumbnail contains no image data.' }
  }
  if (typeof o.width !== 'number' || o.width <= 0 || typeof o.height !== 'number' || o.height <= 0) {
    return { valid: false, reason: 'Thumbnail has invalid dimensions.' }
  }
  return { valid: true }
})

/** Validate an output for a kind. Unknown kinds without a registered
 * validator FAIL honestly (never auto-pass). */
export function validateOutput(kind: string, output: unknown): ValidationResult {
  const validator = validators.get(kind)
  if (!validator) return { valid: false, reason: `No output validator registered for kind "${kind}".` }
  try {
    return validator(output)
  } catch (error) {
    return { valid: false, reason: `Output validator crashed: ${error instanceof Error ? error.message : 'unknown error'}` }
  }
}
