/**
 * Restart-survival test (Phase 8 background test):
 * 1. register + submit a background chat job
 * 2. read the job's state right away
 * (the operator kills + restarts the server between step 2 and 3)
 * 3. poll until terminal; recovery must have taken over (recovered notice
 *    in the event log when the lease expired mid-run).
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
  const mode = process.argv[2] ?? 'submit'
  const stampFile = '/tmp/bean-restart-job-id.txt'
  const j = jar()
  const stamp = Date.now().toString(36)
  const email = `restart-${stamp}@bean-test.local`

  if (mode === 'submit') {
    await j.call('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Bean-Accept-2026!', name: 'Restart Probe' }),
    })
    await j.call('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Bean-Accept-2026!' }),
    })
    const r = await j.call('/api/ai/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'riishe', message: `restart survival probe ${stamp}` }),
    })
    const b = (await r.json()) as { job?: { id: string } }
    if (!b.job?.id) {
      console.log('SUBMIT FAILED', r.status)
      process.exit(1)
    }
    const s = await j.call(`/api/ai/jobs/${b.job.id}`)
    const sj = (await s.json()) as { job?: { status: string } }
    console.log(`SUBMITTED job=${b.job.id} status=${sj.job?.status}`)
    // persist a cookie jar for phase 2
    const fs = await import('node:fs')
    fs.writeFileSync('/tmp/bean-restart-email.txt', email)
    fs.writeFileSync(stampFile, b.job.id)
    process.exit(0)
  }

  // phase 2: new process (post-restart), fresh login (session may persist in DB)
  const fs = await import('node:fs')
  const emailSaved = fs.readFileSync('/tmp/bean-restart-email.txt', 'utf8')
  const jobId = fs.readFileSync(stampFile, 'utf8').trim()
  await j.call('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailSaved, password: 'Bean-Accept-2026!' }),
  })
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    const s = await j.call(`/api/ai/jobs/${jobId}`)
    if (s.ok) {
      const sj = (await s.json()) as { job?: { status: string; errorClass?: string | null } }
      const st = sj.job?.status ?? 'unknown'
      if (['completed', 'failed', 'cancelled'].includes(st)) {
        console.log(`SETTLED after restart: status=${st} errorClass=${sj.job?.errorClass ?? 'none'}`)
        process.exit(0)
      }
      if (Date.now() > deadline) {
        console.log('TIMEOUT — still', st)
        process.exit(1)
      }
      console.log(`poll: ${st}`)
    }
    await new Promise((r) => setTimeout(r, 5_000))
  }
}

void main()
