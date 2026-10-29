/**
 * Live contract test for per-message regenerate + retry (no duplicate user
 * rows, correct truncation). Real route, real account, real DB inspection.
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
const ORIGIN = 'https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai'
const JAR = '/home/z/my-project/scripts/e2e-cit-cookies.txt'

async function api(path: string, body?: unknown, method = 'POST'): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      cookie: readFileSync(JAR, 'utf8').split('\n').filter((l) => l.includes('\t') && (l.startsWith('#HttpOnly_') || !l.startsWith('#'))).map((l) => {
        const parts = l.replace(/^#HttpOnly_/, '').split('\t')
        return `${parts[5]}=${parts[6]}`
      }).join('; '),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function main() {
  // 1. Two-turn conversation (stable questions; no retrieval needed).
  const r1 = await api('/api/riishe/chat', { message: 'What is 12 plus 30? Answer with just the number.', searchMode: 'off' })
  const convId = r1.json.conversationId
  console.log('turn1:', r1.status, '| conv:', convId)
  const r2 = await api('/api/riishe/chat', { message: 'And what is 12 minus 30? Answer with just the number.', searchMode: 'off', conversationId: convId })
  console.log('turn2:', r2.status)

  let detail = await api(`/api/riishe/conversations/${convId}`, undefined, 'GET')
  let msgs = detail.json.conversation.messages
  console.log('messages after 2 turns:', msgs.map((m: any) => `${m.role[0]}:${m.content.slice(0, 24)}`))

  // 2. Regenerate the FIRST assistant message mid-conversation.
  const firstAssistant = msgs.find((m: any) => m.role === 'assistant')
  const regen = await api('/api/riishe/chat?stream=1', {
    message: msgs[0].content,
    conversationId: convId,
    searchMode: 'off',
    regenerateMessageId: firstAssistant.id,
  })
  console.log('regenerate(first assistant):', regen.status)
  detail = await api(`/api/riishe/conversations/${convId}`, undefined, 'GET')
  msgs = detail.json.conversation.messages
  console.log('messages after mid-conversation regenerate:')
  for (const m of msgs) console.log(`   ${m.role[0]}:${m.content.slice(0, 40)}`)

  const userRows = msgs.filter((m: any) => m.role === 'user')
  const q1Count = userRows.filter((m: any) => m.content.includes('12 plus 30')).length
  console.log('Q1 user rows (expect exactly 1):', q1Count)
  console.log('later turns removed with the regenerate (expect 2 messages total):', msgs.length)

  // 3. Trailing regenerate (retry semantics) — no duplicate user row.
  const retry = await api('/api/riishe/chat', {
    message: 'And what is 12 minus 30? Answer with just the number.',
    conversationId: convId,
    searchMode: 'off',
    retry: true,
  })
  console.log('trailing retry:', retry.status)
  detail = await api(`/api/riishe/conversations/${convId}`, undefined, 'GET')
  msgs = detail.json.conversation.messages
  const q2Count = msgs.filter((m: any) => m.role === 'user' && m.content.includes('12 minus 30')).length
  console.log('messages after retry:', msgs.map((m: any) => `${m.role[0]}:${m.content.slice(0, 24)}`))
  console.log('Q2 user rows (expect exactly 1):', q2Count)

  // 4. Regenerate a NON-existent message id -> honest 404.
  const bad = await api('/api/riishe/chat', { message: 'x', conversationId: convId, regenerateMessageId: 'does-not-exist' })
  console.log('regenerate(bad id):', bad.status, '|', JSON.stringify(bad.json?.error ?? {}))

  // Cleanup: delete the test conversation.
  await api(`/api/riishe/conversations/${convId}`, undefined, 'DELETE')
  console.log('cleanup: conversation deleted')
}

main()
  .catch((e) => { console.error('FAILED:', e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
