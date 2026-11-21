/**
 * M28 — shared EBU R128 parser tests.
 *
 * Fixtures use the EXACT ffmpeg 7.1 output shapes measured on this host
 * (progressive per-window lines + final summary). The old first-match
 * parsing had two defects both covered here:
 *  - I: grabbed the first transient window value (could read -70 LUFS);
 *  - true peak never matched because the summary prints dBFS, not dBTP.
 */
import { describe, test, expect } from 'bun:test'
import { parseEbur128Summary } from '@/lib/media/loudness'

const FFMPEG71_SUMMARY = `[Parsed_ebur128_0 @ 0x7f2190001b40] t: 3.199958   TARGET:-23 LUFS    M: -24.8 S: -22.5     I: -22.4 LUFS       LRA:  20.0 LU  FTPK: -19.9 dBFS  TPK:  -6.0 dBFS
[Parsed_ebur128_0 @ 0x7f2190001b40] t: 3.599958   TARGET:-23 LUFS    M: -75.6 S: -23.6     I: -22.7 LUFS       LRA:  1.1 LU  FTPK:  -inf dBFS  TPK:  -6.0 dBFS
[Parsed_ebur128_0 @ 0x7f2190001b40] Summary:

  Integrated loudness:
    I:         -22.7 LUFS
    Threshold: -32.8 LUFS

  Loudness range:
    LRA:         1.2 LU
    Threshold: -42.9 LUFS
    LRA low:   -23.8 LUFS
    LRA high:  -22.5 LUFS

  True peak:
    Peak:       -6.0 dBFS
[out#0/null @ 0x56125c55dc80] video:0KiB audio:173KiB subtitle:0KiB other streams:0KiB global headers:0KiB muxing overhead: unknown`

const EMPTY_START = `[Parsed_ebur128_0 @ 0x0] t: 0.100000    TARGET:-23 LUFS    M: -120.7 S: -120.4     I: -70.0 LUFS       LRA:   0.0 LU  FTPK: -inf dBFS  TPK: -inf dBFS`

describe('parseEbur128Summary', () => {
  test('integrated loudness takes the SUMMARY value, not the first window', () => {
    const m = parseEbur128Summary(FFMPEG71_SUMMARY)
    expect(m.integratedLufs).toBe(-22.7)
  })

  test('true peak parses from the True-peak section with its printed unit (dBFS)', () => {
    const m = parseEbur128Summary(FFMPEG71_SUMMARY)
    expect(m.truePeak).toBe(-6.0)
    expect(m.truePeakUnit).toBe('dBFS')
  })

  test('loudness range LRA comes from the summary block', () => {
    const m = parseEbur128Summary(FFMPEG71_SUMMARY)
    expect(m.loudnessRangeLu).toBe(1.2)
  })

  test('a transient-only stream does not get a bogus integrated value promoted to a measurement', () => {
    // A single early window says I: -70.0 — that IS the only reported value
    // and is returned as-is (the caller sees an honest -70 rather than null).
    const m = parseEbur128Summary(EMPTY_START)
    expect(m.integratedLufs).toBe(-70.0)
    expect(m.truePeak).toBeNull()
    expect(m.truePeakUnit).toBeNull()
  })

  test('empty stderr yields all-null (measurement unavailable, never invented)', () => {
    const m = parseEbur128Summary('')
    expect(m.integratedLufs).toBeNull()
    expect(m.truePeak).toBeNull()
    expect(m.loudnessRangeLu).toBeNull()
    expect(m.truePeakUnit).toBeNull()
  })

  test('dBTP unit (older ffmpeg) is recorded when actually printed', () => {
    const older = `Summary:
  Integrated loudness:
    I:         -16.3 LUFS
  True peak:
    Peak:       -1.2 dBTP`
    const m = parseEbur128Summary(older)
    expect(m.truePeak).toBe(-1.2)
    expect(m.truePeakUnit).toBe('dBTP')
    expect(m.integratedLufs).toBe(-16.3)
  })
})
