/**
 * BEAN Intelligence — client compute: quality-route integration (M39 §A).
 *
 * Wires M38's pure routing policy (`resolveQualityRoute`) into the
 * scheduler's automatic target selection. This module is the ONLY place
 * where scheduler facts are translated into `QualityRouteInput`:
 *
 *  - the policy is consulted ONLY for MODEL-backed tasks (a kind/descriptor
 *    with `feasibility.requiredModelId`). Deterministic compute lanes
 *    (kernels, ffmpeg-style tools) have no model choice, so quality routing
 *    does not apply to them — their quality is fixed by code, not by which
 *    model was selected;
 *  - `authorizedBackendAvailable` mirrors the scheduler's own backend gate
 *    exactly (privacy class + fallback policy + a registered delegate). It
 *    is NEVER true for a route the product has not already authorized;
 *  - `localModelVerified` mirrors the scheduler's model gate (registry
 *    entry + runtime available + verified install) — it is the same
 *    evidence the per-target gates use, so the policy layer can never
 *    approve a lane the executor would refuse;
 *  - complexity comes from the task (descriptor → kind → 'standard');
 *    adapters may declare an honest complexity for their workloads.
 *
 * Client-safe: no Node-only imports. Pure — no IO, no scheduling effects.
 */
import type { DeviceProfile } from './types'
import {
  resolveQualityRoute,
  type ModelQualityClass,
  type QualityRouteDecision,
  type QualityRouteInput,
  type QualityRouteResult,
  type TaskComplexity,
} from './quality-routing'

export type { TaskComplexity }

/** Default complexity when neither descriptor nor kind declares one. */
export const DEFAULT_TASK_COMPLEXITY: TaskComplexity = 'standard'

export interface SchedulerQualityEvidence {
  profile: DeviceProfile
  complexity: TaskComplexity
  /** The scheduler's model gate passed on this device (entry + runtime + install). */
  localModelVerified: boolean
  /** Quality band of the registered local model that would serve the task. */
  localModelQualityClass: ModelQualityClass
  /** The scheduler's backend gate passed (privacy + fallback policy + registered delegate). */
  authorizedBackendAvailable: boolean
  /** Local-only privacy mode (task class OR global consent mode). */
  localOnlyMode: boolean
}

/**
 * Resolve the quality route for a MODEL-backed scheduler task. Pure over the
 * passed evidence; returns `null` when the evidence is insufficient to
 * consult the policy (callers keep their existing gate behavior).
 */
export function resolveSchedulerQualityRoute(evidence: SchedulerQualityEvidence): QualityRouteResult {
  const input: QualityRouteInput = {
    deviceTier: evidence.profile.tier as QualityRouteInput['deviceTier'],
    conservative: evidence.profile.conservative,
    taskComplexity: evidence.complexity,
    localModelVerified: evidence.localModelVerified,
    localModelQualityClass: evidence.localModelQualityClass,
    authorizedBackendAvailable: evidence.authorizedBackendAvailable,
    localOnlyMode: evidence.localOnlyMode,
  }
  return resolveQualityRoute(input)
}

/** Does this decision put the backend FIRST in the execution order (while
 *  keeping verified local lanes as honest fallback after a real backend
 *  failure)? Only `prefer-backend` reorders; `require-backend` does not
 *  need to — the model gate already refuses client targets. */
export function backendFirstDecision(decision: QualityRouteDecision): boolean {
  return decision === 'prefer-backend'
}

/** Stable backend-first partition of the built execution plan. Relative
 *  order is preserved inside each group; when the decision is NOT
 *  backend-first the plan is returned untouched. */
export function applyQualityRouteToPlan<T extends { target: string }>(
  plan: T[],
  decision: QualityRouteDecision,
): T[] {
  if (!backendFirstDecision(decision)) return plan
  return [...plan.filter((step) => step.target === 'backend'), ...plan.filter((step) => step.target !== 'backend')]
}
