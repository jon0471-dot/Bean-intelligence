/**
 * BEAN Intelligence — SearXNG search-discovery provider (self-hosted).
 *
 * MEASURED ON THIS HOST (2026-11-08, SearXNG source build ac11e14 2026-11-06):
 *   - boot 1.5s, RSS ~87MB (cheap enough for the 4GB RAM deployment host)
 *   - real queries return results in 0.8–1.6s from the Brave engine;
 *     Bing responds but returns OFF-TOPIC results for non-English queries
 *     from this datacenter IP — its results are demoted, not trusted
 *   - Google/DuckDuckGo engines do not answer from this IP (measured);
 *     the recommended settings disable them rather than burn timeouts
 *
 * Role in the provider chain: the authorized gateway web_search stays the
 * PRIMARY search provider (measured, quota-metered). SearXNG is the
 * self-hosted fallback that consumes NO gateway quota — exactly what keeps
 * research working when the gateway throttles (the account-wide 429 windows
 * measured across this deployment).
 *
 * Lane management mirrors the llama.cpp lanes (src/lib/providers/llamacpp.ts):
 * adopt a running server, or spawn one as a DETACHED child when explicitly
 * configured (BEAN_SEARXNG_AUTOSTART=1 + BEAN_SEARXNG_HOME). RAM-gated.
 */

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import type { WebSearchResult } from '@/lib/research/provider'
import { logger } from '@/lib/observability/logger'

const SEARXNG_URL = process.env.BEAN_SEARXNG_URL?.trim() || 'http://127.0.0.1:8888'
const AUTOSTART = process.env.BEAN_SEARXNG_AUTOSTART === '1'
const SEARXNG_HOME = process.env.BEAN_SEARXNG_HOME?.trim() || '/tmp/searxng'
const SETTINGS_PATH = process.env.BEAN_SEARXNG_SETTINGS?.trim() || path.join(SEARXNG_HOME, 'settings-test.yml')
const MIN_FREE_RAM_MB = Number(process.env.BEAN_SEARXNG_MIN_FREE_RAM_MB || 500)
const PROBE_TTL_MS = 60_000
const MAX_SPAWNS_PER_HOUR = 3

/** Engines demoted for off-topic noise from this deployment's IP (measured). */
const DEMOTED_ENGINES = new Set(['bing'])

export interface SearxngHealth {
  available: boolean
  detail: string
  checkedAt: string
  autostartAttempted: boolean
}

interface ProbeState {
  at: number
  health: SearxngHealth
}

const g = globalThis as unknown as Record<string, unknown>
const STORE_KEY = '__bean_intel_searxng__'

function state(): { probe?: ProbeState; spawns: number[] } {
  if (!g[STORE_KEY]) g[STORE_KEY] = { spawns: [] }
  return g[STORE_KEY] as { probe?: ProbeState; spawns: number[] }
}

function freeRamMb(): number {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8')
    const m = /MemAvailable:\s+(\d+) kB/.exec(meminfo)
    return m ? Math.round(Number(m[1]) / 1024) : 2048
  } catch {
    return 2048
  }
}

/** Probe the local SearXNG JSON endpoint (60s cache). */
export async function probeSearxng(force = false): Promise<SearxngHealth> {
  const s = state()
  if (!force && s.probe && Date.now() - s.probe.at < PROBE_TTL_MS) return s.probe.health

  const health = await probeOnce()
  if (!health.available && AUTOSTART && health.detail.includes('ECONNREFUSED')) {
    const spawned = await trySpawn()
    if (spawned) {
      const retry = await probeOnce()
      health.available = retry.available
      health.detail = retry.available
        ? `autostarted SearXNG lane; ${retry.detail}`
        : `autostart attempted but service is still down: ${retry.detail}`
      health.autostartAttempted = true
    } else {
      health.autostartAttempted = true
      health.detail += '; autostart refused or failed (see logs)'
    }
  }
  s.probe = { at: Date.now(), health }
  return health
}

async function probeOnce(): Promise<SearxngHealth> {
  const checkedAt = new Date().toISOString()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4_000)
  try {
    const res = await fetch(`${SEARXNG_URL}/search?q=ping&format=json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return { available: false, detail: `SearXNG answered HTTP ${res.status} (JSON format may be disabled in settings)`, checkedAt, autostartAttempted: false }
    }
    const body = (await res.json()) as { results?: unknown[] }
    return { available: true, detail: `SearXNG responded (${Array.isArray(body.results) ? body.results.length : 0} probe results)`, checkedAt, autostartAttempted: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      available: false,
      detail: `SearXNG unreachable at ${SEARXNG_URL} (${msg.slice(0, 80)})`,
      checkedAt,
      autostartAttempted: false,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Adopt-or-spawn a detached SearXNG lane (llama.cpp lane pattern). */
async function trySpawn(): Promise<boolean> {
  const s = state()
  const now = Date.now()
  s.spawns = s.spawns.filter((t) => now - t < 3_600_000)
  if (s.spawns.length >= MAX_SPAWNS_PER_HOUR) {
    logger.warn('searxng.spawn_refused_rate', { count: s.spawns.length })
    return false
  }
  if (freeRamMb() < MIN_FREE_RAM_MB) {
    logger.warn('searxng.spawn_refused_ram', { freeRamMb: freeRamMb(), minFreeRamMb: MIN_FREE_RAM_MB })
    return false
  }
  if (!fs.existsSync(path.join(SEARXNG_HOME, 'searx'))) {
    logger.warn('searxng.spawn_refused_home', { home: SEARXNG_HOME })
    return false
  }
  try {
    const child = spawn(
      process.env.BEAN_SEARXNG_PYTHON || 'python3',
      ['-c', 'from searx.webapp import app; app.run(host="127.0.0.1", port=8888, threaded=True, use_reloader=False)'],
      {
        cwd: SEARXNG_HOME,
        env: { ...process.env, SEARXNG_SETTINGS_PATH: SETTINGS_PATH },
        detached: true,
        stdio: 'ignore',
      },
    )
    child.unref()
    s.spawns.push(now)
    // Bounded wait for the service to open its port.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const probe = await probeOnce()
      if (probe.available) {
        logger.info('searxng.lane_started', { pid: child.pid })
        return true
      }
    }
    logger.warn('searxng.lane_start_timeout', { pid: child.pid })
    return false
  } catch (e) {
    logger.warn('searxng.spawn_failed', { message: e instanceof Error ? e.message : String(e) })
    return false
  }
}

interface SearxngResultItem {
  url?: unknown
  title?: unknown
  content?: unknown
  engine?: unknown
  publishedDate?: unknown
}

/**
 * Real search via SearXNG. Results are normalized into the SAME shape the
 * research pipeline consumes (WebSearchResult) so ranking/caching/dedupe
 * apply unchanged. Demoted engines sink to the tail (rank-derived scores
 * follow position) instead of being dropped — a genuinely good Bing answer
 * still survives ranking.
 */
export async function searxngSearch(
  query: string,
  opts: { num?: number; timeoutMs?: number; language?: string } = {},
): Promise<WebSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const health = await probeSearxng()
  if (!health.available) {
    throw new Error(`SearXNG unavailable: ${health.detail}`)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000)
  try {
    const params = new URLSearchParams({
      q: trimmed.slice(0, 380),
      format: 'json',
      safesearch: '0',
    })
    if (opts.language) params.set('language', opts.language)
    const res = await fetch(`${SEARXNG_URL}/search?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`)
    const body = (await res.json()) as { results?: SearxngResultItem[] }
    const raw = Array.isArray(body.results) ? body.results : []
    const trusted = raw.filter((r) => typeof r.url === 'string')
    const demoted = raw.filter((r) => typeof r.url === 'string' && r.engine && DEMOTED_ENGINES.has(String(r.engine)))
    const demotedSet = new Set(demoted)
    const ordered = [...trusted.filter((r) => !demotedSet.has(r)), ...demoted]
    return ordered.slice(0, Math.min(opts.num ?? 8, 12)).map((r, i) => ({
      url: String(r.url),
      title: String(r.title ?? '').slice(0, 300),
      snippet: String(r.content ?? '').slice(0, 1200),
      hostName: safeHost(String(r.url)),
      rank: i + 1,
      date: typeof r.publishedDate === 'string' && r.publishedDate.trim() ? r.publishedDate.slice(0, 64) : null,
    }))
  } finally {
    clearTimeout(timer)
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Admin/diagnostics surface (health only — never internals). */
export async function searxngStatus(): Promise<{ url: string; autostart: boolean; health: SearxngHealth }> {
  return { url: SEARXNG_URL, autostart: AUTOSTART, health: await probeSearxng() }
}
