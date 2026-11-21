/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: catalogue integrity
 * (Phase 1 registry truth + React Bits attribution/supply-chain checks,
 * updated for the internal library expansion: the original 17 integrations
 * are preserved verbatim at their original upstream commit; the expansion
 * set covers the remaining compatible free collection at the newer commit;
 * every upstream component is either installed with evidence or honestly
 * recorded as not-installed with a verified reason).
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import {
  COMPONENT_CATALOG,
  NOT_INSTALLED_CATALOG,
  FULL_CATALOG,
  PINNED_DEPENDENCIES,
  REACT_BITS_COMMIT,
  REACT_BITS_EXPANSION_COMMIT,
  autoSelectComponents,
  getCatalogEntry,
} from '../../src/lib/frontend-intel/catalog'
import { EXPANSION_ENTRIES, EXPANSION_EXCLUSIONS } from '../../src/lib/frontend-intel/catalog-expansion'

const KIT_DIR = path.join(import.meta.dir, '../../src/components/giftz-kit')

describe('frontend-intel catalogue registry (expanded)', () => {
  test('covers the complete upstream free collection: every component installed or honestly excluded', () => {
    // 218 = 168 installed (17 preserved + 151 expansion) + 50 excluded.
    expect(COMPONENT_CATALOG.length).toBe(168)
    expect(NOT_INSTALLED_CATALOG.length).toBe(50)
    expect(FULL_CATALOG.length).toBe(218)
    const ids = [...COMPONENT_CATALOG, ...NOT_INSTALLED_CATALOG].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the ORIGINAL 17 integrations are preserved with their original upstream commit', () => {
    const originalIds = [
      'split-text', 'text-type', 'blur-text', 'shiny-text', 'gradient-text', 'count-up', 'scroll-reveal',
      'animated-content', 'star-border', 'click-spark', 'spotlight-card', 'glare-hover', 'glass-surface',
      'letter-glitch', 'dot-grid', 'dock', 'lattice-loader',
    ]
    for (const id of originalIds) {
      const c = getCatalogEntry(id)
      expect(c?.installed, `${id} must stay installed`).toBe(true)
      expect(c?.upstreamCommit, `${id} must keep its original pin`).toBe(REACT_BITS_COMMIT)
    }
  })

  test('installed entries are unique, typed, and cover the work-order capability areas', () => {
    const categories = new Set(COMPONENT_CATALOG.map((c) => c.category))
    for (const required of [
      'Text animation',
      'Section animation',
      'Interactive button',
      'Animated navigation',
      'Card',
      'Glass effect',
      'Background effect',
      'Hover interaction',
      'Loading state',
      'General animation',
      'Micro-interaction',
      'UI component',
    ]) {
      expect(categories.has(required), `missing category: ${required}`).toBe(true)
    }
  })

  test('every installed entry has honest metadata (source URL, license, attribution, a pinned commit)', () => {
    for (const c of COMPONENT_CATALOG) {
      expect(c.installed).toBe(true)
      expect(c.sourceUrl.startsWith('https://github.com/DavidHDev/react-bits/blob/')).toBe(true)
      expect(
        c.sourceUrl.includes(REACT_BITS_COMMIT) || c.sourceUrl.includes(REACT_BITS_EXPANSION_COMMIT),
        `${c.id}: source URL must pin a recorded upstream commit`,
      ).toBe(true)
      expect(c.license).toBe('MIT + Commons Clause v1.0')
      expect(c.attribution).toContain('React Bits')
      expect(c.variants).toContain('ts-default')
      expect(c.kitFiles.length).toBeGreaterThan(0)
    }
  })

  test('every installed kit file EXISTS on disk with the attribution header (registry truth)', () => {
    for (const c of COMPONENT_CATALOG) {
      for (const file of c.kitFiles) {
        const full = path.join(KIT_DIR, file)
        expect(existsSync(full), `missing kit file ${file} for ${c.id}`).toBe(true)
        const content = readFileSync(full, 'utf8')
        expect(content.includes('React Bits'), `${file} missing React Bits attribution`).toBe(true)
        expect(content.includes('Commons Clause'), `${file} missing Commons Clause notice`).toBe(true)
        expect(content.includes(c.upstreamCommit), `${file} missing pinned upstream commit`).toBe(true)
      }
    }
  })

  test('kit files declare only the dependencies the registry records (no motion/react leftovers)', () => {
    const externalPackages = new Set(['react', 'react-dom', 'gsap', '@gsap/react', 'framer-motion'])
    for (const c of COMPONENT_CATALOG) {
      for (const file of c.kitFiles.filter((f) => f.endsWith('.tsx'))) {
        const src = readFileSync(path.join(KIT_DIR, file), 'utf8')
        // NO kit file may import motion/react (the renamed framer-motion package).
        expect(src.includes("from 'motion/react'"), `${file} must not import motion/react`).toBe(false)
        // Components whose adaptation records the import swap must use framer-motion.
        if (c.adaptedFrom?.includes('motion/react')) {
          expect(src.includes("from 'framer-motion'"), `${file} should import framer-motion`).toBe(true)
        }
        // Every bare import must be either react built-ins or a recorded dependency.
        const importRe = /from\s+['"]([^.'"][^'"]*)['"]/g
        let m: RegExpExecArray | null
        while ((m = importRe.exec(src)) !== null) {
          const spec = m[1]
          const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
          expect(externalPackages.has(root), `${file} imports undeclared package '${spec}'`).toBe(true)
        }
      }
    }
  })

  test('registry dependencies match the kit files\u2019 real imports (both directions)', () => {
    for (const c of COMPONENT_CATALOG) {
      const src = c.kitFiles
        .filter((f) => f.endsWith('.tsx'))
        .map((f) => readFileSync(path.join(KIT_DIR, f), 'utf8'))
        .join('\n')
      for (const dep of c.dependencies) {
        expect(src.includes(`from '${dep}`) || src.includes(`import '${dep}`) || src.includes(`from "${dep}`), `${c.id} declares ${dep} but never imports it`).toBe(true)
      }
      if (src.includes("from 'framer-motion'")) {
        expect(c.dependencies).toContain('framer-motion')
      }
      if (src.includes("from 'gsap'")) {
        expect(c.dependencies).toContain('gsap')
      }
    }
  })

  test('the expansion data module and the merged registry agree', () => {
    expect(EXPANSION_ENTRIES.length).toBe(151)
    expect(EXPANSION_EXCLUSIONS.length).toBe(50)
    // Every expansion entry is installed with its kit files present.
    for (const e of EXPANSION_ENTRIES) {
      const c = getCatalogEntry(e.id)
      expect(c?.installed, `${e.id} should be installed`).toBe(true)
      expect(c?.upstreamCommit).toBe(REACT_BITS_EXPANSION_COMMIT)
    }
  })

  test('upstream evolution is recorded honestly: previously-uninstallable zero-dep now installed, new exclusions reasoned', () => {
    // Aurora/Particles needed `ogl` at the old pin; the current free
    // implementation is self-contained, so they are installed now.
    for (const id of ['aurora', 'particles']) {
      const c = getCatalogEntry(id)
      expect(c?.installed).toBe(true)
      expect(c?.compatibility).toContain('Note:')
    }
    // GridScan is excluded for its runtime CDN dependency (verified reason).
    const gridScan = getCatalogEntry('grid-scan')
    expect(gridScan?.installed).toBe(false)
    expect(gridScan?.notInstalledReason).toContain('CDN')
    // Lanyard is excluded at the current upstream pin because it directly
    // depends on `three` outside the approved Vanta contract.
    expect(getCatalogEntry('lanyard')?.notInstalledReason).toContain('`three`')
  })

  test('not-installed upstream entries carry an honest reason and are never advertised as installed', () => {
    expect(NOT_INSTALLED_CATALOG.length).toBeGreaterThan(0)
    for (const c of NOT_INSTALLED_CATALOG) {
      expect(c.installed).toBe(false)
      expect(c.notInstalledReason).toBeTruthy()
      expect(c.kitFiles).toEqual([])
    }
    // ids do not overlap with installed ones
    const installedIds = new Set(COMPONENT_CATALOG.map((c) => c.id))
    for (const c of NOT_INSTALLED_CATALOG) expect(installedIds.has(c.id)).toBe(false)
    expect(FULL_CATALOG.length).toBe(COMPONENT_CATALOG.length + NOT_INSTALLED_CATALOG.length)
  })

  test('pinned dependency matrix matches the audit (exact versions)', () => {
    expect(PINNED_DEPENDENCIES.gsap).toEqual({
      name: 'gsap',
      version: '3.13.0',
      license: "Standard 'No Charge' GSAP License (free incl. commercial use)",
      licenseUrl: 'https://gsap.com/standard-license',
    })
    expect(PINNED_DEPENDENCIES['vanta'].version).toBe('0.5.24')
    expect(PINNED_DEPENDENCIES['three'].version).toBe('0.134.0')
    expect(PINNED_DEPENDENCIES['@gsap/react'].version).toBe('2.1.2')
    expect(PINNED_DEPENDENCIES['framer-motion'].version).toBe('12.26.2')
    expect(PINNED_DEPENDENCIES['three'].license).toBe('MIT')
    expect(PINNED_DEPENDENCIES['vanta'].license).toBe('MIT')
    expect(PINNED_DEPENDENCIES['p5'].version).toBe('0.6.1')
    expect(PINNED_DEPENDENCIES['p5'].license).toContain('LGPL-2.1')
  })

  test('keyword auto-selection is bounded and tag-driven', () => {
    const picks = autoSelectComponents('Build a landing page with a typewriter hero heading and a spotlight card')
    expect(picks).toContain('text-type')
    expect(picks).toContain('spotlight-card')
    expect(picks.length).toBeLessThanOrEqual(5)
    expect(autoSelectComponents('fix the parse error in my python script')).toEqual([])
  })
})
