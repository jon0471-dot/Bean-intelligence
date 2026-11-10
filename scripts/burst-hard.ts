import { webSearch } from '../src/lib/research/provider'
const q = Array.from({ length: 45 }, (_, i) => `pressure probe ${i} latest news`)
const settled = await Promise.allSettled(q.map((x) => webSearch(x, { num: 3 })))
const ok = settled.filter((s) => s.status === 'fulfilled').length
console.log(`burst done: ok=${ok} failed=${q.length - ok}`)
