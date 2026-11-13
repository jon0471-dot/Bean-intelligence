/**
 * BEAN Intelligence — Frontend Intelligence Toolkit: catalogue integrity
 * (Phase 1 registry truth + React Bits attribution/supply-chain checks).
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
  autoSelectComponents,
  getCatalogEntry,
} from '../../src/lib/frontend-intel/catalog'

const KIT_DIR = path.join(import.meta.dir, '../../src/components/giftz-kit')

describe('frontend-intel catalogue registry', () => {
  test('installed entries are unique, typed, and cover the work-order capability areas', () => {
    const ids = COMPONENT_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
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
    ]) {
      expect(categories.has(required), `missing category: ${required}`).toBe(true)
    }
  })

  test('every installed entry has honest metadata (source URL, license, attribution, pinned commit)', () => {
    for (const c of COMPONENT_CATALOG) {
      expect(c.installed).toBe(true)
      expect(c.sourceUrl.startsWith('https://github.com/DavidHDev/react-bits/blob/')).toBe(true)
      expect(c.sourceUrl).toContain(REACT_BITS_COMMIT)
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
        expect(content.includes(REACT_BITS_COMMIT), `${file} missing pinned upstream commit`).toBe(true)
      }
    }
  })

  test('kit files declare only the dependencies the registry records (no motion/react leftovers)', () => {
    const externalPackages = new Set([
      'react',
      'react-dom',
      'gsap',
      '@gsap/react',
      'framer-motion',
    ])
    for (const c of COMPONENT_CATALOG) {
      for (const file of c.kitFiles.filter((f) => f.endsWith('.tsx'))) {
        const src = readFileSync(path.join(KIT_DIR, file), 'utf8')
        // Adapted components must import framer-motion, never motion/react.
        if (c.adaptedFrom) {
          expect(c.adaptedFrom).toBe('motion/react -> framer-motion')
          expect(src.includes("from 'framer-motion'"), `${file} should import framer-motion`).toBe(true)
          expect(src.includes("from 'motion/react'"), `${file} must not import motion/react`).toBe(false)
        } else {
          expect(src.includes("from 'motion/react'"), `${file} unexpectedly imports motion/react`).toBe(false)
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

  test('components whose registry deps require gsap/framer-motion record them exactly', () => {
    const split = getCatalogEntry('split-text')
    expect(split?.dependencies).toEqual(['gsap', '@gsap/react'])
    const blur = getCatalogEntry('blur-text')
    expect(blur?.adaptedFrom).toBe('motion/react -> framer-motion')
    const shiny = getCatalogEntry('shiny-text')
    expect(shiny?.dependencies).toEqual([])
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
  })

  test('keyword auto-selection is bounded and tag-driven', () => {
    const picks = autoSelectComponents('Build a landing page with a typewriter hero heading and a spotlight card')
    expect(picks).toContain('text-type')
    expect(picks).toContain('spotlight-card')
    expect(picks.length).toBeLessThanOrEqual(5)
    expect(autoSelectComponents('fix the parse error in my python script')).toEqual([])
  })
})
