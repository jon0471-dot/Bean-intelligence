/**
 * Gateway quota watcher — polls the account-level rate-limit headers without
 * consuming quota (HEAD-style minimal request; a 429 response consumes
 * nothing and carries the same headers). Exits 0 with "QUOTA AVAILABLE" when
 * X-Ratelimit-Remaining-Daily > 0, so the E2E can be re-run for real.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

const cfg = JSON.parse(fs.readFileSync(path.join('/etc/.z-ai-config'), 'utf-8'))

function toInt(v: string | null): number {
  return v == null ? -1 : parseInt(v, 10)
}

async function once(): Promise<{ remainingDaily: number; limitDaily: number; status: number }> {
  const res = await fetch(cfg.baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-Z-AI-From': 'Z',
      ...(cfg.chatId ? { 'X-Chat-Id': cfg.chatId } : {}),
      ...(cfg.userId ? { 'X-User-Id': cfg.userId } : {}),
      ...(cfg.token ? { 'X-Token': cfg.token } : {}),
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      thinking: { type: 'disabled' },
    }),
  })
  // Consume the body so the socket is released.
  await res.text()
  return {
    remainingDaily: toInt(res.headers.get('x-ratelimit-remaining-daily')),
    limitDaily: toInt(res.headers.get('x-ratelimit-limit-daily')),
    status: res.status,
  }
}

const maxMinutes = parseInt(process.argv[2] ?? '150', 10)
const intervalSec = parseInt(process.argv[3] ?? '120', 10)
const deadline = Date.now() + maxMinutes * 60_000

while (Date.now() < deadline) {
  const ts = new Date().toISOString()
  try {
    const r = await once()
    console.log(`${ts} status=${r.status} dailyRemaining=${r.remainingDaily}/${r.limitDaily}`)
    if (r.remainingDaily > 0) {
      console.log('QUOTA AVAILABLE')
      process.exit(0)
    }
  } catch (e) {
    console.log(`${ts} probe error: ${e instanceof Error ? e.message : String(e)}`)
  }
  await new Promise((r) => setTimeout(r, intervalSec * 1000))
}
console.log('QUOTA STILL EXHAUSTED AT WATCH DEADLINE')
process.exit(2)
