/**
 * M40 RTX harness bundler — bundles the REAL client-compute engine + harness
 * driver into validation/m40-rtx/bundle.js (esbuild, iife, browser).
 * Run: node validation/m40-rtx/build.mjs
 */
import esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

await esbuild.build({
  entryPoints: [path.join(here, 'harness-entry.ts')],
  outfile: path.join(here, 'bundle.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
})
console.log('bundle written:', path.join(here, 'bundle.js'))
