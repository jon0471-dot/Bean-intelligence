/** Isolate the 422 trigger: does recency_days=180 (as the pipeline sends) cause 'no results'? */
import ZAI from 'z-ai-web-dev-sdk'

const attempts: Array<{ label: string; query: string; num: number; recency?: number }> = [
  { label: 'raw + recency180 (exact pipeline call)', query: 'What is the latest stable version of Next.js right now?', num: 6, recency: 180 },
  { label: 'keyword + recency180', query: 'Next.js latest stable version', num: 6, recency: 180 },
  { label: 'raw + recency7', query: 'What is the latest stable version of Next.js right now?', num: 6, recency: 7 },
]

const zai = await ZAI.create()
for (const a of attempts) {
  const t0 = Date.now()
  try {
    const res = await zai.functions.invoke('web_search', {
      query: a.query,
      num: a.num,
      ...(a.recency ? { recency_days: a.recency } : {}),
    })
    const arr = Array.isArray(res) ? res : []
    console.log(JSON.stringify({ label: a.label, ok: true, latencyMs: Date.now() - t0, count: arr.length, first: arr[0] ? String(arr[0].name ?? '').slice(0, 60) : null }))
  } catch (e) {
    console.log(JSON.stringify({ label: a.label, ok: false, latencyMs: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }))
  }
  await new Promise((r) => setTimeout(r, 1500))
}
