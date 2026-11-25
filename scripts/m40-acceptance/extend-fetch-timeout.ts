/**
 * Bun preload for the M40 acceptance runner: disables bun's hardcoded
 * ~300 s time-to-first-byte fetch deadline and replaces it with a
 * 30-minute budget enforced by an AbortController, so first-hit dev-server
 * route compilation and slow gateway turns cannot kill a lane.
 *
 * MEASURED JUSTIFICATION (2026-11-25, live dev server): with the original
 * 15-minute budget the RIISHE vision documents turn — measured at ~4.9 min
 * when this preload was written — took 10.0 minutes of server render
 * tonight (upstream gateway latency), and the four lanes ahead of it pushed
 * the total past the budget: the fetch was aborted client-side with an
 * uncaught AbortError while the server was still producing the REAL
 * description (dev log: "POST /api/riishe/documents 200 in 10.0min").
 * The budget must exceed the SLOWEST single measured turn plus preamble.
 *
 * Implementation notes (measured on bun 1.3.14):
 *  - bun IGNORES a numeric `timeout` in RequestInit on the 1.3 series (the
 *    deadline-respecting fix landed in bun v1.4.0, oven-sh/bun#16682);
 *  - bun's internal TTFB deadline is INDEPENDENT of any caller AbortSignal —
 *    only `timeout: false` disables it (the documented 1.3.x workaround);
 *  - so: `timeout: false` + our own 30-min AbortController budget.
 * Only used by the acceptance scripts (never shipped).
 */
const FETCH_BUDGET_MS = 1_800_000
const orig = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_BUDGET_MS)
  const signal = init?.signal
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const done = (res: Response) => {
    clearTimeout(timer)
    return res
  }
  const fail = (e: unknown) => {
    clearTimeout(timer)
    throw e
  }
  return orig(input, {
    ...init,
    signal: controller.signal,
    // bun-internal (undocumented): disables the hardcoded ~300 s TTFB deadline
    timeout: false,
  } as RequestInit).then(done, fail)
}) as typeof fetch
