/**
 * BEAN Intelligence — MemAvailable probe tests (the hardware-probe fix
 * documented in docs/ai/LOCAL-MODEL-LANES.md): os.freemem() reports MemFree,
 * which on the deployment host reads ~0.2–1.0 GB while ~2.1 GB is actually
 * available — it wrongly refused every RAM-gated spawn. detectHardware() must
 * therefore reason over MemAvailable (procfs) and degrade gracefully on
 * non-Linux hosts.
 */
import { describe, expect, test } from 'bun:test'
import { memAvailableMbFromMeminfo } from '../../src/lib/ai-engine/gpu'

/** Verbatim shape of the recycled deployment host's /proc/meminfo (2026-11-16). */
const HOST_MEMINFO = `MemTotal:       3981008 kB
MemFree:          996996 kB
MemAvailable:    2072028 kB
Buffers:           45232 kB
Cached:          1230180 kB
SwapTotal:             0 kB
SwapFree:              0 kB
`

describe('memAvailableMbFromMeminfo', () => {
  test('parses MemAvailable, NOT MemFree (the measured 2 GB vs 1 GB trap)', () => {
    expect(memAvailableMbFromMeminfo(HOST_MEMINFO)).toBe(2023) // 2072028 kB / 1024 = 2023.46 → 2023 MB
  })

  test('null when the field is absent (older kernels / non-Linux)', () => {
    expect(memAvailableMbFromMeminfo('MemTotal: 1024 kB\nMemFree: 512 kB\n')).toBeNull()
  })

  test('null for empty or garbage input — caller falls back to os.freemem()', () => {
    expect(memAvailableMbFromMeminfo('')).toBeNull()
    expect(memAvailableMbFromMeminfo('not a meminfo file')).toBeNull()
  })

  test('tolerates irregular whitespace in the field line', () => {
    expect(memAvailableMbFromMeminfo('MemAvailable:   \t 1048576  kB')).toBe(1024)
  })
})
