#!/usr/bin/env bun
/**
 * One-shot curation script (NOT part of the app): copies the selected React
 * Bits components from the read-only /tmp/react-bits checkout into the BEAN
 * giftz-kit folder with attribution headers, and applies the recorded
 * adaptation (motion/react -> framer-motion). The React Bits repository
 * itself is never copied wholesale.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'

const SRC = '/tmp/react-bits/src/ts-default'
const DEST = '/home/z/my-project/src/components/giftz-kit'
const UPSTREAM_COMMIT = '4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce'

const SELECTED: Array<{ dir: string; name: string; adapted: boolean }> = [
  { dir: 'TextAnimations/SplitText', name: 'SplitText', adapted: false },
  { dir: 'TextAnimations/TextType', name: 'TextType', adapted: false },
  { dir: 'TextAnimations/BlurText', name: 'BlurText', adapted: true },
  { dir: 'TextAnimations/ShinyText', name: 'ShinyText', adapted: false },
  { dir: 'TextAnimations/GradientText', name: 'GradientText', adapted: false },
  { dir: 'TextAnimations/CountUp', name: 'CountUp', adapted: true },
  { dir: 'TextAnimations/ScrollReveal', name: 'ScrollReveal', adapted: false },
  { dir: 'Animations/AnimatedContent', name: 'AnimatedContent', adapted: false },
  { dir: 'Animations/StarBorder', name: 'StarBorder', adapted: false },
  { dir: 'Animations/ClickSpark', name: 'ClickSpark', adapted: false },
  { dir: 'Components/SpotlightCard', name: 'SpotlightCard', adapted: false },
  { dir: 'Animations/GlareHover', name: 'GlareHover', adapted: false },
  { dir: 'Components/GlassSurface', name: 'GlassSurface', adapted: false },
  { dir: 'Backgrounds/LetterGlitch', name: 'LetterGlitch', adapted: false },
  { dir: 'Backgrounds/DotGrid', name: 'DotGrid', adapted: false },
  { dir: 'Components/Dock', name: 'Dock', adapted: false },
  { dir: 'Micro/LatticeLoader', name: 'LatticeLoader', adapted: false },
]

mkdirSync(DEST, { recursive: true })
let copied = 0
for (const sel of SELECTED) {
  const dir = path.join(SRC, sel.dir)
  const upstreamUrl = `https://github.com/DavidHDev/react-bits/blob/${UPSTREAM_COMMIT}/src/ts-default/${sel.dir}`
  const header = [
    '/**',
    ` * ${sel.name} — React Bits (https://reactbits.dev) — MIT + Commons Clause v1.0.`,
    ` * Upstream source: ${upstreamUrl}`,
    ' * Copyright (c) 2026 David Haz. Use as part of an application, website or',
    ' * product is permitted; the components themselves may not be sold or',
    ' * redistributed standalone. Full notices: docs/THIRD-PARTY-NOTICES.md.',
    sel.adapted
      ? " * Adapted for BEAN Intelligence: import source 'motion/react' -> 'framer-motion'."
      : ' * Included verbatim (this attribution header added) by BEAN Intelligence.',
    ' */',
    '',
  ].join('\n')

  const tsxPath = path.join(dir, `${sel.name}.tsx`)
  if (!existsSync(tsxPath)) throw new Error(`missing upstream file: ${tsxPath}`)
  let tsx = readFileSync(tsxPath, 'utf8')
  if (sel.adapted) tsx = tsx.replaceAll('motion/react', 'framer-motion')
  writeFileSync(path.join(DEST, `${sel.name}.tsx`), header + tsx)
  copied += 1

  const cssPath = path.join(dir, `${sel.name}.css`)
  if (existsSync(cssPath)) {
    const css = readFileSync(cssPath, 'utf8')
    const cssHeader = `/* ${sel.name}.css — React Bits (https://reactbits.dev) — MIT + Commons Clause v1.0.\n * Upstream: ${upstreamUrl}/${sel.name}.css — Copyright (c) 2026 David Haz.\n * Included by BEAN Intelligence; notices: docs/THIRD-PARTY-NOTICES.md. */\n\n`
    writeFileSync(path.join(DEST, `${sel.name}.css`), cssHeader + css)
  }
  console.log(`copied ${sel.name}${existsSync(cssPath) ? ' (+css)' : ''}${sel.adapted ? ' (adapted: framer-motion)' : ''}`)
}
console.log(`DONE: ${copied} components into ${DEST}`)
