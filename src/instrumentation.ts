/**
 * BEAN Intelligence — Next.js instrumentation hook.
 *
 * Starts the EMBEDDED background AI engine (worker pools for RIISHE, LAXII,
 * JAZMII and CODE GIFTZ) when the server process boots, so background jobs
 * execute independently of any browser session with zero ops setup. The
 * pools are idempotent (globalThis guard) and CAS-based claims make them
 * safe to combine with standalone worker processes
 * (scripts/ai-workers/worker.ts) — first claim wins, leases recover crashes.
 *
 * Disable with BEAN_ENGINE_EMBEDDED=0 (e.g. when running dedicated workers).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { startEmbeddedEngine } = await import('@/lib/ai-engine/runner')
    startEmbeddedEngine()
  } catch (e) {
    console.error(
      '[bean-engine] embedded engine failed to start:',
      e instanceof Error ? e.message : String(e),
    )
  }
  // SANDBOX RETENTION HYGIENE (OPERATIONAL-TRANSFORMATION, 2026-11-11):
  // cleanupOldRuns previously ran only opportunistically inside the two run
  // routes — measured: 602 stale workspaces accumulated. A scheduled sweep
  // at boot + every 6h keeps sandbox-runs/ bounded without user traffic.
  try {
    const { cleanupOldRuns } = await import('@/lib/sandbox/runner')
    const sweep = () =>
      cleanupOldRuns().catch(() => undefined)
    void sweep()
    const g = globalThis as unknown as { __beanSandboxSweepTimer?: NodeJS.Timeout }
    if (!g.__beanSandboxSweepTimer) {
      g.__beanSandboxSweepTimer = setInterval(sweep, 6 * 3600_000)
      g.__beanSandboxSweepTimer.unref?.()
    }
  } catch {
    // retention hygiene must never block boot
  }
}
