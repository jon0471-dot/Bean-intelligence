#!/usr/bin/env node
/**
 * BEAN Intelligence — copy onnxruntime-web WASM/JS assets into public/ort.
 *
 * onnxruntime-web loads its .wasm/.mjs assets at runtime; serving them from
 * BEAN's own origin (no third-party CDN) is both a privacy choice and an
 * offline-resilience choice. ort.env.wasm.wasmPaths = '/ort/' (see
 * src/lib/client-compute/inference/ort-segmentation.ts).
 *
 * Files copied (onnxruntime-web 1.31.1):
 *  - ort-wasm-simd-threaded.jsep.wasm / .mjs  (WebGPU-capable JSEP build)
 *  - ort-wasm-simd-threaded.wasm / .mjs       (CPU/WASM build)
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const src = join(root, 'node_modules', 'onnxruntime-web', 'dist')
const dst = join(root, 'public', 'ort')

const FILES = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
]

try {
  mkdirSync(dst, { recursive: true })
  let copied = 0
  let bytes = 0
  for (const f of FILES) {
    const from = join(src, f)
    if (!existsSync(from)) continue
    const to = join(dst, f)
    // Skip when the identical-size file is already in place (idempotent).
    if (existsSync(to) && statSync(to).size === statSync(from).size) {
      copied++
      bytes += statSync(to).size
      continue
    }
    copyFileSync(from, to)
    copied++
    bytes += statSync(to).size
  }
  console.log(`[ort-assets] ${copied}/${FILES.length} assets present in public/ort (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
  if (copied < FILES.length) {
    console.warn('[ort-assets] WARNING: some onnxruntime-web assets were not found; WebGPU/WASM EPs may fail to initialize.')
  }
} catch (error) {
  console.error('[ort-assets] copy failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
}
