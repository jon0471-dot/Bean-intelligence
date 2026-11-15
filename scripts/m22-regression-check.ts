/**
 * M22 regression gate — library integrity counts (168 React Bits / 15 GSAP /
 * 13 Vanta), run against the committed modules like the M21 audit.
 */
import { COMPONENT_CATALOG } from '../src/lib/frontend-intel/catalog'
import { GSAP_PATTERNS } from '../src/lib/frontend-intel/gsap-patterns'
import { VANTA_EFFECTS } from '../src/lib/frontend-intel/vanta'
import fs from 'fs'

const installed = COMPONENT_CATALOG.filter((c: { installed: boolean }) => c.installed)
const kitFiles = fs.readdirSync('src/components/giftz-kit').filter((f) => f.endsWith('.tsx'))
console.log(JSON.stringify({
  reactBitsInstalled: installed.length,
  gsapPatterns: GSAP_PATTERNS.length,
  vantaEffects: VANTA_EFFECTS.length,
  kitSourcesOnDisk: kitFiles.length,
}, null, 2))
