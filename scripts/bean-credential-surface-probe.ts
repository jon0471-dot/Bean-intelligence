/**
 * BEAN — credential-surface probe (OPERATIONAL-TRANSFORMATION, Phase 5).
 *
 * One bounded GET {baseUrl}/models with the REAL submission auth surface
 * (Authorization: Bearer <apiKey> + X-Token: <platform token>) — the same
 * headers the video endpoint requires. Measures HTTP status + rate-limit
 * headers. NEVER prints credential values.
 *
 * Context: at 2026-11-11 01:14Z every gateway request (chat, functions,
 * video) answered HTTP 401 {"error":"missing X-Token header"}; the platform
 * rewrote /etc/.z-ai-config at 01:26 (new 243-char token). No request had
 * been made since. This probe is the verification.
 */
import ZAI from 'z-ai-web-dev-sdk'

async function main(): Promise<void> {
  const zai = await ZAI.create()
  const cfg = (zai as unknown as { config?: { baseUrl?: string; apiKey?: string; token?: string } }).config
  if (!cfg?.baseUrl || !cfg?.apiKey) {
    console.log(JSON.stringify({ ok: false, reason: 'no baseUrl/apiKey in gateway config' }))
    process.exit(1)
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
  }
  if (cfg.token) headers['X-Token'] = cfg.token
  const t0 = Date.now()
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/models`, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  await res.arrayBuffer().catch(() => undefined)
  const rl: Record<string, string> = {}
  for (const [k, v] of res.headers.entries()) {
    if (/ratelimit|retry-after|quota/i.test(k)) rl[k] = v
  }
  console.log(
    JSON.stringify(
      {
        ok: res.status >= 200 && res.status < 300,
        httpStatus: res.status,
        latencyMs: Date.now() - t0,
        tokenPresent: Boolean(cfg.token),
        tokenLength: cfg.token ? cfg.token.length : 0,
        apiKeyLength: cfg.apiKey.length,
        rateLimitHeaders: rl,
      },
      null,
      1,
    ),
  )
}

main().catch((e: unknown) => {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  process.exit(1)
})
