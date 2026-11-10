/**
 * Duplicate-guard + cancel probe: fresh user, two identical rapid
 * submissions → the second must be rejected while the first is active.
 * Prints the exact HTTP status + error body of the second submission.
 */
const BASE = 'http://localhost:3000'

function jar() {
  let cookie = ''
  return {
    async call(path: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
      })
      const sc = res.headers.get('set-cookie')
      if (sc) cookie = sc.split(';')[0]
      return res
    },
  }
}

async function main() {
  const stamp = Date.now().toString(36)
  const j = jar()
  const email = `dup-probe-${stamp}@bean-test.local`
  await j.call('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Bean-Accept-2026!', name: 'Dup Probe' }),
  })
  const login = await j.call('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Bean-Accept-2026!' }),
  })
  console.log('login:', login.status)

  const body = JSON.stringify({ product: 'riishe', message: `duplicate probe ${stamp}` })
  const r1 = await j.call('/api/ai/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const r1b = (await r1.json()) as { job?: { id: string; status: string } }
  console.log('submit1:', r1.status, r1b.job?.id, r1b.job?.status)

  const r2 = await j.call('/api/ai/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  const r2b = (await r2.json()) as { error?: string; job?: { id: string } }
  console.log('submit2 (identical, while active):', r2.status, r2b.error ?? r2b.job?.id)

  // cancel the first job and watch it settle
  if (r1b.job?.id) {
    const c = await j.call(`/api/ai/jobs/${r1b.job.id}/cancel`, { method: 'POST' })
    console.log('cancel:', c.status, await c.text())
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 2_000))
      const s = await j.call(`/api/ai/jobs/${r1b.job.id}`)
      const sj = (await s.json()) as { job?: { status: string } }
      if (['completed', 'failed', 'cancelled'].includes(sj.job?.status ?? '')) {
        console.log('final status:', sj.job?.status)
        break
      }
      if (i === 19) console.log('still non-terminal after 40s:', sj.job?.status)
    }
  }
  process.exit(0)
}

void main()
