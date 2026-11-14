#!/usr/bin/env bun
/**
 * One-shot expansion scan (NOT part of the app): enumerates the complete
 * upstream React Bits free collection at the pinned commit and classifies
 * every ts-default component by its bare-package imports, so the expansion
 * selection is evidence-based (which are zero-dep / already-approved deps,
 * and which need unapproved extra dependencies and must be excluded).
 * Read-only against /tmp/react-bits — nothing is copied by this script.
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import path from 'path'

const SRC = '/tmp/react-bits/src/ts-default'
const categories = readdirSync(SRC, { withFileTypes: true }).filter((d) => d.isDirectory())

interface Row {
  category: string
  name: string
  deps: string[] // bare imports excluding react/react-dom
  css: boolean
  loc: number
}

const rows: Row[] = []
for (const cat of categories) {
  const dir = path.join(SRC, cat.name)
  for (const comp of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const cdir = path.join(dir, comp.name)
    const tsx = path.join(cdir, `${comp.name}.tsx`)
    if (!existsSync(tsx)) continue
    const content = readFileSync(tsx, 'utf8')
    const deps = new Set<string>()
    const re = /(?:from\s+|import\s+|import\()['"]([^.'"/][^'"]*)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const spec = m[1]!
      const root = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (root !== 'react' && root !== 'react-dom' && root !== 'react/jsx-runtime') deps.add(root)
    }
    rows.push({
      category: cat.name,
      name: comp.name,
      deps: [...deps].sort(),
      css: existsSync(path.join(cdir, `${comp.name}.css`)),
      loc: content.split('\n').length,
    })
  }
}

// summarize dependency usage across the whole collection
const depCount = new Map<string, number>()
for (const r of rows) for (const d of r.deps) depCount.set(d, (depCount.get(d) ?? 0) + 1)
console.log('=== DEP USAGE ACROSS COLLECTION (dep: #components) ===')
console.log([...depCount.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d}:${n}`).join('  '))
console.log(`\nTOTAL components: ${rows.length}`)

const APPROVED = new Set(['gsap', '@gsap/react', 'framer-motion'])
const compatible = rows.filter((r) => r.deps.every((d) => APPROVED.has(d)))
const incompatible = rows.filter((r) => !r.deps.every((d) => APPROVED.has(d)))
console.log(`\n=== COMPATIBLE (zero-dep or approved deps only): ${compatible.length} ===`)
for (const r of compatible) console.log(`${r.category}/${r.name}  deps=[${r.deps.join(',')}] css=${r.css ? 'y' : 'n'} loc=${r.loc}`)
console.log(`\n=== INCOMPATIBLE (needs unapproved deps): ${incompatible.length} ===`)
for (const r of incompatible) console.log(`${r.category}/${r.name}  deps=[${r.deps.join(',')}]`)
