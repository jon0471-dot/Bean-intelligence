/**
 * BEAN Intelligence — client compute: QUALITY-AWARE ROUTING POLICY (M38 §B5).
 *
 * "Do not always choose the smallest local model just to claim low-spec
 * compatibility." This module implements the routing policy that decides, for
 * a given task and device, whether a local lane is honestly adequate:
 *
 *  - a weak local model must NOT silently replace a stronger model when the
 *    result quality would materially suffer — the decision becomes
 *    `prefer-backend`/`require-backend` when an already-authorized backend is
 *    available, or `local-with-limitation` (limitation STATED, never hidden)
 *    when it is not;
 *  - there is no hidden paid fallback: `authorizedBackendAvailable` may only
 *    be true for a route the user/operator has actually authorized (the
 *    caller owns that guarantee; this module never enables billing);
 *  - local-only mode never routes to a backend, and without a verified local
 *    model it is an honest `no-route`.
 *
 * Pure and synchronous; client-safe (no Node-only imports). The scheduler and
 * device capability manager remain the executors — this is the policy layer.
 */
import type { ClientComputeTier } from './types'

/** Qualitative task load for quality routing (NOT the scheduler's resource class). */
export type TaskComplexity = 'light' | 'standard' | 'demanding'

/** Honest quality band of a model/lane, from measured evaluations where they exist. */
export type ModelQualityClass = 'minimal' | 'balanced' | 'high'

export type QualityRouteDecision =
  /** Local lane verified and adequate — run locally without caveats. */
  | 'local-approved'
  /** Local lane runs, but its quality limit is stated to the user. */
  | 'local-with-limitation'
  /** Local lane exists, but an already-authorized backend route is preferred for quality. */
  | 'prefer-backend'
  /** No verified local lane — the authorized backend route is required. */
  | 'require-backend'
  /** Neither a verified local lane nor an authorized backend is available. */
  | 'no-route'

export interface QualityRouteInput {
  deviceTier: ClientComputeTier
  /** Device profile conservative mode (low memory, mobile hint, fallback adapter...). */
  conservative: boolean
  taskComplexity: TaskComplexity
  /** A registered, verified model/runtime exists on this device for the task. */
  localModelVerified: boolean
  /** Quality band of the local model that would serve the task. */
  localModelQualityClass: ModelQualityClass
  /** True ONLY when an authorized backend route exists (never a hidden paid fallback). */
  authorizedBackendAvailable: boolean
  /** Local-only privacy mode — backends are forbidden regardless of availability. */
  localOnlyMode: boolean
}

export interface QualityRouteResult {
  decision: QualityRouteDecision
  /** Honest limitation text when the decision carries a quality/availability caveat. */
  limitation: string | null
  /** Ordered human-readable reasons (for receipts/diagnostics). */
  reasons: string[]
}

const MINIMAL_MODEL_CAPABILITY: Record<TaskComplexity, boolean> = {
  light: true,
  standard: false,
  demanding: false,
}

const BALANCED_MODEL_CAPABILITY: Record<TaskComplexity, boolean> = {
  light: true,
  standard: true,
  demanding: false,
}

const HIGH_MODEL_CAPABILITY: Record<TaskComplexity, boolean> = {
  light: true,
  standard: true,
  demanding: true,
}

function qualityAdequate(quality: ModelQualityClass, complexity: TaskComplexity): boolean {
  if (quality === 'minimal') return MINIMAL_MODEL_CAPABILITY[complexity]
  if (quality === 'balanced') return BALANCED_MODEL_CAPABILITY[complexity]
  return HIGH_MODEL_CAPABILITY[complexity]
}

/**
 * Resolve the quality route for a task/device combination. Pure — no IO, no
 * scheduling, no consent side effects. The caller must pass real evidence:
 * `localModelVerified` only when the model registry gate actually passed on
 * this device, and `authorizedBackendAvailable` only for genuinely authorized
 * routes.
 */
export function resolveQualityRoute(input: QualityRouteInput): QualityRouteResult {
  const reasons: string[] = []
  const { deviceTier, conservative, taskComplexity, localModelVerified, localModelQualityClass, authorizedBackendAvailable, localOnlyMode } = input

  // Privacy first: local-only mode never touches backends.
  if (localOnlyMode) {
    if (!localModelVerified) {
      reasons.push('local-only mode forbids backend execution')
      reasons.push('no verified local model/runtime for this task on this device')
      return {
        decision: 'no-route',
        limitation: 'Local-only mode is on, but no verified local model can run this task on this device. The task cannot execute under the current privacy settings.',
        reasons,
      }
    }
    if (qualityAdequate(localModelQualityClass, taskComplexity)) {
      reasons.push(`local ${localModelQualityClass}-class model verified for a ${taskComplexity} task`)
      reasons.push('local-only mode: backend routes are excluded by policy')
      const lowDevice = deviceTier <= 2 || conservative
      if (lowDevice && taskComplexity !== 'light') {
        return {
          decision: 'local-with-limitation',
          limitation: `The task will run on this device's local model in ${localModelQualityClass}-class quality; a ${taskComplexity} task on a ${conservative ? 'conservative low-resource' : 'lower-tier'} device may complete slower and with reduced quality. No remote route is used in local-only mode.`,
          reasons,
        }
      }
      return { decision: 'local-approved', limitation: null, reasons }
    }
    reasons.push(`local ${localModelQualityClass}-class model would materially reduce quality for a ${taskComplexity} task`)
    reasons.push('local-only mode: backend routes are excluded by policy')
    return {
      decision: 'local-with-limitation',
      limitation: `The local model available on this device is ${localModelQualityClass}-class, which materially limits quality for ${taskComplexity} work. Local-only mode is on, so no stronger remote route is used — the result will be produced with this limitation rather than silently substituted.`,
      reasons,
    }
  }

  // No verified local model: backend required (if authorized) or nothing.
  if (!localModelVerified) {
    reasons.push('no verified local model/runtime for this task on this device')
    if (!authorizedBackendAvailable) {
      reasons.push('no authorized backend route available')
      return {
        decision: 'no-route',
        limitation: 'This task cannot be executed: no verified local model on this device and no authorized backend route. Nothing will be silently substituted.',
        reasons,
      }
    }
    reasons.push('authorized backend route available')
    return { decision: 'require-backend', limitation: null, reasons }
  }

  // Verified local model: is it adequate for the requested quality?
  const adequate = qualityAdequate(localModelQualityClass, taskComplexity)
  if (adequate) {
    reasons.push(`local ${localModelQualityClass}-class model verified for a ${taskComplexity} task`)
    const lowDevice = deviceTier <= 2 || conservative
    if (lowDevice && taskComplexity !== 'light') {
      return {
        decision: 'local-with-limitation',
        limitation: `The task will run on this device in ${localModelQualityClass}-class quality; on this ${conservative ? 'conservative low-resource' : 'lower-tier'} device a ${taskComplexity} task may be slower and the quality ceiling is the local model's. An authorized stronger route exists but local execution was selected within policy.`,
        reasons,
      }
    }
    return { decision: 'local-approved', limitation: null, reasons }
  }

  // Weak local model for this complexity — never a silent downgrade.
  reasons.push(`local ${localModelQualityClass}-class model would materially reduce quality for a ${taskComplexity} task`)
  if (authorizedBackendAvailable) {
    reasons.push('authorized backend route available — preferred over a silent local downgrade')
    return {
      decision: 'prefer-backend',
      limitation: `This task needs higher quality than this device's local ${localModelQualityClass}-class model can deliver; it will use the authorized stronger route instead of silently degrading the result.`,
      reasons,
    }
  }
  return {
    decision: 'local-with-limitation',
    limitation: `This device's local model is ${localModelQualityClass}-class, which materially limits quality for ${taskComplexity} work, and no authorized stronger route is available. The result will be produced locally with this limitation stated — not silently degraded.`,
    reasons,
  }
}
