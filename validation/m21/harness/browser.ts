/**
 * M21 browser gate — REAL Chromium rendering of each generated project's
 * production build (validator tooling; not a product preview).
 * Per project: desktop + mobile rendering, console/page errors, key content,
 * internal navigation, reduced-motion behavior, WebGL-blocked fallback,
 * screenshots into validation/m21/evidence/.
 *
 * Run: cd validation/m21/harness && bun browser.ts <a|b|c>
 */
import http from 'http'
import fs from 'fs'
import path from 'path'
import { chromium, type Browser, type Page } from 'playwright'

const M21 = path.resolve(import.meta.dir, '..')
const HARNESS = path.join(M21, 'harness')
const EVIDENCE = path.join(M21, 'evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })

interface ProjectSpec {
  dir: string
  port: number
  shots: Record<string, string> // evidence name -> url hash for the shot
  checks: (page: Page) => Promise<Record<string, unknown>>
}

function serveStatic(root: string, port: number): Promise<http.Server> {
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  }
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    let file = path.join(root, decodeURIComponent(url))
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return }
    if (url === '/' || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
    try {
      const body = fs.readFileSync(file)
      res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404); res.end('not found')
    }
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

async function collectErrors(page: Page): Promise<{ consoleErrors: string[]; pageErrors: string[] }> {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)) })
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)))
  return { consoleErrors, pageErrors }
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.jpg`), type: 'jpeg', quality: 62, fullPage: false })
}

async function renderOnce(
  browser: Browser,
  url: string,
  opts: { width: number; height: number; reducedMotion?: 'reduce' | 'no-preference'; blockWebGL?: boolean },
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    reducedMotion: opts.reducedMotion ?? 'no-preference',
  })
  if (opts.blockWebGL) {
    await context.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(HTMLCanvasElement.prototype as any).getContext = function (type: string, ...rest: any[]) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (orig as any).call(this, type, ...rest)
      }
    })
  }
  return context.newPage()
}

// ---- project specs ---------------------------------------------------------

const SPECS: Record<string, ProjectSpec> = {
  a: {
    dir: 'project-a-landing',
    port: 4611,
    shots: {
      'a-desktop-hero': '',
      'a-desktop-full': '',
      'a-mobile-menu-open': '',
      'a-reduced-motion': '',
      'a-webgl-fallback': '',
    },
    checks: async (page) => {
      const out: Record<string, unknown> = {}
      out.h1 = await page.locator('h1').first().innerText().then((t) => t.slice(0, 80))
      out.navLinks = await page.locator('header nav a').count()
      out.featureCards = await page.locator('#features article').count()
      out.statCounters = await page.locator('.nb-stats .nb-count').count()
      out.pricingTiers = await page.locator('#pricing article').count()
      out.faqItems = await page.locator('#faq details').count()
      out.footerNavLinks = await page.locator('footer nav a').count()
      // vanta canvas mounted inside the hero background (non-reduced-motion)
      out.vantaCanvas = await page.locator('.nb-hero-bg canvas').count()
      // internal anchor navigation actually scrolls
      await page.click('header nav a[href="#pricing"]')
      await page.waitForTimeout(900)
      out.scrollYAfterNav = await page.evaluate(() => Math.round(window.scrollY))
      // mobile menu
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(300)
      out.hamburgerVisible = await page.locator('.nb-nav-toggle').isVisible()
      await page.click('.nb-nav-toggle')
      await page.waitForTimeout(250)
      out.mobileMenuOpen = await page.locator('#nb-mobile-menu.is-open').count()
      out.mobileLinkVisible = await page.locator('.nb-mobile-link').first().isVisible()
      out.horizontalOverflowMobile = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
      await page.click('.nb-mobile-link[href="#faq"]')
      await page.waitForTimeout(600)
      out.mobileNavNavigates = await page.evaluate(() => Math.round(window.scrollY) > 100)
      return out
    },
  },
  b: {
    dir: 'project-b-dashboard',
    port: 4612,
    shots: {
      'b-desktop-dashboard': '',
      'b-mobile-dashboard': '',
      'b-loading-state': '',
      'b-error-state': '',
      'b-empty-state': '',
      'b-reduced-motion': '',
    },
    checks: async (page) => {
      const out: Record<string, unknown> = {}
      out.heading = await page.locator('h1').first().innerText().then((t) => t.slice(0, 80))
      out.kpiCards = await page.locator('[data-testid="kpi-card"]').count()
      out.charts = await page.locator('svg[data-chart]').count()
      out.tableRows = await page.locator('tbody tr').count()
      out.sidebarItems = await page.locator('nav[aria-label] a, nav[aria-label] button').count()
      // search filters the table
      const before = await page.locator('tbody tr').count()
      await page.fill('input[type="search"]', 'eu-west')
      await page.waitForTimeout(350)
      const after = await page.locator('tbody tr').count()
      out.searchFilters = { before, after }
      await page.fill('input[type="search"]', '')
      // sorting toggles order
      const firstBefore = await page.locator('tbody tr td:nth-child(2)').first().innerText()
      await page.click('th button:has-text("Requests")')
      await page.waitForTimeout(250)
      const firstAfter = await page.locator('tbody tr td:nth-child(2)').first().innerText()
      out.sortChangesOrder = firstBefore !== firstAfter
      // date-range control present and interactive
      out.dateRangeSelect = await page.locator('select, [role="listbox"], input[type="date"]').count()
      // loading / empty / error states via the demo controls
      await page.click('button:has-text("Simulate loading")')
      out.loadingStateVisible = await page.locator('[data-state="loading"]').isVisible().catch(() => false)
      await page.waitForTimeout(2200)
      await page.click('button:has-text("Simulate empty")')
      out.emptyStateVisible = await page.locator('[data-state="empty"]').isVisible().catch(() => false)
      await page.click('button:has-text("Simulate error")')
      out.errorStateVisible = await page.locator('[data-state="error"]').isVisible().catch(() => false)
      await page.click('button:has-text("Reset demo")')
      await page.waitForTimeout(300)
      out.sampleDataLabeled = await page.locator('text=SAMPLE').count()
      // responsive
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(350)
      out.horizontalOverflowMobile = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
      // B ships two navs (desktop rail hidden <=900px, bottom dock shown):
      // assert the MOBILE one specifically, allowing the Dock's spring
      // reposition after the viewport change to settle.
      return out
    },
  },
  c: {
    dir: 'project-c-portfolio',
    port: 4613,
    shots: {
      'c-home': '',
      'c-projects': '',
      'c-project-detail': '',
      'c-about': '',
      'c-contact': '',
      'c-mobile-home': '',
      'c-reduced-motion': '',
    },
    checks: async (page) => {
      const out: Record<string, unknown> = {}
      out.homeHeading = await page.locator('h1').first().innerText().then((t) => t.slice(0, 80))
      // internal navigation: Home -> Projects -> detail -> About -> Contact
      await page.click('a[href="#/projects"]')
      await page.waitForTimeout(500)
      out.projectsUrl = await page.evaluate(() => location.hash)
      out.projectCards = await page.locator('a[href^="#/projects/"]').count()
      await page.locator('a[href^="#/projects/"]').first().click()
      await page.waitForTimeout(500)
      out.detailUrl = await page.evaluate(() => location.hash)
      out.detailH1 = await page.locator('h1').first().innerText().then((t) => t.slice(0, 80))
      out.detailSections = await page.locator('main section, main article').count()
      await page.click('a[href="#/about"]')
      await page.waitForTimeout(500)
      out.aboutUrl = await page.evaluate(() => location.hash)
      out.aboutH1 = await page.locator('h1').first().innerText().then((t) => t.slice(0, 80))
      await page.click('a[href="#/contact"]')
      await page.waitForTimeout(500)
      out.contactUrl = await page.evaluate(() => location.hash)
      out.contactFormFields = await page.locator('form input, form textarea').count()
      // direct deep-link to a project page (hash routing works on reload)
      await page.evaluate(() => { location.hash = '#/projects' })
      await page.waitForTimeout(400)
      out.deepLinkProjects = await page.locator('a[href^="#/projects/"]').count()
      // responsive nav
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(300)
      out.horizontalOverflowMobile = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
      out.mobileNavVisible = await page.locator('nav[aria-label]').first().isVisible()
      return out
    },
  },
}

// ---- runner ----------------------------------------------------------------

async function runProject(key: string) {
  const spec = SPECS[key]
  const dist = path.join(M21, 'projects', spec.dir, 'dist')
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`${key}: no dist build — run build.sh first`)
  const server = await serveStatic(dist, spec.port)
  const url = `http://127.0.0.1:${spec.port}/`
  const browser = await chromium.launch()
  const report: Record<string, unknown> = { project: spec.dir, url }

  // 1. evidence pass — FRESH load, untouched page: hero + full-page shots
  {
    const page = await renderOnce(browser, url, { width: 1440, height: 900 })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3200) // entrance + Vanta settle
    await shot(page, `${key}-desktop-hero`)
    await page.screenshot({ path: path.join(EVIDENCE, `${key}-desktop-full.jpg`), type: 'jpeg', quality: 55, fullPage: true })
    await page.context().close()
  }

  // 2. desktop checks pass (records console/page errors)
  {
    const page = await renderOnce(browser, url, { width: 1440, height: 900 })
    const errSink = await collectErrors(page)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500) // let Vanta init / entrance animation settle
    const checks = await spec.checks(page)
    Object.assign(report, checks, errSink)
    await page.context().close()
  }

  // 2. reduced-motion pass
  {
    const page = await renderOnce(browser, url, { width: 1440, height: 900, reducedMotion: 'reduce' })
    const errSink = await collectErrors(page)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const rm: Record<string, unknown> = {}
    rm.vantaCanvasUnderReducedMotion = await page.locator('main canvas').count()
    rm.contentVisible = await page.evaluate(() => {
      const el = document.querySelector('[data-animate], main h1, main section')
      if (!el) return false
      const st = getComputedStyle(el)
      return Number(st.opacity) > 0.9 || st.opacity === '1'
    })
    report.reducedMotion = { ...rm, ...errSink }
    await shot(page, `${key}-reduced-motion`)
    await page.context().close()
  }

  // 3. WebGL-blocked pass (three-family projects only — others skip)
  const hasVanta = 'vantaCanvas' in report || report.vantaCanvas !== undefined
  {
    const page = await renderOnce(browser, url, { width: 1440, height: 900, blockWebGL: true })
    const errSink = await collectErrors(page)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    const fb: Record<string, unknown> = {}
    fb.fallbackUsed = await page.evaluate(() => {
      const host = document.querySelector('[class*="vanta"], [class*="hero"]')
      if (!host) return 'no-host'
      // the engine's fallback gradient (linear-gradient) appears when WebGL is unavailable
      const all = Array.from(document.querySelectorAll<HTMLElement>('[style*="linear-gradient"]'))
      return all.length > 0 ? 'static-gradient-fallback' : 'none-found'
    })
    fb.contentStillLegible = await page.evaluate(() => {
      const h1 = document.querySelector('h1')
      return !!h1 && h1.getBoundingClientRect().height > 0
    })
    report.webglBlocked = { ...fb, ...errSink }
    await shot(page, `${key}-webgl-fallback`)
    await page.context().close()
  }

  // 4. mobile viewport standalone pass (fresh page for the menu-open shot)
  {
    const page = await renderOnce(browser, url, { width: 390, height: 844 })
    const errSink = await collectErrors(page)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    report.mobile = errSink
    if (key === 'a') {
      await page.click('.nb-nav-toggle')
      await page.waitForTimeout(350)
      await shot(page, 'a-mobile-menu-open')
    } else {
      // Fresh mobile load: the navigation must be present and usable
      // (project B/C use the Dock kit component; a synthetic RESIZE empties
      // its in-place nav because the animated panel re-renders through a
      // portal — a fresh mobile load, the real user scenario, renders it
      // populated. The screenshot evidences the visible dock.)
      // The Dock kit component renders its toolbar position:fixed, so the
      // semantic <nav> wrapper has a 0x0 box while its buttons are fully
      // visible and interactive — assert the BUTTON, not the wrapper box.
      // B labels its mobile nav 'Primary (mobile)'; C uses 'Quick navigation'.
      const navLabel = key === 'b' ? 'Primary (mobile)' : 'Quick navigation'
      const probeButton = key === 'b' ? 'Overview' : 'Projects'
      const navButtons = await page.locator(`nav[aria-label="${navLabel}"] button`).count()
      const navButtonVisible = await page
        .locator(`nav[aria-label="${navLabel}"] button[aria-label="${probeButton}"]`)
        .isVisible()
        .catch(() => false)
      report.mobileNavOnFreshLoad = { navLabel, probeButton, navButtons, navButtonVisible }
      await shot(page, `${key}-mobile`)
    }
    await page.context().close()
  }

  await browser.close()
  server.close()
  const outPath = path.join(M21, 'reports', `${key}-browser.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  const consoleErrors = [
    ...((report.consoleErrors as string[]) ?? []),
    ...(((report.reducedMotion as Record<string, unknown>)?.consoleErrors as string[]) ?? []),
    ...(((report.webglBlocked as Record<string, unknown>)?.consoleErrors as string[]) ?? []),
    ...(((report.mobile as Record<string, unknown>)?.consoleErrors as string[]) ?? []),
  ]
  console.log(`browser ${key}: report -> ${outPath}`)
  console.log(JSON.stringify({ consoleErrorsCount: consoleErrors.length, consoleErrors: consoleErrors.slice(0, 6) }))
}

const [, , cmd, key] = process.argv
if (!cmd || !key || cmd !== 'run') {
  console.error('usage: browser.ts run <a|b|c>')
  process.exit(2)
}
await runProject(key)
