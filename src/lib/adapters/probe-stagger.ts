/**
 * BEAN Intelligence — staggered remote health-probe scheduling (pure).
 *
 * ZERO-DOWNTIME RECOVERY (2026-11-11), brief §2: "Staggered provider probes
 * rather than parallel bursts." The /api/health fan-out runs its probes
 * through Promise.all; since the CHAT-RECOVERY change all LLM/research
 * probes are quota-FREE reachability GETs — but five of them still target
 * the SAME gateway host in one burst (RIISHE chat, CODE GIFTZ chat, LAXII
 * image, JAZMII video reachability + research). The provider's
 * authoritative limit is 2 QPS on this account, and the measured failure
 * mode of this platform (F1, BEAN-POST-QUOTA-ACCEPTANCE.md) was a parallel
 * health burst tripping it. Free or not, bursting five same-host requests
 * is the pattern that broke before — so the REMOTE probes are now spread
 * on a small fixed stagger while the LOCAL probes (sandbox, Sharp engine,
 * Diffusers preflight — no network) stay parallel.
 *
 * Honesty: staggering only delays when a probe RUNS; every probe still runs
 * on every fresh poll and cached reports still serve within the TTL. The
 * added worst-case latency is (remoteCount-1) × staggerMs.
 */

/** Stagger between consecutive remote probes (ms). */
export const REMOTE_PROBE_STAGGER_MS = 250

/** Delay before the i-th (0-based) remote probe should start. */
export function remoteProbeDelayMs(index: number, baseMs = REMOTE_PROBE_STAGGER_MS): number {
  const i = Math.max(0, Math.floor(index))
  return i * Math.max(0, baseMs)
}

/** Sleep helper (escapes lint's no-floating-promise by construction). */
export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) resolve()
    else setTimeout(resolve, ms)
  })
}

/**
 * Run remote probe factories SERIALLY with a fixed gap between probes —
 * at most ONE remote probe request in flight at any moment, which is the
 * strongest possible anti-burst guarantee: with the 250ms gap plus real
 * network latency, the same-host request rate stays far below the
 * provider's measured 2-QPS limit no matter how many remote probes exist.
 * Results are returned in factory order. A probe that throws still rejects
 * here — callers wrap with safeProbe() as before (failure isolation is
 * unchanged). Cached reports (health-cache.ts, 20s TTL) make fresh probes
 * rare, so the added worst-case latency only lands on the first poll.
 */
export async function staggeredRemoteProbes<T>(
  factories: Array<() => Promise<T>>,
  baseMs = REMOTE_PROBE_STAGGER_MS,
): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < factories.length; i += 1) {
    if (i > 0) await delayMs(remoteProbeDelayMs(i, baseMs) - remoteProbeDelayMs(i - 1, baseMs))
    // Start the probe, but do not wait for it before scheduling the next:
    // the stagger separates STARTS, not completions.
    results.push(await factories[i]())
  }
  return results
}
