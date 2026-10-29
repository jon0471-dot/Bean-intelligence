/** One-shot header-only quota check (mirrors quota-watcher once()). */
import fs from 'fs'
import path from 'path'

const cfg = JSON.parse(fs.readFileSync('/etc/.z-ai-config', 'utf-8'))

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
await res.text()
const h = (n: string) => res.headers.get(n)
console.log(
  JSON.stringify(
    {
      status: res.status,
      limitDaily: h('x-ratelimit-limit-daily'),
      remainingDaily: h('x-ratelimit-remaining-daily'),
      userDailyRemaining: h('x-ratelimit-user-daily-remaining'),
      limitQps: h('x-ratelimit-limit-qps'),
      reset: h('x-ratelimit-reset'),
      retryAfter: h('retry-after'),
    },
    null,
    2,
  ),
)
