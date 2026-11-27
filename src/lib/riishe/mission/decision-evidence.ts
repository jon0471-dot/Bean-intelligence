/**
 * BEAN Intelligence — M45 Phase 1: the decision evidence seam (SERVER ONLY).
 *
 * One narrow wrapper around the EXISTING guarded research lane
 * (src/lib/research/agent-evidence.ts — the M42/M43 specialist path) that
 * gathers a small, read-only source pack for a conversational decision.
 * It introduces no new research architecture: same gateway, same policies,
 * same provenance. A small override seam exists for tests (the same pattern
 * the action runner uses).
 */

export interface DecisionSource {
  url: string
  title: string
  publishedAt?: string | null
}

let overrideForTests: ((objective: string) => Promise<{ sources: DecisionSource[] } | null>) | null = null
let summaryOverrideForTests: ((objective: string) => Promise<unknown>) | null = null

/** Test seam: swap the research path (never used in production code). */
export function setDecisionResearchForTests(runner: ((objective: string) => Promise<{ sources: DecisionSource[] } | null>) | null): void {
  overrideForTests = runner
}

/**
 * Test seam: inject a full evidence summary directly (for tests that pin a
 * specific evidence classification without depending on the summarizer's
 * extraction heuristics). The injected value MUST be an honest summary —
 * the decision engine still grades it.
 */
export function setDecisionEvidenceSummaryForTests(builder: ((objective: string) => Promise<unknown>) | null): void {
  summaryOverrideForTests = builder
}

/** Resolve the evidence summary for one decision (override → real builder). */
export async function evidenceSummaryForDecision(objective: string): Promise<unknown | null> {
  if (summaryOverrideForTests) return summaryOverrideForTests(objective)
  return null
}

/** Gather a bounded source pack for one decision (read-only; never follows links). */
export async function runSpecialistResearchForDecision(objective: string): Promise<{ sources: DecisionSource[] } | null> {
  if (overrideForTests) return overrideForTests(objective)
  try {
    const { runSpecialistResearch } = await import('@/lib/research/agent-evidence')
    const pack = await runSpecialistResearch({
      consumer: 'knowledge',
      objective,
      userId: null,
      purpose: 'fact-check',
      budget: { maxQueries: 2, maxSources: 6, maxPageReads: 1 },
    })
    return {
      sources: (pack.evidence ?? []).slice(0, 6).map((s) => ({
        url: s.url,
        title: s.title,
        publishedAt: s.publishedAt ?? null,
      })),
    }
  } catch {
    // The research lane being unavailable is honest evidence absence — the
    // decision then runs with no evidence and reports its true confidence.
    return null
  }
}
