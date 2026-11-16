/**
 * BEAN Intelligence — page-extraction provider chain (Part 1 of the work
 * order: "Fetch and extract relevant page content").
 *
 * Two REAL providers, chosen per request by configured order:
 *   1. gateway page_reader (authorized, fast, quota-metered) — default first
 *   2. Crawl4AI self-hosted lane (Apache-2.0, no quota, ~4-8s chromium
 *      subprocess per page) — first for background jobs via config, and the
 *      automatic fallback when the gateway fails or throttles
 *
 * Robots/ToS compliance and page-error detection (ERR_BLOCKED_BY_CLIENT
 * interstitials, 404 bodies, captcha walls) are inherited from the research
 * pipeline's page validation (isUsablePageText) applied at the caller.
 */

import type { PageContent } from '@/lib/research/provider'
import { logger } from '@/lib/observability/logger'
import path from 'path'

const CRAWL4AI_ENABLED = process.env.BEAN_INTEL_CRAWL4AI !== '0' // on by default; the subprocess is only spawned when a page must be extracted
const CRAWL4AI_PYTHON = process.env.BEAN_INTEL_CRAWL4AI_PYTHON || 'python3'
const CRAWL4AI_MAX_CONCURRENT = Number(process.env.BEAN_INTEL_CRAWL4AI_CONCURRENCY || 1)
const CRAWL4AI_TIMEOUT_MS = Number(process.env.BEAN_INTEL_CRAWL4AI_TIMEOUT_MS || 60_000)

/** Comma list, e.g. "page_reader,crawl4ai". First AVAILABLE provider wins. */
function extractionOrder(): string[] {
  const raw = process.env.BEAN_INTEL_EXTRACT_ORDER?.trim() || 'page_reader,crawl4ai'
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Crawl4AI subprocess lane                                            */
/* ------------------------------------------------------------------ */

let crawlSemaphore: { active: number; queue: Array<() => void> } | null = null

function semaphore(): { active: number; queue: Array<() => void> } {
  if (!crawlSemaphore) crawlSemaphore = { active: 0, queue: [] }
  return crawlSemaphore
}

async function withCrawlSlot<T>(fn: () => Promise<T>): Promise<T> {
  const sem = semaphore()
  if (sem.active >= Math.max(1, CRAWL4AI_MAX_CONCURRENT)) {
    await new Promise<void>((resolve) => sem.queue.push(resolve))
  }
  sem.active += 1
  try {
    return await fn()
  } finally {
    sem.active -= 1
    const next = sem.queue.shift()
    if (next) next()
  }
}

interface Crawl4aiOutput {
  ok: boolean
  url?: string
  title?: string
  text?: string
  publishedTime?: string | null
  chars?: number
  error?: string
}

/**
 * Extract one page through the Crawl4AI lane (subprocess, one chromium boot,
 * bounded by a 1-slot semaphore and a hard timeout).
 */
export async function crawl4aiExtract(url: string, maxChars = 24_000): Promise<PageContent> {
  if (!CRAWL4AI_ENABLED) throw new Error('Crawl4AI lane disabled (BEAN_INTEL_CRAWL4AI=0)')
  const { spawn } = await import('child_process')
  const script = path.join(process.cwd(), 'scripts', 'intel', 'crawl4ai_extract.py')
  return withCrawlSlot(
    () =>
      new Promise<PageContent>((resolve, reject) => {
        const child = spawn(
          CRAWL4AI_PYTHON,
          [script, url, '--max-chars', String(maxChars), '--timeout', '40'],
          { env: { ...process.env, CRAWL4AI_NO_CLOUD_NOTICE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
        )
        let out = ''
        let err = ''
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error(`Crawl4AI extraction timed out after ${CRAWL4AI_TIMEOUT_MS}ms`))
        }, CRAWL4AI_TIMEOUT_MS)
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString()
        })
        child.stderr.on('data', (d: Buffer) => {
          err += d.toString()
        })
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(new Error(`Crawl4AI spawn failed: ${e.message}`))
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop()
          if (!line) {
            reject(new Error(`Crawl4AI produced no JSON (exit ${code}): ${err.slice(-200)}`))
            return
          }
          try {
            const parsed = JSON.parse(line) as Crawl4aiOutput
            if (!parsed.ok || typeof parsed.text !== 'string' || parsed.text.length === 0) {
              reject(new Error(`Crawl4AI extraction failed: ${parsed.error ?? 'empty text'}`))
              return
            }
            resolve({
              url: parsed.url ?? url,
              title: parsed.title ?? '',
              publishedTime: parsed.publishedTime ?? null,
              text: parsed.text.slice(0, maxChars),
            })
          } catch (e) {
            reject(new Error(`Crawl4AI JSON parse failed: ${e instanceof Error ? e.message : String(e)}`))
          }
        })
      }),
  )
}

/* ------------------------------------------------------------------ */
/* Chain                                                               */
/* ------------------------------------------------------------------ */

export type ExtractionVia = 'page_reader' | 'crawl4ai'

export interface ExtractionOutcome {
  content: PageContent
  via: ExtractionVia
  failures: string[]
}

/**
 * Extract a page through the configured provider chain. Providers are tried
 * in order; the first success wins. All failures are recorded honestly —
 * the caller degrades to the snippet when everything fails.
 */
export async function extractPage(
  url: string,
  opts: { maxChars?: number; pageReader?: (u: string) => Promise<PageContent>; crawlFirst?: boolean } = {},
): Promise<ExtractionOutcome> {
  const maxChars = opts.maxChars ?? 24_000
  const failures: string[] = []
  let order = extractionOrder()
  if (opts.crawlFirst) {
    order = [...order].sort((a, b) => Number(b === 'crawl4ai') - Number(a === 'crawl4ai'))
  }

  for (const provider of order) {
    try {
      if (provider === 'page_reader') {
        if (!opts.pageReader) {
          // Lazy import keeps the gateway breaker semantics intact and the
          // module usable from tests without SDK credentials.
          const mod = await import('@/lib/research/pipeline')
          const content = await mod.runSharedPageRead(url)
          return { content: { ...content, text: content.text.slice(0, maxChars) }, via: 'page_reader', failures }
        }
        const content = await opts.pageReader(url)
        return { content: { ...content, text: content.text.slice(0, maxChars) }, via: 'page_reader', failures }
      }
      if (provider === 'crawl4ai') {
        const content = await crawl4aiExtract(url, maxChars)
        return { content, via: 'crawl4ai', failures }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failures.push(`${provider}: ${msg.slice(0, 200)}`)
      logger.warn('intel.extract_provider_failed', { provider, url: url.slice(0, 120), message: msg.slice(0, 160) })
    }
  }
  throw new Error(`all extraction providers failed: ${failures.join(' | ').slice(0, 400)}`)
}
