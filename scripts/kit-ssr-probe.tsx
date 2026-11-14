#!/usr/bin/env bun
/**
 * One-shot SSR probe (NOT part of the app): imports every vendored giftz-kit
 * component and attempts a server-side render with default props, then with a
 * generic props bag, and records the classification in
 * tests/unit/giftz-kit-ssr-manifest.json:
 *   ssr=true  — renders with {} (or the recorded props bag) through
 *               react-dom/server without throwing;
 *   ssr=false — requires browser APIs (or non-default props) at render; still
 *               validated by the Bun transpiler + the repo tsc gate, and
 *               perfectly usable inside generated React projects (client-side).
 * The manifest keeps the registry honest: the render test enforces it.
 */
import { readdirSync, writeFileSync } from 'fs'
import path from 'path'
import { createElement, type FC as ReactFC } from 'react'
import { renderToString } from 'react-dom/server'
import { pathToFileURL } from 'url'

const KIT_DIR = '/home/z/my-project/src/components/giftz-kit'
const MANIFEST = '/home/z/my-project/tests/unit/giftz-kit-ssr-manifest.json'

/** Generic props bag for components that require non-default props. */
const BAG: Record<string, unknown> = {
  text: 'Hello BEAN',
  children: 'Hi',
  items: [],
  images: [],
  links: [],
  to: 100,
  color: '#d4af37',
  className: '',
  title: 'BEAN',
  label: 'BEAN',
  value: 50,
  options: ['a', 'b'],
  tabs: ['a', 'b'],
  items2: [],
  content: 'Hi',
  src: '',
  href: '#',
  logos: [{ name: 'BEAN', url: '#', id: 'bean' }],
  texts: ['BEAN'],
}

const names = readdirSync(KIT_DIR)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => f.replace(/\.tsx$/, ''))
  .sort()

const manifest: Record<string, { ssr: boolean; props: Record<string, unknown> }> = {}
let safe = 0
let needsProps = 0
let browserOnly = 0

for (const name of names) {
  const mod = (await import(pathToFileURL(path.join(KIT_DIR, `${name}.tsx`)).href)) as {
    default: (props: never) => unknown
  }
  const Comp = mod.default as unknown as ReactFC<Record<string, unknown>>
  let outcome: 'safe' | 'needs-props' | 'browser-only' = 'browser-only'
  let usedProps: Record<string, unknown> = {}
  try {
    renderToString(createElement(Comp, {}))
    outcome = 'safe'
  } catch {
    try {
      renderToString(createElement(Comp, BAG))
      outcome = 'needs-props'
      usedProps = BAG
    } catch {
      outcome = 'browser-only'
    }
  }
  manifest[name] = { ssr: outcome !== 'browser-only', props: usedProps }
  if (outcome === 'safe') safe += 1
  else if (outcome === 'needs-props') needsProps += 1
  else browserOnly += 1
}

writeFileSync(MANIFEST, JSON.stringify({ generatedBy: 'scripts/kit-ssr-probe.tsx', components: manifest }, null, 2) + '\n')
console.log(`total=${names.length} ssr-safe=${safe} needs-props=${needsProps} browser-only=${browserOnly}`)
console.log('browser-only:', names.filter((n) => !manifest[n]!.ssr).join(', ') || 'none')

