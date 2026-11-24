import { describe, expect, test } from 'bun:test'
import { detectCapabilities } from '@/lib/client-compute/capabilities'

/**
 * M39 regression: the WASM SIMD probe module must be a WELL-FORMED wasm
 * binary. The pre-M39-fix hand-built module carried only 12 of the 16
 * required v128 data bytes (code body size 15 instead of 20), so
 * WebAssembly.validate() rejected it on EVERY runtime — the probe always
 * reported simd:false and the probe gate (`wasmBinaryAvailable`) therefore
 * disabled the CPU/WASM chat lane, the browser segmentation fallback and the
 * browser ASR lane on every device, silently. This file pins the contract:
 * the committed bytes must validate (node/bun test runtimes ship WASM SIMD),
 * and a real detection must report simd:true here — if the module bytes are
 * ever malformed again, these tests fail in ANY environment, not only in a
 * SIMD-less browser.
 */

describe('WASM SIMD probe module integrity (M39 regression)', () => {
  test('detectCapabilities reports wasm supported in this runtime', async () => {
    const snapshot = await detectCapabilities()
    expect(snapshot.wasm.supported).toBe(true)
  })

  test('detectCapabilities reports simd:true in this SIMD-capable runtime', async () => {
    const snapshot = await detectCapabilities()
    // The test runtime (node/bun on x86-64/arm64) ships WASM SIMD. If this
    // fails, the probe module bytes are malformed again (the validate()
    // call would reject them in every browser, killing the wasm lanes).
    expect(snapshot.wasm.simd).toBe(true)
  })

  test('a v128.const module with full 16 data bytes validates (control)', () => {
    // Control: build the same module shape the probe uses, independently —
    // locals=0 + v128.const i32x4 (0xfd 0x0c) + 16 data bytes + end.
    const body = new Uint8Array([0x00, 0xfd, 0x0c, ...new Array<number>(16).fill(0), 0x0b])
    const code = new Uint8Array([0x01, body.length, ...body])
    const mod = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00,
      0x0a, code.length, ...code,
    ])
    expect(WebAssembly.validate(mod)).toBe(true)
  })

  test('a truncated v128.const module (12 data bytes) is rejected (documents the old defect)', () => {
    // This is byte-for-byte the pre-fix probe module shape: only 12 of the
    // 16 v128 data bytes, code body size 15. It must NOT validate — pinning
    // WHY the old probe always returned simd:false.
    const broken = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, 0x03,
      0x02, 0x01, 0x00, 0x0a, 0x11, 0x01, 0x0f, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0b,
    ])
    expect(WebAssembly.validate(broken)).toBe(false)
  })
})
