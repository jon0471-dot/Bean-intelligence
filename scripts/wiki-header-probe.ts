/**
 * Probe: which header sets get Wikipedia MediaWiki API 200 from Bun's fetch?
 */
const url = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Chief%20Minister%20of%20Tamil%20Nadu&format=json&formatversion=2&srlimit=2'

const variants: Array<[string, Record<string, string>]> = [
  ['BEANResearch only', { 'user-agent': 'BEANResearch/1.0' }],
  ['full browser UA', { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' }],
  ['wiki policy UA', { 'user-agent': 'BEANResearch/1.0 (https://bean.example; ops@bean.example) userinfo', 'api-user-agent': 'BEANResearch/1.0 (ops@bean.example)' }],
  ['curl-ish', { 'user-agent': 'curl/8.5.0' }],
]

for (const [label, headers] of variants) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    const body = await res.text()
    console.log(`${label}: HTTP ${res.status} len=${body.length} ${res.status === 200 ? 'OK' : body.slice(0, 120).replace(/\n/g, ' ')}`)
  } catch (e) {
    console.log(`${label}: FAILED ${e instanceof Error ? e.message : e}`)
  }
}
