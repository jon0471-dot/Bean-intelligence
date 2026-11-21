#!/usr/bin/env node
/**
 * M26.2 — copy onnxruntime-node NATIVE libraries into the standalone output.
 *
 * Why: the local inference lanes (matting / inpainting / frame interpolation)
 * run on onnxruntime-node. Its binding (onnxruntime_binding.node) is traced
 * into .next/standalone by Next's file tracing, but libonnxruntime.so.1 is
 * dlopen'd BY the binding at runtime, so the tracer never sees it. A standalone
 * deployment without this copy fails on first use with
 * "ERR_DLOPEN_FAILED: libonnxruntime.so.1: cannot open shared object file".
 *
 * Copies the package's whole bin/ tree (binding + versioned .so) into the
 * standalone node_modules so the dlopen resolves next to the binding, exactly
 * as it does in a real node_modules install. Idempotent; run after `next build`.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const src = path.join(root, 'node_modules', 'onnxruntime-node', 'bin')
const dest = path.join(root, '.next', 'standalone', 'node_modules', 'onnxruntime-node', 'bin')

if (!fs.existsSync(src)) {
  // Package not installed (e.g. stripped production install) — nothing to do.
  console.log('[copy-native-libs] onnxruntime-node not present; skipping')
  process.exit(0)
}
if (!fs.existsSync(path.join(root, '.next', 'standalone'))) {
  console.log('[copy-native-libs] no standalone output; skipping (run after next build)')
  process.exit(0)
}

fs.mkdirSync(dest, { recursive: true })
let copied = 0
function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true })
      copyTree(s, d)
    } else {
      fs.copyFileSync(s, d)
      copied++
    }
  }
}
copyTree(src, dest)
console.log(`[copy-native-libs] copied ${copied} onnxruntime-node native files into .next/standalone`)
