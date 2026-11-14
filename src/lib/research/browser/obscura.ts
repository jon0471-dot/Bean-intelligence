/**
 * BEAN Intelligence — shared research gateway: Obscura browser backend
 * (OPTIONAL JavaScript-rendering provider — addendum).
 *
 * Obscura (h4ckf0r0day/obscura, Apache-2.0) is a Rust headless browser with a
 * built-in SSRF deny-list (loopback/RFC1918/CGNAT/link-local blocked at
 * literal-IP AND DNS-resolution time; `--allow-private-network` is NEVER
 * passed). BEAN drives the CLI (`obscura fetch <url> --dump …`), which needs
 * no CDP endpoint at all: nothing listens, nothing to expose. `obscura serve`
 * (CDP, token-authenticated, loopback-bound) is documented for operators who
 * want Puppeteer/Playwright compatibility — it is not used by this adapter.
 *
 * Rules implemented here:
 *   - OPTIONAL: every operation reports honestly when the binary is absent;
 *     the research gateway keeps working without it.
 *   - URL safety: every navigation URL passes assertPublicHttpUrl first
 *     (defense in depth on top of Obscura's own guard).
 *   - Per-navigation timeout (clamped), stdout cap, no retries of blocked
 *     pages, no stealth flag, no proxy, no cookie persistence.
 *   - Extracted content is UNTRUSTED DATA: sanitized + injection-scanned.
 *   - Extracted pages are never executed and never written into app files;
 *     screenshots go to an ephemeral temp file, read, then deleted.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { htmlToText } from '@/lib/research/provider'
import { obscuraBinary, obscuraTimeoutMs, probeBinaryVersion } from '../reach/config'
import { assertPublicHttpUrl } from '../reach/url-safety'
import { scanRetrievedText } from '../reach/injection'

const MAX_HTML_BYTES = 512 * 1024
const MAX_STDOUT_BYTES = 2 * 1024 * 1024
const MAX_LINKS = 200
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

export type ObscuraFailureKind = 'not-configured' | 'bad-input' | 'timeout' | 'upstream' | 'cancelled'

export interface ObscuraBase {
  /** Honest failure kind when ok === false. */
  kind?: ObscuraFailureKind
  reason?: string
  elapsedMs: number
}

export interface ObscuraTextResult extends ObscuraBase {
  ok: boolean
  url: string
  text: string
  /** Injection-pattern flags found in the extracted content (provenance). */
  injectionFlags: string[]
}

export interface ObscuraPageResult extends ObscuraBase {
  ok: boolean
  url: string
  html: string
  text: string
  injectionFlags: string[]
}

export interface ObscuraLink {
  url: string
  text: string
}

export interface ObscuraLinksResult extends ObscuraBase {
  ok: boolean
  url: string
  links: ObscuraLink[]
}

export interface ObscuraScreenshotResult extends ObscuraBase {
  ok: boolean
  url: string
  mime: 'image/png'
  base64: string
  width: number
  height: number
}

export interface ObscuraHealth {
  available: boolean
  version: string | null
  reason: string | null
  checkedAt: string
}

// ---------------------------------------------------------------------------
// Child-process plumbing (argv-array only, minimal env, hard bounds)
// ---------------------------------------------------------------------------

interface SpawnOutcome {
  ok: boolean
  stdout: string
  kind: ObscuraFailureKind
  reason: string
}

function runObscura(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      LANG: process.env.LANG ?? 'C.UTF-8',
      LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
      NODE_ENV: process.env.NODE_ENV,
      // Obscura runtime knobs — the SSRF deny-list stays ON (no
      // OBSCURA_ALLOW_PRIVATE_NETWORK), navigation bounded.
      OBSCURA_NAV_TIMEOUT_MS: String(Math.max(5_000, Math.min(60_000, timeoutMs))),
    }
    let stdout = Buffer.alloc(0)
    let overflow = false
    let settled = false
    let killedFor: 'timeout' | 'cancel' | 'overflow' | null = null

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(obscuraBinary(), args, {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      resolve({ ok: false, stdout: '', kind: 'not-configured', reason: 'browser rendering runtime is not available' })
      return
    }

    const finish = (outcome: SpawnOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      killedFor = 'timeout'
      killChild()
    }, timeoutMs + 2_000)
    const onAbort = () => {
      killedFor = 'cancel'
      killChild()
    }
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (overflow) return
      stdout = Buffer.concat([stdout, chunk])
      if (stdout.length > MAX_STDOUT_BYTES) {
        overflow = true
        killedFor = 'overflow'
        killChild()
      }
    })
    child.stderr?.on('data', () => {
      /* diagnostic only — discarded */
    })
    child.on('error', () => finish({ ok: false, stdout: '', kind: 'not-configured', reason: 'browser rendering runtime is not available' }))

    /** Kill + destroy pipes so a wrapped grandchild cannot hold `close` open. */
    function killChild(): void {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already exited */
      }
      try {
        child.stdout?.destroy()
        child.stderr?.destroy()
      } catch {
        /* streams already gone */
      }
    }
    child.on('close', () => {
      if (overflow) {
        finish({ ok: false, stdout: '', kind: 'upstream', reason: 'rendered output exceeded the configured limit' })
        return
      }
      if (signal?.aborted || killedFor === 'cancel') {
        finish({ ok: false, stdout: '', kind: 'cancelled', reason: 'navigation was cancelled' })
        return
      }
      if (killedFor === 'timeout') {
        finish({ ok: false, stdout: '', kind: 'timeout', reason: 'navigation exceeded its time budget and was stopped' })
        return
      }
      finish({ ok: child.exitCode === 0, stdout: stdout.toString('utf8'), kind: child.exitCode === 0 ? 'upstream' : 'upstream', reason: child.exitCode === 0 ? '' : 'navigation or extraction failed' })
    })
  })
}

async function guardedNavigationUrl(rawUrl: string): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const guard = await assertPublicHttpUrl(rawUrl)
  if (!guard.ok) return { ok: false, reason: guard.reason }
  return { ok: true, url: guard.url }
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text
}

// ---------------------------------------------------------------------------
// Health (cached 60 s)
// ---------------------------------------------------------------------------

const HEALTH_TTL_MS = 60_000
let healthCache: { value: ObscuraHealth; at: number } | null = null

/** Quota-free availability probe (`obscura --version`), cached 60 s. */
export async function obscuraHealthCheck(): Promise<ObscuraHealth> {
  if (healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.value
  const probe = probeBinaryVersion(obscuraBinary())
  const value: ObscuraHealth = {
    available: probe.available,
    version: probe.version,
    reason: probe.available ? null : 'browser rendering runtime is not available',
    checkedAt: new Date().toISOString(),
  }
  healthCache = { value, at: Date.now() }
  return value
}

export function clearObscuraHealthCacheForTests(): void {
  healthCache = null
}

// ---------------------------------------------------------------------------
// Interface operations (addendum contract)
// ---------------------------------------------------------------------------

/** Plain-text extraction from a JavaScript-rendered page. */
export async function obscuraExtractText(rawUrl: string, signal?: AbortSignal): Promise<ObscuraTextResult> {
  const t0 = Date.now()
  const url = await guardedNavigationUrl(rawUrl)
  if (!url.ok) return { ok: false, kind: 'bad-input', reason: url.reason, url: String(rawUrl).slice(0, 2048), text: '', injectionFlags: [], elapsedMs: Date.now() - t0 }
  const timeoutMs = obscuraTimeoutMs()
  const out = await runObscura(['fetch', url.url, '--dump', 'text', '--timeout', String(Math.round(timeoutMs / 1000))], timeoutMs, signal)
  if (!out.ok) {
    return { ok: false, kind: out.kind, reason: out.reason, url: url.url, text: '', injectionFlags: [], elapsedMs: Date.now() - t0 }
  }
  const { sanitized, flags } = scanRetrievedText(out.stdout, 24_000)
  return { ok: true, url: url.url, text: sanitized, injectionFlags: flags, elapsedMs: Date.now() - t0 }
}

/** Rendered HTML + derived text for JavaScript-heavy pages. */
export async function obscuraFetchRenderedPage(rawUrl: string, signal?: AbortSignal): Promise<ObscuraPageResult> {
  const t0 = Date.now()
  const url = await guardedNavigationUrl(rawUrl)
  if (!url.ok) return { ok: false, kind: 'bad-input', reason: url.reason, url: String(rawUrl).slice(0, 2048), html: '', text: '', injectionFlags: [], elapsedMs: Date.now() - t0 }
  const timeoutMs = obscuraTimeoutMs()
  const out = await runObscura(['fetch', url.url, '--dump', 'html', '--timeout', String(Math.round(timeoutMs / 1000))], timeoutMs, signal)
  if (!out.ok) {
    return { ok: false, kind: out.kind, reason: out.reason, url: url.url, html: '', text: '', injectionFlags: [], elapsedMs: Date.now() - t0 }
  }
  const html = clip(out.stdout, MAX_HTML_BYTES)
  const { sanitized: text, flags } = scanRetrievedText(htmlToText(html), 24_000)
  return { ok: true, url: url.url, html, text, injectionFlags: flags, elapsedMs: Date.now() - t0 }
}

/** Link extraction from a rendered page (bounded to MAX_LINKS). */
export async function obscuraExtractLinks(rawUrl: string, signal?: AbortSignal): Promise<ObscuraLinksResult> {
  const t0 = Date.now()
  const url = await guardedNavigationUrl(rawUrl)
  if (!url.ok) return { ok: false, kind: 'bad-input', reason: url.reason, url: String(rawUrl).slice(0, 2048), links: [], elapsedMs: Date.now() - t0 }
  const timeoutMs = obscuraTimeoutMs()
  const out = await runObscura(['fetch', url.url, '--dump', 'links', '--timeout', String(Math.round(timeoutMs / 1000))], timeoutMs, signal)
  if (!out.ok) {
    return { ok: false, kind: out.kind, reason: out.reason, url: url.url, links: [], elapsedMs: Date.now() - t0 }
  }
  const links: ObscuraLink[] = []
  for (const line of out.stdout.split('\n')) {
    if (links.length >= MAX_LINKS) break
    const trimmed = line.trim()
    if (!trimmed) continue
    const tabIndex = trimmed.indexOf('\t')
    const linkUrl = (tabIndex >= 0 ? trimmed.slice(0, tabIndex) : trimmed).trim()
    const text = tabIndex >= 0 ? trimmed.slice(tabIndex + 1).trim().slice(0, 200) : ''
    if (!/^https?:\/\//i.test(linkUrl)) continue
    const guard = await assertPublicHttpUrl(linkUrl, { resolveDns: false })
    if (!guard.ok) continue // extracted links are untrusted — drop non-public ones
    links.push({ url: guard.url, text })
  }
  return { ok: true, url: url.url, links, elapsedMs: Date.now() - t0 }
}

/**
 * Full-page PNG screenshot (1280×720 default viewport, render-enabled build).
 * The image is written to an ephemeral temp file by the CLI, read here, and
 * the temp directory is ALWAYS removed afterwards.
 */
export async function obscuraCaptureScreenshot(rawUrl: string, signal?: AbortSignal): Promise<ObscuraScreenshotResult> {
  const t0 = Date.now()
  const url = await guardedNavigationUrl(rawUrl)
  if (!url.ok) return { ok: false, kind: 'bad-input', reason: url.reason, url: String(rawUrl).slice(0, 2048), mime: 'image/png', base64: '', width: 0, height: 0, elapsedMs: Date.now() - t0 }
  let dir: string | null = null
  try {
    dir = await mkdtemp(join(tmpdir(), 'bean-obscura-'))
    const shotPath = join(dir, 'page.png')
    const timeoutMs = obscuraTimeoutMs()
    const out = await runObscura(
      ['fetch', url.url, '--screenshot', shotPath, '--timeout', String(Math.round(timeoutMs / 1000))],
      timeoutMs,
      signal,
    )
    if (!out.ok) {
      return { ok: false, kind: out.kind, reason: out.reason, url: url.url, mime: 'image/png', base64: '', width: 0, height: 0, elapsedMs: Date.now() - t0 }
    }
    const bytes = await readFile(shotPath)
    if (bytes.length === 0 || bytes.length > MAX_SCREENSHOT_BYTES) {
      return { ok: false, kind: 'upstream', reason: 'screenshot was empty or exceeded the configured limit', url: url.url, mime: 'image/png', base64: '', width: 0, height: 0, elapsedMs: Date.now() - t0 }
    }
    // PNG magic bytes — never trust the file extension alone.
    if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
      return { ok: false, kind: 'upstream', reason: 'screenshot output was not a PNG image', url: url.url, mime: 'image/png', base64: '', width: 0, height: 0, elapsedMs: Date.now() - t0 }
    }
    return { ok: true, url: url.url, mime: 'image/png', base64: bytes.toString('base64'), width: 1280, height: 720, elapsedMs: Date.now() - t0 }
  } catch {
    return { ok: false, kind: 'upstream', reason: 'screenshot capture failed', url: url.url, mime: 'image/png', base64: '', width: 0, height: 0, elapsedMs: Date.now() - t0 }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Lifecycle shutdown. The CLI adapter keeps NO persistent process and holds
 * NO resources: shutdown is an honest no-op (the addendum interface is
 * honored — every operation has a real tested implementation or reports
 * unavailable).
 */
export async function obscuraShutdown(): Promise<{ ok: true; mode: 'cli'; stopped: number }> {
  return { ok: true, mode: 'cli', stopped: 0 }
}
